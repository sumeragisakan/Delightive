import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AiRunForm,
  AiSuggestionActions,
} from "../../../../components/ai-reasoning-forms";
import { CaseWorkspaceFrame } from "../../../../components/case-workspace-frame";
import { getAiReasoningWorkspace } from "../../../../data";
import type { AiReasoningRunView } from "@/db/services/ai-reasoning-service";

export default async function AiReasoningPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ branch?: string | string[] }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const requestedBranchId =
    typeof query.branch === "string" ? query.branch : undefined;
  const { caseFile, configuration, context, runs, workspace } =
    await getAiReasoningWorkspace(caseId, requestedBranchId);

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
  const claimLabels = new Map(
    contextClaims.map((claim) => [claim.id, claim.content]),
  );
  for (const run of runs) {
    for (const [id, content] of readSnapshotClaims(run.input.contextJson)) {
      if (!claimLabels.has(id)) claimLabels.set(id, content);
    }
  }

  return (
    <CaseWorkspaceFrame
      activeModule="reasoning"
      aside={
        <div className="space-y-7 lg:sticky lg:top-8">
          <section>
            <p className="eyebrow">模型边界</p>
            <h2 className="mt-2 text-xl font-semibold">只读上下文，人工写入</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              模型可以阅读固定事实、可信推论和当前分支，但只能生成建议。采纳后也只是第 2 层假设，进入 1.5 层仍需人工审查。
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
              {branch.path.join(" / ")} · 单次结构化分析
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

      {branch ? (
        <>
          <section className="reasoning-composer mt-6">
            <div className="mb-5 border-b border-[var(--line)] pb-4">
              <h3 className="font-semibold">发起新推演</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                一致性检查、假设扩展、反例搜索和调查缺口共享同一份受版本约束的输入快照。
              </p>
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
            />
          </section>

          <section className="mt-10">
            <div className="mb-4 flex items-end justify-between border-b border-[var(--line)] pb-4">
              <div>
                <p className="eyebrow">审计记录</p>
                <h3 className="mt-2 text-xl font-semibold">运行与建议历史</h3>
              </div>
              <span className="record-badge">{runs.length} 次</span>
            </div>
            {runs.length > 0 ? (
              <div className="grid gap-5">
                {runs.map((run) => (
                  <RunCard
                    caseId={caseId}
                    claimLabels={claimLabels}
                    key={run.id}
                    run={run}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm leading-6 text-[var(--muted)]">
                当前分支还没有 AI 推演记录。
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
  claimLabels,
  run,
}: {
  caseId: string;
  claimLabels: Map<string, string>;
  run: AiReasoningRunView;
}) {
  return (
    <article className="reasoning-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`evidence-status evidence-status-${run.status === "completed" ? "accepted" : run.status === "failed" ? "rejected" : "draft"}`}>
              {runStatusLabels[run.status]}
            </span>
            <span className="text-xs text-[var(--muted)]">{modeLabels[run.mode]}</span>
            {run.isStale && <span className="branch-origin">输入快照已有后续变化</span>}
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
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>{run.suggestions.length} 条建议</span>
        {run.totalTokens !== null && <span>{run.totalTokens} tokens</span>}
        {run.durationMs !== null && <span>{(run.durationMs / 1000).toFixed(1)} 秒</span>}
        <span className="font-mono">RUN · {run.id.slice(0, 8)}</span>
      </div>
      {run.suggestions.length > 0 && (
        <div className="mt-5 grid gap-4 border-t border-[var(--line)] pt-5">
          {run.suggestions.map((suggestion) => (
            <article className="rounded-xl border border-[var(--line)] bg-white/55 p-4" key={suggestion.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="reasoning-layer-badge">{suggestionKindLabels[suggestion.kind]}</span>
                <span className="text-xs text-[var(--muted)]">可信度 {suggestion.confidence}%</span>
                <span className="text-xs text-[var(--muted)]">{suggestionStatusLabels[suggestion.status]}</span>
                {suggestion.isStale && <span className="text-xs font-semibold text-[#765718]">引用已过期</span>}
              </div>
              <h4 className="mt-3 font-semibold">{suggestion.title}</h4>
              <p className="mt-2 leading-7">{suggestion.content}</p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{suggestion.rationale}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestion.citations.map((citation) => (
                  <span className="evidence-link" key={`${citation.claimId}-${citation.relation}`}>
                    {relationLabels[citation.relation]} · {truncate(claimLabels.get(citation.claimId) ?? citation.claimId, 40)} · r{citation.revision}
                  </span>
                ))}
              </div>
              {suggestion.validationIssues.length > 0 && (
                <div className="reasoning-issues mt-4">
                  <p className="font-semibold">引用校验未通过</p>
                  {suggestion.validationIssues.map((issue) => <p className="mt-1" key={issue}>• {issue}</p>)}
                </div>
              )}
              {suggestion.status === "pending" && (
                <AiSuggestionActions
                  caseId={caseId}
                  disabled={suggestion.isStale}
                  suggestionId={suggestion.id}
                />
              )}
              {suggestion.acceptedClaimId && (
                <p className="mt-4 text-xs text-[var(--success)]">
                  已建立分支假设 · {suggestion.acceptedClaimId.slice(0, 8)}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </article>
  );
}

const modeLabels = {
  consistency_check: "一致性检查",
  hypothesis_expansion: "假设扩展",
  counterexample_search: "反例搜索",
  investigation_gaps: "调查缺口",
} as const;
const runStatusLabels = { completed: "已完成", failed: "失败", running: "运行中" } as const;
const suggestionKindLabels = {
  contradiction: "矛盾",
  counterexample: "反例",
  hypothesis: "假设",
  investigation_gap: "调查缺口",
} as const;
const suggestionStatusLabels = {
  accepted: "已转为假设",
  dismissed: "已忽略",
  invalid: "无效输出",
  pending: "待审",
} as const;
const relationLabels = { contradicts: "矛盾", depends_on: "依赖", qualifies: "限定", supports: "支持" } as const;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function readSnapshotClaims(contextJson: string): Array<[string, string]> {
  try {
    const context = JSON.parse(contextJson) as {
      acceptedInferences?: Array<{ content?: unknown; id?: unknown }>;
      exploration?: { claims?: Array<{ content?: unknown; id?: unknown }> };
      fixedEvidence?: Array<{ content?: unknown; id?: unknown }>;
    };
    return [
      ...(context.fixedEvidence ?? []),
      ...(context.acceptedInferences ?? []),
      ...(context.exploration?.claims ?? []),
    ].flatMap((claim) =>
      typeof claim.id === "string" && typeof claim.content === "string"
        ? [[claim.id, claim.content] as [string, string]]
        : [],
    );
  } catch {
    return [];
  }
}
