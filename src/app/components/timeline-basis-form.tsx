"use client";

import { useActionState, useId, useState } from "react";
import { updateTimelineBasisAction } from "../actions";
import { initialActionState } from "../action-state";
import { ActionMessage } from "./forms";

export function TimelineBasisForm({ caseFile }: { caseFile: {
  id: string; title: string; description: string; timelineMode: "relative" | "calendar" | "ordinal";
  timelineOriginAt: Date | null; timelineOriginLabel: string | null;
} }) {
  const id = useId();
  const [mode, setMode] = useState(caseFile.timelineMode);
  const [state, action, pending] = useActionState(updateTimelineBasisAction.bind(null, caseFile.id), initialActionState);
  const input = "w-full rounded-xl border border-[var(--line)] bg-white/80 px-3 py-2 text-sm";
  return <details className="rounded-2xl border border-[var(--line)] bg-white/55 p-5">
    <summary className="cursor-pointer font-semibold">案件时间基准</summary>
    <form action={action} className="mt-4 space-y-4">
      <label className="block text-sm" htmlFor={`${id}-mode`}><span className="mb-2 block">日期方式</span>
        <select className={input} id={`${id}-mode`} name="timelineMode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="relative">案件第几天</option><option value="calendar">实际日历日期</option><option value="ordinal">章节 / 顺序（时间可后补）</option>
        </select>
      </label>
      <label className="block text-sm" htmlFor={`${id}-label`}><span className="mb-2 block">第 1 天名称</span>
        <input className={input} id={`${id}-label`} name="timelineOriginLabel" defaultValue={caseFile.timelineOriginLabel ?? ""} placeholder="例如：案发当天" maxLength={120} />
      </label>
      <label className="block text-sm" htmlFor={`${id}-date`}><span className="mb-2 block">第 1 天对应日期</span>
        <input className={input} id={`${id}-date`} name="timelineOriginDate" type="date" defaultValue={caseFile.timelineOriginAt?.toISOString().slice(0, 10) ?? ""} required={mode === "calendar"} />
      </label>
      <p className="text-xs leading-5 text-[var(--muted)]">日期与时刻使用作品中的共同钟表基准，不随电脑时区变化。修改日历基准不会改写已录入的实际日期；从案件第几天切换为实际日期时，第 1 天映射到所填日期。受影响的结论需要重新复核。</p>
      <ActionMessage state={state} />
      <button className="secondary-button w-full" disabled={pending}>{pending ? "正在保存…" : "保存时间基准"}</button>
    </form>
  </details>;
}
