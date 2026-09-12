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
export const claimReviewDecisionKinds = [
  "promoted",
  "reconfirmed",
  "demoted",
  "rejected",
] as const;
export const conflictDecisionKinds = [
  "retained",
  "prefer_premise",
  "prefer_conclusion",
  "both_review",
  "dismissed",
] as const;
export const claimEntityRoles = [
  "subject",
  "object",
  "speaker",
  "context",
  "mentioned",
] as const;
export const reasoningRunModes = [
  "consistency_check",
  "hypothesis_expansion",
  "counterexample_search",
  "investigation_gaps",
] as const;
export const reasoningRunStatuses = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const;
export const reasoningRunErrorCodes = [
  "authentication",
  "rate_limit",
  "timeout",
  "network",
  "invalid_output",
  "provider",
  "interrupted",
] as const;
export const reasoningSuggestionKinds = [
  "hypothesis",
  "counterexample",
  "contradiction",
  "investigation_gap",
] as const;
export const reasoningSuggestionStatuses = [
  "pending",
  "accepted",
  "dismissed",
  "invalid",
] as const;
export const reasoningSuggestionResolutionKinds = [
  "hypothesis_created",
  "conflict_created",
  "investigation_created",
  "dismissed",
] as const;
export const investigationItemStatuses = [
  "pending",
  "in_progress",
  "resolved",
  "unresolved",
] as const;
export const investigationItemPriorities = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;
export const investigationItemLinkRoles = [
  "target",
  "context",
  "result",
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
    index("sources_case_evidence_idx").on(
      table.caseId,
      table.archivedAt,
      table.updatedAt,
    ),
    check(
      "sources_kind_check",
      sql`${table.kind} in ('narration', 'chapter', 'statement', 'document', 'image', 'user', 'other')`,
    ),
    check("sources_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const sourceRevisions = sqliteTable(
  "source_revisions",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
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
    uniqueIndex("source_revisions_source_revision_unique").on(
      table.sourceId,
      table.revision,
    ),
    index("source_revisions_source_idx").on(table.sourceId),
    check("source_revisions_revision_check", sql`${table.revision} >= 1`),
    check(
      "source_revisions_changed_by_check",
      sql`${table.changedBy} in ('user', 'ai')`,
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
    index("claims_case_evidence_idx").on(
      table.caseId,
      table.archivedAt,
      table.kind,
      table.status,
      table.updatedAt,
    ),
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
    sourceRevision: integer("source_revision").notNull().default(1),
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
    check("claim_sources_revision_check", sql`${table.sourceRevision} >= 1`),
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

export const claimReviews = sqliteTable(
  "claim_reviews",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    claimRevision: integer("claim_revision").notNull(),
    decision: text("decision", { enum: claimReviewDecisionKinds }).notNull(),
    premiseSnapshot: text("premise_snapshot").notNull().default("[]"),
    note: text("note").notNull().default(""),
    reviewedBy: text("reviewed_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("claim_reviews_claim_history_idx").on(
      table.claimId,
      table.reviewedAt,
    ),
    check(
      "claim_reviews_decision_check",
      sql`${table.decision} in ('promoted', 'reconfirmed', 'demoted', 'rejected')`,
    ),
    check(
      "claim_reviews_actor_check",
      sql`${table.reviewedBy} in ('user', 'ai')`,
    ),
    check(
      "claim_reviews_revision_check",
      sql`${table.claimRevision} >= 1`,
    ),
  ],
);

export const contradictionReviews = sqliteTable(
  "contradiction_reviews",
  {
    id: text("id").primaryKey(),
    claimLinkId: text("claim_link_id")
      .notNull()
      .references(() => claimLinks.id, { onDelete: "cascade" }),
    premiseRevision: integer("premise_revision").notNull(),
    conclusionRevision: integer("conclusion_revision").notNull(),
    decision: text("decision", { enum: conflictDecisionKinds }).notNull(),
    note: text("note").notNull().default(""),
    reviewedBy: text("reviewed_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("contradiction_reviews_link_history_idx").on(
      table.claimLinkId,
      table.reviewedAt,
    ),
    check(
      "contradiction_reviews_decision_check",
      sql`${table.decision} in ('retained', 'prefer_premise', 'prefer_conclusion', 'both_review', 'dismissed')`,
    ),
    check(
      "contradiction_reviews_premise_revision_check",
      sql`${table.premiseRevision} >= 1`,
    ),
    check(
      "contradiction_reviews_conclusion_revision_check",
      sql`${table.conclusionRevision} >= 1`,
    ),
    check(
      "contradiction_reviews_actor_check",
      sql`${table.reviewedBy} in ('user', 'ai')`,
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

export const reasoningRuns = sqliteTable(
  "reasoning_runs",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => reasoningBranches.id, { onDelete: "restrict" }),
    focusClaimId: text("focus_claim_id").references(() => claims.id, {
      onDelete: "set null",
    }),
    retryOfRunId: text("retry_of_run_id").references(
      (): AnySQLiteColumn => reasoningRuns.id,
      { onDelete: "set null" },
    ),
    requestKey: text("request_key"),
    mode: text("mode", { enum: reasoningRunModes }).notNull(),
    status: text("status", { enum: reasoningRunStatuses })
      .notNull()
      .default("running"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    userPrompt: text("user_prompt").notNull().default(""),
    summary: text("summary").notNull().default(""),
    remoteResponseId: text("remote_response_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code", { enum: reasoningRunErrorCodes }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("reasoning_runs_case_history_idx").on(table.caseId, table.createdAt),
    index("reasoning_runs_branch_history_idx").on(
      table.branchId,
      table.createdAt,
    ),
    index("reasoning_runs_retry_idx").on(table.retryOfRunId),
    uniqueIndex("reasoning_runs_request_key_unique").on(table.requestKey),
    check(
      "reasoning_runs_mode_check",
      sql`${table.mode} in ('consistency_check', 'hypothesis_expansion', 'counterexample_search', 'investigation_gaps')`,
    ),
    check(
      "reasoning_runs_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      "reasoning_runs_error_code_check",
      sql`${table.errorCode} is null or ${table.errorCode} in ('authentication', 'rate_limit', 'timeout', 'network', 'invalid_output', 'provider', 'interrupted')`,
    ),
    check(
      "reasoning_runs_usage_check",
      sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0) and (${table.totalTokens} is null or ${table.totalTokens} >= 0)`,
    ),
  ],
);

export const reasoningRunInputs = sqliteTable(
  "reasoning_run_inputs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reasoningRuns.id, { onDelete: "cascade" }),
    contextJson: text("context_json").notNull(),
    contextFingerprint: text("context_fingerprint").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("reasoning_run_inputs_run_unique").on(table.runId),
    index("reasoning_run_inputs_fingerprint_idx").on(table.contextFingerprint),
  ],
);

export const reasoningSuggestions = sqliteTable(
  "reasoning_suggestions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reasoningRuns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: reasoningSuggestionKinds }).notNull(),
    status: text("status", { enum: reasoningSuggestionStatuses })
      .notNull()
      .default("pending"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    rationale: text("rationale").notNull(),
    confidence: integer("confidence").notNull(),
    citationsJson: text("citations_json").notNull().default("[]"),
    validationIssuesJson: text("validation_issues_json").notNull().default("[]"),
    targetClaimId: text("target_claim_id"),
    secondaryClaimId: text("secondary_claim_id"),
    acceptedClaimId: text("accepted_claim_id").references(() => claims.id, {
      onDelete: "set null",
    }),
    acceptedClaimLinkId: text("accepted_claim_link_id").references(
      () => claimLinks.id,
      { onDelete: "set null" },
    ),
    resolutionKind: text("resolution_kind", {
      enum: reasoningSuggestionResolutionKinds,
    }),
    resolutionNote: text("resolution_note").notNull().default(""),
    resolvedBy: text("resolved_by", { enum: actorKinds }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("reasoning_suggestions_run_idx").on(table.runId),
    index("reasoning_suggestions_status_idx").on(table.status),
    check(
      "reasoning_suggestions_kind_check",
      sql`${table.kind} in ('hypothesis', 'counterexample', 'contradiction', 'investigation_gap')`,
    ),
    check(
      "reasoning_suggestions_status_check",
      sql`${table.status} in ('pending', 'accepted', 'dismissed', 'invalid')`,
    ),
    check(
      "reasoning_suggestions_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 100`,
    ),
    check(
      "reasoning_suggestions_target_pair_check",
      sql`${table.targetClaimId} is null or ${table.secondaryClaimId} is null or ${table.targetClaimId} <> ${table.secondaryClaimId}`,
    ),
    check(
      "reasoning_suggestions_resolution_kind_check",
      sql`${table.resolutionKind} is null or ${table.resolutionKind} in ('hypothesis_created', 'conflict_created', 'investigation_created', 'dismissed')`,
    ),
    check(
      "reasoning_suggestions_resolved_by_check",
      sql`${table.resolvedBy} is null or ${table.resolvedBy} in ('user', 'ai')`,
    ),
  ],
);

export const reasoningSuggestionEdits = sqliteTable(
  "reasoning_suggestion_edits",
  {
    id: text("id").primaryKey(),
    suggestionId: text("suggestion_id")
      .notNull()
      .references(() => reasoningSuggestions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    rationale: text("rationale").notNull(),
    confidence: integer("confidence").notNull(),
    citationsJson: text("citations_json").notNull(),
    targetClaimId: text("target_claim_id"),
    secondaryClaimId: text("secondary_claim_id"),
    note: text("note").notNull().default(""),
    editedBy: text("edited_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    editedAt: integer("edited_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("reasoning_suggestion_edits_revision_unique").on(
      table.suggestionId,
      table.revision,
    ),
    index("reasoning_suggestion_edits_history_idx").on(
      table.suggestionId,
      table.editedAt,
    ),
    check(
      "reasoning_suggestion_edits_revision_check",
      sql`${table.revision} >= 1`,
    ),
    check(
      "reasoning_suggestion_edits_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 100`,
    ),
    check(
      "reasoning_suggestion_edits_target_pair_check",
      sql`${table.targetClaimId} is null or ${table.secondaryClaimId} is null or ${table.targetClaimId} <> ${table.secondaryClaimId}`,
    ),
    check(
      "reasoning_suggestion_edits_actor_check",
      sql`${table.editedBy} in ('user', 'ai')`,
    ),
  ],
);

export const investigationItems = sqliteTable(
  "investigation_items",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => reasoningBranches.id, { onDelete: "restrict" }),
    originSuggestionId: text("origin_suggestion_id").references(
      () => reasoningSuggestions.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    question: text("question").notNull(),
    notes: text("notes").notNull().default(""),
    resultSummary: text("result_summary").notNull().default(""),
    status: text("status", { enum: investigationItemStatuses })
      .notNull()
      .default("pending"),
    priority: text("priority", { enum: investigationItemPriorities })
      .notNull()
      .default("normal"),
    createdBy: text("created_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("investigation_items_case_status_idx").on(table.caseId, table.status),
    index("investigation_items_branch_idx").on(table.branchId),
    uniqueIndex("investigation_items_origin_suggestion_unique").on(
      table.originSuggestionId,
    ),
    check(
      "investigation_items_status_check",
      sql`${table.status} in ('pending', 'in_progress', 'resolved', 'unresolved')`,
    ),
    check(
      "investigation_items_priority_check",
      sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      "investigation_items_actor_check",
      sql`${table.createdBy} in ('user', 'ai')`,
    ),
  ],
);

export const investigationItemClaims = sqliteTable(
  "investigation_item_claims",
  {
    investigationItemId: text("investigation_item_id")
      .notNull()
      .references(() => investigationItems.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    claimRevision: integer("claim_revision").notNull(),
    role: text("role", { enum: investigationItemLinkRoles })
      .notNull()
      .default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.investigationItemId, table.claimId] }),
    index("investigation_item_claims_claim_idx").on(table.claimId),
    check(
      "investigation_item_claims_revision_check",
      sql`${table.claimRevision} >= 1`,
    ),
    check(
      "investigation_item_claims_role_check",
      sql`${table.role} in ('target', 'context', 'result')`,
    ),
  ],
);

export const investigationItemPeople = sqliteTable(
  "investigation_item_people",
  {
    investigationItemId: text("investigation_item_id")
      .notNull()
      .references(() => investigationItems.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["target", "context"] })
      .notNull()
      .default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.investigationItemId, table.personId] }),
    index("investigation_item_people_person_idx").on(table.personId),
    check(
      "investigation_item_people_role_check",
      sql`${table.role} in ('target', 'context')`,
    ),
  ],
);

