import { eq } from "drizzle-orm";

import type { ReasoningCitation } from "../../ai/reasoning-output";
import type { DatabaseConnection } from "../connection";
import { AiReasoningRepository } from "../repositories/ai-reasoning-repository";
import {
  EvidenceRepository,
  type EvidenceClaim,
} from "../repositories/evidence-repository";
import {
  InvestigationRepository,
  type InvestigationItemView,
} from "../repositories/investigation-repository";
import {
  ReasoningWorkspaceRepository,
  type ReasoningClaim,
} from "../repositories/reasoning-workspace-repository";
import {
  cases,
  claimLinks,
  claims,
  type ActorKind,
  type ClaimRelationKind,
} from "../schema";

export const reasoningGraphLanes = [
  "context",
  "fixed",
  "trusted",
  "exploration",
  "action",
] as const;

export type ReasoningGraphLane = (typeof reasoningGraphLanes)[number];
export type ReasoningGraphNodeKind =
  | "claim"
  | "event"
  | "investigation"
  | "location"
  | "person"
  | "source"
  | "suggestion";
export type ReasoningGraphEdgeKind =
  | "ai"
  | "context"
  | "contradiction"
  | "investigation"
  | "support";

export type ReasoningGraphNode = {
  archived: boolean;
  body: string;
  branchId: string | null;
  branchName: string | null;
  confidence: number | null;
  createdBy: ActorKind | null;
  href: string;
  id: string;
  issues: string[];
  kind: ReasoningGraphNodeKind;
  lane: ReasoningGraphLane;
  recordId: string;
  revision: number | null;
  stale: boolean;
  status: string;
  subtype: string;
  title: string;
  unresolvedConflict: boolean;
  updatedAt: string | null;
};

export type ReasoningGraphEdge = {
  detail: string;
  id: string;
  kind: ReasoningGraphEdgeKind;
  relation: string;
  source: string;
  stale: boolean;
  target: string;
  unresolved: boolean;
};

export type ReasoningGraph = {
  branches: Array<{
    depth: number;
    id: string;
    name: string;
    path: string[];
    status: "active" | "archived";
  }>;
  caseId: string;
  edges: ReasoningGraphEdge[];
  nodes: ReasoningGraphNode[];
  selectedBranch: {
    id: string;
    name: string;
    path: string[];
  } | null;
  summary: {
    action: number;
    exploration: number;
    fixed: number;
    openConflicts: number;
    stale: number;
    trusted: number;
  };
};

type ClaimRow = typeof claims.$inferSelect;

export class ReasoningGraphService {
  private readonly ai: AiReasoningRepository;
  private readonly evidence: EvidenceRepository;
  private readonly investigations: InvestigationRepository;
  private readonly reasoning: ReasoningWorkspaceRepository;

  constructor(private readonly connection: DatabaseConnection) {
    this.ai = new AiReasoningRepository(connection);
    this.evidence = new EvidenceRepository(connection);
    this.investigations = new InvestigationRepository(connection);
    this.reasoning = new ReasoningWorkspaceRepository(connection);
  }

