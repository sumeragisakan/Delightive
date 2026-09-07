CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`timeline_mode` text DEFAULT 'relative' NOT NULL,
	`timeline_origin_label` text,
	`timeline_origin_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "cases_status_check" CHECK("cases"."status" in ('active', 'archived')),
	CONSTRAINT "cases_timeline_mode_check" CHECK("cases"."timeline_mode" in ('relative', 'calendar', 'ordinal'))
);
--> statement-breakpoint
CREATE TABLE `claim_events` (
	`claim_id` text NOT NULL,
	`event_id` text NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`claim_id`, `event_id`, `role`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_events_event_idx` ON `claim_events` (`event_id`);--> statement-breakpoint
CREATE TABLE `claim_links` (
	`id` text PRIMARY KEY NOT NULL,
	`premise_claim_id` text NOT NULL,
	`conclusion_claim_id` text NOT NULL,
	`relation` text NOT NULL,
	`premise_revision` integer NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`strength` integer,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`premise_claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conclusion_claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "claim_links_relation_check" CHECK("claim_links"."relation" in ('supports', 'contradicts', 'depends_on', 'qualifies')),
	CONSTRAINT "claim_links_not_self_check" CHECK("claim_links"."premise_claim_id" <> "claim_links"."conclusion_claim_id"),
	CONSTRAINT "claim_links_strength_check" CHECK("claim_links"."strength" is null or ("claim_links"."strength" >= 0 and "claim_links"."strength" <= 100)),
	CONSTRAINT "claim_links_revision_check" CHECK("claim_links"."premise_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_links_edge_unique` ON `claim_links` (`premise_claim_id`,`conclusion_claim_id`,`relation`);--> statement-breakpoint
CREATE INDEX `claim_links_conclusion_idx` ON `claim_links` (`conclusion_claim_id`);--> statement-breakpoint
CREATE TABLE `claim_locations` (
	`claim_id` text NOT NULL,
	`location_id` text NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`claim_id`, `location_id`, `role`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_locations_location_idx` ON `claim_locations` (`location_id`);--> statement-breakpoint
CREATE TABLE `claim_people` (
	`claim_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text DEFAULT 'subject' NOT NULL,
	PRIMARY KEY(`claim_id`, `person_id`, `role`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_people_person_idx` ON `claim_people` (`person_id`);--> statement-breakpoint
CREATE TABLE `claim_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`changed_by` text DEFAULT 'user' NOT NULL,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "claim_revisions_revision_check" CHECK("claim_revisions"."revision" >= 1),
	CONSTRAINT "claim_revisions_changed_by_check" CHECK("claim_revisions"."changed_by" in ('user', 'ai'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_revisions_claim_revision_unique` ON `claim_revisions` (`claim_id`,`revision`);--> statement-breakpoint
CREATE TABLE `claim_sources` (
	`claim_id` text NOT NULL,
	`source_id` text NOT NULL,
	`relation` text DEFAULT 'origin' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`claim_id`, `source_id`, `relation`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "claim_sources_relation_check" CHECK("claim_sources"."relation" in ('origin', 'supports', 'contradicts'))
);
--> statement-breakpoint
CREATE INDEX `claim_sources_source_idx` ON `claim_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`branch_id` text,
	`speaker_person_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` text NOT NULL,
	`confidence` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `reasoning_branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`speaker_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "claims_kind_check" CHECK("claims"."kind" in ('fact', 'statement', 'hypothesis', 'inference')),
	CONSTRAINT "claims_status_check" CHECK("claims"."status" in ('draft', 'accepted', 'rejected', 'needs_review', 'superseded')),
	CONSTRAINT "claims_created_by_check" CHECK("claims"."created_by" in ('user', 'ai')),
	CONSTRAINT "claims_confidence_check" CHECK("claims"."confidence" is null or ("claims"."confidence" >= 0 and "claims"."confidence" <= 100)),
	CONSTRAINT "claims_revision_check" CHECK("claims"."revision" >= 1),
	CONSTRAINT "claims_fact_branch_check" CHECK("claims"."kind" <> 'fact' or "claims"."branch_id" is null)
);
--> statement-breakpoint
CREATE INDEX `claims_case_status_idx` ON `claims` (`case_id`,`status`);--> statement-breakpoint
CREATE INDEX `claims_branch_idx` ON `claims` (`branch_id`);--> statement-breakpoint
CREATE INDEX `claims_speaker_idx` ON `claims` (`speaker_person_id`);--> statement-breakpoint
CREATE TABLE `event_participants` (
	`event_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text DEFAULT 'present' NOT NULL,
	`presence` text DEFAULT 'confirmed' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`event_id`, `person_id`, `role`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_participants_role_check" CHECK("event_participants"."role" in ('actor', 'witness', 'victim', 'present', 'mentioned', 'other')),
	CONSTRAINT "event_participants_presence_check" CHECK("event_participants"."presence" in ('confirmed', 'claimed', 'possible', 'denied'))
);
--> statement-breakpoint
CREATE INDEX `event_participants_person_idx` ON `event_participants` (`person_id`);--> statement-breakpoint
CREATE TABLE `event_sources` (
	`event_id` text NOT NULL,
	`source_id` text NOT NULL,
	`relation` text DEFAULT 'origin' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`event_id`, `source_id`, `relation`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_sources_relation_check" CHECK("event_sources"."relation" in ('origin', 'supports', 'contradicts'))
);
--> statement-breakpoint
CREATE INDEX `event_sources_source_idx` ON `event_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`location_id` text,
	`anchor_event_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`time_kind` text DEFAULT 'unknown' NOT NULL,
	`start_offset_minutes` integer,
	`end_offset_minutes` integer,
	`relative_offset_minutes` integer,
	`display_time` text,
	`certainty` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`anchor_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "events_time_kind_check" CHECK("events"."time_kind" in ('exact', 'range', 'approximate', 'relative', 'unknown')),
	CONSTRAINT "events_range_check" CHECK("events"."start_offset_minutes" is null or "events"."end_offset_minutes" is null or "events"."end_offset_minutes" >= "events"."start_offset_minutes"),
	CONSTRAINT "events_certainty_check" CHECK("events"."certainty" is null or ("events"."certainty" >= 0 and "events"."certainty" <= 100)),
	CONSTRAINT "events_revision_check" CHECK("events"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `events_case_time_idx` ON `events` (`case_id`,`start_offset_minutes`,`end_offset_minutes`);--> statement-breakpoint
CREATE INDEX `events_location_idx` ON `events` (`location_id`);--> statement-breakpoint
CREATE INDEX `events_anchor_idx` ON `events` (`anchor_event_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`parent_location_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `locations_case_idx` ON `locations` (`case_id`);--> statement-breakpoint
CREATE INDEX `locations_parent_idx` ON `locations` (`parent_location_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `people_case_idx` ON `people` (`case_id`);--> statement-breakpoint
CREATE INDEX `people_case_name_idx` ON `people` (`case_id`,`display_name`);--> statement-breakpoint
CREATE TABLE `person_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`kind` text DEFAULT 'name' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_aliases_kind_check" CHECK("person_aliases"."kind" in ('name', 'code', 'description', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_aliases_person_normalized_unique` ON `person_aliases` (`person_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `person_aliases_normalized_idx` ON `person_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `reasoning_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`parent_branch_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_branch_id`) REFERENCES `reasoning_branches`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reasoning_branches_status_check" CHECK("reasoning_branches"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reasoning_branches_case_name_unique` ON `reasoning_branches` (`case_id`,`name`);--> statement-breakpoint
CREATE INDEX `reasoning_branches_parent_idx` ON `reasoning_branches` (`parent_branch_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`kind` text DEFAULT 'user' NOT NULL,
	`title` text NOT NULL,
	`locator` text,
	`excerpt` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sources_kind_check" CHECK("sources"."kind" in ('narration', 'chapter', 'statement', 'document', 'image', 'user', 'other'))
);
--> statement-breakpoint
CREATE INDEX `sources_case_idx` ON `sources` (`case_id`);