import type { ReasoningModelProvider } from "../../ai/provider";
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
} from "../repositories/ai-reasoning-repository";
import { ReasoningWorkspaceRepository } from "../repositories/reasoning-workspace-repository";
import type { ReasoningRunMode } from "../schema";
import { buildReasoningContext, type ReasoningContext } from "./reasoning-context-service";

export type AiSuggestionView = AiSuggestion & { isStale: boolean };
export type AiReasoningRunView = Omit<AiReasoningRun, "suggestions"> & {
  isStale: boolean;
  suggestions: AiSuggestionView[];
};

export class AiReasoningService {
  private readonly repository: AiReasoningRepository;
  private readonly workspace: ReasoningWorkspaceRepository;

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly provider?: ReasoningModelProvider,
  ) {
    this.repository = new AiReasoningRepository(connection);
    this.workspace = new ReasoningWorkspaceRepository(connection);
  }

  async startRun(input: {
    branchId: string;
    caseId: string;
    focusClaimId?: string | null;
    mode: ReasoningRunMode;
    userPrompt?: string;
  }) {
    if (!this.provider) {
      throw new Error("AI provider is required to start a run.");
    }
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
    const run = this.repository.createRun({
      branchId: input.branchId,
      caseId: input.caseId,
      contextFingerprint: fingerprintReasoningContext(contextJson),
      contextJson,
      focusClaimId,
      mode: input.mode,
      model: this.provider.model,
      provider: this.provider.name,
      userPrompt: input.userPrompt?.trim() ?? "",
    });
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
        validationIssues: validateCitations(output.citations, referenceMap),
      }));
      return this.repository.completeRun({
        durationMs: Date.now() - startedAt,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        remoteResponseId: result.remoteResponseId,
        runId: run.id,
        suggestions,
        summary: result.summary,
        totalTokens: result.usage.totalTokens,
      });
    } catch (error) {
      const message = safeRunError(error);
      this.repository.failRun(run.id, message, Date.now() - startedAt);
      throw new Error(message, { cause: error });
    }
  }

  listRuns(caseId: string, branchId: string): AiReasoningRunView[] {
    const context = this.getExactContext(caseId, branchId);
    const currentContextJson = serializeReasoningContext(context);
    const currentFingerprint = fingerprintReasoningContext(currentContextJson);
    const references = buildReferenceMap(context);

    return this.repository.listRuns(caseId, branchId).map((run) => ({
      ...run,
      isStale: run.input.contextFingerprint !== currentFingerprint,
      suggestions: run.suggestions.map((suggestion) => ({
        ...suggestion,
        isStale: !citationsAreCurrent(suggestion.citations, references),
      })),
    }));
  }

  acceptSuggestion(caseId: string, suggestionId: string) {
    const record = this.repository.getSuggestionForCase(caseId, suggestionId);
    if (record.run.status !== "completed" || record.suggestion.status !== "pending") {
      throw new Error("这条建议当前不能被采纳。");
    }
    if (record.suggestion.validationIssues.length > 0) {
      throw new Error("这条建议的引用未通过校验，不能采纳。");
    }
    const context = this.getExactContext(caseId, record.run.branchId);
    const references = buildReferenceMap(context);
    if (!citationsAreCurrent(record.suggestion.citations, references)) {
      throw new Error("引用内容已有变化；请重新运行 AI 推演后再采纳。");
    }

    const transaction = this.connection.sqlite.transaction(() => {
      const claim = this.workspace.createHypothesis({
        branchId: record.run.branchId,
        caseId,
        confidence: record.suggestion.confidence,
        content: record.suggestion.content,
        createdBy: "ai",
      });
      for (const citation of record.suggestion.citations) {
        this.workspace.addArgument({
          caseId,
          conclusionClaimId: claim.id,
          createdBy: "ai",
          premiseClaimId: citation.claimId,
          rationale: record.suggestion.rationale,
          relation: citation.relation,
          strength: record.suggestion.confidence,
        });
      }
      this.repository.markSuggestionAccepted(suggestionId, claim.id);
      return claim;
    });
    return transaction();
  }

  dismissSuggestion(caseId: string, suggestionId: string) {
    return this.repository.dismissSuggestion(caseId, suggestionId);
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

function validateCitations(
  citations: ReasoningCitation[],
  references: Map<string, number>,
) {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const key = `${citation.claimId}:${citation.relation}`;
    if (seen.has(key)) {
      issues.push(`重复引用：${citation.claimId}`);
    }
    seen.add(key);
    const currentRevision = references.get(citation.claimId);
    if (currentRevision === undefined) {
      issues.push(`引用不在当前上下文：${citation.claimId}`);
    } else if (currentRevision !== citation.revision) {
      issues.push(`引用修订不匹配：${citation.claimId}`);
    }
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

function safeRunError(error: unknown) {
  if (error instanceof Error && /[\u3400-\u9fff]/u.test(error.message)) {
    return error.message.slice(0, 500);
  }
  return "AI 推演失败，请检查模型配置与网络后重试。";
}
