import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

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

export type CaseSummary = CaseRow & {
  claimCount: number;
  eventCount: number;
  peopleCount: number;
};

export type PersonWithAliases = PersonRow & {
  aliases: PersonAliasRow[];
};

export class CaseRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  listCases(): CaseSummary[] {
    return this.connection.db
      .select()
      .from(cases)
      .orderBy(asc(cases.status), desc(cases.updatedAt))
      .all()
      .map((caseFile) => ({
        ...caseFile,
        claimCount: this.countRows("claims", caseFile.id),
        eventCount: this.countRows("events", caseFile.id),
        peopleCount: this.countRows("people", caseFile.id),
      }));
  }

  getCase(caseId: string): CaseRow | undefined {
    return this.connection.db
      .select()
      .from(cases)
      .where(eq(cases.id, caseId))
      .get();
  }

  getCaseSummary(caseId: string): CaseSummary | undefined {
    const caseFile = this.getCase(caseId);

    if (!caseFile) {
      return undefined;
    }

    return {
      ...caseFile,
      claimCount: this.countRows("claims", caseId),
      eventCount: this.countRows("events", caseId),
      peopleCount: this.countRows("people", caseId),
    };
  }

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

  updateCase(
    caseId: string,
    input: {
      title: string;
      description?: string;
      timelineMode: CaseRow["timelineMode"];
    },
  ): CaseRow {
    const updated = this.connection.db
      .update(cases)
      .set({
        title: requireText(input.title, "Case title"),
        description: input.description?.trim() ?? "",
        timelineMode: input.timelineMode,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseId))
      .returning()
      .get();

    if (!updated) {
      throw new Error(`Case not found: ${caseId}`);
    }

    return updated;
  }

  setCaseStatus(caseId: string, status: CaseRow["status"]): CaseRow {
    const updated = this.connection.db
      .update(cases)
      .set({ status, updatedAt: new Date() })
      .where(eq(cases.id, caseId))
      .returning()
      .get();

    if (!updated) {
      throw new Error(`Case not found: ${caseId}`);
    }

    return updated;
  }

  listPeople(caseId: string): PersonWithAliases[] {
    const casePeople = this.connection.db
      .select()
      .from(people)
      .where(eq(people.caseId, caseId))
      .orderBy(asc(people.sortOrder), asc(people.createdAt))
      .all();

    if (casePeople.length === 0) {
      return [];
    }

    const aliases = this.connection.db
      .select({
        alias: personAliases,
        caseId: people.caseId,
      })
      .from(personAliases)
      .innerJoin(people, eq(personAliases.personId, people.id))
      .where(eq(people.caseId, caseId))
      .orderBy(asc(personAliases.createdAt))
      .all();
    const aliasesByPerson = new Map<string, PersonAliasRow[]>();

    for (const { alias } of aliases) {
      const current = aliasesByPerson.get(alias.personId) ?? [];
      current.push(alias);
      aliasesByPerson.set(alias.personId, current);
    }

    return casePeople.map((person) => ({
      ...person,
      aliases: aliasesByPerson.get(person.id) ?? [],
    }));
  }

  createPerson(input: {
    caseId: string;
    displayName: string;
    description?: string;
    color?: string | null;
    sortOrder?: number;
  }): PersonRow {
    const person = this.connection.db
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

    this.touchCase(input.caseId);
    return person;
  }

  updatePerson(
    caseId: string,
    personId: string,
    input: {
      displayName: string;
      description?: string;
      color?: string | null;
    },
  ): PersonRow {
    const updated = this.connection.db
      .update(people)
      .set({
        displayName: requireText(input.displayName, "Person display name"),
        description: input.description?.trim() ?? "",
        color: input.color ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(people.id, personId), eq(people.caseId, caseId)))
      .returning()
      .get();

    if (!updated) {
      throw new Error("Person must belong to the requested case.");
    }

    this.touchCase(caseId);
    return updated;
  }

  deletePerson(caseId: string, personId: string) {
    const deleted = this.connection.db
      .delete(people)
      .where(and(eq(people.id, personId), eq(people.caseId, caseId)))
      .returning({ id: people.id })
      .get();

    if (!deleted) {
      throw new Error("Person must belong to the requested case.");
    }

    this.touchCase(caseId);
  }

  addPersonAlias(input: {
    personId: string;
    alias: string;
    kind?: PersonAliasRow["kind"];
  }): PersonAliasRow {
    const person = this.connection.db
      .select({ caseId: people.caseId })
      .from(people)
      .where(eq(people.id, input.personId))
      .get();

    if (!person) {
      throw new Error(`Person not found: ${input.personId}`);
    }

    const alias = requireText(input.alias, "Alias");
    const created = this.connection.db
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

    this.touchCase(person.caseId);
    return created;
  }

  removePersonAlias(caseId: string, aliasId: string) {
    const alias = this.connection.db
      .select({
        aliasId: personAliases.id,
        caseId: people.caseId,
      })
      .from(personAliases)
      .innerJoin(people, eq(personAliases.personId, people.id))
      .where(eq(personAliases.id, aliasId))
      .get();

    if (!alias || alias.caseId !== caseId) {
      throw new Error("Alias must belong to the requested case.");
    }

    this.connection.db
      .delete(personAliases)
      .where(eq(personAliases.id, aliasId))
      .run();
    this.touchCase(caseId);
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

    const event = this.connection.db
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

    this.touchCase(input.caseId);
    return event;
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

    const participant = this.connection.db
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

    this.touchCase(event.caseId);
    return participant;
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

    const branch = this.connection.db
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

    this.touchCase(input.caseId);
    return branch;
  }

  createSource(input: {
    caseId: string;
    title: string;
    kind?: SourceRow["kind"];
    locator?: string | null;
    excerpt?: string | null;
    notes?: string;
  }): SourceRow {
    const source = this.connection.db
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

    this.touchCase(input.caseId);
    return source;
  }

  private countRows(table: "people" | "events" | "claims", caseId: string) {
    const row = this.connection.sqlite
      .prepare(`select count(*) as value from ${table} where case_id = ?`)
      .get(caseId) as { value: number };

    return row.value;
  }

  private touchCase(caseId: string) {
    this.connection.db
      .update(cases)
      .set({ updatedAt: new Date() })
      .where(eq(cases.id, caseId))
      .run();
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
