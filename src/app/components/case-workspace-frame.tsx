import Link from "next/link";

import type { CaseSummary } from "@/db/repositories/case-repository";

export function CaseWorkspaceFrame({
  activeModule,
  aside,
  caseFile,
  children,
}: {
  activeModule: "people" | "timeline";
  aside: React.ReactNode;
  caseFile: CaseSummary;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[96rem] overflow-hidden rounded-[1.75rem] border border-black/10 bg-[var(--paper)] shadow-[0_30px_90px_rgba(20,25,30,0.16)]">
        <header className="case-header px-6 py-5 sm:px-8 lg:px-10">
          <Link className="flex items-center gap-3" href="/">
            <span className="brand-mark" aria-hidden="true">
              D
            </span>
            <div>
              <p className="text-lg font-semibold tracking-[-0.025em] text-white">
                Delightive
              </p>
              <p className="text-xs tracking-[0.16em] text-white/55">
                RETURN TO CASE ARCHIVE
              </p>
            </div>
          </Link>
          <span
            className={
              caseFile.status === "active"
                ? "status-pill status-pill-active"
                : "status-pill status-pill-archived"
            }
          >
            {caseFile.status === "active" ? "调查中" : "已归档"}
          </span>
        </header>

        <section className="border-b border-[var(--line)] px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
          <Link
            className="text-sm font-semibold text-[var(--accent)] hover:underline"
            href="/"
          >
            ← 全部案件
          </Link>
          <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow">案件工作台 · {caseFile.id.slice(0, 8)}</p>
              <h1 className="mt-2 max-w-4xl text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
                {caseFile.title}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted)]">
                {caseFile.description || "尚未填写案件说明。"}
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-white/55 px-2 py-4">
              <WorkspaceStat label="人物" value={caseFile.peopleCount} />
              <WorkspaceStat label="事件" value={caseFile.eventCount} />
              <WorkspaceStat label="论断" value={caseFile.claimCount} />
            </div>
          </div>
        </section>

        <nav
          aria-label="案件模块"
          className="flex gap-2 overflow-x-auto border-b border-[var(--line)] px-6 py-3 sm:px-8 lg:px-10"
        >
          <WorkspaceLink
            active={activeModule === "people"}
            href={`/cases/${caseFile.id}`}
          >
            人物
          </WorkspaceLink>
          <WorkspaceLink
            active={activeModule === "timeline"}
            href={`/cases/${caseFile.id}/timeline`}
          >
            时间轴
          </WorkspaceLink>
          <span className="workspace-tab" title="将在后续阶段开放">
            事实与来源 · 待开放
          </span>
          <span className="workspace-tab" title="将在后续阶段开放">
            推理 · 待开放
          </span>
        </nav>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="min-w-0 px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
            {children}
          </section>
          <aside className="border-t border-[var(--line)] bg-[var(--paper-deep)] px-6 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-10">
            {aside}
          </aside>
        </div>
      </div>
    </main>
  );
}

function WorkspaceLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`workspace-tab ${active ? "workspace-tab-active" : ""}`}
      href={href}
    >
      {children}
    </Link>
  );
}

function WorkspaceStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 px-4 text-center">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
