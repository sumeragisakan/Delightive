"use client";

import { useState } from "react";
import { absoluteTimeInput, formatResolvedTime, resolveEventTime, timeInputParts, type TimeEvent } from "@/timeline/time";

export type CaseTimeCoordinates = { calendar: boolean; originDate: string; originLabel: string; basisToken: string };
const inputClass = "min-w-0 w-full rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-3 text-sm";

export function EventTimeFields({ event, events, timeKind, coordinates, id, fieldErrors }: {
  event?: Pick<TimeEvent, "id" | "startOffsetSeconds" | "endOffsetSeconds" | "relativeOffsetSeconds" | "anchorEventId" | "timePrecision">;
  events: TimeEvent[];
  timeKind: TimeEvent["timeKind"];
  coordinates: CaseTimeCoordinates;
  id: string;
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  const initialStart = timeInputParts(event?.startOffsetSeconds ?? null, coordinates.calendar, coordinates.originDate);
  const initialEnd = timeInputParts(event?.endOffsetSeconds ?? null, coordinates.calendar, coordinates.originDate);
  const [startDay, setStartDay] = useState(initialStart.day);
  const [startClock, setStartClock] = useState(initialStart.clock);
  const [endDay, setEndDay] = useState(initialEnd.day);
  const [endClock, setEndClock] = useState(initialEnd.clock);
  const [precision, setPrecision] = useState<"minute" | "second">(event?.timePrecision ?? "minute");
  const [anchorId, setAnchorId] = useState(event?.anchorEventId ?? "");
  const [direction, setDirection] = useState((event?.relativeOffsetSeconds ?? 0) < 0 ? "before" : "after");
  const initialOffset = Math.abs(event?.relativeOffsetSeconds ?? 0);
  const initialUnit = event?.timePrecision === "second" || initialOffset % 60 !== 0 ? "second" : "minute";
  const [unit, setUnit] = useState(initialUnit);
  const [amount, setAmount] = useState(event ? String(initialUnit === "minute" ? initialOffset / 60 : initialOffset) : "");
  const eventById = new Map(events.map((item) => [item.id, item]));
  // Exclude descendants as anchors as well as the event itself.
  const anchorOptions = events.filter((item) => item.archivedAt === null && item.id !== event?.id &&
    (!event || !resolveEventTime(item, eventById).basis.some((basis) => basis.id === event.id)));
  const start = absoluteTimeInput(startDay, startClock, coordinates.calendar, coordinates.originDate);
  const end = absoluteTimeInput(endDay, endClock, coordinates.calendar, coordinates.originDate);
  const relative = /^\d+$/.test(amount) ? Number(amount) * (unit === "hour" ? 3600 : unit === "minute" ? 60 : 1) * (direction === "before" ? -1 : 1) : null;
  const draft: TimeEvent = {
    id: event?.id ?? "preview", title: "当前事件", archivedAt: null, revision: 1, timeBasisRevision: 1,
    timeKind, timePrecision: timeKind === "relative" ? unit === "second" ? "second" : "minute" : precision,
    anchorEventId: anchorId || null, relativeOffsetSeconds: Number.isSafeInteger(relative) ? relative : null,
    startOffsetSeconds: start, endOffsetSeconds: timeKind === "range" ? end : null,
  };
  const resolved = resolveEventTime(draft, eventById);
  const errors = [...new Set(["startOffsetSeconds", "endOffsetSeconds", "relativeOffsetSeconds", "anchorEventId", "timePrecision"].flatMap((key) => fieldErrors?.[key] ?? []))];
  const label = (name: string, title: string, children: React.ReactNode) => (
    <label className="block text-sm font-semibold" htmlFor={`${id}-${name}`}>
      <span className="mb-2 block">{title}</span>{children}
    </label>
  );
  const dayInput = (prefix: "start" | "end", value: string, change: (value: string) => void) => label(`${prefix}Day`, coordinates.calendar ? "日期" : "案件第几天", (
    <input className={inputClass} id={`${id}-${prefix}Day`} name={`${prefix}Day`} type={coordinates.calendar ? "date" : "number"}
      step={coordinates.calendar ? undefined : 1} value={value} onChange={(e) => change(e.target.value)} required />
  ));
  const clockInput = (prefix: "start" | "end", value: string, change: (value: string) => void) => label(`${prefix}Clock`, "时间", (
    <input className={inputClass} id={`${id}-${prefix}Clock`} name={`${prefix}Clock`} type="time" step={precision === "second" ? 1 : 60}
      value={precision === "minute" ? value.slice(0, 5) : value} onChange={(e) => change(e.target.value)} required />
  ));

  if (timeKind === "unknown") return <><input type="hidden" name="timelineBasis" value={coordinates.basisToken} /><p className="text-xs leading-5 text-[var(--muted)]">可以只保留原文写法；确定时间后再补充，不会默认放到当天零点。</p></>;
  return (
    <div className="space-y-4 rounded-xl border border-[var(--line)] bg-white/40 p-4">
      <input type="hidden" name="timelineBasis" value={coordinates.basisToken} />
      {errors.length > 0 && <ul role="alert" className="text-sm text-[var(--danger)]">{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
      {timeKind === "relative" ? <>
        {label("anchor", "参照事件", <select className={inputClass} id={`${id}-anchor`} name="anchorEventId" value={anchorId} onChange={(e) => setAnchorId(e.target.value)} required>
          <option value="">选择参照事件</option>
          {anchorOptions.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.id.slice(0, 6)}</option>)}
        </select>)}
        <div className="grid grid-cols-3 gap-2">
          {label("direction", "前后", <select className={inputClass} id={`${id}-direction`} name="relativeDirection" value={direction} onChange={(e) => setDirection(e.target.value)}><option value="after">之后</option><option value="before">之前</option></select>)}
          {label("amount", "间隔", <input className={inputClass} id={`${id}-amount`} name="relativeAmount" type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />)}
          {label("unit", "单位", <select className={inputClass} id={`${id}-unit`} name="relativeUnit" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="minute">分钟</option><option value="hour">小时</option><option value="second">秒</option></select>)}
        </div>
      </> : <>
        {label("precision", "时间精度", <select className={inputClass} id={`${id}-precision`} name="timePrecision" value={precision} onChange={(e) => { setPrecision(e.target.value as "minute" | "second"); if (e.target.value === "minute") { setStartClock(startClock.slice(0, 5)); setEndClock(endClock.slice(0, 5)); } }}><option value="minute">精确到分钟</option><option value="second">精确到秒</option></select>)}
        <div className="grid grid-cols-2 gap-3">{dayInput("start", startDay, setStartDay)}{clockInput("start", startClock, setStartClock)}</div>
        {timeKind === "range" && <><p className="text-sm font-semibold">范围终点</p><div className="grid grid-cols-2 gap-3">{dayInput("end", endDay, setEndDay)}{clockInput("end", endClock, setEndClock)}</div></>}
        {!coordinates.calendar && <p className="text-xs text-[var(--muted)]">第 1 天{coordinates.originLabel ? `为“${coordinates.originLabel}”` : "是案件共同日期基准"}；跨午夜请选择下一天。真实日期可在案件时间基准中设置。</p>}
      </>}
      <p aria-live="polite" className="text-sm leading-6 text-[var(--accent)]">
        {timeKind === "range" && start !== null && end !== null && end < start ? "范围终点不能早于起点。" :
          `时间预览${timeKind === "relative" && resolved.status === "located" ? "（根据参照推算）" : ""}：${formatResolvedTime(resolved, coordinates.calendar ? coordinates.originDate : "", coordinates.originLabel)}`}
      </p>
      {resolved.approximate && <p className="text-xs text-[var(--muted)]">大约时间没有明确误差范围，不能当作精确时间判断矛盾。</p>}
    </div>
  );
}
