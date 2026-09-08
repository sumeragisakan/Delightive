import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { DatabaseConnection } from "../connection";
import {
  type ActorKind,
  type ClaimEntityRole,
  type ClaimStatus,
  type SourceKind,
  type SourceRelationKind,
  cases,
  claimEvents,
  claimLocations,
  claimPeople,
  claimRevisions,
  claimSources,
  claims,
  events,
  locations,
  people,
  sourceRevisions,
  sources,
} from "../schema";
import {
  invalidateClaimsForSource,
  invalidateDownstreamClaims,
} from "../services/invalidation-service";

type SourceRow = typeof sources.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;
type EvidenceKind = Extract<ClaimRow["kind"], "fact" | "statement">;

export type EvidenceSource = SourceRow & {
  dependentClaimCount: number;
};

export type EvidenceClaim = ClaimRow & {
  downstreamClaimCount: number;
  events: Array<{
    event: typeof events.$inferSelect;
    eventRevision: number;
    isStale: boolean;
    role: ClaimEntityRole;
  }>;
  locations: Array<{
    location: typeof locations.$inferSelect;
    role: ClaimEntityRole;
  }>;
  people: Array<{
    person: typeof people.$inferSelect;
    role: ClaimEntityRole;
  }>;
  sources: Array<{
    isStale: boolean;
    relation: SourceRelationKind;
    source: SourceRow;
    sourceRevision: number;
  }>;
  speaker: typeof people.$inferSelect | null;
};

