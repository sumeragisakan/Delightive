import type { DatabaseConnection } from "../connection";
import {
  AiReasoningRepository,
  type AiReasoningRun,
  type AiSuggestion,
} from "../repositories/ai-reasoning-repository";

export type SnapshotLayer = "draft" | "fixed" | "trusted";

export type SnapshotClaim = {
  content: string;
  id: string;
  kind: string;
  layer: SnapshotLayer;
  revision: number;
  status: string;
};

export type ContextClaimChange = {
  id: string;
  kind: "added" | "changed" | "removed";
  left: SnapshotClaim | null;
  right: SnapshotClaim | null;
};

export type SuggestionComparison = {
  changes: string[];
  kind: "changed" | "left_only" | "right_only" | "same";
  left: AiSuggestion | null;
  right: AiSuggestion | null;
};

export type AiRunComparison = {
  contextChanges: ContextClaimChange[];
  contextCounts: {
    added: number;
    changed: number;
    removed: number;
  };
  left: AiReasoningRun;
  right: AiReasoningRun;
  suggestionComparisons: SuggestionComparison[];
  suggestionCounts: {
    changed: number;
    leftOnly: number;
    rightOnly: number;
    same: number;
  };
  warnings: string[];
};

export class AiRunComparisonService {
  private readonly repository: AiReasoningRepository;

  constructor(connection: DatabaseConnection) {
    this.repository = new AiReasoningRepository(connection);
  }

  compare(caseId: string, leftRunId: string, rightRunId: string): AiRunComparison {
    if (!leftRunId || !rightRunId || leftRunId === rightRunId) {
      throw new Error("请选择两次不同的 AI 推演进行比较。");
    }
    const left = this.repository.getRunDetailsForCase(caseId, leftRunId);
    const right = this.repository.getRunDetailsForCase(caseId, rightRunId);
    const contextChanges = compareContexts(
      parseSnapshotClaims(left.input.contextJson),
      parseSnapshotClaims(right.input.contextJson),
    );
    const suggestionComparisons = compareSuggestions(
      left.suggestions,
      right.suggestions,
    );
    const warnings: string[] = [];
    if (left.branchId !== right.branchId) warnings.push("两次运行来自不同推理分支。");
    if (left.mode !== right.mode) warnings.push("两次运行使用了不同的推演任务。");
    if (left.model !== right.model || left.provider !== right.provider) {
      warnings.push("两次运行使用了不同的模型或 Provider。");
    }
    if (left.input.contextFingerprint === right.input.contextFingerprint) {
      warnings.push("两次运行使用相同的输入上下文快照。");
    }

    return {
      contextChanges,
      contextCounts: countContextChanges(contextChanges),
      left,
      right,
      suggestionComparisons,
      suggestionCounts: countSuggestionChanges(suggestionComparisons),
      warnings,
    };
  }
}

function parseSnapshotClaims(contextJson: string) {
  let context: unknown;
  try {
    context = JSON.parse(contextJson);
  } catch {
    throw new Error("运行输入快照已损坏，无法比较。");
  }
  if (!isRecord(context)) {
    throw new Error("运行输入快照结构无效，无法比较。");
  }
  const exploration = isRecord(context.exploration) ? context.exploration : {};
  return [
    ...readClaimArray(context.fixedEvidence, "fixed"),
    ...readClaimArray(context.acceptedInferences, "trusted"),
    ...readClaimArray(exploration.claims, "draft"),
  ];
}

function readClaimArray(value: unknown, layer: SnapshotLayer): SnapshotClaim[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.content !== "string" ||
      typeof candidate.kind !== "string" ||
      typeof candidate.revision !== "number" ||
      typeof candidate.status !== "string"
    ) {
      return [];
    }
    return [{
      content: candidate.content,
      id: candidate.id,
      kind: candidate.kind,
      layer,
      revision: candidate.revision,
      status: candidate.status,
    }];
  });
}

function compareContexts(left: SnapshotClaim[], right: SnapshotClaim[]) {
  const leftById = new Map(left.map((claim) => [claim.id, claim]));
  const rightById = new Map(right.map((claim) => [claim.id, claim]));
  const ids = [...new Set([...leftById.keys(), ...rightById.keys()])].sort();
  return ids.flatMap<ContextClaimChange>((id) => {
    const leftClaim = leftById.get(id) ?? null;
    const rightClaim = rightById.get(id) ?? null;
    if (!leftClaim) return [{ id, kind: "added", left: null, right: rightClaim }];
    if (!rightClaim) return [{ id, kind: "removed", left: leftClaim, right: null }];
    if (
      leftClaim.revision !== rightClaim.revision ||
      leftClaim.content !== rightClaim.content ||
      leftClaim.kind !== rightClaim.kind ||
      leftClaim.layer !== rightClaim.layer ||
      leftClaim.status !== rightClaim.status
    ) {
      return [{ id, kind: "changed", left: leftClaim, right: rightClaim }];
    }
    return [];
  });
}

