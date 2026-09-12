import { describe, expect, it } from "vitest";

import type {
  ReasoningGraphEdge,
  ReasoningGraphNode,
} from "@/db/services/reasoning-graph-service";

import { filterReasoningGraph, traceConnected } from "./graph-view";

describe("reasoning graph view filters", () => {
  const nodes = [
    node("source", "context", "source"),
    node("fact", "fixed"),
    node("draft", "exploration", "claim", { stale: true }),
    node("ai", "exploration", "suggestion"),
    node("pending", "action", "investigation", { status: "pending" }),
    node("resolved", "action", "investigation", { status: "resolved" }),
    node("unresolved", "action", "investigation", { status: "unresolved" }),
  ];
  const edges = [
    edge("source", "fact", "context"),
    edge("fact", "draft", "support"),
    edge("draft", "ai", "ai"),
    edge("ai", "pending", "investigation"),
  ];

  it("uses a quiet default while preserving unresolved work", () => {
    const result = filterReasoningGraph(nodes, edges, {
      onlyIssues: false,
      query: "",
      showAi: true,
      showContext: false,
      showResolved: false,
      traceRootId: null,
    });

    expect(result.nodes.map(({ id }) => id)).not.toContain("source");
    expect(result.nodes.map(({ id }) => id)).not.toContain("resolved");
    expect(result.nodes.map(({ id }) => id)).toContain("unresolved");
  });

  it("keeps one-hop context around search and issue matches", () => {
    const searched = filterReasoningGraph(nodes, edges, {
      onlyIssues: false,
      query: "draft",
      showAi: true,
      showContext: true,
      showResolved: true,
      traceRootId: null,
    });
    expect(searched.nodes.map(({ id }) => id).sort()).toEqual([
      "ai",
      "draft",
      "fact",
    ]);

    const issues = filterReasoningGraph(nodes, edges, {
      onlyIssues: true,
      query: "",
      showAi: true,
      showContext: true,
      showResolved: true,
      traceRootId: null,
    });
    expect(issues.nodes.map(({ id }) => id).sort()).toEqual(["ai", "draft", "fact"]);
  });

  it("traces both upstream premises and downstream actions", () => {
    expect([...traceConnected("draft", edges)].sort()).toEqual([
      "ai",
      "draft",
      "fact",
      "pending",
      "source",
    ]);
  });
});

function node(
  id: string,
  lane: ReasoningGraphNode["lane"],
  kind: ReasoningGraphNode["kind"] = "claim",
  overrides: Partial<ReasoningGraphNode> = {},
): ReasoningGraphNode {
  return {
    archived: false,
    body: `${id} body`,
    branchId: null,
    branchName: null,
    confidence: null,
    createdBy: "user",
    href: `#${id}`,
    id,
    issues: [],
    kind,
    lane,
    recordId: id,
    revision: 1,
    stale: false,
    status: "active",
    subtype: kind,
    title: id,
    unresolvedConflict: false,
    updatedAt: null,
    ...overrides,
  };
}

function edge(
  source: string,
  target: string,
  kind: ReasoningGraphEdge["kind"],
): ReasoningGraphEdge {
  return {
    detail: "",
    id: `${source}:${target}`,
    kind,
    relation: kind === "support" ? "supports" : kind,
    source,
    stale: false,
    target,
    unresolved: false,
  };
}
