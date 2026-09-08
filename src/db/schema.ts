import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const caseStatuses = ["active", "archived"] as const;
export const timelineModes = ["relative", "calendar", "ordinal"] as const;
export const aliasKinds = ["name", "code", "description", "unknown"] as const;
export const eventTimeKinds = [
  "exact",
  "range",
  "approximate",
  "relative",
  "unknown",
] as const;
export const participantRoles = [
  "actor",
  "witness",
  "victim",
  "present",
  "mentioned",
  "other",
] as const;
export const presenceStatuses = [
  "confirmed",
  "claimed",
  "possible",
  "denied",
] as const;
export const sourceKinds = [
  "narration",
  "chapter",
  "statement",
  "document",
  "image",
  "user",
  "other",
] as const;
export const branchStatuses = ["active", "archived"] as const;
export const claimKinds = [
  "fact",
  "statement",
  "hypothesis",
  "inference",
] as const;
export const claimStatuses = [
  "draft",
  "accepted",
  "rejected",
  "needs_review",
  "superseded",
] as const;
export const actorKinds = ["user", "ai"] as const;
export const sourceRelationKinds = [
  "origin",
  "supports",
  "contradicts",
] as const;
export const claimRelationKinds = [
  "supports",
  "contradicts",
  "depends_on",
  "qualifies",
] as const;
export const claimEntityRoles = [
  "subject",
  "object",
  "speaker",
  "context",
  "mentioned",
] as const;

const nowInMilliseconds = sql`(unixepoch() * 1000)`;

export const cases = sqliteTable(
  "cases",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: caseStatuses }).notNull().default("active"),
    timelineMode: text("timeline_mode", { enum: timelineModes })
      .notNull()
      .default("relative"),
    timelineOriginLabel: text("timeline_origin_label"),
    timelineOriginAt: integer("timeline_origin_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    check(
      "cases_status_check",
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      "cases_timeline_mode_check",
      sql`${table.timelineMode} in ('relative', 'calendar', 'ordinal')`,
    ),
  ],
);

export const people = sqliteTable(
  "people",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("people_case_idx").on(table.caseId),
    index("people_case_name_idx").on(table.caseId, table.displayName),
  ],
);

export const personAliases = sqliteTable(
  "person_aliases",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    kind: text("kind", { enum: aliasKinds }).notNull().default("name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("person_aliases_person_normalized_unique").on(
      table.personId,
      table.normalizedAlias,
    ),
    index("person_aliases_normalized_idx").on(table.normalizedAlias),
    check(
      "person_aliases_kind_check",
      sql`${table.kind} in ('name', 'code', 'description', 'unknown')`,
    ),
  ],
);

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    parentLocationId: text("parent_location_id").references(
      (): AnySQLiteColumn => locations.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("locations_case_idx").on(table.caseId),
    index("locations_parent_idx").on(table.parentLocationId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    locationId: text("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    anchorEventId: text("anchor_event_id").references(
      (): AnySQLiteColumn => events.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    timeKind: text("time_kind", { enum: eventTimeKinds })
      .notNull()
      .default("unknown"),
    startOffsetSeconds: integer("start_offset_seconds"),
    endOffsetSeconds: integer("end_offset_seconds"),
    relativeOffsetSeconds: integer("relative_offset_seconds"),
    displayTime: text("display_time"),
    certainty: integer("certainty"),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("events_case_timeline_idx").on(
      table.caseId,
      table.archivedAt,
      table.startOffsetSeconds,
      table.sortOrder,
    ),
    index("events_location_idx").on(table.locationId),
    index("events_anchor_idx").on(table.anchorEventId),
    check(
      "events_time_kind_check",
      sql`${table.timeKind} in ('exact', 'range', 'approximate', 'relative', 'unknown')`,
    ),
    check(
      "events_range_check",
      sql`${table.startOffsetSeconds} is null or ${table.endOffsetSeconds} is null or ${table.endOffsetSeconds} >= ${table.startOffsetSeconds}`,
    ),
    check(
      "events_certainty_check",
      sql`${table.certainty} is null or (${table.certainty} >= 0 and ${table.certainty} <= 100)`,
    ),
    check("events_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const eventParticipants = sqliteTable(
  "event_participants",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role", { enum: participantRoles }).notNull().default("present"),
    presence: text("presence", { enum: presenceStatuses })
      .notNull()
      .default("confirmed"),
    notes: text("notes").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.personId, table.role] }),
    index("event_participants_person_idx").on(table.personId),
    check(
      "event_participants_role_check",
      sql`${table.role} in ('actor', 'witness', 'victim', 'present', 'mentioned', 'other')`,
    ),
    check(
      "event_participants_presence_check",
      sql`${table.presence} in ('confirmed', 'claimed', 'possible', 'denied')`,
    ),
  ],
);

export const eventRevisions = sqliteTable(
  "event_revisions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    snapshot: text("snapshot").notNull(),
    changedBy: text("changed_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    changedAt: integer("changed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("event_revisions_event_revision_unique").on(
      table.eventId,
      table.revision,
    ),
    index("event_revisions_event_idx").on(table.eventId),
    check("event_revisions_revision_check", sql`${table.revision} >= 1`),
    check(
      "event_revisions_changed_by_check",
      sql`${table.changedBy} in ('user', 'ai')`,
    ),
  ],
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: sourceKinds }).notNull().default("user"),
    title: text("title").notNull(),
    locator: text("locator"),
    excerpt: text("excerpt"),
    notes: text("notes").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("sources_case_idx").on(table.caseId),
    check(
      "sources_kind_check",
      sql`${table.kind} in ('narration', 'chapter', 'statement', 'document', 'image', 'user', 'other')`,
    ),
  ],
);

