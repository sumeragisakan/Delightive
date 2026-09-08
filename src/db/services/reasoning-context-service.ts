import type { DatabaseConnection } from "../connection";
import {
  ReasoningWorkspaceRepository,
  type ReasoningClaim,
} from "../repositories/reasoning-workspace-repository";
import { buildEvidenceContext } from "./evidence-context-service";

export function buildReasoningContext(
  connection: DatabaseConnection,
  caseId: string,
  branchId?: string | null,
) {
  const fixed = buildEvidenceContext(connection, caseId);
  const workspace = new ReasoningWorkspaceRepository(connection).getWorkspace(
    caseId,
    branchId,
  );
  const acceptedInferences = workspace.acceptedInferences.filter(
    (claim) => claim.issues.length === 0,
  );
  const exploration = workspace.exploration.filter((claim) =>
    ["draft", "needs_review"].includes(claim.status),
  );

  return {
    case: fixed.case,
    fixedEvidence: fixed.evidence,
    acceptedInferences: acceptedInferences.map(serializeReasoningClaim),
    exploration: {
      branch: workspace.selectedBranch
        ? {
            id: workspace.selectedBranch.id,
            name: workspace.selectedBranch.name,
            path: workspace.selectedBranch.path,
          }
        : null,
      claims: exploration.map(serializeReasoningClaim),
    },
    excluded: {
      ...fixed.excluded,
      reasoningNeedsReview: workspace.exploration.filter(
        (claim) => claim.status === "needs_review",
      ).length,
      rejectedReasoning: workspace.exploration.filter(
        (claim) => claim.status === "rejected",
      ).length,
      staleAcceptedInferences:
        workspace.acceptedInferences.length - acceptedInferences.length,
      unresolvedConflicts: workspace.conflicts.filter((conflict) => conflict.isOpen)
        .length,
    },
    sources: fixed.sources,
  };
}

function serializeReasoningClaim(claim: ReasoningClaim) {
  return {
    branch: claim.branch
      ? { id: claim.branch.id, name: claim.branch.name }
      : null,
    confidence: claim.confidence,
    content: claim.content,
    id: claim.id,
    kind: claim.kind,
    premises: claim.premises.map(({ claim: premise, isStale, link }) => ({
      content: premise.content,
      id: premise.id,
      relation: link.relation,
      revision: premise.revision,
      stale: isStale,
      strength: link.strength,
    })),
    revision: claim.revision,
    status: claim.status,
  };
}

export type ReasoningContext = ReturnType<typeof buildReasoningContext>;
