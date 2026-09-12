import { randomUUID } from "node:crypto";

import { and, desc, eq, lt } from "drizzle-orm";

import type {
  ReasoningCitation,
  ReasoningSuggestionOutput,
} from "../../ai/reasoning-output";
import type { DatabaseConnection } from "../connection";
import {
  cases,
  claims,
  reasoningBranches,
  reasoningRunInputs,
  reasoningRuns,
  reasoningSuggestionEdits,
  reasoningSuggestions,
  type ReasoningRunErrorCode,
  type ReasoningRunMode,
  type ReasoningSuggestionResolutionKind,
} from "../schema";

type RunRow = typeof reasoningRuns.$inferSelect;
type RunInputRow = typeof reasoningRunInputs.$inferSelect;
type SuggestionRow = typeof reasoningSuggestions.$inferSelect;
type SuggestionEditRow = typeof reasoningSuggestionEdits.$inferSelect;

export type EditableSuggestion = {
  citations: ReasoningCitation[];
  confidence: number;
  content: string;
  rationale: string;
  secondaryClaimId: string | null;
  targetClaimId: string | null;
  title: string;
};

export type AiSuggestionEdit = Omit<SuggestionEditRow, "citationsJson"> & {
  citations: ReasoningCitation[];
};

export type AiSuggestion = SuggestionRow & {
  citations: ReasoningCitation[];
  edits: AiSuggestionEdit[];
  effective: EditableSuggestion;
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
    requestKey: string;
    retryOfRunId?: string | null;
    userPrompt: string;
  }): { created: boolean; run: RunRow } {
    this.assertCaseBranch(input.caseId, input.branchId);
    if (input.focusClaimId) this.assertClaimInCase(input.caseId, input.focusClaimId);
    if (input.retryOfRunId) {
      this.getRunForCase(input.caseId, input.retryOfRunId);
    }

    const existing = this.connection.db
      .select()
      .from(reasoningRuns)
      .where(eq(reasoningRuns.requestKey, input.requestKey))
      .get();
    if (existing) {
      if (existing.caseId !== input.caseId) {
        throw new Error("推演请求标识与案件不匹配。");
      }
      return { created: false, run: existing };
    }

    const transaction = this.connection.sqlite.transaction(() => {
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
          requestKey: input.requestKey,
          retryOfRunId: input.retryOfRunId ?? null,
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
    return { created: true, run: transaction() };
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
            secondaryClaimId: suggestion.output.secondaryClaimId,
            status:
              suggestion.validationIssues.length > 0 ? "invalid" : "pending",
            targetClaimId: suggestion.output.targetClaimId,
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
          errorCode: null,
          errorMessage: null,
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

  failRun(
    runId: string,
    errorCode: ReasoningRunErrorCode,
    errorMessage: string,
    durationMs: number,
  ) {
    return this.connection.db
      .update(reasoningRuns)
      .set({
        completedAt: new Date(),
        durationMs,
        errorCode,
        errorMessage,
        status: "failed",
      })
      .where(
        and(eq(reasoningRuns.id, runId), eq(reasoningRuns.status, "running")),
      )
      .returning()
      .get();
  }

  interruptExpiredRuns(caseId: string, olderThan: Date) {
    return this.connection.db
      .update(reasoningRuns)
      .set({
        completedAt: new Date(),
        errorCode: "interrupted",
        errorMessage: "运行未正常结束，已由系统回收；可以使用原设置重新运行。",
        status: "interrupted",
      })
      .where(
        and(
          eq(reasoningRuns.caseId, caseId),
          eq(reasoningRuns.status, "running"),
          lt(reasoningRuns.createdAt, olderThan),
        ),
      )
      .run();
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

  getRunForCase(caseId: string, runId: string) {
    const run = this.connection.db
      .select()
      .from(reasoningRuns)
      .where(and(eq(reasoningRuns.id, runId), eq(reasoningRuns.caseId, caseId)))
      .get();
    if (!run) throw new Error("找不到这次 AI 推演。");
    return run;
  }

  getSuggestionForCase(caseId: string, suggestionId: string) {
    const result = this.connection.db
      .select({
        input: reasoningRunInputs,
        run: reasoningRuns,
        suggestion: reasoningSuggestions,
      })
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
    if (!result) throw new Error("找不到这条 AI 建议。");
    return {
      input: result.input,
      run: result.run,
      suggestion: this.hydrateSuggestion(result.suggestion),
    };
  }

  addSuggestionEdit(
    caseId: string,
    suggestionId: string,
    baseRevision: number,
    input: EditableSuggestion & { note: string },
  ) {
    const transaction = this.connection.sqlite.transaction(() => {
      const record = this.getSuggestionForCase(caseId, suggestionId);
      if (record.suggestion.status !== "pending") {
        throw new Error("已处理的建议不能继续编辑。");
      }
      const currentRevision = record.suggestion.edits[0]?.revision ?? 0;
      if (currentRevision !== baseRevision) {
        throw new Error("建议已经被其他编辑更新，请刷新后重试。");
      }
      return this.connection.db
        .insert(reasoningSuggestionEdits)
        .values({
          citationsJson: JSON.stringify(input.citations),
          confidence: input.confidence,
          content: input.content,
          id: randomUUID(),
          note: input.note,
          rationale: input.rationale,
          revision: currentRevision + 1,
          secondaryClaimId: input.secondaryClaimId,
          suggestionId,
          targetClaimId: input.targetClaimId,
          title: input.title,
        })
        .returning()
        .get();
    });
    return transaction();
  }

  markSuggestionResolved(input: {
    acceptedClaimId?: string | null;
    acceptedClaimLinkId?: string | null;
    note?: string;
    resolutionKind: ReasoningSuggestionResolutionKind;
    suggestionId: string;
  }) {
    const updated = this.connection.db
      .update(reasoningSuggestions)
      .set({
        acceptedClaimId: input.acceptedClaimId ?? null,
        acceptedClaimLinkId: input.acceptedClaimLinkId ?? null,
        resolutionKind: input.resolutionKind,
        resolutionNote: input.note?.trim() ?? "",
        resolvedAt: new Date(),
        resolvedBy: "user",
        status: input.resolutionKind === "dismissed" ? "dismissed" : "accepted",
      })
      .where(
        and(
          eq(reasoningSuggestions.id, input.suggestionId),
          eq(reasoningSuggestions.status, "pending"),
        ),
      )
      .returning()
      .get();
    if (!updated) throw new Error("这条建议已经处理，不能重复操作。");
    return updated;
  }

  private listSuggestions(runId: string) {
    return this.connection.db
      .select()
      .from(reasoningSuggestions)
      .where(eq(reasoningSuggestions.runId, runId))
      .orderBy(desc(reasoningSuggestions.createdAt))
      .all()
      .map((suggestion) => this.hydrateSuggestion(suggestion));
  }

  private hydrateSuggestion(row: SuggestionRow): AiSuggestion {
    const edits = this.connection.db
      .select()
      .from(reasoningSuggestionEdits)
      .where(eq(reasoningSuggestionEdits.suggestionId, row.id))
      .orderBy(desc(reasoningSuggestionEdits.revision))
      .all()
      .map(hydrateEdit);
    const latest = edits[0];
    const citations = parseJsonArray<ReasoningCitation>(row.citationsJson);
    return {
      ...row,
      citations,
      edits,
      effective: latest
        ? {
            citations: latest.citations,
            confidence: latest.confidence,
            content: latest.content,
            rationale: latest.rationale,
            secondaryClaimId: latest.secondaryClaimId,
            targetClaimId: latest.targetClaimId,
            title: latest.title,
          }
        : {
            citations,
            confidence: row.confidence,
            content: row.content,
            rationale: row.rationale,
            secondaryClaimId: row.secondaryClaimId,
            targetClaimId: row.targetClaimId,
            title: row.title,
          },
      validationIssues: parseJsonArray<string>(row.validationIssuesJson),
    };
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
    if (!claim) throw new Error("聚焦内容不属于当前案件。");
  }
}

function hydrateEdit(row: SuggestionEditRow): AiSuggestionEdit {
  return {
    ...row,
    citations: parseJsonArray<ReasoningCitation>(row.citationsJson),
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
