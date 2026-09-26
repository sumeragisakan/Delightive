// Civil case time: calendar dates are coordinates, never browser-local instants.
export type TimeEvent = {
  id: string;
  caseId?: string;
  title: string;
  timeKind: "exact" | "range" | "approximate" | "relative" | "unknown";
  timePrecision: "minute" | "second";
  startOffsetSeconds: number | null;
  endOffsetSeconds: number | null;
  relativeOffsetSeconds: number | null;
  anchorEventId: string | null;
  archivedAt: unknown;
  revision: number;
  timeBasisRevision: number;
};

export type ResolvedTime = {
  status: "located" | "unanchored" | "invalid";
  start: number | null;
  end: number | null;
  approximate: boolean;
  precision: "minute" | "second";
  reason: string | null;
  basis: Array<{ id: string; revision: number; timeBasisRevision: number }>;
};

export function caseTimeBasisToken(mode: string, origin: string | null) {
  return `${mode}:${origin ?? ""}`;
}

export function resolveEventTime(event: TimeEvent, events: ReadonlyMap<string, TimeEvent>): ResolvedTime {
  const basis: ResolvedTime["basis"] = [];
  const visited = new Set<string>();
  let current: TimeEvent | undefined = event;
  let offset = 0;
  let precision = event.timePrecision;
  const finish = (status: ResolvedTime["status"], reason: string | null, start: number | null = null,
    end: number | null = null, approximate = false): ResolvedTime =>
    ({ status, reason, start, end, approximate, precision, basis });
  while (current) {
    if (visited.has(current.id)) return finish("invalid", "时间参照形成循环。");
    visited.add(current.id);
    basis.push({ id: current.id, revision: current.revision, timeBasisRevision: current.timeBasisRevision });
    if (current.timePrecision === "minute") precision = "minute";
    if (current.archivedAt !== null) return finish("invalid", `时间依据“${current.title}”已归档。`);
    if (current.timeKind === "unknown") return finish("unanchored", `“${current.title}”尚未确定时间。`);
    if (current.timeKind !== "relative") {
      if (current.startOffsetSeconds === null) return finish("invalid", "时间依据缺少起点。");
      const start = current.startOffsetSeconds + offset;
      const end = (current.endOffsetSeconds ?? current.startOffsetSeconds) + offset;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return finish("invalid", "推算时间超出可表示范围。");
      return finish("located", null, start, end, current.timeKind === "approximate");
    }
    if (current.relativeOffsetSeconds === null) return finish("invalid", "相对时间缺少间隔。");
    offset += current.relativeOffsetSeconds;
    const anchor: TimeEvent | undefined = current.anchorEventId ? events.get(current.anchorEventId) : undefined;
    if (!anchor || (event.caseId && anchor.caseId !== event.caseId)) return finish("invalid", "参照事件不可用。");
    current = anchor;
  }
  return finish("invalid", "时间依据不可用。");
}

export function parseCivilDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

export function parseClock(value: string): number | null {
  const match = /^(\d{2}):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!match || Number(match[1]) > 23) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

export function absoluteTimeInput(day: string, clock: string, calendar: boolean, originDate: string): number | null {
  const seconds = parseClock(clock);
  if (seconds === null) return null;
  const date = calendar ? parseCivilDate(day) : null;
  const origin = calendar ? parseCivilDate(originDate) : null;
  const dayOffset = calendar
    ? date !== null && origin !== null ? (date - origin) / 86_400_000 : NaN
    : /^-?\d+$/.test(day) ? Number(day) - 1 : NaN;
  const result = dayOffset * 86400 + seconds;
  return Number.isSafeInteger(result) ? result : null;
}

export function timeInputParts(seconds: number | null, calendar: boolean, originDate: string) {
  if (seconds === null) return { day: calendar ? originDate : "1", clock: "" };
  const dayOffset = Math.floor(seconds / 86400);
  const clockSeconds = seconds - dayOffset * 86400;
  const origin = parseCivilDate(originDate);
  const timestamp = origin === null ? NaN : origin + dayOffset * 86_400_000;
  const day = calendar && Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15
    ? new Date(timestamp).toISOString().slice(0, 10) : String(dayOffset + 1);
  const clock = [Math.floor(clockSeconds / 3600), Math.floor(clockSeconds % 3600 / 60), clockSeconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
  return { day, clock };
}

export function formatCaseTime(seconds: number, precision: "minute" | "second", originDate = "", originLabel = "") {
  const parts = timeInputParts(seconds, Boolean(originDate), originDate);
  const day = originDate ? parts.day : `第 ${parts.day} 天${parts.day === "1" && originLabel ? `（${originLabel}）` : ""}`;
  return `${day} ${precision === "minute" ? parts.clock.slice(0, 5) : parts.clock}`;
}

export function formatResolvedTime(time: ResolvedTime, originDate = "", originLabel = "") {
  if (time.status !== "located" || time.start === null || time.end === null) return time.reason ?? "时间未定";
  const start = formatCaseTime(time.start, time.precision, originDate, originLabel);
  return `${time.approximate ? "约 " : ""}${start}${time.end !== time.start ? ` 至 ${formatCaseTime(time.end, time.precision, originDate, originLabel)}` : ""}`;
}
