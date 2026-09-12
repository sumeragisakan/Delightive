import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { CaseWorkspaceFrame } from "../../../../../components/case-workspace-frame";
import { getAiRunComparison } from "../../../../../data";
import type { AiReasoningRun } from "@/db/repositories/ai-reasoning-repository";
import type {
  SnapshotClaim,
  SuggestionComparison,
} from "@/db/services/ai-run-comparison-service";

export default async function AiRunComparisonPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{
    left?: string | string[];
    right?: string | string[];
  }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const leftRunId = typeof query.left === "string" ? query.left : "";
  const rightRunId = typeof query.right === "string" ? query.right : "";
  const { caseFile, comparison } = await getAiRunComparison(
    caseId,
    leftRunId,
    rightRunId,
  );

  if (!caseFile || !comparison) notFound();

  const returnHref = `/cases/${caseId}/reasoning/ai?branch=${comparison.right.branchId}`;

  return (
    <CaseWorkspaceFrame
      activeModule="reasoning"
      aside={
        <div className="space-y-6 lg:sticky lg:top-8">
          <section>
            <p className="eyebrow">比较摘要</p>
            <h2 className="mt-2 text-xl font-semibold">两次快照，一次复盘</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              比较完全读取本地历史，不会再次调用模型，也不会改变任何建议或推论。
            </p>
          </section>
          <section className="border-t border-[var(--line)] pt-5">
            <p className="text-sm font-semibold">输入上下文变化</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="新增" value={comparison.contextCounts.added} />
              <Metric label="修改" value={comparison.contextCounts.changed} />
              <Metric label="移除" value={comparison.contextCounts.removed} />
            </dl>
          </section>
          <section className="border-t border-[var(--line)] pt-5">
            <p className="text-sm font-semibold">模型建议变化</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
              <Metric label="发生变化" value={comparison.suggestionCounts.changed} />
              <Metric label="保持一致" value={comparison.suggestionCounts.same} />
              <Metric label="仅运行 A" value={comparison.suggestionCounts.leftOnly} />
              <Metric label="仅运行 B" value={comparison.suggestionCounts.rightOnly} />
            </dl>
          </section>
          {comparison.warnings.length > 0 && (
            <section className="reasoning-issues">
              <p className="font-semibold">比较提示</p>
              {comparison.warnings.map((warning) => (
                <p className="mt-1" key={warning}>• {warning}</p>
              ))}
            </section>
          )}
          <Link className="secondary-button" href={returnHref}>
            返回 AI 推演历史
          </Link>
        </div>
      }
      caseFile={caseFile}
    >
      <header className="border-b border-[var(--line)] pb-6">
        <p className="eyebrow">运行比较</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.035em]">
              输入变化如何影响推演结果
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              先核对上下文差异，再查看模型建议及其人工处理状态的变化。
            </p>
          </div>
          <span className="record-badge">本地确定性比较</span>
        </div>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <RunSummary label="运行 A · 基准" run={comparison.left} />
        <RunSummary label="运行 B · 对照" run={comparison.right} />
      </section>

      <section className="mt-10">
        <SectionHeading
          eyebrow="输入快照"
          title={`上下文差异 · ${comparison.contextChanges.length}`}
        />
        {comparison.contextChanges.length > 0 ? (
          <div className="mt-4 grid gap-4">
            {comparison.contextChanges.map((change) => (
              <article className="reasoning-card" key={change.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="reasoning-layer-badge">
                    {contextChangeLabels[change.kind]}
                  </span>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {change.id.slice(0, 12)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <ClaimSide claim={change.left} emptyLabel="运行 A 中不存在" label="运行 A" />
                  <ClaimSide claim={change.right} emptyLabel="运行 B 中不存在" label="运行 B" />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyMessage>两次运行的事实、可信推论与分支草稿快照没有差异。</EmptyMessage>
        )}
      </section>

      <section className="mt-10">
        <SectionHeading
          eyebrow="模型输出"
          title={`建议差异 · ${comparison.suggestionComparisons.length}`}
        />
        {comparison.suggestionComparisons.length > 0 ? (
          <div className="mt-4 grid gap-5">
            {comparison.suggestionComparisons.map((item, index) => (
              <SuggestionPair item={item} key={`${item.left?.id ?? "none"}-${item.right?.id ?? "none"}-${index}`} />
            ))}
          </div>
        ) : (
          <EmptyMessage>两次运行都没有生成可比较的建议。</EmptyMessage>
        )}
      </section>
    </CaseWorkspaceFrame>
  );
}

function RunSummary({
  label,
  run,
}: {
  label: string;
  run: AiReasoningRun;
}) {
  return (
    <article className="reasoning-card">
      <p className="eyebrow">{label}</p>
      <p className="mt-3 font-semibold">{run.summary || run.errorMessage || "无运行摘要"}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
        <dt className="text-[var(--muted)]">模型</dt><dd>{run.provider} · {run.model}</dd>
        <dt className="text-[var(--muted)]">任务</dt><dd>{modeLabels[run.mode]}</dd>
        <dt className="text-[var(--muted)]">状态</dt><dd>{runStatusLabels[run.status]}</dd>
        <dt className="text-[var(--muted)]">时间</dt><dd>{formatDate(run.createdAt)}</dd>
        <dt className="text-[var(--muted)]">运行 ID</dt><dd className="break-all font-mono">{run.id}</dd>
        <dt className="text-[var(--muted)]">快照</dt><dd className="break-all font-mono">{run.input.contextFingerprint}</dd>
      </dl>
    </article>
  );
}

function SuggestionPair({ item }: { item: SuggestionComparison }) {
  return (
    <article className="reasoning-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="reasoning-layer-badge">{suggestionChangeLabels[item.kind]}</span>
        {item.left?.kind && <span className="text-xs text-[var(--muted)]">{suggestionKindLabels[item.left.kind]}</span>}
        {!item.left && item.right?.kind && <span className="text-xs text-[var(--muted)]">{suggestionKindLabels[item.right.kind]}</span>}
        {item.changes.map((change) => <span className="branch-origin" key={change}>{change}</span>)}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SuggestionSide emptyLabel="运行 A 中没有对应建议" label="运行 A" suggestion={item.left} />
        <SuggestionSide emptyLabel="运行 B 中没有对应建议" label="运行 B" suggestion={item.right} />
      </div>
    </article>
  );
}

function SuggestionSide({
  emptyLabel,
  label,
  suggestion,
}: {
  emptyLabel: string;
  label: string;
  suggestion: SuggestionComparison["left"];
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/45 p-4">
      <p className="text-xs font-semibold text-[var(--accent)]">{label}</p>
      {suggestion ? (
        <>
          <h4 className="mt-2 font-semibold">{suggestion.effective.title}</h4>
          <p className="mt-2 text-sm leading-6">{suggestion.effective.content}</p>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            可信度 {suggestion.effective.confidence}% · {suggestionStatusLabels[suggestion.status]}
            {suggestion.edits.length > 0 ? ` · 人工修订 ${suggestion.edits.length} 次` : ""}
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            {suggestion.effective.rationale}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            引用 {suggestion.effective.citations.length} 条
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">{emptyLabel}</p>
      )}
    </div>
  );
}

function ClaimSide({
  claim,
  emptyLabel,
  label,
}: {
  claim: SnapshotClaim | null;
  emptyLabel: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/45 p-4">
      <p className="text-xs font-semibold text-[var(--accent)]">{label}</p>
      {claim ? (
        <>
          <p className="mt-2 text-sm leading-6">{claim.content}</p>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {snapshotLayerLabels[claim.layer]} · {claim.kind} · {claim.status} · r{claim.revision}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">{emptyLabel}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/45 p-3">
      <dd className="text-xl font-semibold">{value}</dd>
      <dt className="mt-1 text-xs text-[var(--muted)]">{label}</dt>
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-[var(--line)] pb-4">
      <p className="eyebrow">{eyebrow}</p>
      <h3 className="mt-2 text-xl font-semibold">{title}</h3>
    </div>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
      {children}
    </p>
  );
}

const contextChangeLabels = { added: "新增输入", changed: "输入已变化", removed: "移除输入" } as const;
const snapshotLayerLabels = { draft: "2 分支草稿", fixed: "1 固定事实", trusted: "1.5 可信推论" } as const;
const suggestionChangeLabels = { changed: "建议已变化", left_only: "仅运行 A", right_only: "仅运行 B", same: "建议一致" } as const;
const suggestionKindLabels = { contradiction: "矛盾", counterexample: "反例", hypothesis: "假设", investigation_gap: "调查缺口" } as const;
const suggestionStatusLabels = { accepted: "已处置", dismissed: "已忽略", invalid: "无效输出", pending: "待审" } as const;
const modeLabels = { consistency_check: "一致性检查", counterexample_search: "反例搜索", hypothesis_expansion: "假设扩展", investigation_gaps: "调查缺口" } as const;
const runStatusLabels = { completed: "已完成", failed: "失败", interrupted: "已中断", running: "运行中" } as const;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