function compareSuggestions(left: AiSuggestion[], right: AiSuggestion[]) {
  const candidates = left.flatMap((leftSuggestion, leftIndex) =>
    right.flatMap((rightSuggestion, rightIndex) => {
      const score = suggestionMatchScore(leftSuggestion, rightSuggestion);
      return score > 1
        ? [{ leftIndex, rightIndex, score }]
        : [];
    }),
  ).sort((a, b) => b.score - a.score);
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();
  const result: SuggestionComparison[] = [];

  for (const candidate of candidates) {
    if (matchedLeft.has(candidate.leftIndex) || matchedRight.has(candidate.rightIndex)) {
      continue;
    }
    matchedLeft.add(candidate.leftIndex);
    matchedRight.add(candidate.rightIndex);
    const leftSuggestion = left[candidate.leftIndex];
    const rightSuggestion = right[candidate.rightIndex];
    const changes = describeSuggestionChanges(leftSuggestion, rightSuggestion);
    result.push({
      changes,
      kind: changes.length === 0 ? "same" : "changed",
      left: leftSuggestion,
      right: rightSuggestion,
    });
  }

  left.forEach((suggestion, index) => {
    if (!matchedLeft.has(index)) {
      result.push({ changes: [], kind: "left_only", left: suggestion, right: null });
    }
  });
  right.forEach((suggestion, index) => {
    if (!matchedRight.has(index)) {
      result.push({ changes: [], kind: "right_only", left: null, right: suggestion });
    }
  });
  return result;
}

function suggestionMatchScore(left: AiSuggestion, right: AiSuggestion) {
  if (left.kind !== right.kind) return 0;
  let score = 1;
  if (
    left.effective.targetClaimId &&
    left.effective.targetClaimId === right.effective.targetClaimId
  ) score += 2;
  if (
    left.effective.secondaryClaimId &&
    left.effective.secondaryClaimId === right.effective.secondaryClaimId
  ) score += 2;
  const leftCitations = new Set(left.effective.citations.map(({ claimId }) => claimId));
  const rightCitations = new Set(right.effective.citations.map(({ claimId }) => claimId));
  const overlap = [...leftCitations].filter((id) => rightCitations.has(id)).length;
  if (overlap > 0) score += 3 * (overlap / Math.max(leftCitations.size, rightCitations.size));
  if (normalizeText(left.effective.title) === normalizeText(right.effective.title)) score += 2;
  if (normalizeText(left.effective.content) === normalizeText(right.effective.content)) score += 2;
  return score;
}

function describeSuggestionChanges(left: AiSuggestion, right: AiSuggestion) {
  const changes: string[] = [];
  if (left.effective.title !== right.effective.title) changes.push("标题");
  if (left.effective.content !== right.effective.content) changes.push("建议内容");
  if (left.effective.rationale !== right.effective.rationale) changes.push("判断理由");
  if (left.effective.confidence !== right.effective.confidence) changes.push("可信度");
  if (citationSignature(left) !== citationSignature(right)) changes.push("引用关系");
  if (
    left.effective.targetClaimId !== right.effective.targetClaimId ||
    left.effective.secondaryClaimId !== right.effective.secondaryClaimId
  ) changes.push("目标内容");
  if (left.status !== right.status || left.resolutionKind !== right.resolutionKind) {
    changes.push("人工处理状态");
  }
  if (left.edits.length !== right.edits.length) changes.push("人工修订次数");
  return changes;
}

function citationSignature(suggestion: AiSuggestion) {
  return suggestion.effective.citations
    .map(({ claimId, relation, revision }) => `${claimId}:${revision}:${relation}`)
    .sort()
    .join("|");
}

function countContextChanges(changes: ContextClaimChange[]) {
  return {
    added: changes.filter(({ kind }) => kind === "added").length,
    changed: changes.filter(({ kind }) => kind === "changed").length,
    removed: changes.filter(({ kind }) => kind === "removed").length,
  };
}

function countSuggestionChanges(changes: SuggestionComparison[]) {
  return {
    changed: changes.filter(({ kind }) => kind === "changed").length,
    leftOnly: changes.filter(({ kind }) => kind === "left_only").length,
    rightOnly: changes.filter(({ kind }) => kind === "right_only").length,
    same: changes.filter(({ kind }) => kind === "same").length,
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
