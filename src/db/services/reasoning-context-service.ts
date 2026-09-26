import type { DatabaseConnection } from "../connection";
import {
  ReasoningWorkspaceRepository,
  type ReasoningClaim,
} from "../repositories/reasoning-workspace-repository";
import { buildEvidenceContext } from "./evidence-context-service";
import { EventRepository } from "../repositories/event-repository";

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
    timeline: new EventRepository(connection).listTimeline(caseId, false).map((event) => ({
      id: event.id,
      revision: event.revision,
      timeBasisRevision: event.timeBasisRevision,
      title: event.title,
      description: event.description,
      timeKind: event.timeKind,
      timePrecision: event.timePrecision,
      startOffsetSeconds: event.startOffsetSeconds,
      endOffsetSeconds: event.endOffsetSeconds,
      anchorEventId: event.anchorEventId,
      relativeOffsetSeconds: event.relativeOffsetSeconds,
      resolvedTime: event.resolvedTime,
      certainty: event.certainty,
      location: event.location ? { id: event.location.id, name: event.location.name } : null,
      participants: event.participants.map((person) => ({
        personId: person.personId, name: person.person.displayName,
        role: person.role, presence: person.presence, notes: person.notes,
      })),
      evidenceClaimIds: fixed.evidence.filter((claim) => claim.events.some((link) => link.id === event.id)).map((claim) => claim.id),
    })),
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

// Changes to the temporal input require a fresh run, even when claim text revisions are unchanged.
export function temporalContextIsCurrent(snapshotJson: string, current: ReasoningContext) {
  const snapshot = JSON.parse(snapshotJson) as Partial<ReasoningContext>;
  if (!snapshot.timeline || !snapshot.case) return false;
  const signature = (context: Pick<ReasoningContext, "case" | "timeline">) => JSON.stringify({
    origin: context.case.timelineOriginAt,
    mode: context.case.timelineMode,
    timeline: context.timeline.map((event) => ({ id: event.id, revision: event.revision, basis: event.timeBasisRevision }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return signature({ case: snapshot.case, timeline: snapshot.timeline }) === signature(current);
}
