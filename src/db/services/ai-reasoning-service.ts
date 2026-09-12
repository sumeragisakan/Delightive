import {
  ReasoningProviderError,
  type ReasoningModelProvider,
} from "../../ai/provider";
import {
  fingerprintReasoningContext,
  serializeReasoningContext,
} from "../../ai/context-snapshot";
import type { ReasoningCitation } from "../../ai/reasoning-output";
import type { DatabaseConnection } from "../connection";
import {
  AiReasoningRepository,
  type AiReasoningRun,
  type AiSuggestion,
  type EditableSuggestion,
} from "../repositories/ai-reasoning-repository";
import { InvestigationRepository } from "../repositories/investigation-repository";
import { ReasoningWorkspaceRepository } from "../repositories/reasoning-workspace-repository";
import type {
  ReasoningRunErrorCode,
  ReasoningRunMode,
} from "../schema";
import {
  buildReasoningContext,
  type ReasoningContext,
} from "./reasoning-context-service";

const expiredRunAgeMs = 5 * 60 * 1_000;

export type AiSuggestionView = AiSuggestion & { isStale: boolean };
export type AiReasoningRunView = Omit<AiReasoningRun, "suggestions"> & {
  isStale: boolean;
  suggestions: AiSuggestionView[];
};

export class AiReasoningService {
  private readonly repository: AiReasoningRepository;
  private readonly investigations: InvestigationRepository;
  private readonly workspace: ReasoningWorkspaceRepository;

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly provider?: ReasoningModelProvider,
  ) {
    this.repository = new AiReasoningRepository(connection);
    this.investigations = new InvestigationRepository(connection);
    this.workspace = new ReasoningWorkspaceRepository(connection);
  }

  async startRun(input: {
    branchId: string;
    caseId: string;
    focusClaimId?: string | null;
    mode: ReasoningRunMode;
    requestKey: string;
    retryOfRunId?: string | null;
    userPrompt?: string;
  }) {
    if (!this.provider) throw new Error("AI provider is required to start a run.");
    assertRequestKey(input.requestKey);
    this.recoverInterruptedRuns(input.caseId);
    const context = this.getExactContext(input.caseId, input.branchId);
    const referenceMap = buildReferenceMap(context);
    const focusClaimId = input.focusClaimId ?? null;
    if (focusClaimId && !referenceMap.has(focusClaimId)) {
      throw new Error("聚焦内容不在当前分支可见范围内。");
    }
    const contextJson = serializeReasoningContext(context);
    if (contextJson.length > 500_000) {
      throw new Error("当前推理上下文过大，请缩小分支内容后再运行。");
    }
    const created = this.repository.createRun({
      branchId: input.branchId,
      caseId: input.caseId,
      contextFingerprint: fingerprintReasoningContext(contextJson),
      contextJson,
      focusClaimId,
      mode: input.mode,
      model: this.provider.model,
      provider: this.provider.name,
      requestKey: input.requestKey,
      retryOfRunId: input.retryOfRunId,
      userPrompt: input.userPrompt?.trim() ?? "",
    });
    if (!created.created) {
      return { deduplicated: true, run: created.run };
    }
    const startedAt = Date.now();

    try {
      const result = await this.provider.generate({
        context,
        focusClaimId,
        mode: input.mode,
        userPrompt: input.userPrompt?.trim() ?? "",
      });
      const suggestions = result.suggestions.map((output) => ({
        output,
        validationIssues: validateSuggestion(
          output.kind,
          output,
          referenceMap,
        ),
      }));
      const run = this.repository.completeRun({
        durationMs: Date.now() - startedAt,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        remoteResponseId: result.remoteResponseId,
        runId: created.run.id,
        suggestions,
        summary: result.summary,
        totalTokens: result.usage.totalTokens,
      });
      return { deduplicated: false, run };
    } catch (error) {
      const failure = safeRunError(error);
      this.repository.failRun(
        created.run.id,
        failure.code,
        failure.message,
        Date.now() - startedAt,
      );
      throw new Error(failure.message, { cause: error });
    }
  }

  async retryRun(caseId: string, runId: string, requestKey: string) {
    const previous = this.repository.getRunForCase(caseId, runId);
    if (previous.status === "running") {
      throw new Error("仍在运行的推演不能重复启动。");
    }
    return this.startRun({
      branchId: previous.branchId,
      caseId,
      focusClaimId: previous.focusClaimId,
      mode: previous.mode,
      requestKey,
      retryOfRunId: previous.id,
      userPrompt: previous.userPrompt,
    });
  }

  listRuns(caseId: string, branchId: string): AiReasoningRunView[] {
    this.recoverInterruptedRuns(caseId);
    const context = this.getExactContext(caseId, branchId);
    const currentContextJson = serializeReasoningContext(context);
    const currentFingerprint = fingerprintReasoningContext(currentContextJson);
    const references = buildReferenceMap(context);

    return this.repository.listRuns(caseId, branchId).map((run) => ({
      ...run,
      isStale: run.input.contextFingerprint !== currentFingerprint,
      suggestions: run.suggestions.map((suggestion) => ({
        ...suggestion,
        isStale: !citationsAreCurrent(
          suggestion.effective.citations,
          references,
        ),
      })),
    }));
  }

  editSuggestion(
    caseId: string,
    suggestionId: string,
    baseRevision: number,
    input: EditableSuggestion & { note: string },
  ) {
    const record = this.repository.getSuggestionForCase(caseId, suggestionId);
    assertEditableSuggestion(input);
    const originalIds = new Set(record.suggestion.citations.map(({ claimId }) => claimId));
    if (input.citations.some(({ claimId }) => !originalIds.has(claimId))) {
      throw new Error("编辑只能调整模型原先引用的内容和关系。");
    }
    const context = this.getExactContext(caseId, record.run.branchId);
    const issues = validateSuggestion(
      record.suggestion.kind,
      input,
      buildReferenceMap(context),
    );
    if (issues.length > 0) throw new Error(issues.join("；"));
    return this.repository.addSuggestionEdit(
      caseId,
      suggestionId,
      baseRevision,
      { ...input, note: input.note.trim() },
    );
  }

  acceptSuggestion(caseId: string, suggestionId: string, note = "") {
    const record = this.repository.getSuggestionForCase(caseId, suggestionId);
    if (record.run.status !== "completed" || record.suggestion.status !== "pending") {
      throw new Error("这条建议当前不能被采纳。");
    }
    if (record.suggestion.validationIssues.length > 0) {
      throw new Error("这条建议的模型原始引用未通过校验，不能采纳。");
    }
    const effective = record.suggestion.effective;
    const context = this.getExactContext(caseId, record.run.branchId);
    const issues = validateSuggestion(
      record.suggestion.kind,
      effective,
      buildReferenceMap(context),
    );
    if (issues.length > 0) {
      throw new Error(`建议已不可用：${issues.join("；")}`);
    }

    const transaction = this.connection.sqlite.transaction(() => {
      if (record.suggestion.kind === "contradiction") {
        const link = this.workspace.createContradiction({
          caseId,
          conclusionClaimId: requireId(effective.secondaryClaimId),
          createdBy: "ai",
          premiseClaimId: requireId(effective.targetClaimId),
          rationale: effective.rationale,
          strength: effective.confidence,
        });
        this.repository.markSuggestionResolved({
          acceptedClaimLinkId: link.id,
          note,
          resolutionKind: "conflict_created",
          suggestionId,
        });
        return { id: link.id, kind: "conflict" as const };
      }
      if (record.suggestion.kind === "investigation_gap") {
        const item = this.investigations.createFromSuggestion({
          branchId: record.run.branchId,
          caseId,
          citations: effective.citations,
          notes: effective.rationale,
          originSuggestionId: suggestionId,
          question: effective.content,
          targetClaimId: effective.targetClaimId,
          title: effective.title,
        });
        this.repository.markSuggestionResolved({
          note,
          resolutionKind: "investigation_created",
          suggestionId,
        });
        return { id: item.id, kind: "investigation" as const };
      }

      const claim = this.workspace.createHypothesis({
        branchId: record.run.branchId,
        caseId,
        confidence: effective.confidence,
        content: effective.content,
        createdBy: "ai",
      });
      for (const citation of effective.citations) {
        const relation =
          record.suggestion.kind === "counterexample" &&
          citation.claimId === effective.targetClaimId
            ? "contradicts"
            : citation.relation;
        this.workspace.addArgument({
          caseId,
          conclusionClaimId: claim.id,
          createdBy: "ai",
          premiseClaimId: citation.claimId,
          rationale: effective.rationale,
          relation,
          strength: effective.confidence,
        });
      }
      this.repository.markSuggestionResolved({
        acceptedClaimId: claim.id,
        note,
        resolutionKind: "hypothesis_created",
        suggestionId,
      });
      return { id: claim.id, kind: "hypothesis" as const };
    });
    return transaction();
  }

  dismissSuggestion(caseId: string, suggestionId: string, note = "") {
    const record = this.repository.getSuggestionForCase(caseId, suggestionId);
    if (record.suggestion.status !== "pending") {
      throw new Error("这条建议已经处理。");
    }
    return this.repository.markSuggestionResolved({
      note,
      resolutionKind: "dismissed",
      suggestionId,
    });
  }

  listInvestigationItems(caseId: string, branchId: string) {
    this.getExactContext(caseId, branchId);
    return this.investigations.listItems(caseId, branchId);
  }

  recoverInterruptedRuns(caseId: string, now = new Date()) {
    return this.repository.interruptExpiredRuns(
      caseId,
      new Date(now.getTime() - expiredRunAgeMs),
    );
  }

  private getExactContext(caseId: string, branchId: string) {
    const context = buildReasoningContext(this.connection, caseId, branchId);
    if (context.exploration.branch?.id !== branchId) {
      throw new Error("推理分支不存在或已经归档。");
    }
    return context;
  }
}

