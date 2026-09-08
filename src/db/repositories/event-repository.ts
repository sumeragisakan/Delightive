import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { DatabaseConnection } from "../connection";
import {
  type ActorKind,
  cases,
  claimEvents,
  eventParticipants,
  eventRevisions,
  eventSources,
  events,
  locations,
  people,
} from "../schema";
import { invalidateClaimsForEvent } from "../services/invalidation-service";

type EventRow = typeof events.$inferSelect;
type EventParticipantRow = typeof eventParticipants.$inferSelect;
type LocationRow = typeof locations.$inferSelect;
type PersonRow = typeof people.$inferSelect;

export type TimelineParticipant = EventParticipantRow & {
  person: PersonRow;
};

export type TimelineEvent = EventRow & {
  dependentClaimCount: number;
  location: LocationRow | null;
  participants: TimelineParticipant[];
};

type EventInput = {
  caseId: string;
  title: string;
  description?: string;
  locationId?: string | null;
  anchorEventId?: string | null;
  timeKind?: EventRow["timeKind"];
  startOffsetSeconds?: number | null;
  endOffsetSeconds?: number | null;
  relativeOffsetSeconds?: number | null;
  displayTime?: string | null;
  certainty?: number | null;
  sortOrder?: number;
};

type EventUpdateInput = Omit<EventInput, "caseId" | "timeKind"> & {
  timeKind: EventRow["timeKind"];
  changedBy?: ActorKind;
};

export class EventRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  listTimeline(caseId: string, includeArchived = true): TimelineEvent[] {
    const rows = this.connection.db
      .select()
      .from(events)
      .where(eq(events.caseId, caseId))
      .orderBy(asc(events.sortOrder), asc(events.createdAt))
      .all()
      .filter((event) => includeArchived || event.archivedAt === null);