export const investigationItemEvents = sqliteTable(
  "investigation_item_events",
  {
    investigationItemId: text("investigation_item_id")
      .notNull()
      .references(() => investigationItems.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    eventRevision: integer("event_revision").notNull(),
    role: text("role", { enum: ["target", "context"] })
      .notNull()
      .default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.investigationItemId, table.eventId] }),
    index("investigation_item_events_event_idx").on(table.eventId),
    check(
      "investigation_item_events_revision_check",
      sql`${table.eventRevision} >= 1`,
    ),
    check(
      "investigation_item_events_role_check",
      sql`${table.role} in ('target', 'context')`,
    ),
  ],
);

export const investigationItemLocations = sqliteTable(
  "investigation_item_locations",
  {
    investigationItemId: text("investigation_item_id")
      .notNull()
      .references(() => investigationItems.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["target", "context"] })
      .notNull()
      .default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.investigationItemId, table.locationId] }),
    index("investigation_item_locations_location_idx").on(table.locationId),
    check(
      "investigation_item_locations_role_check",
      sql`${table.role} in ('target', 'context')`,
    ),
  ],
);

export const investigationItemSources = sqliteTable(
  "investigation_item_sources",
  {
    investigationItemId: text("investigation_item_id")
      .notNull()
      .references(() => investigationItems.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceRevision: integer("source_revision").notNull(),
    role: text("role", { enum: investigationItemLinkRoles })
      .notNull()
      .default("context"),
  },
  (table) => [
    primaryKey({ columns: [table.investigationItemId, table.sourceId] }),
    index("investigation_item_sources_source_idx").on(table.sourceId),
    check(
      "investigation_item_sources_revision_check",
      sql`${table.sourceRevision} >= 1`,
    ),
    check(
      "investigation_item_sources_role_check",
      sql`${table.role} in ('target', 'context', 'result')`,
    ),
  ],
);

export const investigationItemUpdates = sqliteTable(
  "investigation_item_updates",
  {
    id: text("id").primaryKey(),
    investigationItemId: text("investigation_item_id")
      .notNull()
      .references(() => investigationItems.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: investigationItemStatuses }),
    toStatus: text("to_status", { enum: investigationItemStatuses }).notNull(),
    note: text("note").notNull().default(""),
    sourceId: text("source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    claimId: text("claim_id").references(() => claims.id, {
      onDelete: "set null",
    }),
    changedBy: text("changed_by", { enum: actorKinds })
      .notNull()
      .default("user"),
    changedAt: integer("changed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("investigation_item_updates_history_idx").on(
      table.investigationItemId,
      table.changedAt,
    ),
    check(
      "investigation_item_updates_from_status_check",
      sql`${table.fromStatus} is null or ${table.fromStatus} in ('pending', 'in_progress', 'resolved', 'unresolved')`,
    ),
    check(
      "investigation_item_updates_to_status_check",
      sql`${table.toStatus} in ('pending', 'in_progress', 'resolved', 'unresolved')`,
    ),
    check(
      "investigation_item_updates_actor_check",
      sql`${table.changedBy} in ('user', 'ai')`,
    ),
  ],
);

