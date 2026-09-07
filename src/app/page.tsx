import Link from "next/link";

import { setCaseStatusAction } from "./actions";
import { CaseCreateForm } from "./components/forms";
import { CaseWebMcpTools } from "./components/webmcp-tools";
import { getCaseDashboard } from "./data";
import type { CaseSummary } from "@/db/repositories/case-repository";

export default async function Home() {
  const cases = await getCaseDashboard();
  const activeCases = cases.filter((caseFile) => caseFile.status === "active");
  const archivedCases = cases.filter(
    (caseFile) => caseFile.status === "archived",
  );
  const totalRecords = cases.reduce(
    (total, caseFile) =>
      total +
      caseFile.peopleCount +
      caseFile.eventCount +
      caseFile.claimCount,
    0,
  );

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <CaseWebMcpTools />
      <div className="mx-auto max-w-[92rem] overflow-hidden rounded-[1.75rem] border border-black/10 bg-[var(--paper)] shadow-[0_30px_90px_rgba(20,25,30,0.16)]">
        <header className="case-header px-6 py-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="brand-mark" aria-hidden="true">
              D
            </span>
            <div>
              <p className="text-lg font-semibold tracking-[-0.025em] text-white">
                Delightive
              </p>
              <p className="text-xs tracking-[0.16em] text-white/55">
                LOCAL CASE ARCHIVE
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-2 text-xs text-white/70">
            <span className="h-2 w-2 rounded-full bg-[#d9b45b] shadow-[0_0_0_4px_rgba(217,180,91,0.12)]" />
            数据仅保存在本机
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_25rem]">
          <section className="min-w-0 px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
            <div className="flex flex-col gap-7 border-b border-[var(--line)] pb-8 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">案件大厅</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                  选择一份案件档案
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
                  在人物、时间与来源之间建立清晰联系，再从固定事实展开推理。
                </p>
              </div>
              <div className="flex gap-6 text-right">
                <Stat label="进行中" value={activeCases.length} />
                <Stat label="已记录条目" value={totalRecords} />
              </div>
            </div>

            <div className="mt-8">
              {activeCases.length > 0 ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {activeCases.map((caseFile, index) => (
                    <CaseCard
                      caseFile={caseFile}
                      index={index + 1}
                      key={caseFile.id}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-dossier">
                  <span className="empty-dossier-number">00</span>
                  <div>
                    <h2 className="text-xl font-semibold">档案柜还是空的</h2>
                    <p className="mt-2 max-w-lg leading-7 text-[var(--muted)]">
                      从右侧建立第一份案件。名称只是档案标签，之后可以随时修改。
                    </p>
                  </div>
                </div>
              )}
            </div>

            {archivedCases.length > 0 && (
              <details className="mt-10 border-t border-[var(--line)] pt-6">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
                  已归档案件 · {archivedCases.length}
                </summary>
                <div className="mt-4 grid gap-3">
                  {archivedCases.map((caseFile) => {
                    const restoreAction = setCaseStatusAction.bind(
                      null,
                      caseFile.id,
                      "active",
                    );

                    return (
                      <div
                        className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-white/45 p-4 sm:flex-row sm:items-center sm:justify-between"
                        key={caseFile.id}
                      >
                        <div>
                          <Link
                            className="font-semibold hover:text-[var(--accent)]"
                            href={`/cases/${caseFile.id}`}
                          >
                            {caseFile.title}
                          </Link>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {formatUpdatedAt(caseFile.updatedAt)}
                          </p>
                        </div>
                        <form action={restoreAction}>
                          <button className="text-button" type="submit">
                            恢复案件
                          </button>
                        </form>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </section>

          <aside className="border-t border-[var(--line)] bg-[var(--paper-deep)] px-6 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-8 lg:py-10">
            <div className="lg:sticky lg:top-8">
              <p className="eyebrow">新档案</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                建立案件
              </h2>
              <p className="mb-7 mt-3 text-sm leading-6 text-[var(--muted)]">
                先决定案件如何记录时间。人物与证据可以在进入工作台后逐步补充。
              </p>
              <CaseCreateForm />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function CaseCard({
  caseFile,
  index,
}: {
  caseFile: CaseSummary;
  index: number;
}) {
  return (
    <Link className="case-card group" href={`/cases/${caseFile.id}`}>
      <div className="case-card-index">
        {String(index).padStart(2, "0")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
              {timelineModeLabels[caseFile.timelineMode]}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] group-hover:text-[var(--accent)]">
              {caseFile.title}
            </h2>
          </div>
          <span className="case-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
        <p className="mt-3 line-clamp-2 min-h-12 text-sm leading-6 text-[var(--muted)]">
          {caseFile.description || "尚未填写案件说明。"}
        </p>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
          <span>{caseFile.peopleCount} 人物</span>
          <span>{caseFile.eventCount} 事件</span>
          <span>{caseFile.claimCount} 事实与推论</span>
          <span className="sm:ml-auto">{formatUpdatedAt(caseFile.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold tracking-[-0.04em]">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

function formatUpdatedAt(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

const timelineModeLabels = {
  calendar: "日历时间",
  ordinal: "章节顺序",
  relative: "相对时间",
} as const;
