import { describe, expect, it } from "vitest";
import { absoluteTimeInput, formatResolvedTime, parseCivilDate, resolveEventTime, timeInputParts, type TimeEvent } from "./time";

const event = (id: string, overrides: Partial<TimeEvent> = {}): TimeEvent => ({
  id, title: id, timeKind: "exact", timePrecision: "minute", startOffsetSeconds: 21 * 3600,
  endOffsetSeconds: null, relativeOffsetSeconds: null, anchorEventId: null, archivedAt: null,
  revision: 1, timeBasisRevision: 1, ...overrides,
});

describe("civil case time", () => {
  it("converts calendar and fictional case days without local timezone assumptions", () => {
    expect(absoluteTimeInput("2026-09-27", "00:10", true, "2026-09-26")).toBe(87000);
    expect(absoluteTimeInput("2", "00:10", false, "")).toBe(87000);
    expect(timeInputParts(-60, true, "2026-09-26")).toEqual({ day: "2026-09-25", clock: "23:59:00" });
    expect(parseCivilDate("2026-02-30")).toBeNull();
    expect(absoluteTimeInput("1", "24:00", false, "")).toBeNull();
    expect(absoluteTimeInput("", "21:00", false, "")).toBeNull();
  });

  it("resolves multi-hop chains across midnight and preserves coarse precision", () => {
    const a = event("a", { startOffsetSeconds: 23 * 3600 + 55 * 60 });
    const b = event("b", { timeKind: "relative", anchorEventId: "a", relativeOffsetSeconds: 600, startOffsetSeconds: null });
    const c = event("c", { timeKind: "relative", anchorEventId: "b", relativeOffsetSeconds: 30, startOffsetSeconds: null, timePrecision: "second" });
    const resolved = resolveEventTime(c, new Map([a, b, c].map((e) => [e.id, e])));
    expect(resolved).toMatchObject({ status: "located", start: 86730, end: 86730, precision: "minute" });
    expect(resolved.basis.map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(formatResolvedTime(resolved)).toBe("第 2 天 00:05");
  });

  it("preserves intervals and approximations without inventing an error margin", () => {
    const a = event("a", { timeKind: "range", endOffsetSeconds: 21 * 3600 + 900 });
    const b = event("b", { timeKind: "relative", anchorEventId: "a", relativeOffsetSeconds: -300, startOffsetSeconds: null });
    expect(resolveEventTime(b, new Map([[a.id, a]]))).toMatchObject({ start: 75300, end: 76200, approximate: false });
    a.timeKind = "approximate";
    a.endOffsetSeconds = null;
    expect(resolveEventTime(b, new Map([[a.id, a]]))).toMatchObject({ start: 75300, end: 75300, approximate: true });
    expect(formatResolvedTime(resolveEventTime(b, new Map([[a.id, a]])))).toBe("约 第 1 天 20:55");
  });

  it("keeps unknown anchors unlocated and rejects unavailable or circular bases", () => {
    const a = event("a", { timeKind: "unknown", startOffsetSeconds: null });
    const b = event("b", { timeKind: "relative", anchorEventId: "a", relativeOffsetSeconds: 600, startOffsetSeconds: null });
    const byId = new Map([a, b].map((e) => [e.id, e]));
    expect(resolveEventTime(b, byId).status).toBe("unanchored");
    a.archivedAt = new Date();
    expect(resolveEventTime(b, byId).status).toBe("invalid");
    a.archivedAt = null;
    a.timeKind = "relative";
    a.anchorEventId = "b";
    a.relativeOffsetSeconds = 0;
    expect(resolveEventTime(b, byId).reason).toContain("循环");
  });
});