export class EvidenceRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  listSources(caseId: string, includeArchived = true): EvidenceSource[] {
    return this.connection.db
      .select()
      .from(sources)
      .where(eq(sources.caseId, caseId))
      .orderBy(asc(sources.archivedAt), desc(sources.updatedAt))
      .all()
      .filter((source) => includeArchived || source.archivedAt === null)
      .map((source) => ({
        ...source,
        dependentClaimCount: this.connection.db
          .select({ claimId: claimSources.claimId })
          .from(claimSources)
          .where(eq(claimSources.sourceId, source.id))
          .all().length,
      }));
  }

  createSource(input: {
    caseId: string;
    title: string;
    kind?: SourceKind;
    locator?: string | null;
    excerpt?: string | null;
    notes?: string;
  }): SourceRow {
    this.assertCaseExists(input.caseId);

    const create = this.connection.sqlite.transaction(() => {
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
    });

    return create();
  }

  updateSource(
    caseId: string,
    sourceId: string,
    input: {
      title: string;
      kind: SourceKind;
      locator?: string | null;
      excerpt?: string | null;
      notes?: string;
      changedBy?: ActorKind;
    },
  ) {
    const current = this.getSourceOrThrow(sourceId, caseId);
    this.assertSourceActive(current);

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordSourceRevision(current, changedAt, input.changedBy ?? "user");
      const source = this.connection.db
        .update(sources)
        .set({
          title: requireText(input.title, "Source title"),
          kind: input.kind,
          locator: input.locator?.trim() || null,
          excerpt: input.excerpt?.trim() || null,
          notes: input.notes?.trim() ?? "",
          revision: current.revision + 1,
          updatedAt: changedAt,
        })
        .where(eq(sources.id, sourceId))
        .returning()
        .get();
      const invalidatedClaimIds = invalidateClaimsForSource(
        this.connection,
        sourceId,
        changedAt,
      );

      this.touchCase(caseId, changedAt);
      return { invalidatedClaimIds, source };
    });

    return revise();
  }

  setSourceArchived(
    caseId: string,
    sourceId: string,
    archived: boolean,
    changedBy: ActorKind = "user",
  ) {
    const current = this.getSourceOrThrow(sourceId, caseId);

    if ((current.archivedAt !== null) === archived) {
      return { invalidatedClaimIds: [] as string[], source: current };
    }

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordSourceRevision(current, changedAt, changedBy);
      const source = this.connection.db
        .update(sources)
        .set({
          archivedAt: archived ? changedAt : null,
          revision: current.revision + 1,
          updatedAt: changedAt,
        })
        .where(eq(sources.id, sourceId))
        .returning()
        .get();
      const invalidatedClaimIds = invalidateClaimsForSource(
        this.connection,
        sourceId,
        changedAt,
      );

      this.touchCase(caseId, changedAt);
      return { invalidatedClaimIds, source };
    });

    return revise();
  }

  listEvidenceClaims(
    caseId: string,
    includeArchived = true,
  ): EvidenceClaim[] {
    return this.connection.db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.caseId, caseId),
          inArray(claims.kind, ["fact", "statement"]),
        ),
      )
      .orderBy(asc(claims.archivedAt), desc(claims.updatedAt))
      .all()
      .filter((claim) => includeArchived || claim.archivedAt === null)
      .map((claim) => this.hydrateClaim(claim));
  }

  createEvidenceClaim(input: {
    caseId: string;
    content: string;
    kind: EvidenceKind;
    status?: ClaimStatus;
    confidence?: number | null;
    speakerPersonId?: string | null;
    sourceId?: string | null;
    sourceRelation?: SourceRelationKind;
    eventId?: string | null;
    eventRole?: ClaimEntityRole;
    personId?: string | null;
    personRole?: ClaimEntityRole;
    locationId?: string | null;
    locationRole?: ClaimEntityRole;
    createdBy?: ActorKind;
  }): ClaimRow {
    this.assertCaseExists(input.caseId);
    assertPercentage(input.confidence, "Claim confidence");
    this.assertSpeaker(input.caseId, input.kind, input.speakerPersonId ?? null);
    const source = input.sourceId
      ? this.getActiveSourceForCase(input.sourceId, input.caseId)
      : null;
    const event = input.eventId
      ? this.getActiveEventForCase(input.eventId, input.caseId)
      : null;
    const person = input.personId
      ? this.getPersonForCase(input.personId, input.caseId)
      : null;
    const location = input.locationId
      ? this.getLocationForCase(input.locationId, input.caseId)
      : null;
    const sourceRelation = input.sourceRelation ?? "origin";
    const status = input.status ?? "draft";

    if (
      status === "accepted" &&
      (!source || sourceRelation === "contradicts")
    ) {
      throw new Error("Accepted evidence requires an active provenance source.");
    }

    const create = this.connection.sqlite.transaction(() => {
      const claim = this.connection.db
        .insert(claims)
        .values({
          id: randomUUID(),
          caseId: input.caseId,
          content: requireText(input.content, "Claim content"),
          kind: input.kind,
          status,
          confidence: input.confidence ?? null,
          speakerPersonId:
            input.kind === "statement" ? (input.speakerPersonId ?? null) : null,
          createdBy: input.createdBy ?? "user",
        })
        .returning()
        .get();

      if (source) {
        this.connection.db
          .insert(claimSources)
          .values({
            claimId: claim.id,
            sourceId: source.id,
            sourceRevision: source.revision,
            relation: sourceRelation,
          })
          .run();
      }
      if (event) {
        this.connection.db
          .insert(claimEvents)
          .values({
            claimId: claim.id,
            eventId: event.id,
            eventRevision: event.revision,
            role: input.eventRole ?? "context",
          })
          .run();
      }
      if (person) {
        this.connection.db
          .insert(claimPeople)
          .values({
            claimId: claim.id,
            personId: person.id,
            role: input.personRole ?? "subject",
          })
          .run();
      }
      if (location) {
        this.connection.db
          .insert(claimLocations)
          .values({
            claimId: claim.id,
            locationId: location.id,
            role: input.locationRole ?? "context",
          })
          .run();
      }

      this.touchCase(input.caseId);
      return claim;
    });

    return create();
  }

  updateEvidenceClaim(
    caseId: string,
    claimId: string,
    input: {
      content: string;
      status: ClaimStatus;
      confidence?: number | null;
      speakerPersonId?: string | null;
      changedBy?: ActorKind;
    },
  ) {
    const current = this.getEvidenceClaimOrThrow(claimId, caseId);
    this.assertClaimActive(current);
    assertPercentage(input.confidence, "Claim confidence");
    this.assertSpeaker(caseId, current.kind, input.speakerPersonId ?? null);

    if (input.status === "accepted" && !this.hasActiveProvenance(claimId)) {
      throw new Error("Accepted evidence requires an active provenance source.");
    }

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordClaimRevision(current, changedAt, input.changedBy ?? "user");
      const claim = this.connection.db
        .update(claims)
        .set({
          content: requireText(input.content, "Claim content"),
          status: input.status,
          confidence: input.confidence ?? null,
          speakerPersonId:
            current.kind === "statement"
              ? (input.speakerPersonId ?? null)
              : null,
          revision: current.revision + 1,
          updatedAt: changedAt,
        })
        .where(eq(claims.id, claimId))
        .returning()
        .get();
      const invalidatedClaimIds = invalidateDownstreamClaims(
        this.connection,
        claimId,
        changedAt,
      );

      this.refreshDependencyVersions(claimId);
      this.touchCase(caseId, changedAt);
      return { claim, invalidatedClaimIds };
    });

    return revise();
  }

  setClaimArchived(
    caseId: string,
    claimId: string,
    archived: boolean,
    changedBy: ActorKind = "user",
  ) {
    const current = this.getEvidenceClaimOrThrow(claimId, caseId);

    if ((current.archivedAt !== null) === archived) {
      return { claim: current, invalidatedClaimIds: [] as string[] };
    }
    if (!archived && current.status === "accepted" && !this.hasActiveProvenance(claimId)) {
      throw new Error("Accepted evidence requires an active provenance source.");
    }

    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordClaimRevision(current, changedAt, changedBy);
      const claim = this.connection.db
        .update(claims)
        .set({
          archivedAt: archived ? changedAt : null,
          revision: current.revision + 1,
          updatedAt: changedAt,
        })
        .where(eq(claims.id, claimId))
        .returning()
        .get();
      const invalidatedClaimIds = invalidateDownstreamClaims(
        this.connection,
        claimId,
        changedAt,
      );

      this.touchCase(caseId, changedAt);
      return { claim, invalidatedClaimIds };
    });

    return revise();
  }

  addSourceLink(input: {
    caseId: string;
    claimId: string;
    sourceId: string;
    relation?: SourceRelationKind;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    const source = this.getActiveSourceForCase(input.sourceId, input.caseId);

    return this.reviseClaimAggregate(claim, input.changedBy, () =>
      this.connection.db
        .insert(claimSources)
        .values({
          claimId: claim.id,
          sourceId: source.id,
          sourceRevision: source.revision,
          relation: input.relation ?? "origin",
        })
        .returning()
        .get(),
    );
  }

  removeSourceLink(input: {
    caseId: string;
    claimId: string;
    sourceId: string;
    relation: SourceRelationKind;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    this.assertSourceLinkExists(claim.id, input.sourceId, input.relation);

    if (
      claim.status === "accepted" &&
      input.relation !== "contradicts" &&
      !this.hasActiveProvenance(claim.id, {
        relation: input.relation,
        sourceId: input.sourceId,
      })
    ) {
      throw new Error("Accepted evidence must keep at least one active source.");
    }

    return this.reviseClaimAggregate(claim, input.changedBy, () => {
      this.connection.db
        .delete(claimSources)
        .where(
          and(
            eq(claimSources.claimId, claim.id),
            eq(claimSources.sourceId, input.sourceId),
            eq(claimSources.relation, input.relation),
          ),
        )
        .run();
      return { removed: true as const };
    });
  }

  addEventLink(input: {
    caseId: string;
    claimId: string;
    eventId: string;
    role?: ClaimEntityRole;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    const event = this.getActiveEventForCase(input.eventId, input.caseId);

    return this.reviseClaimAggregate(claim, input.changedBy, () =>
      this.connection.db
        .insert(claimEvents)
        .values({
          claimId: claim.id,
          eventId: event.id,
          eventRevision: event.revision,
          role: input.role ?? "context",
        })
        .returning()
        .get(),
    );
  }

  removeEventLink(input: {
    caseId: string;
    claimId: string;
    eventId: string;
    role: ClaimEntityRole;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    this.assertCompositeLinkExists(
      "claim_events",
      claim.id,
      "event_id",
      input.eventId,
      input.role,
    );

    return this.reviseClaimAggregate(claim, input.changedBy, () => {
      this.connection.db
        .delete(claimEvents)
        .where(
          and(
            eq(claimEvents.claimId, claim.id),
            eq(claimEvents.eventId, input.eventId),
            eq(claimEvents.role, input.role),
          ),
        )
        .run();
      return { removed: true as const };
    });
  }

  addPersonLink(input: {
    caseId: string;
    claimId: string;
    personId: string;
    role?: ClaimEntityRole;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    const person = this.getPersonForCase(input.personId, input.caseId);

    return this.reviseClaimAggregate(claim, input.changedBy, () =>
      this.connection.db
        .insert(claimPeople)
        .values({
          claimId: claim.id,
          personId: person.id,
          role: input.role ?? "subject",
        })
        .returning()
        .get(),
    );
  }

  removePersonLink(input: {
    caseId: string;
    claimId: string;
    personId: string;
    role: ClaimEntityRole;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    this.assertCompositeLinkExists(
      "claim_people",
      claim.id,
      "person_id",
      input.personId,
      input.role,
    );

    return this.reviseClaimAggregate(claim, input.changedBy, () => {
      this.connection.db
        .delete(claimPeople)
        .where(
          and(
            eq(claimPeople.claimId, claim.id),
            eq(claimPeople.personId, input.personId),
            eq(claimPeople.role, input.role),
          ),
        )
        .run();
      return { removed: true as const };
    });
  }

  addLocationLink(input: {
    caseId: string;
    claimId: string;
    locationId: string;
    role?: ClaimEntityRole;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    const location = this.getLocationForCase(input.locationId, input.caseId);

    return this.reviseClaimAggregate(claim, input.changedBy, () =>
      this.connection.db
        .insert(claimLocations)
        .values({
          claimId: claim.id,
          locationId: location.id,
          role: input.role ?? "context",
        })
        .returning()
        .get(),
    );
  }

  removeLocationLink(input: {
    caseId: string;
    claimId: string;
    locationId: string;
    role: ClaimEntityRole;
    changedBy?: ActorKind;
  }) {
    const claim = this.getEvidenceClaimOrThrow(input.claimId, input.caseId);
    this.assertClaimActive(claim);
    this.assertCompositeLinkExists(
      "claim_locations",
      claim.id,
      "location_id",
      input.locationId,
      input.role,
    );

    return this.reviseClaimAggregate(claim, input.changedBy, () => {
      this.connection.db
        .delete(claimLocations)
        .where(
          and(
            eq(claimLocations.claimId, claim.id),
            eq(claimLocations.locationId, input.locationId),
            eq(claimLocations.role, input.role),
          ),
        )
        .run();
      return { removed: true as const };
    });
  }

  private hydrateClaim(claim: ClaimRow): EvidenceClaim {
    const sourceLinks = this.connection.db
      .select({ link: claimSources, source: sources })
      .from(claimSources)
      .innerJoin(sources, eq(claimSources.sourceId, sources.id))
      .where(eq(claimSources.claimId, claim.id))
      .all()
      .map(({ link, source }) => ({
        isStale:
          link.sourceRevision !== source.revision || source.archivedAt !== null,
        relation: link.relation,
        source,
        sourceRevision: link.sourceRevision,
      }));
    const eventLinks = this.connection.db
      .select({ event: events, link: claimEvents })
      .from(claimEvents)
      .innerJoin(events, eq(claimEvents.eventId, events.id))
      .where(eq(claimEvents.claimId, claim.id))
      .all()
      .map(({ event, link }) => ({
        event,
        eventRevision: link.eventRevision,
        isStale:
          link.eventRevision !== event.revision || event.archivedAt !== null,
        role: link.role,
      }));
    const personLinks = this.connection.db
      .select({ link: claimPeople, person: people })
      .from(claimPeople)
      .innerJoin(people, eq(claimPeople.personId, people.id))
      .where(eq(claimPeople.claimId, claim.id))
      .all()
      .map(({ link, person }) => ({ person, role: link.role }));
    const locationLinks = this.connection.db
      .select({ link: claimLocations, location: locations })
      .from(claimLocations)
      .innerJoin(locations, eq(claimLocations.locationId, locations.id))
      .where(eq(claimLocations.claimId, claim.id))
      .all()
      .map(({ link, location }) => ({ location, role: link.role }));
    const speaker = claim.speakerPersonId
      ? (this.connection.db
          .select()
          .from(people)
          .where(eq(people.id, claim.speakerPersonId))
          .get() ?? null)
      : null;

    return {
      ...claim,
      downstreamClaimCount: this.countDownstreamClaims(claim.id),
      events: eventLinks,
      locations: locationLinks,
      people: personLinks,
      sources: sourceLinks,
      speaker,
    };
  }

  private getSourceOrThrow(sourceId: string, caseId?: string): SourceRow {
    const source = this.connection.db
      .select()
      .from(sources)
      .where(eq(sources.id, sourceId))
      .get();

    if (!source || (caseId && source.caseId !== caseId)) {
      throw new Error("Source must belong to the requested case.");
    }

    return source;
  }

  private getActiveSourceForCase(sourceId: string, caseId: string) {
    const source = this.getSourceOrThrow(sourceId, caseId);
    this.assertSourceActive(source);
    return source;
  }

  private getEvidenceClaimOrThrow(
    claimId: string,
    caseId: string,
  ): ClaimRow & { kind: EvidenceKind } {
    const claim = this.connection.db
      .select()
      .from(claims)
      .where(eq(claims.id, claimId))
      .get();

    if (
      !claim ||
      claim.caseId !== caseId ||
      (claim.kind !== "fact" && claim.kind !== "statement")
    ) {
      throw new Error("Evidence claim must belong to the requested case.");
    }

    return claim as ClaimRow & { kind: EvidenceKind };
  }

  private getActiveEventForCase(eventId: string, caseId: string) {
    const event = this.connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .get();

    if (!event || event.caseId !== caseId || event.archivedAt !== null) {
      throw new Error("Event must be active and belong to the same case.");
    }

    return event;
  }

  private getPersonForCase(personId: string, caseId: string) {
    const person = this.connection.db
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .get();

    if (!person || person.caseId !== caseId) {
      throw new Error("Person must belong to the same case.");
    }

    return person;
  }

  private getLocationForCase(locationId: string, caseId: string) {
    const location = this.connection.db
      .select()
      .from(locations)
      .where(eq(locations.id, locationId))
      .get();

    if (!location || location.caseId !== caseId) {
      throw new Error("Location must belong to the same case.");
    }

    return location;
  }

  private assertSpeaker(
    caseId: string,
    kind: EvidenceKind,
    speakerPersonId: string | null,
  ) {
    if (kind === "fact" && speakerPersonId) {
      throw new Error("Facts cannot have a speaker; use a statement instead.");
    }
    if (speakerPersonId) {
      this.getPersonForCase(speakerPersonId, caseId);
    }
  }

  private assertSourceActive(source: SourceRow) {
    if (source.archivedAt) {
      throw new Error("Archived sources must be restored before use.");
    }
  }

  private assertClaimActive(claim: ClaimRow) {
    if (claim.archivedAt) {
      throw new Error("Archived evidence must be restored before editing.");
    }
  }

  private hasActiveProvenance(
    claimId: string,
    excluding?: { sourceId: string; relation: SourceRelationKind },
  ) {
    const row = this.connection.sqlite
      .prepare(
        `
          select 1
          from claim_sources
          join sources on sources.id = claim_sources.source_id
          where claim_sources.claim_id = ?
            and claim_sources.relation in ('origin', 'supports')
            and sources.archived_at is null
            and not (
              claim_sources.source_id = ?
              and claim_sources.relation = ?
            )
          limit 1
        `,
      )
      .get(
        claimId,
        excluding?.sourceId ?? "",
        excluding?.relation ?? "contradicts",
      );

    return row !== undefined;
  }

  private reviseClaimAggregate<T>(
    claim: ClaimRow,
    changedBy: ActorKind | undefined,
    mutation: () => T,
  ) {
    const revise = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordClaimRevision(claim, changedAt, changedBy ?? "user");
      const result = mutation();
      const updatedClaim = this.connection.db
        .update(claims)
        .set({ revision: claim.revision + 1, updatedAt: changedAt })
        .where(eq(claims.id, claim.id))
        .returning()
        .get();
      const invalidatedClaimIds = invalidateDownstreamClaims(
        this.connection,
        claim.id,
        changedAt,
      );

      this.refreshDependencyVersions(claim.id);
      this.touchCase(claim.caseId, changedAt);
      return { claim: updatedClaim, invalidatedClaimIds, result };
    });

    return revise();
  }

  private recordSourceRevision(
    source: SourceRow,
    changedAt: Date,
    changedBy: ActorKind,
  ) {
    this.connection.db
      .insert(sourceRevisions)
      .values({
        id: randomUUID(),
        sourceId: source.id,
        revision: source.revision,
        snapshot: JSON.stringify(source),
        changedAt,
        changedBy,
      })
      .run();
  }

  private recordClaimRevision(
    claim: ClaimRow,
    changedAt: Date,
    changedBy: ActorKind,
  ) {
    const snapshot = {
      claim,
      events: this.connection.db
        .select()
        .from(claimEvents)
        .where(eq(claimEvents.claimId, claim.id))
        .all(),
      locations: this.connection.db
        .select()
        .from(claimLocations)
        .where(eq(claimLocations.claimId, claim.id))
        .all(),
      people: this.connection.db
        .select()
        .from(claimPeople)
        .where(eq(claimPeople.claimId, claim.id))
        .all(),
      sources: this.connection.db
        .select()
        .from(claimSources)
        .where(eq(claimSources.claimId, claim.id))
        .all(),
    };

    this.connection.db
      .insert(claimRevisions)
      .values({
        id: randomUUID(),
        claimId: claim.id,
        revision: claim.revision,
        snapshot: JSON.stringify(snapshot),
        changedAt,
        changedBy,
      })
      .run();
  }

  private refreshDependencyVersions(claimId: string) {
    this.connection.sqlite
      .prepare(
        `
          update claim_sources
          set source_revision = (
            select revision from sources
            where sources.id = claim_sources.source_id
          )
          where claim_id = ?
        `,
      )
      .run(claimId);
    this.connection.sqlite
      .prepare(
        `
          update claim_events
          set event_revision = (
            select revision from events
            where events.id = claim_events.event_id
          )
          where claim_id = ?
        `,
      )
      .run(claimId);
  }

  private assertSourceLinkExists(
    claimId: string,
    sourceId: string,
    relation: SourceRelationKind,
  ) {
    const link = this.connection.db
      .select({ claimId: claimSources.claimId })
      .from(claimSources)
      .where(
        and(
          eq(claimSources.claimId, claimId),
          eq(claimSources.sourceId, sourceId),
          eq(claimSources.relation, relation),
        ),
      )
      .get();

    if (!link) {
      throw new Error("Claim source link not found.");
    }
  }

  private assertCompositeLinkExists(
    table: "claim_events" | "claim_locations" | "claim_people",
    claimId: string,
    entityColumn: "event_id" | "location_id" | "person_id",
    entityId: string,
    role: ClaimEntityRole,
  ) {
    const link = this.connection.sqlite
      .prepare(
        `select 1 from ${table}
         where claim_id = ? and ${entityColumn} = ? and role = ?
         limit 1`,
      )
      .get(claimId, entityId, role);

    if (!link) {
      throw new Error("Claim entity link not found.");
    }
  }

  private countDownstreamClaims(claimId: string) {
    const row = this.connection.sqlite
      .prepare(
        `
          with recursive downstream(id) as (
            select conclusion_claim_id
            from claim_links
            where premise_claim_id = ?
            union
            select links.conclusion_claim_id
            from claim_links as links
            join downstream on links.premise_claim_id = downstream.id
          )
          select count(*) as value from downstream
        `,
      )
      .get(claimId) as { value: number };

    return row.value;
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

  private touchCase(caseId: string, updatedAt = new Date()) {
    this.connection.db
      .update(cases)
      .set({ updatedAt })
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

function assertPercentage(value: number | null | undefined, label: string) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error(`${label} must be an integer between 0 and 100.`);
  }
}
