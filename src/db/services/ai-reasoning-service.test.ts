import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ReasoningProviderError,
  type ReasoningModelProvider,
  type ReasoningModelRequest,
  type ReasoningModelResult,
} from "../../ai/provider";
import { createDatabase, type DatabaseConnection } from "../connection";
import {
  claimLinks,
  claims,
  investigationItems,
  reasoningRuns,
} from "../schema";
import { CaseRepository } from "../repositories/case-repository";
import { EvidenceRepository } from "../repositories/evidence-repository";
import { ReasoningWorkspaceRepository } from "../repositories/reasoning-workspace-repository";
import { AiReasoningService } from "./ai-reasoning-service";

class MockProvider implements ReasoningModelProvider {
  readonly model = "mock-reasoner";
  readonly name = "mock";

  constructor(
    private readonly response:
      | ReasoningModelResult
      | Error
      | ((request: ReasoningModelRequest) => ReasoningModelResult),
    readonly requests: ReasoningModelRequest[] = [],
  ) {}

  async generate(request: ReasoningModelRequest) {
    this.requests.push(request);
    if (this.response instanceof Error) throw this.response;
    return typeof this.response === "function"
      ? this.response(request)
      : this.response;
  }
}

describe("AI reasoning review loop", () => {
  let connection: DatabaseConnection;
  let cases: CaseRepository;
  let evidence: EvidenceRepository;
  let reasoning: ReasoningWorkspaceRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    cases = new CaseRepository(connection);
    evidence = new EvidenceRepository(connection);
    reasoning = new ReasoningWorkspaceRepository(connection);
  });

  afterEach(() => connection.sqlite.close());

  it("preserves model output while accepting the latest human edit as an AI draft", async () => {
    const { branch, fact, mystery } = createFixture();
    const provider = new MockProvider(resultFor("hypothesis", [citation(fact.id)]));
    const service = new AiReasoningService(connection, provider);

    const completed = await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      focusClaimId: fact.id,
      mode: "hypothesis_expansion",
      requestKey: requestKey(1),
      userPrompt: "检查门锁之后的行动路径",
    });
    expect(completed.run.status).toBe("completed");
    let suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];

    service.editSuggestion(mystery.id, suggestion.id, 0, {
      citations: suggestion.effective.citations,
      confidence: 64,
      content: "人工修订：锁门后可能存在未记录的通路。",
      note: "去掉过度确定的措辞",
      rationale: "门锁只排除了正常入口。",
      secondaryClaimId: null,
      targetClaimId: null,
      title: "修订后的备用通路",
    });
    suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];
    expect(suggestion.content).toBe("锁门后仍可能存在一条未记录的离开路线。");
    expect(suggestion.effective.content).toContain("人工修订");
    expect(suggestion.edits[0]).toMatchObject({ revision: 1, editedBy: "user" });

    const accepted = service.acceptSuggestion(mystery.id, suggestion.id, "人工确认");
    expect(accepted.kind).toBe("hypothesis");
    const savedClaim = connection.db
      .select()
      .from(claims)
      .where(eq(claims.id, accepted.id))
      .get();
    const link = connection.db
      .select()
      .from(claimLinks)
      .where(eq(claimLinks.conclusionClaimId, accepted.id))
      .get();
    expect(savedClaim).toMatchObject({
      content: "人工修订：锁门后可能存在未记录的通路。",
      createdBy: "ai",
      kind: "hypothesis",
      status: "draft",
    });
    expect(link).toMatchObject({ createdBy: "ai", premiseClaimId: fact.id });
    expect(service.listRuns(mystery.id, branch.id)[0].suggestions[0]).toMatchObject({
      acceptedClaimId: accepted.id,
      resolutionKind: "hypothesis_created",
      resolutionNote: "人工确认",
      status: "accepted",
    });
  });

  it("deduplicates repeated submissions before calling the provider twice", async () => {
    const { branch, fact, mystery } = createFixture();
    const provider = new MockProvider(resultFor("hypothesis", [citation(fact.id)]));
    const service = new AiReasoningService(connection, provider);
    const input = {
      branchId: branch.id,
      caseId: mystery.id,
      mode: "hypothesis_expansion" as const,
      requestKey: requestKey(2),
    };

    const first = await service.startRun(input);
    const second = await service.startRun(input);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(provider.requests).toHaveLength(1);
  });

  it("marks invented citations and incomplete typed targets invalid", async () => {
    const { branch, mystery } = createFixture();
    const provider = new MockProvider(
      resultFor("counterexample", [citation("invented-claim")]),
    );
    const service = new AiReasoningService(connection, provider);

    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "counterexample_search",
      requestKey: requestKey(3),
    });

    const suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];
    expect(suggestion.status).toBe("invalid");
    expect(suggestion.validationIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("不在当前上下文"),
        "反例必须指定被反驳的目标",
      ]),
    );
  });

  it("blocks acceptance when a cited claim has a newer revision", async () => {
    const { branch, fact, mystery, source } = createFixture();
    const service = new AiReasoningService(
      connection,
      new MockProvider(resultFor("hypothesis", [citation(fact.id)])),
    );
    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "hypothesis_expansion",
      requestKey: requestKey(4),
    });
    const suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];

    evidence.updateSource(mystery.id, source.id, {
      kind: "user",
      title: "修订正文",
    });
    evidence.updateEvidenceClaim(mystery.id, fact.id, {
      content: "门在二十二点零五分锁上",
      status: "accepted",
    });

    expect(service.listRuns(mystery.id, branch.id)[0].suggestions[0].isStale).toBe(true);
    expect(() => service.acceptSuggestion(mystery.id, suggestion.id)).toThrow(
      "建议已不可用",
    );
  });

  it("turns a counterexample into a draft with an explicit contradiction", async () => {
    const { branch, fact, mystery } = createFixture();
    const provider = new MockProvider(
      resultFor("counterexample", [citation(fact.id)], fact.id),
    );
    const service = new AiReasoningService(connection, provider);
    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "counterexample_search",
      requestKey: requestKey(5),
    });
    const suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];

    const accepted = service.acceptSuggestion(mystery.id, suggestion.id);
    const link = connection.db
      .select()
      .from(claimLinks)
      .where(eq(claimLinks.conclusionClaimId, accepted.id))
      .get();
    expect(link).toMatchObject({ premiseClaimId: fact.id, relation: "contradicts" });
    expect(reasoning.listConflicts(mystery.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ isOpen: true })]),
    );
  });

  it("turns a contradiction into a reviewable link between two existing claims", async () => {
    const { branch, fact, mystery, secondFact } = createFixture();
    const provider = new MockProvider(
      resultFor(
        "contradiction",
        [citation(fact.id), citation(secondFact.id)],
        fact.id,
        secondFact.id,
      ),
    );
    const service = new AiReasoningService(connection, provider);
    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "consistency_check",
      requestKey: requestKey(6),
    });
    const suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];

    const accepted = service.acceptSuggestion(mystery.id, suggestion.id);
    expect(accepted.kind).toBe("conflict");
    expect(connection.db.select().from(claimLinks).where(eq(claimLinks.id, accepted.id)).get()).toMatchObject({
      premiseClaimId: fact.id,
      conclusionClaimId: secondFact.id,
      relation: "contradicts",
    });
    expect(service.listRuns(mystery.id, branch.id)[0].suggestions[0]).toMatchObject({
      acceptedClaimLinkId: accepted.id,
      resolutionKind: "conflict_created",
    });
  });

  it("turns an investigation gap into a lightweight linked investigation item", async () => {
    const { branch, fact, mystery } = createFixture();
    const provider = new MockProvider(
      resultFor("investigation_gap", [citation(fact.id)], fact.id),
    );
    const service = new AiReasoningService(connection, provider);
    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "investigation_gaps",
      requestKey: requestKey(7),
    });
    const suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];

    const accepted = service.acceptSuggestion(mystery.id, suggestion.id);
    expect(accepted.kind).toBe("investigation");
    expect(connection.db.select().from(investigationItems).get()).toMatchObject({
      createdBy: "ai",
      originSuggestionId: suggestion.id,
      status: "pending",
    });
    expect(service.listInvestigationItems(mystery.id, branch.id)[0].claims).toEqual([
      expect.objectContaining({ claimId: fact.id, role: "target" }),
    ]);
  });

  it("links retries to their source while rebuilding the current snapshot", async () => {
    const { branch, mystery } = createFixture();
    const provider = new MockProvider((request) => {
      const current = request.context.fixedEvidence[0];
      return resultFor("hypothesis", [citation(current.id, current.revision)]);
    });
    const service = new AiReasoningService(connection, provider);
    const first = await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "hypothesis_expansion",
      requestKey: requestKey(8),
    });
    reasoning.createHypothesis({
      branchId: branch.id,
      caseId: mystery.id,
      content: "后来加入的分支草稿",
    });

    const retried = await service.retryRun(mystery.id, first.run.id, requestKey(9));
    const retryRecord = service.listRuns(mystery.id, branch.id).find(
      ({ id }) => id === retried.run.id,
    );
    expect(retryRecord?.retryOfRunId).toBe(first.run.id);
    expect(JSON.parse(retryRecord?.input.contextJson ?? "{}").exploration.claims).toHaveLength(1);
    expect(provider.requests).toHaveLength(2);
  });

  it("recovers abandoned runs and stores safe provider error categories", async () => {
    const { branch, mystery } = createFixture();
    const provider = new MockProvider(
      new ReasoningProviderError("rate_limit", "模型服务暂时限流，请稍后重试。"),
    );
    const service = new AiReasoningService(connection, provider);
    await expect(
      service.startRun({
        branchId: branch.id,
        caseId: mystery.id,
        mode: "investigation_gaps",
        requestKey: requestKey(10),
      }),
    ).rejects.toThrow("限流");
    expect(connection.db.select().from(reasoningRuns).get()).toMatchObject({
      errorCode: "rate_limit",
      status: "failed",
    });

    const old = connection.db
      .insert(reasoningRuns)
      .values({
        branchId: branch.id,
        caseId: mystery.id,
        id: "abandoned-run",
        mode: "consistency_check",
        model: "mock",
        provider: "mock",
      })
      .returning()
      .get();
    service.recoverInterruptedRuns(mystery.id, new Date(Date.now() + 6 * 60 * 1_000));
    expect(connection.db.select().from(reasoningRuns).where(eq(reasoningRuns.id, old.id)).get()).toMatchObject({
      errorCode: "interrupted",
      status: "interrupted",
    });
  });

  function createFixture() {
    const mystery = cases.createCase({ title: "AI 推演案件" });
    const source = evidence.createSource({ caseId: mystery.id, title: "正文" });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "门在二十二点锁上",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const secondFact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "证人称二十二点十分看见门仍然打开",
      kind: "statement",
      sourceId: source.id,
      status: "accepted",
    });
    const branch = reasoning.createBranch({
      caseId: mystery.id,
      name: "密室路线",
    });
    return { branch, fact, mystery, secondFact, source };
  }
});

function resultFor(
  kind: "hypothesis" | "counterexample" | "contradiction" | "investigation_gap",
  citations: ReasoningModelResult["suggestions"][number]["citations"],
  targetClaimId: string | null = null,
  secondaryClaimId: string | null = null,
): ReasoningModelResult {
  return {
    remoteResponseId: "resp_mock",
    suggestions: [
      {
        citations,
        confidence: 72,
        content: "锁门后仍可能存在一条未记录的离开路线。",
        kind,
        rationale: "已知锁门时间约束了正常出口，但没有排除其他路径。",
        secondaryClaimId,
        targetClaimId,
        title: "检查备用出口",
      },
    ],
    summary: "发现一条可进一步核验的路径假设。",
    usage: { inputTokens: 120, outputTokens: 48, totalTokens: 168 },
  };
}

function citation(claimId: string, revision = 1) {
  return { claimId, relation: "supports" as const, revision };
}

function requestKey(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