  build(caseId: string, requestedBranchId?: string | null): ReasoningGraph | null {
    const caseFile = this.connection.db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.id, caseId))
      .get();
    if (!caseFile) return null;

    const workspace = this.reasoning.getWorkspace(caseId, requestedBranchId);
    const selectedBranch = workspace.selectedBranch;
    const branchById = new Map(workspace.branches.map((branch) => [branch.id, branch]));
    const lineageIds = new Set(branchLineage(selectedBranch?.id ?? null, branchById));
    const allClaims = this.connection.db
      .select()
      .from(claims)
      .where(eq(claims.caseId, caseId))
      .all();
    const claimById = new Map(allClaims.map((claim) => [claim.id, claim]));
    const evidenceClaims = this.evidence.listEvidenceClaims(caseId);
    const evidenceById = new Map(evidenceClaims.map((claim) => [claim.id, claim]));
    const conflicts = workspace.conflicts;
    const openConflictLinkIds = new Set(
      conflicts.filter((conflict) => conflict.isOpen).map((conflict) => conflict.link.id),
    );
    const nodes = new Map<string, ReasoningGraphNode>();
    const edges = new Map<string, ReasoningGraphEdge>();

    const addClaim = (claim: ClaimRow, details?: EvidenceClaim | ReasoningClaim) => {
      const id = claimNodeId(claim.id);
      const evidenceDetails = details && "sources" in details ? details : undefined;
      const reasoningDetails = details && "premises" in details ? details : undefined;
      const staleReasons = evidenceDetails
        ? [
            ...evidenceDetails.sources.filter((link) => link.isStale).map(
              (link) => `来源“${link.source.title}”已有新修订或已归档。`,
            ),
            ...evidenceDetails.events.filter((link) => link.isStale).map(
              (link) => `事件“${link.event.title}”已有新修订或已归档。`,
            ),
          ]
        : [];
      const stateIssues = claimStateIssues(claim);
      const issues = unique([
        ...stateIssues,
        ...staleReasons,
        ...(reasoningDetails?.issues.map((issue) => issue.message) ?? []),
      ]);
      nodes.set(id, {
        archived: claim.archivedAt !== null,
        body: claim.content,
        branchId: claim.branchId,
        branchName: claim.branchId ? (branchById.get(claim.branchId)?.name ?? null) : null,
        confidence: claim.confidence,
        createdBy: claim.createdBy,
        href: claimHref(caseId, claim),
        id,
        issues,
        kind: "claim",
        lane: claimLane(claim),
        recordId: claim.id,
        revision: claim.revision,
        stale: staleReasons.length > 0 || reasoningDetails?.issues.some(
          (issue) => issue.code === "premise_stale" || issue.code === "premise_unavailable",
        ) === true,
        status: claim.status,
        subtype: claim.kind,
        title: summarize(claim.content, 58),
        unresolvedConflict: false,
        updatedAt: claim.updatedAt.toISOString(),
      });
    };

    for (const claim of evidenceClaims) {
      if (claim.archivedAt === null) addClaim(claim, claim);
    }
    const reasoningClaims = deduplicateById([
      ...workspace.acceptedInferences,
      ...workspace.exploration,
    ]);
    for (const claim of reasoningClaims) addClaim(claim, claim);

    for (const claim of reasoningClaims) {
      for (const premise of claim.premises) {
        if (!nodes.has(claimNodeId(premise.claim.id))) {
          addClaim(
            premise.claim,
            evidenceById.get(premise.claim.id),
          );
        }
        addEdge(edges, {
          detail: premise.link.rationale,
          id: `claim-link:${premise.link.id}`,
          kind: edgeKind(premise.link.relation),
          relation: premise.link.relation,
          source: claimNodeId(premise.claim.id),
          stale: premise.isStale,
          target: claimNodeId(claim.id),
          unresolved: openConflictLinkIds.has(premise.link.id),
        });
      }
    }

    for (const conflict of conflicts) {
      if (
        !nodes.has(claimNodeId(conflict.premise.id)) ||
        !nodes.has(claimNodeId(conflict.conclusion.id))
      ) {
        continue;
      }
      addEdge(edges, {
        detail: conflict.link.rationale,
        id: `claim-link:${conflict.link.id}`,
        kind: "contradiction",
        relation: "contradicts",
        source: claimNodeId(conflict.premise.id),
        stale: conflict.link.premiseRevision !== conflict.premise.revision,
        target: claimNodeId(conflict.conclusion.id),
        unresolved: conflict.isOpen,
      });
    }

    if (selectedBranch) {
      this.addSuggestions(
        caseId,
        lineageIds,
        branchById,
        claimById,
        nodes,
        edges,
        addClaim,
      );
      this.addInvestigations(
        caseId,
        lineageIds,
        branchById,
        nodes,
        edges,
        addClaim,
      );
    }

    for (const evidenceClaim of evidenceClaims) {
      if (nodes.has(claimNodeId(evidenceClaim.id))) {
        this.addEvidenceContext(caseId, evidenceClaim, nodes, edges);
      }
    }

    for (const edge of edges.values()) {
      if (!edge.unresolved) continue;
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (source) source.unresolvedConflict = true;
      if (target) target.unresolvedConflict = true;
    }

    const nodeList = [...nodes.values()].sort(compareNodes);
    const edgeList = [...edges.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    return {
      branches: workspace.branches.map(({ depth, id, name, path, status }) => ({
        depth,
        id,
        name,
        path,
        status,
      })),
      caseId,
      edges: edgeList,
      nodes: nodeList,
      selectedBranch: selectedBranch
        ? { id: selectedBranch.id, name: selectedBranch.name, path: selectedBranch.path }
        : null,
      summary: {
        action: nodeList.filter((node) => node.lane === "action").length,
        exploration: nodeList.filter((node) => node.lane === "exploration").length,
        fixed: nodeList.filter((node) => node.lane === "fixed").length,
        openConflicts: edgeList.filter((edge) => edge.unresolved).length,
        stale: nodeList.filter((node) => node.stale).length,
        trusted: nodeList.filter((node) => node.lane === "trusted").length,
      },
    };
  }

  private addSuggestions(
    caseId: string,
    lineageIds: Set<string>,
    branchById: ReadonlyMap<string, { name: string }>,
    claimById: Map<string, ClaimRow>,
    nodes: Map<string, ReasoningGraphNode>,
    edges: Map<string, ReasoningGraphEdge>,
    addClaim: (claim: ClaimRow, details?: EvidenceClaim | ReasoningClaim) => void,
  ) {
    const runs = this.ai
      .listRuns(caseId)
      .filter((run) => lineageIds.has(run.branchId));
    for (const run of runs) {
      for (const suggestion of run.suggestions) {
        if (suggestion.status === "dismissed") continue;
        const staleCitations = suggestion.effective.citations.filter(
          (citation) => claimById.get(citation.claimId)?.revision !== citation.revision,
        );
        const id = suggestionNodeId(suggestion.id);
        nodes.set(id, {
          archived: false,
          body: [suggestion.effective.content, suggestion.effective.rationale]
            .filter(Boolean)
            .join("\n\n"),
          branchId: run.branchId,
          branchName: branchById.get(run.branchId)?.name ?? null,
          confidence: suggestion.effective.confidence,
          createdBy: "ai",
          href: `/cases/${caseId}/reasoning/ai?branch=${encodeURIComponent(run.branchId)}#run-${run.id}`,
          id,
          issues: unique([
            ...suggestion.validationIssues,
            ...staleCitations.map(() => "引用的命题已有新修订或不可用。"),
          ]),
          kind: "suggestion",
          lane: "exploration",
          recordId: suggestion.id,
          revision: suggestion.edits[0]?.revision ?? 0,
          stale: staleCitations.length > 0,
          status: suggestion.status,
          subtype: suggestion.kind,
          title: suggestion.effective.title,
          unresolvedConflict: suggestion.kind === "contradiction" && suggestion.status === "pending",
          updatedAt: (suggestion.edits[0]?.editedAt ?? suggestion.resolvedAt ?? suggestion.createdAt).toISOString(),
        });

        for (const citation of suggestion.effective.citations) {
          const claim = claimById.get(citation.claimId);
          if (!claim) continue;
          if (!nodes.has(claimNodeId(claim.id))) addClaim(claim);
          addEdge(edges, citationEdge(suggestion.id, citation, claim.revision));
        }
        if (suggestion.acceptedClaimId) {
          const accepted = claimById.get(suggestion.acceptedClaimId);
          if (accepted) {
            if (!nodes.has(claimNodeId(accepted.id))) addClaim(accepted);
            addEdge(edges, {
              detail: suggestion.resolutionNote,
              id: `suggestion-result:${suggestion.id}:${accepted.id}`,
              kind: "ai",
              relation: "suggestion_result",
              source: id,
              stale: false,
              target: claimNodeId(accepted.id),
              unresolved: false,
            });
          }
        } else if (suggestion.acceptedClaimLinkId) {
          const acceptedLink = this.connection.db
            .select()
            .from(claimLinks)
            .where(eq(claimLinks.id, suggestion.acceptedClaimLinkId))
            .get();
          const conclusion = acceptedLink
            ? claimById.get(acceptedLink.conclusionClaimId)
            : undefined;
          if (acceptedLink && conclusion) {
            if (!nodes.has(claimNodeId(conclusion.id))) addClaim(conclusion);
            addEdge(edges, {
              detail: suggestion.resolutionNote,
              id: `suggestion-conflict:${suggestion.id}:${acceptedLink.id}`,
              kind: "ai",
              relation: "suggestion_conflict",
              source: id,
              stale: false,
              target: claimNodeId(conclusion.id),
              unresolved: false,
            });
          }
        }
      }
    }
  }

  private addInvestigations(
    caseId: string,
    lineageIds: Set<string>,
    branchById: ReadonlyMap<string, { name: string }>,
    nodes: Map<string, ReasoningGraphNode>,
    edges: Map<string, ReasoningGraphEdge>,
    addClaim: (claim: ClaimRow, details?: EvidenceClaim | ReasoningClaim) => void,
  ) {
    const items = [...lineageIds].flatMap((branchId) =>
      this.investigations.listItems(caseId, branchId),
    );
    for (const item of deduplicateById(items)) {
      const id = investigationNodeId(item.id);
      nodes.set(id, investigationNode(caseId, item, branchById.get(item.branchId)?.name ?? null));
      if (item.originSuggestionId && nodes.has(suggestionNodeId(item.originSuggestionId))) {
        addEdge(edges, {
          detail: "AI 建议经人工确认后转为调查事项。",
          id: `suggestion-investigation:${item.originSuggestionId}:${item.id}`,
          kind: "ai",
          relation: "suggestion_investigation",
          source: suggestionNodeId(item.originSuggestionId),
          stale: false,
          target: id,
          unresolved: false,
        });
      }
      for (const link of item.claims) {
        if (!nodes.has(claimNodeId(link.claim.id))) addClaim(link.claim);
        addInvestigationEdge(edges, item.id, "claim", link.claim.id, link.role, link.isStale);
      }
      for (const link of item.events) {
        addEventNode(caseId, link.event, nodes);
        addInvestigationEdge(edges, item.id, "event", link.event.id, link.role, link.isStale);
      }
      for (const link of item.locations) {
        addLocationNode(caseId, link.location, nodes);
        addInvestigationEdge(edges, item.id, "location", link.location.id, link.role, false);
      }
      for (const link of item.people) {
        addPersonNode(caseId, link.person, nodes);
        addInvestigationEdge(edges, item.id, "person", link.person.id, link.role, false);
      }
      for (const link of item.sources) {
        addSourceNode(caseId, link.source, nodes);
        addInvestigationEdge(edges, item.id, "source", link.source.id, link.role, link.isStale);
      }
    }
  }

  private addEvidenceContext(
    caseId: string,
    claim: EvidenceClaim,
    nodes: Map<string, ReasoningGraphNode>,
    edges: Map<string, ReasoningGraphEdge>,
  ) {
    for (const link of claim.sources) {
      addSourceNode(caseId, link.source, nodes);
      addEdge(edges, {
        detail: "",
        id: `claim-source:${claim.id}:${link.source.id}:${link.relation}`,
        kind: edgeKind(link.relation),
        relation: link.relation,
        source: sourceNodeId(link.source.id),
        stale: link.isStale,
        target: claimNodeId(claim.id),
        unresolved: false,
      });
    }
    for (const link of claim.events) {
      addEventNode(caseId, link.event, nodes);
      addEdge(edges, contextEdge("event", link.event.id, claim.id, link.role, link.isStale));
    }
    for (const link of claim.locations) {
      addLocationNode(caseId, link.location, nodes);
      addEdge(edges, contextEdge("location", link.location.id, claim.id, link.role, false));
    }
    for (const link of claim.people) {
      addPersonNode(caseId, link.person, nodes);
      addEdge(edges, contextEdge("person", link.person.id, claim.id, link.role, false));
    }
    if (claim.speaker) {
      addPersonNode(caseId, claim.speaker, nodes);
      addEdge(edges, contextEdge("person", claim.speaker.id, claim.id, "speaker", false));
    }
  }
}

