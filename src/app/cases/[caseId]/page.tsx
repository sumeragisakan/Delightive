import { notFound } from "next/navigation";

import { CaseWorkspaceFrame } from "../../components/case-workspace-frame";
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
    <CaseWorkspaceFrame
      activeModule="people"
      aside={
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
      }
      caseFile={caseFile}
    >
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
    </CaseWorkspaceFrame>
  );
}