export const eventSources = sqliteTable(
  "event_sources",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: sourceRelationKinds })
      .notNull()
      .default("origin"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.sourceId, table.relation] }),
    index("event_sources_source_idx").on(table.sourceId),
    check(
      "event_sources_relation_check",
      sql`${table.relation} in ('origin', 'supports', 'contradicts')`,
    ),
  ],
);

export const reasoningBranches = sqliteTable(
  "reasoning_branches",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    parentBranchId: text("parent_branch_id").references(
      (): AnySQLiteColumn => reasoningBranches.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: branchStatuses })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("reasoning_branches_case_name_unique").on(
      table.caseId,
      table.name,
    ),
    index("reasoning_branches_parent_idx").on(table.parentBranchId),
    check(
      "reasoning_branches_status_check",
      sql`${table.status} in ('active', 'archived')`,
    ),
  ],
);

export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    branchId: text("branch_id").references(() => reasoningBranches.id, {
      onDelete: "restrict",
    }),
    speakerPersonId: text("speaker_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: claimKinds }).notNull(),
    status: text("status", { enum: claimStatuses }).notNull().default("draft"),
    content: text("content").notNull(),
    confidence: integer("confidence"),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("claims_case_status_idx").on(table.caseId, table.status),
    index("claims_branch_idx").on(table.branchId),
    index("claims_speaker_idx").on(table.speakerPersonId),
    check(
      "claims_kind_check",
      sql`${table.kind} in ('fact', 'statement', 'hypothesis', 'inference')`,
    ),
    check(
      "claims_status_check",
      sql`${table.status} in ('draft', 'accepted', 'rejected', 'needs_review', 'superseded')`,
    ),
    check(
      "claims_created_by_check",
      sql`${table.createdBy} in ('user', 'ai')`,
    ),
    check(
      "claims_confidence_check",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 100)`,
    ),
    check("claims_revision_check", sql`${table.revision} >= 1`),
    check(
      "claims_fact_branch_check",
      sql`${table.kind} <> 'fact' or ${table.branchId} is null`,
    ),
  ],
);

export const claimSources = sqliteTable(
  "claim_sources",
  {
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: sourceRelationKinds })
      .notNull()
      .default("origin"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.sourceId, table.relation] }),
    index("claim_sources_source_idx").on(table.sourceId),
    check(
      "claim_sources_relation_check",
      sql`${table.relation} in ('origin', 'supports', 'contradicts')`,
    ),
  ],
);

export const claimLinks = sqliteTable(
  "claim_links",
  {
    id: text("id").primaryKey(),
    premiseClaimId: text("premise_claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    conclusionClaimId: text("conclusion_claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: claimRelationKinds }).notNull(),
    premiseRevision: integer("premise_revision").notNull(),
    rationale: text("rationale").notNull().default(""),
    strength: integer("strength"),
    createdBy: text("created_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("claim_links_edge_unique").on(
      table.premiseClaimId,
      table.conclusionClaimId,
      table.relation,
    ),
    index("claim_links_conclusion_idx").on(table.conclusionClaimId),
    check(
      "claim_links_relation_check",
      sql`${table.relation} in ('supports', 'contradicts', 'depends_on', 'qualifies')`,
    ),
    check(
      "claim_links_not_self_check",
      sql`${table.premiseClaimId} <> ${table.conclusionClaimId}`,
    ),
    check(
      "claim_links_strength_check",
      sql`${table.strength} is null or (${table.strength} >= 0 and ${table.strength} <= 100)`,
    ),
    check("claim_links_revision_check", sql`${table.premiseRevision} >= 1`),
  ],
);

export const claimRevisions = sqliteTable(
  "claim_revisions",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    snapshot: text("snapshot").notNull(),
    changedBy: text("changed_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    changedAt: integer("changed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("claim_revisions_claim_revision_unique").on(
      table.claimId,
      table.revision,
    ),
    check("claim_revisions_revision_check", sql`${table.revision} >= 1`),
    check(
      "claim_revisions_changed_by_check",
      sql`${table.changedBy} in ('user', 'ai')`,
    ),
  ],
);

export const claimPeople = sqliteTable(
  "claim_people",
  {
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role", { enum: claimEntityRoles }).notNull().default("subject"),
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.personId, table.role] }),
    index("claim_people_person_idx").on(table.personId),
  ],
);

export const claimEvents = sqliteTable(
  "claim_events",
  {
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    eventRevision: integer("event_revision").notNull().default(1),
    role: text("role", { enum: claimEntityRoles }).notNull().default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.eventId, table.role] }),
    index("claim_events_event_idx").on(table.eventId),
    check("claim_events_revision_check", sql`${table.eventRevision} >= 1`),
  ],
);

export const claimLocations = sqliteTable(
  "claim_locations",
  {
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    role: text("role", { enum: claimEntityRoles }).notNull().default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.locationId, table.role] }),
    index("claim_locations_location_idx").on(table.locationId),
  ],
);

export type ClaimKind = (typeof claimKinds)[number];
export type ClaimStatus = (typeof claimStatuses)[number];
export type ClaimRelationKind = (typeof claimRelationKinds)[number];
export type ActorKind = (typeof actorKinds)[number];