    return rows.map((event) => this.hydrateEvent(event)).sort(compareEvents);
  }

  getEvent(caseId: string, eventId: string): TimelineEvent | undefined {
    const event = this.connection.db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.caseId, caseId)))
      .get();

    return event ? this.hydrateEvent(event) : undefined;
  }

  createEvent(input: EventInput): EventRow {
    this.assertCaseExists(input.caseId);
    assertPercentage(input.certainty, "Event certainty");
    assertInteger(input.sortOrder, "Event sort order");

    const time = this.normalizeTime({
      anchorEventId: input.anchorEventId ?? null,
      caseId: input.caseId,
      endOffsetSeconds: input.endOffsetSeconds ?? null,
      eventId: null,
      relativeOffsetSeconds: input.relativeOffsetSeconds ?? null,
      startOffsetSeconds: input.startOffsetSeconds ?? null,
      timeKind: input.timeKind ?? "unknown",
    });
    this.assertLocation(input.caseId, input.locationId ?? null);

    const create = this.connection.sqlite.transaction(() => {
      const event = this.connection.db
        .insert(events)
        .values({
          id: randomUUID(),
          caseId: input.caseId,
          title: requireText(input.title, "Event title"),
          description: input.description?.trim() ?? "",
          locationId: input.locationId ?? null,
          displayTime: input.displayTime?.trim() || null,
          certainty: input.certainty ?? null,
          sortOrder: input.sortOrder ?? 0,
          ...time,
        })
        .returning()
        .get();

      this.touchCase(input.caseId);
      return event;
    });

    return create();
  }

  updateEvent(caseId: string, eventId: string, input: EventUpdateInput) {
    const current = this.getEventOrThrow(eventId, caseId);
    assertPercentage(input.certainty, "Event certainty");
    assertInteger(input.sortOrder, "Event sort order");

    const time = this.normalizeTime({
      anchorEventId: input.anchorEventId ?? null,
      caseId,
      endOffsetSeconds: input.endOffsetSeconds ?? null,
      eventId,
      relativeOffsetSeconds: input.relativeOffsetSeconds ?? null,
      startOffsetSeconds: input.startOffsetSeconds ?? null,
      timeKind: input.timeKind,
    });
    this.assertLocation(caseId, input.locationId ?? null);

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordRevision(current, changedAt, input.changedBy ?? "user");

      const event = this.connection.db
        .update(events)
        .set({
          title: requireText(input.title, "Event title"),
          description: input.description?.trim() ?? "",
          locationId: input.locationId ?? null,
          displayTime: input.displayTime?.trim() || null,
          certainty: input.certainty ?? null,
          sortOrder: input.sortOrder ?? current.sortOrder,
          revision: current.revision + 1,
          updatedAt: changedAt,
          ...time,
        })
        .where(eq(events.id, eventId))
        .returning()
        .get();

      const invalidatedClaimIds = invalidateClaimsForEvent(
        this.connection,
        eventId,
        changedAt,
      );
      this.touchCase(caseId, changedAt);

      return { event, invalidatedClaimIds };
    });

    return revise();
  }

  setEventArchived(
    caseId: string,
    eventId: string,
    archived: boolean,
    changedBy: ActorKind = "user",
  ) {
    const current = this.getEventOrThrow(eventId, caseId);

    if ((current.archivedAt !== null) === archived) {
      return { event: current, invalidatedClaimIds: [] as string[] };
    }

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordRevision(current, changedAt, changedBy);
      const event = this.connection.db
        .update(events)
        .set({
          archivedAt: archived ? changedAt : null,
          revision: current.revision + 1,
          updatedAt: changedAt,
        })
        .where(eq(events.id, eventId))
        .returning()
        .get();
      const invalidatedClaimIds = invalidateClaimsForEvent(
        this.connection,
        eventId,
        changedAt,
      );

      this.touchCase(caseId, changedAt);
      return { event, invalidatedClaimIds };
    });

    return revise();
  }

  addParticipant(input: {
    eventId: string;
    personId: string;
    role?: EventParticipantRow["role"];
    presence?: EventParticipantRow["presence"];
    notes?: string;
    changedBy?: ActorKind;
  }) {
    const current = this.getEventOrThrow(input.eventId);
    this.assertActive(current);
    const person = this.getPersonOrThrow(input.personId);

    if (current.caseId !== person.caseId) {
      throw new Error("Event and person must belong to the same case.");
    }

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordRevision(current, changedAt, input.changedBy ?? "user");
      const participant = this.connection.db
        .insert(eventParticipants)
        .values({
          eventId: input.eventId,
          personId: input.personId,
          role: input.role ?? "present",
          presence: input.presence ?? "confirmed",
          notes: input.notes?.trim() ?? "",
          createdAt: changedAt,
        })
        .returning()
        .get();
      const { event, invalidatedClaimIds } = this.finishAggregateRevision(
        current,
        changedAt,
      );

      return { event, invalidatedClaimIds, participant };
    });

    return revise();
  }

  updateParticipant(input: {
    eventId: string;
    personId: string;
    role: EventParticipantRow["role"];
    presence: EventParticipantRow["presence"];
    notes?: string;
    changedBy?: ActorKind;
  }) {
    const current = this.getEventOrThrow(input.eventId);
    this.assertActive(current);
    this.assertParticipantExists(input.eventId, input.personId, input.role);

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordRevision(current, changedAt, input.changedBy ?? "user");
      const participant = this.connection.db
        .update(eventParticipants)
        .set({
          presence: input.presence,
          notes: input.notes?.trim() ?? "",
        })
        .where(
          and(
            eq(eventParticipants.eventId, input.eventId),
            eq(eventParticipants.personId, input.personId),
            eq(eventParticipants.role, input.role),
          ),
        )
        .returning()
        .get();
      const { event, invalidatedClaimIds } = this.finishAggregateRevision(
        current,
        changedAt,
      );

      return { event, invalidatedClaimIds, participant };
    });

    return revise();
  }

  removeParticipant(input: {
    eventId: string;
    personId: string;
    role: EventParticipantRow["role"];
    changedBy?: ActorKind;
  }) {
    const current = this.getEventOrThrow(input.eventId);
    this.assertActive(current);
    this.assertParticipantExists(input.eventId, input.personId, input.role);

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordRevision(current, changedAt, input.changedBy ?? "user");
      this.connection.db
        .delete(eventParticipants)
        .where(
          and(
            eq(eventParticipants.eventId, input.eventId),
            eq(eventParticipants.personId, input.personId),
            eq(eventParticipants.role, input.role),
          ),
        )
        .run();
      const result = this.finishAggregateRevision(current, changedAt);

      return { ...result, removed: true as const };
    });

    return revise();
  }

  private hydrateEvent(event: EventRow): TimelineEvent {
    const location = event.locationId
      ? (this.connection.db
          .select()
          .from(locations)
          .where(eq(locations.id, event.locationId))
          .get() ?? null)
      : null;
    const participants = this.connection.db
      .select({ participant: eventParticipants, person: people })
      .from(eventParticipants)
      .innerJoin(people, eq(eventParticipants.personId, people.id))
      .where(eq(eventParticipants.eventId, event.id))
      .orderBy(asc(eventParticipants.createdAt))
      .all()
      .map(({ participant, person }) => ({ ...participant, person }));
    const dependentClaimCount = this.connection.db
      .select({ id: claimEvents.claimId })
      .from(claimEvents)
      .where(eq(claimEvents.eventId, event.id))
      .all().length;

    return { ...event, dependentClaimCount, location, participants };
  }

  private getEventOrThrow(eventId: string, caseId?: string): EventRow {
    const event = this.connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .get();

    if (!event || (caseId && event.caseId !== caseId)) {
      throw new Error("Event must belong to the requested case.");
    }

    return event;
  }

  private getPersonOrThrow(personId: string): PersonRow {
    const person = this.connection.db
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .get();

    if (!person) {
      throw new Error(`Person not found: ${personId}`);
    }

    return person;
  }

  private assertParticipantExists(
    eventId: string,
    personId: string,
    role: EventParticipantRow["role"],
  ) {
    const participant = this.connection.db
      .select({ eventId: eventParticipants.eventId })
      .from(eventParticipants)
      .where(
        and(
          eq(eventParticipants.eventId, eventId),
          eq(eventParticipants.personId, personId),
          eq(eventParticipants.role, role),
        ),
      )
      .get();

    if (!participant) {
      throw new Error("Event participant not found.");
    }
  }

  private assertActive(event: EventRow) {
    if (event.archivedAt) {
      throw new Error("Archived events must be restored before editing.");
    }
  }

  private normalizeTime(input: {
    anchorEventId: string | null;
    caseId: string;
    endOffsetSeconds: number | null;
    eventId: string | null;
    relativeOffsetSeconds: number | null;
    startOffsetSeconds: number | null;
    timeKind: EventRow["timeKind"];
  }) {
    assertInteger(input.startOffsetSeconds, "Event start time");
    assertInteger(input.endOffsetSeconds, "Event end time");
    assertInteger(input.relativeOffsetSeconds, "Relative event offset");

    if (input.timeKind === "unknown") {
      return {
        anchorEventId: null,
        endOffsetSeconds: null,
        relativeOffsetSeconds: null,
        startOffsetSeconds: null,
        timeKind: input.timeKind,
      };
    }

    if (input.timeKind === "relative") {
      if (!input.anchorEventId || input.relativeOffsetSeconds === null) {
        throw new Error("Relative events require an anchor and a time offset.");
      }

      const anchor = this.getEventOrThrow(input.anchorEventId, input.caseId);
      this.assertActive(anchor);
      if (
        input.eventId &&
        (input.eventId === anchor.id ||
          this.wouldCreateAnchorCycle(input.eventId, anchor.id))
      ) {
        throw new Error("A relative event cannot create a circular timeline.");
      }

      return {
        anchorEventId: anchor.id,
        endOffsetSeconds: null,
        relativeOffsetSeconds: input.relativeOffsetSeconds,
        startOffsetSeconds: null,
        timeKind: input.timeKind,
      };
    }

    if (input.startOffsetSeconds === null) {
      throw new Error("Timed events require a start time.");
    }

    if (input.timeKind === "range") {
      if (input.endOffsetSeconds === null) {
        throw new Error("Time ranges require an end time.");
      }
      if (input.endOffsetSeconds < input.startOffsetSeconds) {
        throw new Error("Event end time cannot precede its start time.");
      }
    }

    return {
      anchorEventId: null,
      endOffsetSeconds:
        input.timeKind === "range" ? input.endOffsetSeconds : null,
      relativeOffsetSeconds: null,
      startOffsetSeconds: input.startOffsetSeconds,
      timeKind: input.timeKind,
    };
  }

  private assertCaseExists(caseId: string) {
    const caseFile = this.connection.db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.id, caseId))
      .get();

    if (!caseFile) {
      throw new Error(`Case not found: ${caseId}`);
    }
  }

  private assertLocation(caseId: string, locationId: string | null) {
    if (!locationId) {
      return;
    }

    const location = this.connection.db
      .select({ caseId: locations.caseId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .get();

    if (!location || location.caseId !== caseId) {
      throw new Error("Event location must belong to the same case.");
    }
  }

  private wouldCreateAnchorCycle(eventId: string, anchorEventId: string) {
    return Boolean(
      this.connection.sqlite
        .prepare(
          `
            with recursive ancestors(id) as (
              select ?
              union
              select anchor_event_id
              from events
              join ancestors on events.id = ancestors.id
              where anchor_event_id is not null
            )
            select 1
            from ancestors
            where id = ?
            limit 1
          `,
        )
        .get(anchorEventId, eventId),
    );
  }

  private recordRevision(
    current: EventRow,
    changedAt: Date,
    changedBy: ActorKind,
  ) {
    const participants = this.connection.db
      .select()
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, current.id))
      .all();
    const sources = this.connection.db
      .select()
      .from(eventSources)
      .where(eq(eventSources.eventId, current.id))
      .all();

    this.connection.db
      .insert(eventRevisions)
      .values({
        id: randomUUID(),
        eventId: current.id,
        revision: current.revision,
        snapshot: JSON.stringify({ event: current, participants, sources }),
        changedBy,
        changedAt,
      })
      .run();
  }

  private finishAggregateRevision(current: EventRow, changedAt: Date) {
    const event = this.connection.db
      .update(events)
      .set({ revision: current.revision + 1, updatedAt: changedAt })
      .where(eq(events.id, current.id))
      .returning()
      .get();
    const invalidatedClaimIds = invalidateClaimsForEvent(
      this.connection,
      current.id,
      changedAt,
    );

    this.touchCase(current.caseId, changedAt);
    return { event, invalidatedClaimIds };
  }

  private touchCase(caseId: string, updatedAt = new Date()) {
    this.connection.db
      .update(cases)
      .set({ updatedAt })
      .where(eq(cases.id, caseId))
      .run();
  }
}

function compareEvents(left: TimelineEvent, right: TimelineEvent) {
  const rankDifference = eventRank(left) - eventRank(right);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  const timeDifference =
    (left.startOffsetSeconds ?? Number.MAX_SAFE_INTEGER) -
    (right.startOffsetSeconds ?? Number.MAX_SAFE_INTEGER);

  return timeDifference || left.sortOrder - right.sortOrder;
}

function eventRank(event: EventRow) {
  if (event.archivedAt) {
    return 3;
  }
  if (["exact", "range", "approximate"].includes(event.timeKind)) {
    return 0;
  }
  return event.timeKind === "relative" ? 1 : 2;
}

function requireText(value: string, label: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }

  return normalized;
}

function assertPercentage(value: number | null | undefined, label: string) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error(`${label} must be an integer between 0 and 100.`);
  }
}

function assertInteger(value: number | null | undefined, label: string) {
  if (value != null && !Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number of seconds.`);
  }
}