function buildReferenceMap(context: ReasoningContext) {
  const entries = [
    ...context.fixedEvidence,
    ...context.acceptedInferences,
    ...context.exploration.claims,
  ];
  return new Map(entries.map((claim) => [claim.id, claim.revision]));
}

function validateSuggestion(
  kind: AiSuggestion["kind"],
  suggestion: EditableSuggestion,
  references: Map<string, number>,
) {
  const issues: string[] = [];
  const citedIds = new Set<string>();
  const seenEdges = new Set<string>();
  for (const citation of suggestion.citations) {
    citedIds.add(citation.claimId);
    const edgeKey = `${citation.claimId}:${citation.relation}`;
    if (seenEdges.has(edgeKey)) issues.push(`重复引用：${citation.claimId}`);
    seenEdges.add(edgeKey);
    const currentRevision = references.get(citation.claimId);
    if (currentRevision === undefined) {
      issues.push(`引用不在当前上下文：${citation.claimId}`);
    } else if (currentRevision !== citation.revision) {
      issues.push(`引用修订不匹配：${citation.claimId}`);
    }
  }
  if (suggestion.citations.length === 0) issues.push("至少需要一条引用");
  if (suggestion.targetClaimId && !citedIds.has(suggestion.targetClaimId)) {
    issues.push("主要目标必须包含在引用中");
  }
  if (suggestion.secondaryClaimId && !citedIds.has(suggestion.secondaryClaimId)) {
    issues.push("冲突另一侧必须包含在引用中");
  }
  if (kind === "counterexample" && !suggestion.targetClaimId) {
    issues.push("反例必须指定被反驳的目标");
  }
  if (kind === "contradiction") {
    if (!suggestion.targetClaimId || !suggestion.secondaryClaimId) {
      issues.push("矛盾建议必须指定冲突两侧");
    } else if (suggestion.targetClaimId === suggestion.secondaryClaimId) {
      issues.push("矛盾两侧不能是同一条内容");
    }
  } else if (suggestion.secondaryClaimId) {
    issues.push("只有矛盾建议可以指定第二目标");
  }
  return [...new Set(issues)];
}

