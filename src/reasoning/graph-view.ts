import type {
  ReasoningGraphEdge,
  ReasoningGraphNode,
} from "@/db/services/reasoning-graph-service";

export type ReasoningGraphViewFilters = {
  onlyIssues: boolean;
  query: string;
  showAi: boolean;
  showContext: boolean;
  showResolved: boolean;
  traceRootId: string | null;
};

export function filterReasoningGraph(
  allNodes: ReasoningGraphNode[],
  allEdges: ReasoningGraphEdge[],
  filters: ReasoningGraphViewFilters,
) {
  const allowed = new Set(
    allNodes
      .filter((node) => filters.showContext || node.lane !== "context")
      .filter((node) => filters.showAi || node.kind !== "suggestion")
      .filter(
        (node) =>
          filters.showResolved ||
          node.kind !== "investigation" ||
          node.status !== "resolved",
      )
      .map((node) => node.id),
  );

  if (filters.onlyIssues) {
    const issueIds = new Set(
      allNodes
        .filter(
          (node) =>
            allowed.has(node.id) &&
            (node.stale || node.unresolvedConflict || node.issues.length > 0),
        )
        .map((node) => node.id),
    );
    includeNeighbors(issueIds, allEdges, allowed);
    intersect(allowed, issueIds);
  }

  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  if (query) {
    const matches = new Set(
      allNodes
        .filter(
          (node) =>
            allowed.has(node.id) &&
            `${node.title}\n${node.body}\n${node.branchName ?? ""}`
              .toLocaleLowerCase("zh-CN")
              .includes(query),
        )
        .map((node) => node.id),
    );
    includeNeighbors(matches, allEdges, allowed);
    intersect(allowed, matches);
  }

  if (filters.traceRootId && allowed.has(filters.traceRootId)) {
    intersect(allowed, traceConnected(filters.traceRootId, allEdges, allowed));
  }

  const nodes = allNodes.filter((node) => allowed.has(node.id));
  const edges = allEdges.filter(
    (edge) => allowed.has(edge.source) && allowed.has(edge.target),
  );
  return { edges, nodes };
}

export function traceConnected(
  rootId: string,
  edges: ReasoningGraphEdge[],
  allowed = new Set(edges.flatMap((edge) => [edge.source, edge.target])),
) {
  const result = new Set([rootId]);
  walk(rootId, "upstream", edges, allowed, result);
  walk(rootId, "downstream", edges, allowed, result);
  return result;
}

function walk(
  nodeId: string,
  direction: "downstream" | "upstream",
  edges: ReasoningGraphEdge[],
  allowed: Set<string>,
  visited: Set<string>,
) {
  for (const edge of edges) {
    const next =
      direction === "upstream" && edge.target === nodeId
        ? edge.source
        : direction === "downstream" && edge.source === nodeId
          ? edge.target
          : null;
    if (next && allowed.has(next) && !visited.has(next)) {
      visited.add(next);
      walk(next, direction, edges, allowed, visited);
    }
  }
}

function includeNeighbors(
  selected: Set<string>,
  edges: ReasoningGraphEdge[],
  allowed: Set<string>,
) {
  const original = new Set(selected);
  for (const edge of edges) {
    if (original.has(edge.source) && allowed.has(edge.target)) selected.add(edge.target);
    if (original.has(edge.target) && allowed.has(edge.source)) selected.add(edge.source);
  }
}

function intersect(target: Set<string>, accepted: Set<string>) {
  for (const id of target) {
    if (!accepted.has(id)) target.delete(id);
  }
}
