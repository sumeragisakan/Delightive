import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CaseSettingsForm,
  PersonCard,
  PersonCreateForm,
} from "../../components/forms";
import { getCaseWorkspace } from "../../data";

export default async function CaseWorkspacePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const { caseFile, people } = await getCaseWorkspace(caseId);

  if (!caseFile) {
    notFound();
  }

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
          <span className="workspace-tab workspace-tab-active">人物</span>
          <span className="workspace-tab">时间轴 · 下一步</span>
          <span className="workspace-tab">事实与来源</span>
          <span className="workspace-tab">推理</span>
        </nav>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_23rem]">
          <section className="min-w-0 px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
            <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">人物索引</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                  案件人物
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-[var(--muted)]">
                同名人物由内部编号区分；别名可以重复，以保留真实的指代歧义。
              </p>
            </div>

            {people.length > 0 ? (
              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                {people.map((person) => (
                  <PersonCard caseId={caseId} key={person.id} person={person} />
                ))}
              </div>
            ) : (
              <div className="empty-dossier mt-6">
                <span className="empty-dossier-number">01</span>
                <div>
                  <h3 className="text-xl font-semibold">先记录第一个人物</h3>
                  <p className="mt-2 max-w-lg leading-7 text-[var(--muted)]">
                    可以使用真实姓名，也可以先写下“X”或“嫌疑人 1 号”等暂定称呼。
                  </p>
                </div>
              </div>
            )}
          </section>

          <aside className="border-t border-[var(--line)] bg-[var(--paper-deep)] px-6 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-10">
            <div className="space-y-7 lg:sticky lg:top-8">
              <section>
                <p className="eyebrow">新增记录</p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                  加入人物
                </h2>
                <p className="mb-6 mt-2 text-sm leading-6 text-[var(--muted)]">
                  先记录最少信息，稍后可以继续补充别名和识别说明。
                </p>
                <PersonCreateForm caseId={caseId} />
              </section>

              <details className="rounded-2xl border border-[var(--line)] bg-white/55 p-5">
                <summary className="cursor-pointer list-none font-semibold marker:hidden">
                  案件设置
                </summary>
                <div className="mt-5 border-t border-[var(--line)] pt-5">
                  <CaseSettingsForm caseFile={caseFile} />
                </div>
              </details>
            </div>
          </aside>
        </div>
      </div>
    </main>
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