export type ClaimKind = (typeof claimKinds)[number];
export type ClaimStatus = (typeof claimStatuses)[number];
export type ClaimRelationKind = (typeof claimRelationKinds)[number];
export type ClaimReviewDecision = (typeof claimReviewDecisionKinds)[number];
export type ConflictDecision = (typeof conflictDecisionKinds)[number];
export type ActorKind = (typeof actorKinds)[number];
export type SourceKind = (typeof sourceKinds)[number];
export type SourceRelationKind = (typeof sourceRelationKinds)[number];
export type ClaimEntityRole = (typeof claimEntityRoles)[number];
export type ReasoningRunMode = (typeof reasoningRunModes)[number];
export type ReasoningRunStatus = (typeof reasoningRunStatuses)[number];
export type ReasoningRunErrorCode = (typeof reasoningRunErrorCodes)[number];
export type ReasoningSuggestionKind = (typeof reasoningSuggestionKinds)[number];
export type ReasoningSuggestionStatus =
  (typeof reasoningSuggestionStatuses)[number];
export type ReasoningSuggestionResolutionKind =
  (typeof reasoningSuggestionResolutionKinds)[number];
export type InvestigationItemStatus = (typeof investigationItemStatuses)[number];
export type InvestigationItemPriority =
  (typeof investigationItemPriorities)[number];
export type InvestigationItemLinkRole =
  (typeof investigationItemLinkRoles)[number];
