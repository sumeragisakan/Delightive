import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { DatabaseConnection } from "../connection";
import {
  cases,
  eventParticipants,
  events,
  people,
  personAliases,
  reasoningBranches,
  sources,
} from "../schema";

type CaseRow = typeof cases.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type PersonAliasRow = typeof personAliases.$inferSelect;
type EventRow = typeof events.$inferSelect;
type EventParticipantRow = typeof eventParticipants.$inferSelect;
type BranchRow = typeof reasoningBranches.$inferSelect;
type SourceRow = typeof sources.$inferSelect;

export class CaseRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  createCase(input: {
    title: string;
    description?: string;
    timelineMode?: CaseRow["timelineMode"];
    timelineOriginLabel?: string | null;
    timelineOriginAt?: Date | null;
  }): CaseRow {
    return this.connection.db
      .insert(cases)
      .values({
        id: randomUUID(),
        title: requireText(input.title, "Case title"),
        description: input.description?.trim() ?? "",
        timelineMode: input.timelineMode ?? "relative",
        timelineOriginLabel: input.timelineOriginLabel?.trim() || null,
        timelineOriginAt: input.timelineOriginAt ?? null,
      })
      .returning()
      .get();
  }

  createPerson(input: {
    caseId: string;
    displayName: string;
    description?: string;
    color?: string | null;
    sortOrder?: number;
  }): PersonRow {
    return this.connection.db
      .insert(people)
      .values({
        id: randomUUID(),
        caseId: input.caseId,
        displayName: requireText(input.displayName, "Person display name"),
        description: input.description?.trim() ?? "",
        color: input.color ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
      .get();
  }

  addPersonAlias(input: {
    personId: string;
    alias: string;
    kind?: PersonAliasRow["kind"];
  }): PersonAliasRow {
    const alias = requireText(input.alias, "Alias");

    return this.connection.db
      .insert(personAliases)
      .values({
        id: randomUUID(),
        personId: input.personId,
        alias,
        normalizedAlias: normalizeAlias(alias),
        kind: input.kind ?? "name",
      })
      .returning()
      .get();
  }

  createEvent(input: {
    caseId: string;
    title: string;
    description?: string;
    locationId?: string | null;
    anchorEventId?: string | null;
    timeKind?: EventRow["timeKind"];
    startOffsetMinutes?: number | null;
    endOffsetMinutes?: number | null;
    relativeOffsetMinutes?: number | null;
    displayTime?: string | null;
    certainty?: number | null;
    sortOrder?: number;
  }): EventRow {
    if (
      input.startOffsetMinutes != null &&
      input.endOffsetMinutes != null &&
      input.endOffsetMinutes < input.startOffsetMinutes
    ) {
      throw new Error("Event end time cannot precede its start time.");
    }

    assertPercentage(input.certainty, "Event certainty");

    return this.connection.db
      .insert(events)
      .values({
        id: randomUUID(),
        caseId: input.caseId,
        title: requireText(input.title, "Event title"),
        description: input.description?.trim() ?? "",
        locationId: input.locationId ?? null,
        anchorEventId: input.anchorEventId ?? null,
        timeKind: input.timeKind ?? "unknown",
        startOffsetMinutes: input.startOffsetMinutes ?? null,
        endOffsetMinutes: input.endOffsetMinutes ?? null,
        relativeOffsetMinutes: input.relativeOffsetMinutes ?? null,
        displayTime: input.displayTime?.trim() || null,
        certainty: input.certainty ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
      .get();
  }

  addEventParticipant(input: {
    eventId: string;
    personId: string;
    role?: EventParticipantRow["role"];
    presence?: EventParticipantRow["presence"];
    notes?: string;
  }): EventParticipantRow {
    const event = this.connection.db
      .select({ caseId: events.caseId })
      .from(events)
      .where(eq(events.id, input.eventId))
      .get();
    const person = this.connection.db
      .select({ caseId: people.caseId })
      .from(people)
      .where(eq(people.id, input.personId))
      .get();

    if (!event || !person) {
      throw new Error("Event and person must both exist.");
    }

    if (event.caseId !== person.caseId) {
      throw new Error("Event and person must belong to the same case.");
    }

    return this.connection.db
      .insert(eventParticipants)
      .values({
        eventId: input.eventId,
        personId: input.personId,
        role: input.role ?? "present",
        presence: input.presence ?? "confirmed",
        notes: input.notes?.trim() ?? "",
      })
      .returning()
      .get();
  }

  createBranch(input: {
    caseId: string;
    name: string;
    description?: string;
    parentBranchId?: string | null;
  }): BranchRow {
    if (input.parentBranchId) {
      const parent = this.connection.db
        .select({ caseId: reasoningBranches.caseId })
        .from(reasoningBranches)
        .where(
          and(
            eq(reasoningBranches.id, input.parentBranchId),
            eq(reasoningBranches.caseId, input.caseId),
          ),
        )
        .get();

      if (!parent) {
        throw new Error("Parent branch must belong to the same case.");
      }
    }

    return this.connection.db
      .insert(reasoningBranches)
      .values({
        id: randomUUID(),
        caseId: input.caseId,
        name: requireText(input.name, "Branch name"),
        description: input.description?.trim() ?? "",
        parentBranchId: input.parentBranchId ?? null,
      })
      .returning()
      .get();
  }

  createSource(input: {
    caseId: string;
    title: string;
    kind?: SourceRow["kind"];
    locator?: string | null;
    excerpt?: string | null;
    notes?: string;
  }): SourceRow {
    return this.connection.db
      .insert(sources)
      .values({
        id: randomUUID(),
        caseId: input.caseId,
        title: requireText(input.title, "Source title"),
        kind: input.kind ?? "user",
        locator: input.locator?.trim() || null,
        excerpt: input.excerpt?.trim() || null,
        notes: input.notes?.trim() ?? "",
      })
      .returning()
      .get();
  }
}

function requireText(value: string, label: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }

  return normalized;
}

function normalizeAlias(alias: string) {
  return alias.normalize("NFKC").toLocaleLowerCase();
}

function assertPercentage(value: number | null | undefined, label: string) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error(`${label} must be an integer between 0 and 100.`);
  }
}
