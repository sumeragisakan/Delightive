import Link from "next/link";
import { notFound } from "next/navigation";

import { CaseWorkspaceFrame } from "../../../components/case-workspace-frame";
import {
  InvestigationCompletionForm,
  InvestigationCreateForm,
  InvestigationEditor,
  type InvestigationFormOptions,
  InvestigationStatusForm,
} from "../../../components/investigation-forms";
import { getInvestigationWorkspace } from "../../../data";
import type { InvestigationItemView } from "@/db/repositories/investigation-repository";

type ViewFilter = "all" | "open" | "closed";
type PriorityFilter = "all" | "low" | "normal" | "high" | "urgent";

export default async function InvestigationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{
    branch?: string | string[];
    priority?: string | string[];
    view?: string | string[];
  }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const requestedBranchId = typeof query.branch === "string" ? query.branch : undefined;
  const view = readView(query.view);
  const priority = readPriority(query.priority);
  const { caseFile, events, items, locations, people, sources, workspace } =
    await getInvestigationWorkspace(caseId, requestedBranchId);
  if (!caseFile || !workspace) notFound();

  const branch = workspace.selectedBranch;
  const activeBranches = workspace.branches.filter(({ status }) => status === "active");
  const options: InvestigationFormOptions = {
    claims: workspace.premiseOptions.map(({ content, id, kind, revision }) => ({ content, id, kind, revision })),
    events: events.map(({ id, revision, title }) => ({ id, revision, title })),
    locations: locations.map(({ id, name }) => ({ id, name })),
    people: people.map(({ displayName, id }) => ({ displayName, id })),
    sources: sources.map(({ id, kind, revision, title }) => ({ id, kind, revision, title })),
  };
  const filtered = items.filter((item) => {
    const matchesView =
      view === "all" ||
      (view === "open" && (item.status === "pending" || item.status === "in_progress")) ||
      (view === "closed" && (item.status === "resolved" || item.status === "unresolved"));
    return matchesView && (priority === "all" || item.priority === priority);
  });
  const groups = investigationStatuses.map((status) => ({
    ...status,
    items: filtered.filter((item) => item.status === status.value),
  }));

  return (
    <CaseWorkspaceFrame
      activeModule="investigations"
      aside={
        <div className="space-y-7 lg:sticky lg:top-8">
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">调查路线</p>
                <h2 className="mt-2 text-xl font-semibold">分支范围</h2>
              </div>
              <span className="record-badge">{activeBranches.length}</span>
            </div>
            {activeBranches.length > 0 ? (
              <nav aria-label="调查分支" className="branch-list mt-5">
                {activeBranches.map((candidate) => (
                  <Link
                    aria-current={candidate.id === branch?.id ? "page" : undefined}
                    className={`branch-link ${candidate.id === branch?.id ? "branch-link-active" : ""}`}
                    href={investigationUrl(caseId, candidate.id, view, priority)}
                    key={candidate.id}
                  >
                    <span className="branch-depth" aria-hidden="true">●</span>
                    <span>{candidate.path.join(" / ")}</span>
                  </Link>
                ))}
              </nav>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                先在推理页面建立活动分支，才能安排调查事项。
              </p>
            )}
          </section>
          {branch && (
            <section className="border-t border-[var(--line)] pt-6">
              <p className="eyebrow">新任务</p>
              <h3 className="mt-2 text-lg font-semibold">建立调查事项</h3>
              <p className="mb-5 mt-2 text-sm leading-6 text-[var(--muted)]">
                把推理中的疑点变成可以核对、可以结束的具体问题。
              </p>
              <InvestigationCreateForm branchId={branch.id} caseId={caseId} options={options} />
            </section>
          )}
        </div>
      }
      caseFile={caseFile}
    >
      <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">调查计划与验证</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
            {branch?.name ?? "尚无活动分支"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            从疑点出发，记录查证过程；结果只能生成待审核草稿，是否进入固定事实层仍由你决定。
          </p>
        </div>
        {branch && (
          <Link className="secondary-button" href={`/cases/${caseId}/reasoning/ai?branch=${branch.id}`}>
            基于最新资料进行 AI 推演
          </Link>
        )}
      </div>

      {branch ? (
        <>
          <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-[var(--line)] bg-white/45 p-4 sm:flex-row sm:items-center sm:justify-between">
            <nav aria-label="调查状态筛选" className="flex flex-wrap gap-2">
              {viewFilters.map((filter) => (
                <Link
                  aria-current={filter.value === view ? "page" : undefined}
                  className={filter.value === view ? "primary-button" : "secondary-button"}
                  href={investigationUrl(caseId, branch.id, filter.value, priority)}
                  key={filter.value}
                >
                  {filter.label}
                </Link>
              ))}
            </nav>
            <nav aria-label="调查优先级筛选" className="flex flex-wrap gap-2">
              {priorityFilters.map((filter) => (
                <Link
                  aria-current={filter.value === priority ? "page" : undefined}
                  className={filter.value === priority ? "primary-button" : "secondary-button"}
                  href={investigationUrl(caseId, branch.id, view, filter.value)}
                  key={filter.value}
                >
                  {filter.label}
                </Link>
              ))}
            </nav>
          </section>

          {filtered.length > 0 ? (
            groups.map((group) =>
              group.items.length > 0 ? (
                <section className="mt-10" key={group.value}>
                  <div className="mb-4 flex items-end justify-between border-b border-[var(--line)] pb-4">
                    <div>
                      <p className="eyebrow">{group.kicker}</p>
                      <h3 className="mt-2 text-xl font-semibold">{group.label}</h3>
                    </div>
                    <span className="record-badge">{group.items.length} 项</span>
                  </div>
                  <div className="grid gap-5">
                    {group.items.map((item) => (
                      <InvestigationCard
                        branchId={branch.id}
                        caseId={caseId}
                        item={item}
                        key={item.id}
                        options={options}
                      />
                    ))}
                  </div>
                </section>
              ) : null,
            )
          ) : (
            <div className="empty-dossier mt-8">
              <span className="empty-dossier-number">?</span>
              <div>
                <h3 className="text-xl font-semibold">当前筛选下没有调查事项</h3>
                <p className="mt-2 text-[var(--muted)]">
                  可以在右侧手动建立，也可以从 AI 的“调查缺口”建议转入。
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-dossier mt-8">
          <span className="empty-dossier-number">01</span>
          <div>
            <h3 className="text-xl font-semibold">调查事项依附于推理分支</h3>
            <p className="mt-2 text-[var(--muted)]">先建立一条推理路线，再把其中的疑点安排为调查任务。</p>
          </div>
        </div>
      )}
    </CaseWorkspaceFrame>
  );
}

function InvestigationCard({
  branchId,
  caseId,
  item,
  options,
}: {
  branchId: string;
  caseId: string;
  item: InvestigationItemView;
  options: InvestigationFormOptions;
}) {
  const open = item.status === "pending" || item.status === "in_progress";
  return (
    <article className={`reasoning-card scroll-mt-8 ${item.isStale ? "reasoning-card-needs_review" : ""}`} id={`investigation-${item.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`evidence-status evidence-status-${statusTone[item.status]}`}>{statusLabels[item.status]}</span>
            <span className={`investigation-priority investigation-priority-${item.priority}`}>{priorityLabels[item.priority]}</span>
            <span className="text-xs text-[var(--muted)]">{item.createdBy === "ai" ? "AI 建议" : "手动建立"}</span>
            {item.isStale && <span className="branch-origin">上下文已变化</span>}
          </div>
          <h4 className="mt-3 text-lg font-semibold">{item.title}</h4>
          <p className="mt-2 leading-7">{item.question}</p>
          {item.notes && <p className="mt-3 text-sm leading-6 text-[var(--muted)]">计划：{item.notes}</p>}
        </div>
        <span className="font-mono text-xs text-[var(--muted)]">TASK · {item.id.slice(0, 8)}</span>
      </div>

      <InvestigationLinks branchId={branchId} caseId={caseId} item={item} />

      {item.isStale && (
        <div className="reasoning-issues mt-4">
          <p className="font-semibold">调查建立后的上下文发生了变化</p>
          {item.staleReasons.map((reason) => <p className="mt-1" key={reason}>• {reason}</p>)}
          <p className="mt-2">仍可记录结果，但结束前请确认原问题是否依然成立。</p>
        </div>
      )}

      {item.resultSummary && (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-white/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--success)]">调查结果</p>
          <p className="mt-2 leading-7">{item.resultSummary}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
        <span>建立：{formatDate(item.createdAt)}</span>
        {item.startedAt && <span>开始：{formatDate(item.startedAt)}</span>}
        {item.resolvedAt && <span>结束：{formatDate(item.resolvedAt)}</span>}
        <span>{item.updates.length} 条状态记录</span>
      </div>

      <InvestigationStatusForm caseId={caseId} item={item} />

      {open && (
        <details className="mt-5 border-t border-[var(--line)] pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">编辑问题与关联</summary>
          <div className="mt-5"><InvestigationEditor caseId={caseId} item={item} options={options} /></div>
        </details>
      )}
      {open && (
        <details className="mt-5 border-t border-[var(--line)] pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">结束调查并回填结果</summary>
          <div className="mt-5">
            <InvestigationCompletionForm caseId={caseId} itemId={item.id} people={options.people} sources={options.sources} />
          </div>
        </details>
      )}
      <details className="mt-5 border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">状态与结果历史 · {item.updates.length}</summary>
        <ol className="review-history mt-3">
          {item.updates.map((update) => (
            <li key={update.id}>
              <span>{update.fromStatus ? statusLabels[update.fromStatus] : "建立"} → {statusLabels[update.toStatus]}</span>
              <time>{formatDate(update.changedAt)}</time>
              {update.note && <p>{update.note}</p>}
              {(update.sourceId || update.claimId) && <p>生成：{update.sourceId ? "来源 " : ""}{update.claimId ? "待审核命题" : ""}</p>}
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

function InvestigationLinks({
  branchId,
  caseId,
  item,
}: {
  branchId: string;
  caseId: string;
  item: InvestigationItemView;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
      {item.originSuggestion && (
        <Link className="evidence-link" href={`/cases/${caseId}/reasoning/ai?branch=${branchId}#run-${item.originSuggestion.runId}`}>
          AI 来源 · {truncate(item.originSuggestion.title, 38)}
        </Link>
      )}
      {item.claims.map(({ claim, claimRevision, isStale, role }) => (
        <Link
          className={isStale ? "evidence-link evidence-link-stale" : "evidence-link"}
          href={claim.kind === "fact" || claim.kind === "statement" ? `/cases/${caseId}/evidence#claim-${claim.id}` : `/cases/${caseId}/reasoning?branch=${branchId}#claim-${claim.id}`}
          key={claim.id}
        >
          {roleLabels[role]} · {truncate(claim.content, 42)} · r{claimRevision}
        </Link>
      ))}
      {item.people.map(({ person }) => <Link className="evidence-link" href={`/cases/${caseId}`} key={person.id}>人物 · {person.displayName}</Link>)}
      {item.events.map(({ event, eventRevision, isStale }) => <Link className={isStale ? "evidence-link evidence-link-stale" : "evidence-link"} href={`/cases/${caseId}/timeline#event-${event.id}`} key={event.id}>事件 · {event.title} · r{eventRevision}</Link>)}
      {item.locations.map(({ location }) => <Link className="evidence-link" href={`/cases/${caseId}/timeline`} key={location.id}>地点 · {location.name}</Link>)}
      {item.sources.map(({ isStale, role, source, sourceRevision }) => <Link className={isStale ? "evidence-link evidence-link-stale" : "evidence-link"} href={`/cases/${caseId}/evidence#source-${source.id}`} key={source.id}>{role === "result" ? "结果来源" : "来源"} · {source.title} · r{sourceRevision}</Link>)}
    </div>
  );
}

function investigationUrl(
  caseId: string,
  branchId: string,
  view: ViewFilter,
  priority: PriorityFilter,
) {
  return `/cases/${caseId}/investigations?branch=${branchId}&view=${view}&priority=${priority}`;
}

function readView(value: string | string[] | undefined): ViewFilter {
  return typeof value === "string" && ["all", "open", "closed"].includes(value)
    ? value as ViewFilter
    : "open";
}

function readPriority(value: string | string[] | undefined): PriorityFilter {
  return typeof value === "string" && ["all", "low", "normal", "high", "urgent"].includes(value)
    ? value as PriorityFilter
    : "all";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

const investigationStatuses = [
  { kicker: "QUEUE", label: "待处理", value: "pending" },
  { kicker: "ACTIVE", label: "调查中", value: "in_progress" },
  { kicker: "RESOLVED", label: "已解决", value: "resolved" },
  { kicker: "OPEN QUESTION", label: "暂时无解", value: "unresolved" },
] as const;
const viewFilters = [
  { label: "进行中", value: "open" },
  { label: "已结束", value: "closed" },
  { label: "全部", value: "all" },
] as const;
const priorityFilters = [
  { label: "全部优先级", value: "all" },
  { label: "紧急", value: "urgent" },
  { label: "高", value: "high" },
  { label: "普通", value: "normal" },
  { label: "低", value: "low" },
] as const;
const statusLabels = {
  in_progress: "调查中",
  pending: "待处理",
  resolved: "已解决",
  unresolved: "暂时无解",
} as const;
const statusTone = {
  in_progress: "needs_review",
  pending: "draft",
  resolved: "accepted",
  unresolved: "rejected",
} as const;
const priorityLabels = {
  high: "高优先级",
  low: "低优先级",
  normal: "普通",
  urgent: "紧急",
} as const;
const roleLabels = {
  context: "上下文",
  result: "结果命题",
  target: "目标",
} as const;