function addSourceNode(
  caseId: string,
  source: EvidenceClaim["sources"][number]["source"],
  nodes: Map<string, ReasoningGraphNode>,
) {
  nodes.set(sourceNodeId(source.id), {
    archived: source.archivedAt !== null,
    body: [source.excerpt, source.notes, source.locator].filter(Boolean).join("\n\n"),
    branchId: null,
    branchName: null,
    confidence: null,
    createdBy: null,
    href: `/cases/${caseId}/evidence#source-${source.id}`,
    id: sourceNodeId(source.id),
    issues: source.archivedAt ? ["来源已归档。"] : [],
    kind: "source",
    lane: "context",
    recordId: source.id,
    revision: source.revision,
    stale: source.archivedAt !== null,
    status: source.archivedAt ? "archived" : "active",
    subtype: source.kind,
    title: source.title,
    unresolvedConflict: false,
    updatedAt: source.updatedAt.toISOString(),
  });
}

function addPersonNode(
  caseId: string,
  person: EvidenceClaim["people"][number]["person"],
  nodes: Map<string, ReasoningGraphNode>,
) {
  nodes.set(personNodeId(person.id), {
    archived: false,
    body: person.description,
    branchId: null,
    branchName: null,
    confidence: null,
    createdBy: null,
    href: `/cases/${caseId}#person-${person.id}`,
    id: personNodeId(person.id),
    issues: [],
    kind: "person",
    lane: "context",
    recordId: person.id,
    revision: null,
    stale: false,
    status: "active",
    subtype: "person",
    title: person.displayName,
    unresolvedConflict: false,
    updatedAt: person.updatedAt.toISOString(),
  });
}

