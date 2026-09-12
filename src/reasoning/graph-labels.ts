import type {
  ReasoningGraphEdge,
  ReasoningGraphLane,
  ReasoningGraphNode,
} from "@/db/services/reasoning-graph-service";

export const graphLaneLabels: Record<ReasoningGraphLane, string> = {
  action: "调查行动",
  context: "来源与背景",
  exploration: "探索层",
  fixed: "固定事实层",
  trusted: "1.5 · 可信推理",
};

const nodeKindLabels: Record<ReasoningGraphNode["kind"], string> = {
  claim: "命题",
  event: "事件",
  investigation: "调查事项",
  location: "地点",
  person: "人物",
  source: "来源",
  suggestion: "AI 建议",
};

const subtypeLabels: Record<string, string> = {
  approximate: "大致时间",
  chapter: "章节",
  contradiction: "矛盾建议",
  counterexample: "反例建议",
  document: "文档",
  exact: "精确时间",
  fact: "事实",
  high: "高优先级",
  hypothesis: "假设",
  image: "图片",
  inference: "推论",
  investigation_gap: "调查缺口",
  location: "地点",
  low: "低优先级",
  narration: "叙述",
  normal: "普通优先级",
  other: "其他",
  person: "人物",
  range: "时间范围",
  relative: "相对时间",
  statement: "人物陈述",
  unknown: "时间未知",
  urgent: "紧急",
  user: "用户记录",
};

const statusLabels: Record<string, string> = {
  accepted: "已采纳",
  active: "使用中",
  archived: "已归档",
  draft: "草稿",
  in_progress: "调查中",
  invalid: "无效",
  needs_review: "待复核",
  pending: "待处理",
  rejected: "已拒绝",
  resolved: "已解决",
  superseded: "已取代",
  unresolved: "未解决",
};

const relationLabels: Record<string, string> = {
  citation_contradicts: "AI 引用 · 矛盾",
  citation_depends_on: "AI 引用 · 依赖",
  citation_qualifies: "AI 引用 · 限定",
  citation_supports: "AI 引用 · 支持",
  context_context: "关联背景",
  context_mentioned: "提及",
  context_object: "客体",
  context_subject: "主体",
  depends_on: "依赖",
  investigation_context: "调查背景",
  investigation_result: "调查结果",
  investigation_target: "调查目标",
  origin: "原始来源",
  qualifies: "限定",
  speaker: "陈述者",
  suggestion_conflict: "转为矛盾",
  suggestion_investigation: "转为调查",
  suggestion_result: "转为假设",
  supports: "支持",
  contradicts: "矛盾",
};

export function graphNodeKindLabel(node: ReasoningGraphNode) {
  return subtypeLabels[node.subtype] ?? nodeKindLabels[node.kind];
}

export function graphStatusLabel(status: string) {
  return statusLabels[status] ?? status;
}

export function graphEdgeLabel(edge: Pick<ReasoningGraphEdge, "relation">) {
  return relationLabels[edge.relation] ?? edge.relation;
}
