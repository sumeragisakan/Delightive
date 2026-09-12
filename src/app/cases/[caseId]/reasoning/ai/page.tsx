import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AiRunForm,
  AiSuggestionReview,
  RetryAiRunForm,
} from "../../../../components/ai-reasoning-forms";
import { CaseWorkspaceFrame } from "../../../../components/case-workspace-frame";
import { getAiReasoningWorkspace } from "../../../../data";
import type { InvestigationItem } from "@/db/repositories/ai-reasoning-repository";
import type { AiReasoningRunView } from "@/db/services/ai-reasoning-service";

type ClaimReference = { content: string; href: string };
type HistoryView = "all" | "review" | "failed";

export default async function AiReasoningPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{
    branch?: string | string[];
    view?: string | string[];
  }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const requestedBranchId =
    typeof query.branch === "string" ? query.branch : undefined;
  const requestedView = typeof query.view === "string" ? query.view : "all";
  const historyView: HistoryView = ["review", "failed"].includes(requestedView)
    ? (requestedView as HistoryView)
    : "all";
  const {
    caseFile,
    configuration,
    context,
    investigationItems,
    runs,
    workspace,
  } = await getAiReasoningWorkspace(caseId, requestedBranchId);

  if (!caseFile || !workspace) notFound();

  const branch = workspace.selectedBranch;
  const activeBranches = workspace.branches.filter(
    (candidate) => candidate.status === "active",
  );
  const contextClaims = context
    ? [
        ...context.fixedEvidence,
        ...context.acceptedInferences,
        ...context.exploration.claims,
      ]
    : [];
  const focusOptions = context
    ? [
        ...context.fixedEvidence.map((claim) => ({
          content: claim.content,
          id: claim.id,
          layer: "1 固定事实",
        })),
        ...context.acceptedInferences.map((claim) => ({
          content: claim.content,
          id: claim.id,
          layer: "1.5 可信推论",
        })),
        ...context.exploration.claims.map((claim) => ({
          content: claim.content,
          id: claim.id,
          layer: "2 分支草稿",
        })),
      ]
    : [];
  const claimReferences: Record<string, ClaimReference> = {};
  for (const claim of contextClaims) {
    const fixed = claim.kind === "fact" || claim.kind === "statement";
    claimReferences[claim.id] = {
      content: claim.content,
      href: fixed
        ? `/cases/${caseId}/evidence#claim-${claim.id}`
        : `/cases/${caseId}/reasoning${branch ? `?branch=${branch.id}` : ""}#claim-${claim.id}`,
    };
  }
  for (const run of runs) {
    for (const claim of readSnapshotClaims(run.input.contextJson)) {
      claimReferences[claim.id] ??= {
        content: claim.content,
        href:
          claim.kind === "fact" || claim.kind === "statement"
            ? `/cases/${caseId}/evidence#claim-${claim.id}`
            : `/cases/${caseId}/reasoning?branch=${run.branchId}#claim-${claim.id}`,
      };
    }
  }
  const filteredRuns = runs.filter((run) => {
    if (historyView === "review") {
      return run.suggestions.some(({ status }) => status === "pending");
    }
    if (historyView === "failed") {
      return run.status === "failed" || run.status === "interrupted";
    }
    return true;
  });

  return (
    <CaseWorkspaceFrame
      activeModule="reasoning"
      aside={
        <div className="space-y-7 lg:sticky lg:top-8">
          <section>
            <p className="eyebrow">模型边界</p>
            <h2 className="mt-2 text-xl font-semibold">只读上下文，人工写入</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              模型原文始终保留。人工编辑作为新修订保存，采纳后也只能进入分支草稿、冲突审查或待调查区。
            </p>
          </section>
          <section className="border-t border-[var(--line)] pt-5">
            <p className="text-sm font-semibold">当前服务</p>
            <div className="mt-3 source-summary">
              <p className="font-mono text-xs uppercase tracking-[0.12em]">
                {configuration.provider} · {configuration.model}
              </p>
              <p
                className={`mt-2 text-sm ${configuration.configured ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
              >
                {configuration.configured ? "服务端密钥已配置" : "尚未配置服务端密钥"}
              </p>
            </div>
          </section>
          <section className="border-t border-[var(--line)] pt-5">
            <p className="text-sm font-semibold">切换分支</p>
            <nav aria-label="AI 推演分支" className="branch-list mt-4">
              {activeBranches.map((candidate) => (
                <Link
                  aria-current={candidate.id === branch?.id ? "page" : undefined}
                  className={`branch-link ${candidate.id === branch?.id ? "branch-link-active" : ""}`}
                  href={`/cases/${caseId}/reasoning/ai?branch=${candidate.id}`}
                  key={candidate.id}
                >
                  <span className="branch-depth" aria-hidden="true">●</span>
                  <span>{candidate.path.join(" / ")}</span>
                </Link>
              ))}
            </nav>
          </section>
        </div>
      }
      caseFile={caseFile}
    >
      <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">AI 辅助推演</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
            {branch?.name ?? "先建立一个推理分支"}
          </h2>
          {branch && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              {branch.path.join(" / ")} · 可编辑、可追溯的审阅闭环
            </p>
          )}
        </div>
        <Link
          className="secondary-button"
          href={`/cases/${caseId}/reasoning${branch ? `?branch=${branch.id}` : ""}`}
        >
          返回人工推理
        </Link>
      </div>

      {branch && context ? (
        <>
          <section className="reasoning-composer mt-6">
            <div className="mb-5 flex flex-col gap-3 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-semibold">发起新推演</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  本次将读取 {context.fixedEvidence.length} 条固定事实、{context.acceptedInferences.length} 条可信推论和 {context.exploration.claims.length} 条当前路线草稿。
                </p>
              </div>
              <span className="record-badge">最多 8 条建议</span>
            </div>
            {!configuration.configured && (
              <div className="reasoning-issues mb-5">
                <p className="font-semibold">需要先配置 API</p>
                <p className="mt-2">
                  在项目根目录创建 .env.local，写入 OPENAI_API_KEY 后重启开发服务器。
                </p>
              </div>
            )}
            <AiRunForm
              branchId={branch.id}
              caseId={caseId}
              configured={configuration.configured}
              focusOptions={focusOptions}
              requestKey={randomUUID()}
            />
          </section>

          <InvestigationQueue
            claimReferences={claimReferences}
            items={investigationItems}
          />

          <section className="mt-10">
            <div className="mb-4 flex flex-col gap-4 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">审计记录</p>
                <h3 className="mt-2 text-xl font-semibold">运行与建议历史</h3>
              </div>
              <nav aria-label="运行记录筛选" className="flex flex-wrap gap-2">
                {historyFilters.map((filter) => (
                  <Link
                    aria-current={historyView === filter.value ? "page" : undefined}
                    className={historyView === filter.value ? "primary-button" : "secondary-button"}
                    href={`/cases/${caseId}/reasoning/ai?branch=${branch.id}&view=${filter.value}`}
                    key={filter.value}
                  >
                    {filter.label}
                  </Link>
                ))}
              </nav>
            </div>
            {filteredRuns.length > 0 ? (
              <div className="grid gap-5">
                {filteredRuns.map((run, index) => (
                  <RunCard
                    caseId={caseId}
                    claimReferences={claimReferences}
                    configured={configuration.configured}
                    defaultOpen={index === 0 || run.suggestions.some(({ status }) => status === "pending")}
                    key={run.id}
                    retryRequestKey={randomUUID()}
                    run={run}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm leading-6 text-[var(--muted)]">
                当前筛选条件下没有运行记录。
              </p>
            )}
          </section>
        </>
      ) : (
        <div className="empty-dossier mt-6">
          <span className="empty-dossier-number">AI</span>
          <div>
            <h3 className="text-xl font-semibold">AI 推演需要明确的分支范围</h3>
            <p className="mt-2 text-[var(--muted)]">
              返回人工推理页面建立第一条活动分支后再运行。
            </p>
          </div>
        </div>
      )}
    </CaseWorkspaceFrame>
  );
}

function RunCard({
  caseId,
  claimReferences,
  configured,
  defaultOpen,
  retryRequestKey,
  run,
}: {
  caseId: string;
  claimReferences: Record<string, ClaimReference>;
  configured: boolean;
  defaultOpen: boolean;
  retryRequestKey: string;
  run: AiReasoningRunView;
}) {
  const stats = readSnapshotStats(run.input.contextJson);
  const labels = Object.fromEntries(
    Object.entries(claimReferences).map(([id, value]) => [id, value.content]),
  );
  return (
    <details className="reasoning-card" open={defaultOpen}>
      <summary className="cursor-pointer list-none marker:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`evidence-status evidence-status-${run.status === "completed" ? "accepted" : run.status === "running" ? "draft" : "rejected"}`}>
                {runStatusLabels[run.status]}
              </span>
              <span className="text-xs text-[var(--muted)]">{modeLabels[run.mode]}</span>
              {run.isStale && <span className="branch-origin">输入快照已有后续变化</span>}
              {run.retryOfRunId && <span className="branch-origin">重试运行</span>}
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {run.summary || run.errorMessage || "等待模型返回。"}
            </p>
          </div>
          <div className="text-right text-xs leading-5 text-[var(--muted)]">
            <p>{run.model}</p>
            <time>{formatDate(run.createdAt)}</time>
          </div>
        </div>
      </summary>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>{run.suggestions.length} 条建议</span>
        <span>输入：{stats.fixed} 事实 / {stats.trusted} 可信 / {stats.drafts} 草稿</span>
        {run.totalTokens !== null && <span>{run.totalTokens} tokens</span>}
        {run.durationMs !== null && <span>{(run.durationMs / 1000).toFixed(1)} 秒</span>}
        {run.focusClaimId && <span>聚焦：{truncate(claimReferences[run.focusClaimId]?.content ?? run.focusClaimId, 34)}</span>}
        <span className="font-mono">RUN · {run.id.slice(0, 8)}</span>
      </div>
      {(run.userPrompt || run.errorCode || run.retryOfRunId) && (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-white/40 p-3 text-xs leading-5 text-[var(--muted)]">
          {run.userPrompt && <p>补充要求：{run.userPrompt}</p>}
          {run.errorCode && <p>错误分类：{errorCodeLabels[run.errorCode]}</p>}
          {run.retryOfRunId && <p className="font-mono">来源运行：{run.retryOfRunId.slice(0, 8)}</p>}
        </div>
      )}
      {run.status !== "running" && (
        <RetryAiRunForm
          caseId={caseId}
          configured={configured}
          requestKey={retryRequestKey}
          runId={run.id}
        />
      )}
      {run.suggestions.length > 0 && (
        <div className="mt-5 grid gap-4 border-t border-[var(--line)] pt-5">
          {run.suggestions.map((suggestion) => (
            <article className="rounded-xl border border-[var(--line)] bg-white/55 p-4" key={suggestion.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="reasoning-layer-badge">{suggestionKindLabels[suggestion.kind]}</span>
                <span className="text-xs text-[var(--muted)]">可信度 {suggestion.effective.confidence}%</span>
                <span className="text-xs text-[var(--muted)]">{suggestionStatusLabels[suggestion.status]}</span>
                {suggestion.edits.length > 0 && <span className="branch-origin">人工修订 {suggestion.edits[0].revision}</span>}
                {suggestion.isStale && <span className="text-xs font-semibold text-[#765718]">引用已过期</span>}
              </div>
              <h4 className="mt-3 font-semibold">{suggestion.effective.title}</h4>
              <p className="mt-2 leading-7">{suggestion.effective.content}</p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{suggestion.effective.rationale}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestion.effective.citations.map((citation) => {
                  const reference = claimReferences[citation.claimId];
                  return (
                    <Link className="evidence-link" href={reference?.href ?? "#"} key={`${citation.claimId}-${citation.relation}`}>
                      {relationLabels[citation.relation]} · {truncate(reference?.content ?? citation.claimId, 40)} · r{citation.revision}
                    </Link>
                  );
                })}
              </div>
              {suggestion.edits.length > 0 && (
                <details className="mt-4 border-t border-[var(--line)] pt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
                    查看模型原文与编辑历史
                  </summary>
                  <div className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    <p className="font-semibold text-[var(--ink)]">模型原文：{suggestion.title}</p>
                    <p className="mt-1">{suggestion.content}</p>
                    <ol className="mt-3 space-y-2">
                      {[...suggestion.edits].reverse().map((edit) => (
                        <li key={edit.id}>修订 {edit.revision} · {formatDate(edit.editedAt)}{edit.note ? ` · ${edit.note}` : ""}</li>
                      ))}
                    </ol>
                  </div>
                </details>
              )}
              {suggestion.validationIssues.length > 0 && (
                <div className="reasoning-issues mt-4">
                  <p className="font-semibold">模型原始输出未通过校验</p>
                  {suggestion.validationIssues.map((issue) => <p className="mt-1" key={issue}>• {issue}</p>)}
                </div>
              )}
              {suggestion.status === "pending" && (
                <AiSuggestionReview
                  baseRevision={suggestion.edits[0]?.revision ?? 0}
                  caseId={caseId}
                  claimLabels={labels}
                  disabled={suggestion.isStale || suggestion.validationIssues.length > 0}
                  effective={suggestion.effective}
                  kind={suggestion.kind}
                  suggestionId={suggestion.id}
                />
              )}
              {suggestion.resolutionKind && (
                <p className="mt-4 text-xs text-[var(--success)]">
                  {resolutionStatusLabels[suggestion.resolutionKind]}
                  {suggestion.resolutionNote ? ` · ${suggestion.resolutionNote}` : ""}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </details>
  );
}

function InvestigationQueue({
  claimReferences,
  items,
}: {
  claimReferences: Record<string, ClaimReference>;
  items: InvestigationItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between border-b border-[var(--line)] pb-4">
        <div>
          <p className="eyebrow">调查移交</p>
          <h3 className="mt-2 text-xl font-semibold">AI 发现的待调查事项</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">这里先保留轻量队列；完整任务管理会在下一阶段展开。</p>
        </div>
        <span className="record-badge">{items.length} 项</span>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <article className="reasoning-card" id={`investigation-${item.id}`} key={item.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="reasoning-layer-badge">待调查</span>
              <span className="text-xs text-[var(--muted)]">{investigationStatusLabels[item.status]}</span>
            </div>
            <h4 className="mt-3 font-semibold">{item.title}</h4>
            <p className="mt-2 leading-7">{item.question}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.claims.map((claim) => {
                const reference = claimReferences[claim.claimId];
                return <Link className="evidence-link" href={reference?.href ?? "#"} key={claim.claimId}>{claim.role === "target" ? "目标" : "上下文"} · {truncate(reference?.content ?? claim.claimId, 38)} · r{claim.claimRevision}</Link>;
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const historyFilters = [
  { label: "全部", value: "all" },
  { label: "待审", value: "review" },
  { label: "失败 / 中断", value: "failed" },
] as const;
const modeLabels = {
  consistency_check: "一致性检查",
  counterexample_search: "反例搜索",
  hypothesis_expansion: "假设扩展",
  investigation_gaps: "调查缺口",
} as const;
const runStatusLabels = {
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  running: "运行中",
} as const;
const errorCodeLabels = {
  authentication: "密钥或权限",
  interrupted: "执行中断",
  invalid_output: "模型输出无效",
  network: "网络连接",
  provider: "模型服务",
  rate_limit: "调用限流",
  timeout: "请求超时",
} as const;
const suggestionKindLabels = {
  contradiction: "矛盾",
  counterexample: "反例",
  hypothesis: "假设",
  investigation_gap: "调查缺口",
} as const;
const suggestionStatusLabels = {
  accepted: "已处置",
  dismissed: "已忽略",
  invalid: "无效输出",
  pending: "待审",
} as const;
const resolutionStatusLabels = {
  conflict_created: "已建立矛盾关系",
  dismissed: "已忽略并保留记录",
  hypothesis_created: "已建立分支假设",
  investigation_created: "已建立待调查事项",
} as const;
const investigationStatusLabels = {
  in_progress: "进行中",
  pending: "待查",
  resolved: "已解决",
  unresolved: "无法确认",
} as const;
const relationLabels = {
  contradicts: "矛盾",
  depends_on: "依赖",
  qualifies: "限定",
  supports: "支持",
} as const;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function readSnapshotClaims(contextJson: string) {
  try {
    const context = JSON.parse(contextJson) as {
      acceptedInferences?: Array<{ content?: unknown; id?: unknown; kind?: unknown }>;
      exploration?: { claims?: Array<{ content?: unknown; id?: unknown; kind?: unknown }> };
      fixedEvidence?: Array<{ content?: unknown; id?: unknown; kind?: unknown }>;
    };
    return [
      ...(context.fixedEvidence ?? []),
      ...(context.acceptedInferences ?? []),
      ...(context.exploration?.claims ?? []),
    ].flatMap((claim) =>
      typeof claim.id === "string" &&
      typeof claim.content === "string" &&
      typeof claim.kind === "string"
        ? [{ content: claim.content, id: claim.id, kind: claim.kind }]
        : [],
    );
  } catch {
    return [];
  }
}

function readSnapshotStats(contextJson: string) {
  try {
    const context = JSON.parse(contextJson) as {
      acceptedInferences?: unknown[];
      exploration?: { claims?: unknown[] };
      fixedEvidence?: unknown[];
    };
    return {
      drafts: context.exploration?.claims?.length ?? 0,
      fixed: context.fixedEvidence?.length ?? 0,
      trusted: context.acceptedInferences?.length ?? 0,
    };
  } catch {
    return { drafts: 0, fixed: 0, trusted: 0 };
  }
}