function addEventNode(
  caseId: string,
  event: EvidenceClaim["events"][number]["event"],
  nodes: Map<string, ReasoningGraphNode>,
) {
  nodes.set(eventNodeId(event.id), {
    archived: event.archivedAt !== null,
    body: [event.description, event.displayTime].filter(Boolean).join("\n\n"),
    branchId: null,
    branchName: null,
    confidence: event.certainty,
    createdBy: null,
    href: `/cases/${caseId}/timeline#event-${event.id}`,
    id: eventNodeId(event.id),
    issues: event.archivedAt ? ["事件已归档。"] : [],
    kind: "event",
    lane: "context",
    recordId: event.id,
    revision: event.revision,
    stale: event.archivedAt !== null,
    status: event.archivedAt ? "archived" : "active",
    subtype: event.timeKind,
    title: event.title,
    unresolvedConflict: false,
    updatedAt: event.updatedAt.toISOString(),
  });
}

function addLocationNode(
  caseId: string,
  location: EvidenceClaim["locations"][number]["location"],
  nodes: Map<string, ReasoningGraphNode>,
) {
  nodes.set(locationNodeId(location.id), {
    archived: false,
    body: location.description,
    branchId: null,
    branchName: null,
    confidence: null,
    createdBy: null,
    href: `/cases/${caseId}/timeline#location-${location.id}`,
    id: locationNodeId(location.id),
    issues: [],
    kind: "location",
    lane: "context",
    recordId: location.id,
    revision: null,
    stale: false,
    status: "active",
    subtype: "location",
    title: location.name,
    unresolvedConflict: false,
    updatedAt: location.updatedAt.toISOString(),
  });
}

