"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ReasoningGraph,
  ReasoningGraphEdge,
  ReasoningGraphLane,
  ReasoningGraphNode,
} from "@/db/services/reasoning-graph-service";
import {
  graphEdgeLabel,
  graphLaneLabels,
  graphNodeKindLabel,
  graphStatusLabel,
} from "@/reasoning/graph-labels";
import { filterReasoningGraph } from "@/reasoning/graph-view";

import styles from "./reasoning-graph.module.css";

const elk = new ELK();
const NODE_WIDTH = 260;
const NODE_HEIGHT = 134;
const laneOrder: ReasoningGraphLane[] = [
  "context",
  "fixed",
  "trusted",
  "exploration",
  "action",
];

type GraphContextValue = {
  filters: {
    onlyIssues: boolean;
    query: string;
    showAi: boolean;
    showContext: boolean;
    showResolved: boolean;
    traceSelected: boolean;
  };
  graph: ReasoningGraph;
  resetFilters: () => void;
  selectedId: string | null;
  selectNode: (id: string | null) => void;
  setFilter: <Key extends keyof GraphContextValue["filters"]>(
    key: Key,
    value: GraphContextValue["filters"][Key],
  ) => void;
};

const GraphContext = createContext<GraphContextValue | null>(null);

export function ReasoningGraphProvider({
  children,
  graph,
  initialFocusId,
}: {
  children: React.ReactNode;
  graph: ReasoningGraph;
  initialFocusId?: string;
}) {
  const initialSelected =
    graph.nodes.find(
      (node) => node.id === initialFocusId || node.recordId === initialFocusId,
    )?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  const [filters, setFilters] = useState({
    onlyIssues: false,
    query: "",
    showAi: true,
    showContext: false,
    showResolved: false,
    traceSelected: false,
  });
  const setFilter = useCallback(
    <Key extends keyof typeof filters>(key: Key, value: (typeof filters)[Key]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );
  const resetFilters = useCallback(() => {
    setFilters({
      onlyIssues: false,
      query: "",
      showAi: true,
      showContext: false,
      showResolved: false,
      traceSelected: false,
    });
  }, []);
  const value = useMemo(
    () => ({
      filters,
      graph,
      resetFilters,
      selectedId,
      selectNode: setSelectedId,
      setFilter,
    }),
    [filters, graph, resetFilters, selectedId, setFilter],
  );

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function ReasoningGraphCanvas() {
  const { filters, graph, resetFilters, selectedId, selectNode, setFilter } =
    useGraphContext();
  const [view, setView] = useState<"graph" | "outline">("graph");
  const visible = useMemo(
    () =>
      filterReasoningGraph(graph.nodes, graph.edges, {
        onlyIssues: filters.onlyIssues,
        query: filters.query,
        showAi: filters.showAi,
        showContext: filters.showContext,
        showResolved: filters.showResolved,
        traceRootId: filters.traceSelected ? selectedId : null,
      }),
    [filters, graph, selectedId],
  );

  return (
    <div className={styles.workspace}>
      <div className={styles.toolbar}>
        <input
          aria-label="筛选图中节点"
          className={styles.search}
          onChange={(event) => setFilter("query", event.target.value)}
          placeholder="筛选标题、正文或分支…"
          type="search"
          value={filters.query}
        />
        <FilterToggle
          checked={filters.onlyIssues}
          label="只看异常"
          onChange={(checked) => setFilter("onlyIssues", checked)}
        />
        <FilterToggle
          checked={filters.showAi}
          label="AI 建议"
          onChange={(checked) => setFilter("showAi", checked)}
        />
        <FilterToggle
          checked={filters.showContext}
          label="背景节点"
          onChange={(checked) => setFilter("showContext", checked)}
        />
        <FilterToggle
          checked={filters.showResolved}
          label="已解决调查"
          onChange={(checked) => setFilter("showResolved", checked)}
        />
        <FilterToggle
          checked={filters.traceSelected}
          disabled={!selectedId}
          label="追踪选中链路"
          onChange={(checked) => setFilter("traceSelected", checked)}
        />
        <button className={styles.viewButton} onClick={resetFilters} type="button">
          重置
        </button>
        <div aria-label="视图模式" className={styles.viewSwitch} role="group">
          <ViewButton active={view === "graph"} onClick={() => setView("graph")}>
            图谱
          </ViewButton>
          <ViewButton active={view === "outline"} onClick={() => setView("outline")}>
            大纲
          </ViewButton>
        </div>
      </div>

      <p aria-live="polite" className="text-xs text-[var(--muted)]">
        当前显示 {visible.nodes.length} 个节点、{visible.edges.length} 条关系
        {filters.traceSelected && selectedId ? " · 正在追踪选中节点的上下游" : ""}
      </p>

      {view === "graph" ? (
        <ReactFlowProvider>
          <FlowSurface
            edges={visible.edges}
            nodes={visible.nodes}
            selectedId={selectedId}
            selectNode={selectNode}
            tracing={filters.traceSelected}
          />
        </ReactFlowProvider>
      ) : (
        <GraphOutline
          nodes={visible.nodes}
          selectedId={selectedId}
          selectNode={selectNode}
        />
      )}
    </div>
  );
}

export function ReasoningGraphInspector() {
  const { graph, selectedId, selectNode } = useGraphContext();
  const node = graph.nodes.find((candidate) => candidate.id === selectedId) ?? null;
  const relations = node
    ? graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id)
    : [];
  const nodeById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));

  if (!node) {
    return (
      <section className={styles.inspector}>
        <div>
          <p className="eyebrow">节点检查器</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
            选择一条记录
          </h2>
        </div>
        <p className="text-sm leading-6 text-[var(--muted)]">
          点击图谱卡片或大纲条目，查看其版本、状态、异常和直接关系。图中的内容始终链接回原始记录。
        </p>
      </section>
    );
  }

  return (
    <section className={styles.inspector}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{graphLaneLabels[node.lane]}</p>
          <h2 className="mt-2 text-lg font-semibold leading-7">{node.title}</h2>
        </div>
        <button className="text-button !min-h-0 !p-1" onClick={() => selectNode(null)} type="button">
          关闭
        </button>
      </div>

      {node.body && <p className={styles.inspectorBody}>{node.body}</p>}

      <dl className={styles.detailGrid}>
        <dt>类型</dt>
        <dd>{graphNodeKindLabel(node)}</dd>
        <dt>状态</dt>
        <dd>{graphStatusLabel(node.status)}</dd>
        {node.branchName && (
          <>
            <dt>分支</dt>
            <dd>{node.branchName}</dd>
          </>
        )}
        {node.revision !== null && (
          <>
            <dt>修订</dt>
            <dd>{node.revision}</dd>
          </>
        )}
        {node.confidence !== null && (
          <>
            <dt>可信度</dt>
            <dd>{node.confidence}%</dd>
          </>
        )}
        <dt>记录 ID</dt>
        <dd className="font-mono">{node.recordId.slice(0, 12)}</dd>
      </dl>

      {node.issues.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--danger)]">需要注意</h3>
          <ul className={`${styles.issueList} mt-2`}>
            {node.issues.map((issue) => (
              <li key={issue}>• {issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">直接关系 · {relations.length}</h3>
        {relations.length > 0 ? (
          <ul className={`${styles.relationList} mt-2`}>
            {relations.map((edge) => {
              const outgoing = edge.source === node.id;
              const other = nodeById.get(outgoing ? edge.target : edge.source);
              return (
                <li key={edge.id}>
                  {outgoing ? "→" : "←"} {graphEdgeLabel(edge)} · {other?.title ?? "未知记录"}
                  {edge.stale ? " · 已陈旧" : ""}
                  {edge.unresolved ? " · 待处置" : ""}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted)]">暂无直接关系。</p>
        )}
      </div>

      <Link className="secondary-button justify-center" href={node.href}>
        打开原始记录
      </Link>
    </section>
  );
}

export function ReasoningGraphLegend() {
  return (
    <section className="border-t border-[var(--line)] pt-5">
      <p className="eyebrow">图例</p>
      <div className={`${styles.legend} mt-3`}>
        {laneOrder.map((lane) => (
          <div className={styles.legendItem} key={lane}>
            <span className={`${styles.legendSwatch} ${styles[lane]}`} />
            <span>{graphLaneLabels[lane]}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        红色关系表示矛盾，虚线表示陈旧引用。背景节点默认折叠，可从筛选栏展开。
      </p>
    </section>
  );
}

function FlowSurface({
  edges,
  nodes,
  selectedId,
  selectNode,
  tracing,
}: {
  edges: ReasoningGraphEdge[];
  nodes: ReasoningGraphNode[];
  selectedId: string | null;
  selectNode: (id: string | null) => void;
  tracing: boolean;
}) {
  const [layout, setLayout] = useState<{
    positions: Map<string, { x: number; y: number }>;
    signature: string;
  }>({ positions: new Map(), signature: "" });
  const { fitView } = useReactFlow<GraphFlowNode, Edge>();
  const layoutSignature = `${nodes.map((node) => node.id).join("|")}::${edges.map((edge) => edge.id).join("|")}`;
  const layoutPending = layout.signature !== layoutSignature;

  useEffect(() => {
    let cancelled = false;
    void layoutPositions(nodes, edges).then((next) => {
      if (!cancelled) {
        setLayout({ positions: next, signature: layoutSignature });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [edges, layoutSignature, nodes]);

  const connectedToSelection = useMemo(() => {
    const result = new Set<string>();
    if (!selectedId) return result;
    result.add(selectedId);
    for (const edge of edges) {
      if (edge.source === selectedId) result.add(edge.target);
      if (edge.target === selectedId) result.add(edge.source);
    }
    return result;
  }, [edges, selectedId]);

  const flowNodes = useMemo<GraphFlowNode[]>(
    () =>
      nodes.map((node, index) => ({
        ariaLabel: `${graphLaneLabels[node.lane]}，${graphNodeKindLabel(node)}，${node.title}`,
        ariaRole: "group",
        data: {
          dimmed: Boolean(selectedId) && !tracing && !connectedToSelection.has(node.id),
          record: node,
          selected: node.id === selectedId,
          selectNode,
        },
        id: node.id,
        focusable: false,
        position: layout.positions.get(node.id) ?? fallbackPosition(node, index),
        selectable: false,
        type: "reasoning",
      })),
    [connectedToSelection, layout.positions, nodes, selectNode, selectedId, tracing],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        animated: edge.unresolved,
        id: edge.id,
        label: graphEdgeLabel(edge),
        labelBgBorderRadius: 4,
        labelBgPadding: [4, 2],
        markerEnd: {
          color: edgeColor(edge),
          height: 13,
          type: MarkerType.ArrowClosed,
          width: 13,
        },
        source: edge.source,
        style: {
          stroke: edgeColor(edge),
          strokeDasharray: edge.stale ? "6 5" : undefined,
          strokeWidth: edge.unresolved ? 2.4 : 1.5,
        },
        target: edge.target,
        type: "smoothstep",
      })),
    [edges],
  );

  useEffect(() => {
    if (!layoutPending && flowNodes.length > 0) {
      void fitView({ duration: 260, maxZoom: 1.1, padding: 0.16 });
    }
  }, [fitView, flowNodes.length, layoutPending, layoutSignature]);

  if (nodes.length === 0) {
    return (
      <div className={styles.canvasShell}>
        <div className={styles.empty}>
          <div>
            <p className="font-semibold text-[var(--ink)]">没有符合筛选条件的节点</p>
            <p className="mt-2 text-sm">调整筛选条件或取消链路追踪后再试。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.canvasShell}>
      {layoutPending && <div className={styles.loading}>正在整理推理链路…</div>}
      <ReactFlow<GraphFlowNode, Edge>
        className={styles.flow}
        edges={flowEdges}
        elementsSelectable={false}
        fitView
        maxZoom={1.65}
        minZoom={0.18}
        nodes={flowNodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodeTypes={{ reasoning: ReasoningNodeCard }}
        onNodeClick={(_, node) => selectNode(node.id)}
        panOnScroll
        preventScrolling={false}
      >
        <Background color="#cfc9bc" gap={22} size={1} variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

type GraphFlowData = {
  dimmed: boolean;
  record: ReasoningGraphNode;
  selected: boolean;
  selectNode: (id: string | null) => void;
};
type GraphFlowNode = Node<GraphFlowData, "reasoning">;

function ReasoningNodeCard({ data }: NodeProps<GraphFlowNode>) {
  const node = data.record;
  return (
    <article
      className={`${styles.node} ${styles[node.lane]} ${data.selected ? styles.nodeSelected : ""} ${data.dimmed ? styles.nodeDimmed : ""}`}
    >
      <Handle className={styles.handle} position={Position.Left} type="target" />
      <button
        className={`${styles.nodeButton} nodrag nopan`}
        onClick={(event) => {
          event.stopPropagation();
          data.selectNode(node.id);
        }}
        type="button"
      >
        <span className={styles.nodeMeta}>
          <span>{graphLaneLabels[node.lane]}</span>
          <span>{graphNodeKindLabel(node)}</span>
        </span>
        <span className={styles.nodeTitle}>{node.title}</span>
        <span className={styles.nodeFooter}>
          <span className={styles.badge}>{graphStatusLabel(node.status)}</span>
          {node.branchName && <span className={styles.badge}>{node.branchName}</span>}
          {node.confidence !== null && <span className={styles.badge}>{node.confidence}%</span>}
          {(node.stale || node.unresolvedConflict || node.issues.length > 0) && (
            <span className={styles.issueBadge}>
              {node.unresolvedConflict ? "待处置矛盾" : node.stale ? "陈旧" : "需注意"}
            </span>
          )}
        </span>
      </button>
      <Handle className={styles.handle} position={Position.Right} type="source" />
    </article>
  );
}

function GraphOutline({
  nodes,
  selectedId,
  selectNode,
}: {
  nodes: ReasoningGraphNode[];
  selectedId: string | null;
  selectNode: (id: string | null) => void;
}) {
  if (nodes.length === 0) {
    return <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">没有符合筛选条件的节点。</p>;
  }
  return (
    <div className={styles.outline}>
      {laneOrder.map((lane) => {
        const laneNodes = nodes.filter((node) => node.lane === lane);
        if (laneNodes.length === 0) return null;
        return (
          <section className={styles.outlineGroup} key={lane}>
            <h3 className={styles.outlineHeading}>
              <span>{graphLaneLabels[lane]}</span>
              <span className="record-badge">{laneNodes.length}</span>
            </h3>
            <div className={styles.outlineList}>
              {laneNodes.map((node) => (
                <button
                  className={`${styles.outlineItem} ${selectedId === node.id ? styles.outlineItemActive : ""}`}
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  type="button"
                >
                  <span>
                    <strong>{node.title}</strong>
                    <small className="mt-1 block">
                      {graphNodeKindLabel(node)} · {graphStatusLabel(node.status)}
                      {node.branchName ? ` · ${node.branchName}` : ""}
                    </small>
                  </span>
                  {(node.stale || node.unresolvedConflict || node.issues.length > 0) && (
                    <span className={styles.issueBadge}>需注意</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FilterToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`${styles.toggle} ${disabled ? "opacity-45" : ""}`}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`${styles.viewButton} ${active ? styles.viewButtonActive : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

async function layoutPositions(
  nodes: ReasoningGraphNode[],
  edges: ReasoningGraphEdge[],
) {
  try {
    const result = await elk.layout({
      children: nodes.map((node) => ({
        height: NODE_HEIGHT,
        id: node.id,
        layoutOptions: {
          "elk.partitioning.partition": String(laneOrder.indexOf(node.lane)),
        },
        width: NODE_WIDTH,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
      id: "reasoning-graph",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.partitioning.activate": "true",
        "elk.spacing.nodeNode": "46",
        "elk.layered.spacing.nodeNodeBetweenLayers": "92",
      },
    });
    return new Map(
      (result.children ?? []).map((node) => [
        node.id,
        { x: node.x ?? 0, y: node.y ?? 0 },
      ]),
    );
  } catch {
    return new Map(nodes.map((node, index) => [node.id, fallbackPosition(node, index)]));
  }
}

function fallbackPosition(node: ReasoningGraphNode, index: number) {
  const laneIndex = laneOrder.indexOf(node.lane);
  return { x: laneIndex * 350, y: (index % 7) * 180 };
}

function edgeColor(edge: ReasoningGraphEdge) {
  if (edge.kind === "contradiction") return "#a3312a";
  if (edge.kind === "ai") return "#785393";
  if (edge.kind === "investigation") return "#a57622";
  if (edge.kind === "context") return "#747b80";
  return "#426b59";
}

function useGraphContext() {
  const value = useContext(GraphContext);
  if (!value) throw new Error("Reasoning graph components require a provider.");
  return value;
}
