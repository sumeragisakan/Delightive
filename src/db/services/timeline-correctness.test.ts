import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../connection";
import { CaseRepository } from "../repositories/case-repository";
import { EventRepository } from "../repositories/event-repository";
import { EvidenceRepository } from "../repositories/evidence-repository";
import { InvestigationRepository } from "../repositories/investigation-repository";
import { ReasoningWorkspaceRepository } from "../repositories/reasoning-workspace-repository";
import { AiReasoningService } from "./ai-reasoning-service";
import { buildReasoningContext } from "./reasoning-context-service";
import { ReasoningGraphService } from "./reasoning-graph-service";
import type { ReasoningModelProvider } from "../../ai/provider";
import { formatResolvedTime } from "../../timeline/time";

describe("timeline correctness across the review workflow", () => {
  let connection: DatabaseConnection;
  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  });
  afterEach(() => connection.sqlite.close());

  function fixture() {
    const cases = new CaseRepository(connection);
    const events = new EventRepository(connection);
    const evidence = new EvidenceRepository(connection);
    const reasoning = new ReasoningWorkspaceRepository(connection);
    const investigations = new InvestigationRepository(connection);
    const caseFile = cases.createCase({ title: "钟楼案", timelineOriginLabel: "案发当天" });
    const branch = reasoning.createBranch({ caseId: caseFile.id, name: "主要解释" });
    const a = events.createEvent({ caseId: caseFile.id, title: "停电", timeKind: "exact", timePrecision: "minute", startOffsetSeconds: 21 * 3600 });
    const b = events.createEvent({ caseId: caseFile.id, title: "甲进入书房", timeKind: "relative", anchorEventId: a.id, relativeOffsetSeconds: 600, timePrecision: "minute" });
    const c = events.createEvent({ caseId: caseFile.id, title: "听见声响", timeKind: "relative", anchorEventId: b.id, relativeOffsetSeconds: 300 });
    const source = evidence.createSource({ caseId: caseFile.id, title: "第一章" });
    const fact = evidence.createEvidenceClaim({ caseId: caseFile.id, kind: "fact", content: "声响发生于21:15", sourceId: source.id, eventId: c.id, status: "accepted" });
    const hypothesis = reasoning.createHypothesis({ caseId: caseFile.id, branchId: branch.id, content: "甲在声响前已进入书房" });
    reasoning.addArgument({ caseId: caseFile.id, premiseClaimId: fact.id, conclusionClaimId: hypothesis.id, relation: "supports" });
    reasoning.promoteHypothesis(caseFile.id, hypothesis.id);
    const item = investigations.createItem({ caseId: caseFile.id, branchId: branch.id, title: "核实声响", question: "核实21:15的声响", associations: { eventIds: [c.id] } });
    const unrelated = events.createEvent({ caseId: caseFile.id, title: "无关事件", timeKind: "exact", startOffsetSeconds: 3600 });
    return { cases, events, evidence, reasoning, investigations, caseFile, branch, a, b, c, source, fact, hypothesis, item, unrelated };
  }

  it("updates a multi-hop timeline and invalidates dependent claims without fabricating event edits", () => {
    const f = fixture();
    const result = f.events.updateEvent(f.caseFile.id, f.a.id, { title: "停电", timeKind: "exact", startOffsetSeconds: 21 * 3600 + 1800 });
    expect(result.invalidatedClaimIds).toContain(f.fact.id);
    expect(result.invalidatedClaimIds).toContain(f.hypothesis.id);
    expect(f.events.getEvent(f.caseFile.id, f.c.id)).toMatchObject({ revision: 1, timeBasisRevision: 2, resolvedTime: { start: 21 * 3600 + 2700 } });
    expect(f.events.getEvent(f.caseFile.id, f.unrelated.id)?.timeBasisRevision).toBe(1);
    expect(f.evidence.listEvidenceClaims(f.caseFile.id)[0]).toMatchObject({ status: "needs_review", events: [{ isStale: true }] });
    expect(f.investigations.getItem(f.caseFile.id, f.item.id).isStale).toBe(true);
    expect(new ReasoningGraphService(connection).build(f.caseFile.id, f.branch.id)?.nodes.find((node) => node.recordId === f.fact.id)?.stale).toBe(true);
    f.evidence.updateEvidenceClaim(f.caseFile.id, f.fact.id, { content: "声响发生于21:45", status: "accepted" });
    expect(f.evidence.listEvidenceClaims(f.caseFile.id)[0].events[0].isStale).toBe(false);
    expect(f.reasoning.getWorkspace(f.caseFile.id, f.branch.id).exploration.find((claim) => claim.id === f.hypothesis.id)?.status).toBe("needs_review");
    f.reasoning.reconfirmInference(f.caseFile.id, f.hypothesis.id);
    expect(f.reasoning.getWorkspace(f.caseFile.id, f.branch.id).acceptedInferences).toHaveLength(1);
  });

  it("blocks accepting evidence with an archived anchor until its basis is restored", () => {
    const f = fixture();
    f.events.setEventArchived(f.caseFile.id, f.a.id, true);
    expect(f.events.getEvent(f.caseFile.id, f.c.id)?.resolvedTime.status).toBe("invalid");
    expect(() => f.evidence.updateEvidenceClaim(f.caseFile.id, f.fact.id, { content: "声响发生于21:15", status: "accepted" })).toThrow("时间依据不可用");
    expect(() => f.evidence.createEvidenceClaim({ caseId: f.caseFile.id, kind: "fact", content: "新事实", sourceId: f.source.id, eventId: f.c.id, status: "accepted" })).toThrow("时间依据不可用");
    f.events.setEventArchived(f.caseFile.id, f.a.id, false);
    expect(f.events.getEvent(f.caseFile.id, f.c.id)?.resolvedTime.status).toBe("located");
    expect(f.evidence.listEvidenceClaims(f.caseFile.id)[0].status).toBe("needs_review");
  });

  it("invalidates time-dependent reviews when changing the case-wide date basis", () => {
    const f = fixture();
    f.cases.updateCase(f.caseFile.id, { title: f.caseFile.title, timelineMode: "calendar", timelineOriginAt: new Date("2026-09-26T00:00:00Z") });
    expect(f.evidence.listEvidenceClaims(f.caseFile.id)[0]).toMatchObject({ status: "needs_review", events: [{ isStale: true }] });
    expect(f.investigations.getItem(f.caseFile.id, f.item.id).isStale).toBe(true);
    expect(f.events.getEvent(f.caseFile.id, f.a.id)?.startOffsetSeconds).toBe(21 * 3600);
    const basis = f.events.getEvent(f.caseFile.id, f.a.id)?.timeBasisRevision;
    f.cases.updateCase(f.caseFile.id, { title: "仅改标题", timelineMode: "calendar" });
    expect(f.events.getEvent(f.caseFile.id, f.a.id)?.timeBasisRevision).toBe(basis);
  });

  it("preserves independent civil dates when rebasing an existing calendar timeline", () => {
    const f = fixture();
    f.cases.updateCase(f.caseFile.id, { title: f.caseFile.title, timelineMode: "calendar", timelineOriginAt: new Date("2026-09-26T00:00:00Z") });
    f.cases.updateCase(f.caseFile.id, { title: f.caseFile.title, timelineMode: "calendar", timelineOriginAt: new Date("2026-09-27T00:00:00Z") });
    const relative = f.events.getEvent(f.caseFile.id, f.c.id)!;
    expect(formatResolvedTime(relative.resolvedTime, "2026-09-27")).toBe("2026-09-26 21:15");
    expect(relative.revision).toBe(1);
    expect(f.events.getEvent(f.caseFile.id, f.a.id)).toMatchObject({ revision: 1, startOffsetSeconds: -10800 });
  });

  it("includes global event time and presence data and rejects AI output after a time-only change", async () => {
    const f = fixture();
    const person = f.cases.createPerson({ caseId: f.caseFile.id, displayName: "甲" });
    f.events.addParticipant({ eventId: f.b.id, personId: person.id, presence: "claimed" });
    // Refresh the fact after the participant aggregate revision.
    f.evidence.updateEvidenceClaim(f.caseFile.id, f.fact.id, { content: "声响发生于21:15", status: "accepted" });
    const context = buildReasoningContext(connection, f.caseFile.id, f.branch.id);
    expect(context.timeline.find((event) => event.id === f.b.id)).toMatchObject({
      anchorEventId: f.a.id, relativeOffsetSeconds: 600, resolvedTime: { start: 21 * 3600 + 600 },
      participants: [{ presence: "claimed", name: "甲" }],
    });
    expect(context.timeline.some((event) => event.id === f.unrelated.id)).toBe(true);
    const provider: ReasoningModelProvider = {
      name: "mock", model: "mock",
      async generate() { return {
        summary: "待查", remoteResponseId: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        suggestions: [{ kind: "hypothesis", title: "备选解释", content: "需核实甲的行动", confidence: 50, rationale: "时间线需核查",
          targetClaimId: null, secondaryClaimId: null, citations: [{ claimId: f.fact.id, revision: 2, relation: "supports" }] }],
      }; },
    };
    const service = new AiReasoningService(connection, provider);
    await service.startRun({ caseId: f.caseFile.id, branchId: f.branch.id, mode: "consistency_check", requestKey: "abcdef01-2345-6789-abcd-012345678901" });
    const suggestion = service.listRuns(f.caseFile.id, f.branch.id)[0].suggestions[0];
    // This event has no claim links, so cited claim text/revision remains unchanged.
    f.events.updateEvent(f.caseFile.id, f.unrelated.id, { title: "无关事件", timeKind: "exact", startOffsetSeconds: 7200 });
    expect(service.listRuns(f.caseFile.id, f.branch.id)[0].suggestions[0].isStale).toBe(true);
    expect(() => service.acceptSuggestion(f.caseFile.id, suggestion.id)).toThrow("时间轴或时间依据已变化");
  });
});