function investigationNode(
  caseId: string,
  item: InvestigationItemView,
  branchName: string | null,
): ReasoningGraphNode {
  return {
    archived: false,
    body: [item.question, item.notes, item.resultSummary].filter(Boolean).join("\n\n"),
    branchId: item.branchId,
    branchName,
    confidence: null,
    createdBy: item.createdBy,
    href: `/cases/${caseId}/investigations?branch=${encodeURIComponent(item.branchId)}#investigation-${item.id}`,
    id: investigationNodeId(item.id),
    issues: item.staleReasons,
    kind: "investigation",
    lane: "action",
    recordId: item.id,
    revision: null,
    stale: item.isStale,
    status: item.status,
    subtype: item.priority,
    title: item.title,
    unresolvedConflict: false,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function addInvestigationEdge(
  edges: Map<string, ReasoningGraphEdge>,
  itemId: string,
  entityType: "claim" | "event" | "location" | "person" | "source",
  entityId: string,
  role: "context" | "result" | "target",
  stale: boolean,
) {
  const itemNode = investigationNodeId(itemId);
  const entityNode = `${entityType}:${entityId}`;
  addEdge(edges, {
    detail: "",
    id: `investigation-link:${itemId}:${entityType}:${entityId}:${role}`,
    kind: "investigation",
    relation: `investigation_${role}`,
    source: role === "result" ? itemNode : entityNode,
    stale,
    target: role === "result" ? entityNode : itemNode,
    unresolved: false,
  });
}

function contextEdge(
  entityType: "event" | "location" | "person",
  entityId: string,
  claimId: string,
  role: string,
  stale: boolean,
): ReasoningGraphEdge {
  return {
    detail: "",
    id: `claim-context:${claimId}:${entityType}:${entityId}:${role}`,
    kind: "context",
    relation: role === "speaker" ? "speaker" : `context_${role}`,
    source: `${entityType}:${entityId}`,
    stale,
    target: claimNodeId(claimId),
    unresolved: false,
  };
}

function citationEdge(
  suggestionId: string,
  citation: ReasoningCitation,
  currentRevision: number,
): ReasoningGraphEdge {
  return {
    detail: `引用修订 ${citation.revision}`,
    id: `suggestion-citation:${suggestionId}:${citation.claimId}:${citation.relation}`,
    kind: "ai",
    relation: `citation_${citation.relation}`,
    source: claimNodeId(citation.claimId),
    stale: citation.revision !== currentRevision,
    target: suggestionNodeId(suggestionId),
    unresolved: false,
  };
}

function claimStateIssues(claim: ClaimRow) {
  const issues: string[] = [];
  if (claim.archivedAt) issues.push("记录已归档。");
  if (claim.status === "needs_review") issues.push("记录等待重新复核。");
  return issues;
}

function claimLane(claim: ClaimRow): ReasoningGraphLane {
  if ((claim.kind === "fact" || claim.kind === "statement") && claim.status === "accepted") {
    return "fixed";
  }
  if (claim.kind === "inference" && claim.status === "accepted") return "trusted";
  return "exploration";
}

function claimHref(caseId: string, claim: ClaimRow) {
  if (claim.kind === "fact" || claim.kind === "statement") {
    return `/cases/${caseId}/evidence#claim-${claim.id}`;
  }
  const branch = claim.branchId ? `?branch=${encodeURIComponent(claim.branchId)}` : "";
  return `/cases/${caseId}/reasoning${branch}#claim-${claim.id}`;
}

function edgeKind(relation: ClaimRelationKind | "origin"): ReasoningGraphEdgeKind {
  if (relation === "contradicts") return "contradiction";
  return relation === "origin" ? "context" : "support";
}

function branchLineage<T extends { id: string; parentBranchId?: string | null }>(
  branchId: string | null,
  branchById: ReadonlyMap<string, T>,
) {
  const result: string[] = [];
  const visited = new Set<string>();
  let current = branchId ? branchById.get(branchId) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.push(current.id);
    current = current.parentBranchId
      ? branchById.get(current.parentBranchId)
      : undefined;
  }
  return result;
}

function addEdge(
  edges: Map<string, ReasoningGraphEdge>,
  edge: ReasoningGraphEdge,
) {
  edges.set(edge.id, edge);
}

function compareNodes(left: ReasoningGraphNode, right: ReasoningGraphNode) {
  const laneDifference = reasoningGraphLanes.indexOf(left.lane) - reasoningGraphLanes.indexOf(right.lane);
  return laneDifference || left.title.localeCompare(right.title, "zh-CN");
}

function deduplicateById<T extends { id: string }>(values: T[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function summarize(value: string, length: number) {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

function claimNodeId(id: string) {
  return `claim:${id}`;
}

function sourceNodeId(id: string) {
  return `source:${id}`;
}

function personNodeId(id: string) {
  return `person:${id}`;
}

function eventNodeId(id: string) {
  return `event:${id}`;
}

function locationNodeId(id: string) {
  return `location:${id}`;
}

function suggestionNodeId(id: string) {
  return `suggestion:${id}`;
}

function investigationNodeId(id: string) {
  return `investigation:${id}`;
}
