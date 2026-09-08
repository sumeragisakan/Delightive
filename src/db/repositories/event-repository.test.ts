import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { claimEvents, claims, eventRevisions } from "../schema";
import { CaseRepository } from "./case-repository";
import { EventRepository } from "./event-repository";
import { LocationRepository } from "./location-repository";
import { ReasoningRepository } from "./reasoning-repository";

describe("timeline domain services", () => {
  let connection: DatabaseConnection;
  let cases: CaseRepository;
  let events: EventRepository;
  let locations: LocationRepository;
  let reasoning: ReasoningRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    cases = new CaseRepository(connection);
    events = new EventRepository(connection);
    locations = new LocationRepository(connection);
    reasoning = new ReasoningRepository(connection);
  });

  afterEach(() => {
    connection.sqlite.close();
  });

  it("keeps nested locations inside a case and rejects parent cycles", () => {
    const firstCase = cases.createCase({ title: "旅馆谜案" });
    const secondCase = cases.createCase({ title: "钟楼谜案" });
    const lobby = locations.createLocation({
      caseId: firstCase.id,
      name: "旅馆",
    });
    const room = locations.createLocation({
      caseId: firstCase.id,
      name: "203 室",
      parentLocationId: lobby.id,
    });
    const tower = locations.createLocation({
      caseId: secondCase.id,
      name: "钟楼",
    });

    expect(locations.listLocations(firstCase.id).map(({ name }) => name)).toEqual([
      "旅馆",
      "203 室",
    ]);
    expect(() =>
      locations.updateLocation(firstCase.id, lobby.id, {
        name: "旅馆",
        parentLocationId: room.id,
      }),
    ).toThrow("contain itself");
    expect(() =>
      locations.createLocation({
        caseId: firstCase.id,
        name: "屋顶",
        parentLocationId: tower.id,
      }),
    ).toThrow("same case");
  });

  it("validates timeline semantics and orders absolute, relative, and unknown events", () => {
    const mystery = cases.createCase({ title: "午夜谜案" });
    const otherCase = cases.createCase({ title: "另案" });
    const hall = locations.createLocation({
      caseId: mystery.id,
      name: "大厅",
    });
    const elsewhere = locations.createLocation({
      caseId: otherCase.id,
      name: "远处",
    });
    const later = events.createEvent({
      caseId: mystery.id,
      locationId: hall.id,
      startOffsetSeconds: 120,
      timeKind: "exact",
      title: "灯熄灭",
    });
    events.createEvent({
      caseId: mystery.id,
      startOffsetSeconds: 60,
      timeKind: "approximate",
      title: "脚步声",
    });
    events.createEvent({
      anchorEventId: later.id,
      caseId: mystery.id,
      relativeOffsetSeconds: 15,
      timeKind: "relative",
      title: "门被推开",
    });
    const unknown = events.createEvent({
      caseId: mystery.id,
      startOffsetSeconds: 999,
      timeKind: "unknown",
      title: "遗失的钥匙",
    });

    expect(unknown.startOffsetSeconds).toBeNull();
    expect(events.listTimeline(mystery.id).map(({ title }) => title)).toEqual([
      "脚步声",
      "灯熄灭",
      "门被推开",
      "遗失的钥匙",
    ]);
    expect(() =>
      events.createEvent({
        caseId: mystery.id,
        timeKind: "exact",
        title: "缺少时间",
      }),
    ).toThrow("start time");
    expect(() =>
      events.createEvent({
        caseId: mystery.id,
        endOffsetSeconds: 10,
        startOffsetSeconds: 20,
        timeKind: "range",
        title: "倒置区间",
      }),
    ).toThrow("cannot precede");
    expect(() =>
      events.createEvent({
        caseId: mystery.id,
        locationId: elsewhere.id,
        title: "越界地点",
      }),
    ).toThrow("same case");
  });

  it("revisions aggregate edits and blocks relative-event cycles", () => {
    const mystery = cases.createCase({ title: "循环案" });
    const witness = cases.createPerson({
      caseId: mystery.id,
      displayName: "X",
    });
    const firstEvent = events.createEvent({
      caseId: mystery.id,
      startOffsetSeconds: 0,
      timeKind: "exact",
      title: "起点",
    });
    const secondEvent = events.createEvent({
      anchorEventId: firstEvent.id,
      caseId: mystery.id,
      relativeOffsetSeconds: 30,
      timeKind: "relative",
      title: "后续",
    });

    events.addParticipant({
      eventId: firstEvent.id,
      personId: witness.id,
      role: "witness",
    });
    events.updateParticipant({
      eventId: firstEvent.id,
      notes: "自述在场",
      personId: witness.id,
      presence: "claimed",
      role: "witness",
    });
    events.removeParticipant({
      eventId: firstEvent.id,
      personId: witness.id,
      role: "witness",
    });

    expect(events.getEvent(mystery.id, firstEvent.id)?.revision).toBe(4);
    const revisions = connection.db
      .select()
      .from(eventRevisions)
      .where(eq(eventRevisions.eventId, firstEvent.id))
      .orderBy(asc(eventRevisions.revision))
      .all();
    expect(revisions.map(({ revision }) => revision)).toEqual([1, 2, 3]);
    expect(JSON.parse(revisions[0].snapshot).participants).toEqual([]);
    expect(JSON.parse(revisions[1].snapshot).participants[0].presence).toBe(
      "confirmed",
    );
    expect(() =>
      events.updateEvent(mystery.id, firstEvent.id, {
        anchorEventId: secondEvent.id,
        relativeOffsetSeconds: -30,
        timeKind: "relative",
        title: "起点",
      }),
    ).toThrow("circular timeline");

    events.setEventArchived(mystery.id, firstEvent.id, true);
    expect(events.listTimeline(mystery.id, false).map(({ id }) => id)).not.toContain(
      firstEvent.id,
    );
    events.setEventArchived(mystery.id, firstEvent.id, false);
    expect(events.getEvent(mystery.id, firstEvent.id)?.revision).toBe(6);
  });

  it("invalidates event-dependent claims and records their event revision", () => {
    const mystery = cases.createCase({ title: "车站谜案" });
    const event = events.createEvent({
      caseId: mystery.id,
      startOffsetSeconds: 60,
      timeKind: "exact",
      title: "列车到站",
    });
    const fact = reasoning.createClaim({
      caseId: mystery.id,
      content: "列车于一分钟后到站",
      kind: "fact",
      status: "accepted",
    });
    const hypothesis = reasoning.createClaim({
      caseId: mystery.id,
      content: "X 当时在站台",
      kind: "hypothesis",
      status: "accepted",
    });
    const inference = reasoning.createClaim({
      caseId: mystery.id,
      content: "X 有机会登车",
      kind: "inference",
      status: "accepted",
    });

    reasoning.attachEvent({ claimId: fact.id, eventId: event.id });
    reasoning.linkClaims({
      conclusionClaimId: hypothesis.id,
      premiseClaimId: fact.id,
      relation: "supports",
    });
    reasoning.linkClaims({
      conclusionClaimId: inference.id,
      premiseClaimId: hypothesis.id,
      relation: "supports",
    });

    const result = events.updateEvent(mystery.id, event.id, {
      startOffsetSeconds: 90,
      timeKind: "exact",
      title: "列车到站",
    });
    const statuses = new Map(
      connection.db
        .select({ id: claims.id, status: claims.status })
        .from(claims)
        .where(eq(claims.caseId, mystery.id))
        .all()
        .map(({ id, status }) => [id, status]),
    );

    expect(result.invalidatedClaimIds).toEqual(
      expect.arrayContaining([fact.id, hypothesis.id, inference.id]),
    );
    expect(statuses.get(fact.id)).toBe("needs_review");
    expect(statuses.get(hypothesis.id)).toBe("needs_review");
    expect(statuses.get(inference.id)).toBe("needs_review");
    expect(
      connection.db
        .select({ eventRevision: claimEvents.eventRevision })
        .from(claimEvents)
        .where(eq(claimEvents.claimId, fact.id))
        .get()?.eventRevision,
    ).toBe(1);

    reasoning.reviseClaim(fact.id, { status: "accepted" });
    expect(
      connection.db
        .select({ eventRevision: claimEvents.eventRevision })
        .from(claimEvents)
        .where(eq(claimEvents.claimId, fact.id))
        .get()?.eventRevision,
    ).toBe(2);
  });
});
