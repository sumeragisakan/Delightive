import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ReasoningModelProvider,
  ReasoningModelRequest,
  ReasoningModelResult,
} from "../../ai/provider";
import { createDatabase, type DatabaseConnection } from "../connection";
import { claimLinks, claims, reasoningRuns } from "../schema";
import { CaseRepository } from "../repositories/case-repository";
import { EvidenceRepository } from "../repositories/evidence-repository";
import { ReasoningWorkspaceRepository } from "../repositories/reasoning-workspace-repository";
import { AiReasoningService } from "./ai-reasoning-service";

class MockProvider implements ReasoningModelProvider {
  readonly model = "mock-reasoner";
  readonly name = "mock";

  constructor(
    private readonly response: ReasoningModelResult | Error,
    readonly requests: ReasoningModelRequest[] = [],
  ) {}

  async generate(request: ReasoningModelRequest) {
    this.requests.push(request);
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

describe("AI reasoning service", () => {
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

  it("stores an immutable run snapshot and turns an accepted suggestion into an AI draft", async () => {
    const { branch, fact, mystery } = createFixture();
    const provider = new MockProvider(validResult(fact.id, fact.revision));
    const service = new AiReasoningService(connection, provider);

    const completed = await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      focusClaimId: fact.id,
      mode: "hypothesis_expansion",
      userPrompt: "检查门锁之后的行动路径",
    });
    const runs = service.listRuns(mystery.id, branch.id);

    expect(completed.status).toBe("completed");
    expect(provider.requests[0]).toMatchObject({
      focusClaimId: fact.id,
      mode: "hypothesis_expansion",
    });
    expect(runs[0].input.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(runs[0].input.contextJson)).toMatchObject({
      case: { id: mystery.id },
      fixedEvidence: [{ id: fact.id, revision: 1 }],
    });
    const suggestion = runs[0].suggestions[0];
    expect(suggestion).toMatchObject({ isStale: false, status: "pending" });

    const accepted = service.acceptSuggestion(mystery.id, suggestion.id);
    expect(accepted).toMatchObject({ createdBy: "ai", kind: "hypothesis", status: "draft" });
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
    expect(savedClaim?.revision).toBe(2);
    expect(link).toMatchObject({ createdBy: "ai", premiseClaimId: fact.id });
    expect(service.listRuns(mystery.id, branch.id)[0].suggestions[0]).toMatchObject({
      acceptedClaimId: accepted.id,
      status: "accepted",
    });
  });

  it("marks invented citations invalid and never exposes them as actionable", async () => {
    const { branch, mystery } = createFixture();
    const provider = new MockProvider(validResult("invented-claim", 1));
    const service = new AiReasoningService(connection, provider);

    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "consistency_check",
    });

    const suggestion = service.listRuns(mystery.id, branch.id)[0].suggestions[0];
    expect(suggestion.status).toBe("invalid");
    expect(suggestion.validationIssues[0]).toContain("不在当前上下文");
    expect(() => service.acceptSuggestion(mystery.id, suggestion.id)).toThrow(
      "不能被采纳",
    );
  });

  it("blocks acceptance when a cited claim has a newer revision", async () => {
    const { branch, fact, mystery, source } = createFixture();
    const service = new AiReasoningService(
      connection,
      new MockProvider(validResult(fact.id, fact.revision)),
    );
    await service.startRun({
      branchId: branch.id,
      caseId: mystery.id,
      mode: "counterexample_search",
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
      "引用内容已有变化",
    );
  });

  it("records provider failures with a safe local message", async () => {
    const { branch, mystery } = createFixture();
    const service = new AiReasoningService(
      connection,
      new MockProvider(new Error("secret upstream response")),
    );

    await expect(
      service.startRun({
        branchId: branch.id,
        caseId: mystery.id,
        mode: "investigation_gaps",
      }),
    ).rejects.toThrow("AI 推演失败");
    const failed = connection.db.select().from(reasoningRuns).get();
    expect(failed).toMatchObject({
      errorMessage: "AI 推演失败，请检查模型配置与网络后重试。",
      status: "failed",
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
    const branch = reasoning.createBranch({
      caseId: mystery.id,
      name: "密室路线",
    });
    return { branch, fact, mystery, source };
  }
});

function validResult(claimId: string, revision: number): ReasoningModelResult {
  return {
    remoteResponseId: "resp_mock",
    suggestions: [
      {
        citations: [{ claimId, relation: "supports", revision }],
        confidence: 72,
        content: "锁门后仍可能存在一条未记录的离开路线。",
        kind: "hypothesis",
        rationale: "已知锁门时间约束了正常出口，但没有排除其他路径。",
        title: "检查备用出口",
      },
    ],
    summary: "发现一条可进一步核验的路径假设。",
    usage: { inputTokens: 120, outputTokens: 48, totalTokens: 168 },
  };
}
