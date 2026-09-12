import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { ReasoningCitation, ReasoningSuggestionOutput } from "../../ai/reasoning-output";
import type { DatabaseConnection } from "../connection";
import {
  cases,
  claims,
  reasoningBranches,
  reasoningRunInputs,
  reasoningRuns,
  reasoningSuggestions,
  type ReasoningRunMode,
} from "../schema";

type RunRow = typeof reasoningRuns.$inferSelect;
type RunInputRow = typeof reasoningRunInputs.$inferSelect;
type SuggestionRow = typeof reasoningSuggestions.$inferSelect;

export type AiSuggestion = SuggestionRow & {
  citations: ReasoningCitation[];
  validationIssues: string[];
};

export type AiReasoningRun = RunRow & {
  input: RunInputRow;
  suggestions: AiSuggestion[];
};

export class AiReasoningRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  createRun(input: {
    branchId: string;
    caseId: string;
    contextFingerprint: string;
    contextJson: string;
    focusClaimId: string | null;
    mode: ReasoningRunMode;
    model: string;
    provider: string;
    userPrompt: string;
  }) {
    this.assertCaseBranch(input.caseId, input.branchId);
    if (input.focusClaimId) {
      this.assertClaimInCase(input.caseId, input.focusClaimId);
    }

    const run = this.connection.sqlite.transaction(() => {
      const created = this.connection.db
        .insert(reasoningRuns)
        .values({
          id: randomUUID(),
          branchId: input.branchId,
          caseId: input.caseId,
          focusClaimId: input.focusClaimId,
          mode: input.mode,
          model: input.model,
          provider: input.provider,
          userPrompt: input.userPrompt,
        })
        .returning()
        .get();
      this.connection.db
        .insert(reasoningRunInputs)
        .values({
          contextFingerprint: input.contextFingerprint,
          contextJson: input.contextJson,
          id: randomUUID(),
          runId: created.id,
        })
        .run();
      return created;
    });

    return run();
  }

  completeRun(input: {
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    remoteResponseId: string | null;
    runId: string;
    suggestions: Array<{
      output: ReasoningSuggestionOutput;
      validationIssues: string[];
    }>;
    summary: string;
    totalTokens: number | null;
  }) {
    const transaction = this.connection.sqlite.transaction(() => {
      const completedAt = new Date();
      for (const suggestion of input.suggestions) {
        this.connection.db
          .insert(reasoningSuggestions)
          .values({
            citationsJson: JSON.stringify(suggestion.output.citations),
            confidence: suggestion.output.confidence,
            content: suggestion.output.content,
            id: randomUUID(),
            kind: suggestion.output.kind,
            rationale: suggestion.output.rationale,
            runId: input.runId,
            status:
              suggestion.validationIssues.length > 0 ? "invalid" : "pending",
            title: suggestion.output.title,
            validationIssuesJson: JSON.stringify(suggestion.validationIssues),
          })
          .run();
      }
      return this.connection.db
        .update(reasoningRuns)
        .set({
          completedAt,
          durationMs: input.durationMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          remoteResponseId: input.remoteResponseId,
          status: "completed",
          summary: input.summary,
          totalTokens: input.totalTokens,
        })
        .where(
          and(eq(reasoningRuns.id, input.runId), eq(reasoningRuns.status, "running")),
        )
        .returning()
        .get();
    });
    return transaction();
  }

  failRun(runId: string, errorMessage: string, durationMs: number) {
    return this.connection.db
      .update(reasoningRuns)
      .set({
        completedAt: new Date(),
        durationMs,
        errorMessage,
        status: "failed",
      })
      .where(
        and(eq(reasoningRuns.id, runId), eq(reasoningRuns.status, "running")),
      )
      .returning()
      .get();
  }

  listRuns(caseId: string, branchId?: string | null): AiReasoningRun[] {
    const where = branchId
      ? and(eq(reasoningRuns.caseId, caseId), eq(reasoningRuns.branchId, branchId))
      : eq(reasoningRuns.caseId, caseId);
    return this.connection.db
      .select({ input: reasoningRunInputs, run: reasoningRuns })
      .from(reasoningRuns)
      .innerJoin(reasoningRunInputs, eq(reasoningRunInputs.runId, reasoningRuns.id))
      .where(where)
      .orderBy(desc(reasoningRuns.createdAt))
      .all()
      .map(({ input, run }) => ({
        ...run,
        input,
        suggestions: this.listSuggestions(run.id),
      }));
  }

  getSuggestionForCase(caseId: string, suggestionId: string) {
    const result = this.connection.db
      .select({ input: reasoningRunInputs, run: reasoningRuns, suggestion: reasoningSuggestions })
      .from(reasoningSuggestions)
      .innerJoin(reasoningRuns, eq(reasoningRuns.id, reasoningSuggestions.runId))
      .innerJoin(reasoningRunInputs, eq(reasoningRunInputs.runId, reasoningRuns.id))
      .where(
        and(
          eq(reasoningSuggestions.id, suggestionId),
          eq(reasoningRuns.caseId, caseId),
        ),
      )
      .get();
    if (!result) {
      throw new Error("找不到这条 AI 建议。");
    }
    return {
      input: result.input,
      run: result.run,
      suggestion: hydrateSuggestion(result.suggestion),
    };
  }

  markSuggestionAccepted(suggestionId: string, acceptedClaimId: string) {
    const updated = this.connection.db
      .update(reasoningSuggestions)
      .set({ acceptedClaimId, resolvedAt: new Date(), status: "accepted" })
      .where(
        and(
          eq(reasoningSuggestions.id, suggestionId),
          eq(reasoningSuggestions.status, "pending"),
        ),
      )
      .returning()
      .get();
    if (!updated) {
      throw new Error("这条建议已经处理，不能重复采纳。");
    }
    return updated;
  }

  dismissSuggestion(caseId: string, suggestionId: string) {
    this.getSuggestionForCase(caseId, suggestionId);
    const updated = this.connection.db
      .update(reasoningSuggestions)
      .set({ resolvedAt: new Date(), status: "dismissed" })
      .where(
        and(
          eq(reasoningSuggestions.id, suggestionId),
          eq(reasoningSuggestions.status, "pending"),
        ),
      )
      .returning()
      .get();
    if (!updated) {
      throw new Error("这条建议已经处理。");
    }
    return updated;
  }

  private listSuggestions(runId: string) {
    return this.connection.db
      .select()
      .from(reasoningSuggestions)
      .where(eq(reasoningSuggestions.runId, runId))
      .orderBy(desc(reasoningSuggestions.createdAt))
      .all()
      .map(hydrateSuggestion);
  }

  private assertCaseBranch(caseId: string, branchId: string) {
    const caseFile = this.connection.db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.id, caseId))
      .get();
    const branch = this.connection.db
      .select()
      .from(reasoningBranches)
      .where(
        and(eq(reasoningBranches.id, branchId), eq(reasoningBranches.caseId, caseId)),
      )
      .get();
    if (!caseFile || !branch || branch.status !== "active") {
      throw new Error("只能在当前案件的活动分支中运行 AI 推演。");
    }
  }

  private assertClaimInCase(caseId: string, claimId: string) {
    const claim = this.connection.db
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.caseId, caseId)))
      .get();
    if (!claim) {
      throw new Error("聚焦内容不属于当前案件。");
    }
  }
}

function hydrateSuggestion(row: SuggestionRow): AiSuggestion {
  return {
    ...row,
    citations: parseJsonArray<ReasoningCitation>(row.citationsJson),
    validationIssues: parseJsonArray<string>(row.validationIssuesJson),
  };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
