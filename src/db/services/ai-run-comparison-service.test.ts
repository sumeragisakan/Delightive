import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReasoningSuggestionOutput } from "../../ai/reasoning-output";
import { createDatabase, type DatabaseConnection } from "../connection";
import { AiReasoningRepository } from "../repositories/ai-reasoning-repository";
import { AiRunComparisonService } from "./ai-run-comparison-service";

describe("AI reasoning run comparison", () => {
  let connection: DatabaseConnection;
  let repository: AiReasoningRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    connection.sqlite.exec(`
      insert into cases (id, title) values ('case-1', '比较测试'), ('case-2', '其他案件');
      insert into reasoning_branches (id, case_id, name) values ('branch-1', 'case-1', '主线');
    `);
    repository = new AiReasoningRepository(connection);
  });

  afterEach(() => connection.sqlite.close());

  it("compares immutable contexts and pairs related suggestions without another model call", () => {
    const left = createCompletedRun(
      "request-left-0001",
      contextJson({
        acceptedInferences: [],
        fixedEvidence: [claim("claim-1", "门在二十二点锁上", 1)],
      }),
      [suggestion("可能存在侧门", "门锁未排除第二通路", 72, 1)],
    );
    const right = createCompletedRun(
      "request-right-0002",
      contextJson({
        acceptedInferences: [claim("claim-2", "证人可能看错时间", 1, "inference")],
        fixedEvidence: [claim("claim-1", "门在二十二点零五分锁上", 2)],
      }),
      [
        suggestion("可能存在侧门", "修订时间仍未排除第二通路", 61, 2),
        {
          citations: [{ claimId: "claim-2", relation: "depends_on", revision: 1 }],
          confidence: 55,
          content: "核对证人的计时依据。",
          kind: "investigation_gap",
          rationale: "可信推论依赖尚未核实的时间判断。",
          secondaryClaimId: null,
          targetClaimId: "claim-2",
          title: "核对证人时间",
        },
      ],
    );

    const comparison = new AiRunComparisonService(connection).compare(
      "case-1",
      left.id,
      right.id,
    );

    expect(comparison.contextCounts).toEqual({ added: 1, changed: 1, removed: 0 });
    expect(comparison.suggestionCounts).toEqual({
      changed: 1,
      leftOnly: 0,
      rightOnly: 1,
      same: 0,
    });
    expect(comparison.suggestionComparisons[0]).toMatchObject({
      changes: expect.arrayContaining(["建议内容", "可信度", "引用关系"]),
      kind: "changed",
    });
    expect(() =>
      new AiRunComparisonService(connection).compare("case-2", left.id, right.id),
    ).toThrow();
  });

  function createCompletedRun(
    requestKey: string,
    context: string,
    suggestions: ReasoningSuggestionOutput[],
  ) {
    const created = repository.createRun({
      branchId: "branch-1",
      caseId: "case-1",
      contextFingerprint: requestKey,
      contextJson: context,
      focusClaimId: null,
      mode: "hypothesis_expansion",
      model: "comparison-model",
      provider: "openai",
      requestKey,
      userPrompt: "",
    }).run;
    repository.completeRun({
      durationMs: 100,
      inputTokens: 20,
      outputTokens: 10,
      remoteResponseId: null,
      runId: created.id,
      suggestions: suggestions.map((output) => ({ output, validationIssues: [] })),
      summary: "比较测试运行",
      totalTokens: 30,
    });
    return created;
  }
});

function claim(id: string, content: string, revision: number, kind = "fact") {
  return { content, id, kind, revision, status: "accepted" };
}

function contextJson({
  acceptedInferences,
  fixedEvidence,
}: {
  acceptedInferences: unknown[];
  fixedEvidence: unknown[];
}) {
  return JSON.stringify({
    acceptedInferences,
    exploration: { claims: [] },
    fixedEvidence,
  });
}

function suggestion(
  title: string,
  content: string,
  confidence: number,
  revision: number,
): ReasoningSuggestionOutput {
  return {
    citations: [{ claimId: "claim-1", relation: "supports", revision }],
    confidence,
    content,
    kind: "hypothesis",
    rationale: "存在尚未排除的替代解释。",
    secondaryClaimId: null,
    targetClaimId: null,
    title,
  };
}
