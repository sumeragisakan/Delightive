import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ReasoningGraphCanvas,
  ReasoningGraphInspector,
  ReasoningGraphLegend,
  ReasoningGraphProvider,
} from "../../../../components/reasoning-graph";
import { CaseWorkspaceFrame } from "../../../../components/case-workspace-frame";
import { getReasoningGraphWorkspace } from "../../../../data";

export default async function ReasoningGraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{
    branch?: string | string[];
    focus?: string | string[];
  }>;
}) {
  const { caseId } = await params;
  const query = await searchParams;
  const requestedBranchId =
    typeof query.branch === "string" ? query.branch : undefined;
  const focusId = typeof query.focus === "string" ? query.focus : undefined;
  const { caseFile, graph } = await getReasoningGraphWorkspace(
    caseId,
    requestedBranchId,
  );

  if (!caseFile || !graph) notFound();

  const activeBranches = graph.branches.filter((branch) => branch.status === "active");
  const selectedBranchId = graph.selectedBranch?.id;
  const reasoningHref = selectedBranchId
    ? `/cases/${caseId}/reasoning?branch=${encodeURIComponent(selectedBranchId)}`
    : `/cases/${caseId}/reasoning`;

  return (
    <ReasoningGraphProvider graph={graph} initialFocusId={focusId}>
      <CaseWorkspaceFrame
        activeModule="graph"
        aside={
          <div className="space-y-7 lg:sticky lg:top-8">
            <section>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">可见范围</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                    分支导航
                  </h2>
                </div>
                <span className="record-badge">{activeBranches.length}</span>
              </div>
              {activeBranches.length > 0 ? (
                <nav aria-label="推理图分支" className="branch-list mt-5">
                  {activeBranches.map((branch) => (
                    <Link
                      aria-current={selectedBranchId === branch.id ? "page" : undefined}
                      className={`branch-link ${selectedBranchId === branch.id ? "branch-link-active" : ""}`}
                      href={`/cases/${caseId}/reasoning/graph?branch=${encodeURIComponent(branch.id)}`}
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
                  尚无推理分支。固定事实仍会显示；建立分支后可查看推理路线。
                </p>
              )}
            </section>

            <section className="border-t border-[var(--line)] pt-5">
              <ReasoningGraphInspector />
            </section>
            <ReasoningGraphLegend />
          </div>
        }
        caseFile={caseFile}
      >
        <div className="flex flex-col gap-5 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">推理流程可视化</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
              {graph.selectedBranch?.name ?? "固定事实全景"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              从固定事实，经可信推论和分支探索，追踪到 AI 建议与调查行动。箭头方向表示信息如何流向结论或行动。
            </p>
            {graph.selectedBranch && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                当前范围：{graph.selectedBranch.path.join(" / ")}；兄弟分支保持隔离。
              </p>
            )}
          </div>
          <Link className="secondary-button shrink-0" href={reasoningHref}>
            返回编辑推理
          </Link>
        </div>

        <div className="my-5 flex flex-wrap gap-2">
          <SummaryBadge label="固定事实" value={graph.summary.fixed} />
          <SummaryBadge label="可信推论" value={graph.summary.trusted} />
          <SummaryBadge label="探索节点" value={graph.summary.exploration} />
          <SummaryBadge label="调查行动" value={graph.summary.action} />
          <SummaryBadge alert={graph.summary.stale > 0} label="陈旧" value={graph.summary.stale} />
          <SummaryBadge
            alert={graph.summary.openConflicts > 0}
            label="待处置矛盾"
            value={graph.summary.openConflicts}
          />
        </div>

        <ReasoningGraphCanvas />
      </CaseWorkspaceFrame>
    </ReasoningGraphProvider>
  );
}

function SummaryBadge({
  alert = false,
  label,
  value,
}: {
  alert?: boolean;
  label: string;
  value: number;
}) {
  return (
    <span
      className={
        alert
          ? "reasoning-layer-badge reasoning-layer-alert"
          : "reasoning-layer-badge"
      }
    >
      {label} · {value}
    </span>
  );
}