function citationsAreCurrent(
  citations: ReasoningCitation[],
  references: Map<string, number>,
) {
  return citations.every(
    (citation) => references.get(citation.claimId) === citation.revision,
  );
}

function assertEditableSuggestion(input: EditableSuggestion) {
  if (!input.title.trim() || input.title.length > 160) {
    throw new Error("建议标题必须为 1–160 个字符。");
  }
  if (!input.content.trim() || input.content.length > 8_000) {
    throw new Error("建议内容必须为 1–8000 个字符。");
  }
  if (!input.rationale.trim() || input.rationale.length > 4_000) {
    throw new Error("判断理由必须为 1–4000 个字符。");
  }
  if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100) {
    throw new Error("可信度必须是 0–100 的整数。");
  }
  if (input.citations.length === 0 || input.citations.length > 12) {
    throw new Error("引用数量必须为 1–12 条。");
  }
}

function assertRequestKey(value: string) {
  if (!/^[a-f0-9-]{16,64}$/i.test(value)) {
    throw new Error("推演请求标识无效，请刷新页面后重试。");
  }
}

function requireId(value: string | null) {
  if (!value) throw new Error("建议缺少必要的目标。");
  return value;
}

function safeRunError(error: unknown): {
  code: ReasoningRunErrorCode;
  message: string;
} {
  if (error instanceof ReasoningProviderError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }
  return {
    code: "provider",
    message: "AI 推演失败，请检查模型配置与网络后重试。",
  };
}
