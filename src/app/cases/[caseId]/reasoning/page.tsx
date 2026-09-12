import Link from "next/link";
import { notFound } from "next/navigation";

import { CaseWorkspaceFrame } from "../../../components/case-workspace-frame";
import {
  ArgumentManager,
  BranchArchiveToggle,
  BranchCreateForm,
  BranchSettingsForm,
  ClaimReviewForm,
  ConflictReviewForm,
  HypothesisCreateForm,
  ReasoningClaimEditor,
  relationLabels,
} from "../../../components/reasoning-forms";
import { getReasoningWorkspace } from "../../../data";
import type {
  ReasoningClaim,
  ReasoningConflict,
} from "@/db/repositories/reasoning-workspace-repository";

export default async function ReasoningPage({
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
  const { caseFile, workspace } = await getReasoningWorkspace(
    caseId,
    requestedBranchId,
  );

  if (!caseFile || !workspace) {
    notFound();
  }

  const activeBranches = workspace.branches.filter(
    (branch) => branch.status === "active",
  );
  const archivedBranches = workspace.branches.filter(
    (branch) => branch.status === "archived",
  );
  const openConflicts = workspace.conflicts.filter((conflict) => conflict.isOpen);
  const reviewedConflicts = workspace.conflicts.filter(
    (conflict) => !conflict.isOpen,
  );

  return (
    <CaseWorkspaceFrame
      activeModule="reasoning"
      aside={
        <div className="space-y-7 lg:sticky lg:top-8">
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">推理路线</p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                  分支导航
                </h2>
              </div>
              <span className="record-badge">{activeBranches.length}</span>
            </div>
            {activeBranches.length > 0 ? (
              <nav aria-label="推理分支" className="branch-list mt-5">
                {activeBranches.map((branch) => (
                  <Link
                    aria-current={
                      workspace.selectedBranch?.id === branch.id
                        ? "page"
                        : undefined
                    }
                    className={`branch-link ${workspace.selectedBranch?.id === branch.id ? "branch-link-active" : ""}`}
                    href={`/cases/${caseId}/reasoning?branch=${branch.id}`}
                    key={branch.id}
                  >
                    <span className="branch-depth" aria-hidden="true">
                      {branch.depth > 0 ? `${"· ".repeat(branch.depth)}↳` : "●"}
                    </span>
                    <span>{branch.name}</span>
                  </Link>
                ))}
              </nav>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-4 text-sm leading-6 text-[var(--muted)]">
                还没有活动分支。先给第一条调查路线命名。
              </p>
            )}
          </section>

          {workspace.selectedBranch && (
            <details className="border-t border-[var(--line)] pt-5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
                编辑当前分支
              </summary>
              <div className="mt-4">
                <BranchSettingsForm
                  branch={workspace.selectedBranch}
                  branches={workspace.branches}
                  caseId={caseId}
                />
              </div>
            </details>
          )}

          <details className="border-t border-[var(--line)] pt-5" open={!workspace.selectedBranch}>
            <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
              新建推理分支
            </summary>
            <div className="mt-4">
              <BranchCreateForm
                branches={workspace.branches}
                caseId={caseId}
                suggestedParentId={workspace.selectedBranch?.id}
              />
            </div>
          </details>

          {archivedBranches.length > 0 && (
            <details className="border-t border-[var(--line)] pt-5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
                已归档分支 · {archivedBranches.length}
              </summary>
              <div className="mt-3 space-y-3">
                {archivedBranches.map((branch) => (
                  <div className="source-summary" key={branch.id}>
                    <p className="font-semibold">{branch.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {branch.path.join(" / ")}
                    </p>
                    <BranchArchiveToggle
                      archived
                      branchId={branch.id}
                      caseId={caseId}
                    />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      }
      caseFile={caseFile}
    >
      <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">分支推理与可信层</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
            {workspace.selectedBranch?.name ?? "建立第一条推理路线"}
          </h2>
          {workspace.selectedBranch && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              {workspace.selectedBranch.path.join(" / ")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {workspace.selectedBranch && (
            <Link
              className="secondary-button"
              href={`/cases/${caseId}/reasoning/ai?branch=${workspace.selectedBranch.id}`}
            >
              AI 辅助推演
            </Link>
          )}
          <span className="reasoning-layer-badge reasoning-layer-trusted">
            1.5 可信推论 · {workspace.acceptedInferences.length}
          </span>
          <span className="reasoning-layer-badge">
            2 分支草稿 · {workspace.exploration.length}
          </span>
          <span className={openConflicts.length > 0 ? "reasoning-layer-badge reasoning-layer-alert" : "reasoning-layer-badge"}>
            待处理矛盾 · {openConflicts.length}
          </span>
        </div>
      </div>

      {workspace.selectedBranch ? (
        <>
          <details
            className="reasoning-composer mt-6"
            open={workspace.exploration.length === 0}
          >
            <summary className="cursor-pointer list-none marker:hidden">
              <span className="font-semibold">写下一个可验证的假设</span>
              <span className="ml-2 text-sm text-[var(--muted)]">
                先保持为分支草稿
              </span>
            </summary>
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <HypothesisCreateForm
                branchId={workspace.selectedBranch.id}
                caseId={caseId}
              />
            </div>
          </details>

          <ReasoningGroup
            caseId={caseId}
            claims={workspace.acceptedInferences}
            description="由用户审查通过，可供所有分支复用；原始分支和审查记录仍会保留。"
            label="1.5 · 可信推论"
            premiseOptions={workspace.premiseOptions}
          />
          <ReasoningGroup
            caseId={caseId}
            claims={workspace.exploration}
            description="当前分支及其上级分支的草稿；兄弟分支内容不会在这里出现。"
            label="2 · 当前路线"
            premiseOptions={workspace.premiseOptions}
          />

          <ConflictQueue
            caseId={caseId}
            openConflicts={openConflicts}
            reviewedConflicts={reviewedConflicts}
          />
        </>
      ) : (
        <div className="empty-dossier mt-6">
          <span className="empty-dossier-number">02</span>
          <div>
            <h3 className="text-xl font-semibold">推理从分支开始</h3>
            <p className="mt-2 max-w-lg leading-7 text-[var(--muted)]">
              在右侧建立第一条路线。之后，每条假设都只在自己的分支和子分支中可见，直到你把它晋升为可信推论。
            </p>
          </div>
        </div>
      )}
    </CaseWorkspaceFrame>
  );
}

function ReasoningGroup({
  caseId,
  claims,
  description,
  label,
  premiseOptions,
}: {
  caseId: string;
  claims: ReasoningClaim[];
  description: string;
  label: string;
  premiseOptions: Array<{
    branchName: string | null;
    content: string;
    id: string;
    kind: "fact" | "statement" | "hypothesis" | "inference";
    revision: number;
    status: "draft" | "accepted" | "rejected" | "needs_review" | "superseded";
  }>;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-col gap-2 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.17em] text-[var(--accent)]">
            {label}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
        </div>
        <span className="record-badge">{claims.length} 条</span>
      </div>
      {claims.length > 0 ? (
        <div className="grid gap-4">
          {claims.map((claim) => (
            <ReasoningCard
              caseId={caseId}
              claim={claim}
              key={claim.id}
              premiseOptions={premiseOptions}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm leading-6 text-[var(--muted)]">
          这一层目前没有内容。
        </p>
      )}
    </section>
  );
}

function ReasoningCard({
  caseId,
  claim,
  premiseOptions,
}: {
  caseId: string;
  claim: ReasoningClaim;
  premiseOptions: Array<{
    branchName: string | null;
    content: string;
    id: string;
    kind: "fact" | "statement" | "hypothesis" | "inference";
    revision: number;
    status: "draft" | "accepted" | "rejected" | "needs_review" | "superseded";
  }>;
}) {
  const latestReview = claim.reviews[0];

  return (
    <article className={`reasoning-card reasoning-card-${claim.status}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`evidence-status evidence-status-${claim.status}`}>
              {statusLabels[claim.status]}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {claim.kind === "inference" ? "推论" : "假设"} · 修订 {claim.revision}
            </span>
            {claim.branch && (
              <span className="branch-origin">源自 · {claim.branch.name}</span>
            )}
          </div>
          <p className="mt-3 text-base leading-7">{claim.content}</p>
        </div>
        {claim.confidence !== null && (
          <span className="record-badge">可信度 {claim.confidence}%</span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
        {claim.premises.length > 0 ? (
          claim.premises.map(({ claim: premise, isStale, link }) => (
            <span
              className={isStale ? "evidence-link evidence-link-stale" : "evidence-link"}
              key={link.id}
            >
              {relationLabels[link.relation]} · {truncate(premise.content, 42)}
            </span>
          ))
        ) : (
          <span className="text-sm text-[var(--muted)]">尚未添加前提</span>
        )}
      </div>

      {claim.issues.length > 0 && (
        <div className="reasoning-issues mt-4">
          <p className="font-semibold">审查前还需处理</p>
          <ul className="mt-2 space-y-1.5">
            {claim.issues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>• {issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
        <span>{claim.premises.length} 条关系</span>
        <span>{claim.reviews.length} 次审查</span>
        {latestReview && (
          <span>
            最近：{reviewLabels[latestReview.decision]} · {formatDate(latestReview.reviewedAt)}
          </span>
        )}
        <span className="font-mono">CLAIM · {claim.id.slice(0, 8)}</span>
      </div>

      <details className="mt-5 border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--accent)] marker:hidden">
          编辑论证与审查
        </summary>
        <div className="mt-5 space-y-6">
          <ReasoningClaimEditor caseId={caseId} claim={claim} />
          <section className="border-t border-[var(--line)] pt-5">
            <h4 className="mb-4 font-semibold">前提与关系</h4>
            <ArgumentManager
              caseId={caseId}
              claim={claim}
              premiseOptions={premiseOptions}
            />
          </section>
          <section className="border-t border-[var(--line)] pt-5">
            <h4 className="mb-2 font-semibold">人工审查</h4>
            <p className="mb-4 text-sm leading-6 text-[var(--muted)]">
              系统只检查前提版本、分支范围、循环与未处理矛盾；是否采信始终由你决定。
            </p>
            <ClaimReviewForm caseId={caseId} claim={claim} />
          </section>
          {claim.reviews.length > 0 && (
            <details className="border-t border-[var(--line)] pt-5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
                审查历史 · {claim.reviews.length}
              </summary>
              <ol className="review-history mt-3">
                {claim.reviews.map((review) => (
                  <li key={review.id}>
                    <span>{reviewLabels[review.decision]}</span>
                    <span>修订 {review.claimRevision}</span>
                    <time>{formatDate(review.reviewedAt)}</time>
                    {review.note && <p>{review.note}</p>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </details>
    </article>
  );
}

function ConflictQueue({
  caseId,
  openConflicts,
  reviewedConflicts,
}: {
  caseId: string;
  openConflicts: ReasoningConflict[];
  reviewedConflicts: ReasoningConflict[];
}) {
  return (
    <section className="mt-10 border-t border-[var(--line)] pt-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">矛盾审查</p>
          <h3 className="mt-2 text-xl font-semibold">冲突不会自动裁决</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            每条显式矛盾都需要一次人工处置；两侧内容有新修订后，会重新回到待处理队列。
          </p>
        </div>
        <span className="record-badge">待处理 {openConflicts.length}</span>
      </div>

      {openConflicts.length > 0 ? (
        <div className="mt-5 grid gap-4">
          {openConflicts.map((conflict) => (
            <ConflictCard caseId={caseId} conflict={conflict} key={conflict.link.id} />
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          当前没有等待处置的矛盾。
        </p>
      )}

      {reviewedConflicts.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
            已处置矛盾 · {reviewedConflicts.length}
          </summary>
          <div className="mt-4 grid gap-3">
            {reviewedConflicts.map((conflict) => (
              <ConflictCard
                caseId={caseId}
                conflict={conflict}
                key={conflict.link.id}
                readonly
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ConflictCard({
  caseId,
  conflict,
  readonly = false,
}: {
  caseId: string;
  conflict: ReasoningConflict;
  readonly?: boolean;
}) {
  return (
    <article className="conflict-card">
      <div className="conflict-sides">
        <div>
          <span className="conflict-side-label">左侧 · 前提</span>
          <p>{conflict.premise.content}</p>
          <span className="text-xs text-[var(--muted)]">修订 {conflict.premise.revision}</span>
        </div>
        <span className="conflict-mark" aria-label="与之矛盾">≠</span>
        <div>
          <span className="conflict-side-label">右侧 · 结论</span>
          <p>{conflict.conclusion.content}</p>
          <span className="text-xs text-[var(--muted)]">修订 {conflict.conclusion.revision}</span>
        </div>
      </div>
      {conflict.link.rationale && (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          关系说明：{conflict.link.rationale}
        </p>
      )}
      {conflict.latestReview && !conflict.isOpen && (
        <p className="mt-3 text-sm text-[var(--success)]">
          已处置：{conflictDecisionLabels[conflict.latestReview.decision]}
          {conflict.latestReview.note ? ` · ${conflict.latestReview.note}` : ""}
        </p>
      )}
      {!readonly && <ConflictReviewForm caseId={caseId} conflict={conflict} />}
    </article>
  );
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

const statusLabels = {
  accepted: "可信",
  draft: "草稿",
  needs_review: "待复核",
  rejected: "已否定",
  superseded: "已取代",
} as const;

const reviewLabels = {
  demoted: "转入复核",
  promoted: "晋升可信",
  reconfirmed: "重新确认",
  rejected: "否定",
} as const;

const conflictDecisionLabels = {
  both_review: "双方复核",
  dismissed: "不构成矛盾",
  prefer_conclusion: "暂取右侧",
  prefer_premise: "暂取左侧",
  retained: "保留矛盾",
} as const;
