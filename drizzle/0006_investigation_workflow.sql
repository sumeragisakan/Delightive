CREATE TABLE `investigation_item_events` (
	`investigation_item_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_revision` integer NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`investigation_item_id`, `event_id`),
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investigation_item_events_revision_check" CHECK("investigation_item_events"."event_revision" >= 1),
	CONSTRAINT "investigation_item_events_role_check" CHECK("investigation_item_events"."role" in ('target', 'context'))
);
--> statement-breakpoint
CREATE INDEX `investigation_item_events_event_idx` ON `investigation_item_events` (`event_id`);--> statement-breakpoint
CREATE TABLE `investigation_item_locations` (
	`investigation_item_id` text NOT NULL,
	`location_id` text NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`investigation_item_id`, `location_id`),
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investigation_item_locations_role_check" CHECK("investigation_item_locations"."role" in ('target', 'context'))
);
--> statement-breakpoint
CREATE INDEX `investigation_item_locations_location_idx` ON `investigation_item_locations` (`location_id`);--> statement-breakpoint
CREATE TABLE `investigation_item_people` (
	`investigation_item_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`investigation_item_id`, `person_id`),
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investigation_item_people_role_check" CHECK("investigation_item_people"."role" in ('target', 'context'))
);
--> statement-breakpoint
CREATE INDEX `investigation_item_people_person_idx` ON `investigation_item_people` (`person_id`);--> statement-breakpoint
CREATE TABLE `investigation_item_sources` (
	`investigation_item_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`investigation_item_id`, `source_id`),
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investigation_item_sources_revision_check" CHECK("investigation_item_sources"."source_revision" >= 1),
	CONSTRAINT "investigation_item_sources_role_check" CHECK("investigation_item_sources"."role" in ('target', 'context', 'result'))
);
--> statement-breakpoint
CREATE INDEX `investigation_item_sources_source_idx` ON `investigation_item_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `investigation_item_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`investigation_item_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source_id` text,
	`claim_id` text,
	`changed_by` text DEFAULT 'user' NOT NULL,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "investigation_item_updates_from_status_check" CHECK("investigation_item_updates"."from_status" is null or "investigation_item_updates"."from_status" in ('pending', 'in_progress', 'resolved', 'unresolved')),
	CONSTRAINT "investigation_item_updates_to_status_check" CHECK("investigation_item_updates"."to_status" in ('pending', 'in_progress', 'resolved', 'unresolved')),
	CONSTRAINT "investigation_item_updates_actor_check" CHECK("investigation_item_updates"."changed_by" in ('user', 'ai'))
);
--> statement-breakpoint
CREATE INDEX `investigation_item_updates_history_idx` ON `investigation_item_updates` (`investigation_item_id`,`changed_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_investigation_item_claims` (
	`investigation_item_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`claim_revision` integer NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`investigation_item_id`, `claim_id`),
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investigation_item_claims_revision_check" CHECK("__new_investigation_item_claims"."claim_revision" >= 1),
	CONSTRAINT "investigation_item_claims_role_check" CHECK("__new_investigation_item_claims"."role" in ('target', 'context', 'result'))
);
--> statement-breakpoint
INSERT INTO `__new_investigation_item_claims`("investigation_item_id", "claim_id", "claim_revision", "role") SELECT "investigation_item_id", "claim_id", "claim_revision", "role" FROM `investigation_item_claims`;--> statement-breakpoint
DROP TABLE `investigation_item_claims`;--> statement-breakpoint
ALTER TABLE `__new_investigation_item_claims` RENAME TO `investigation_item_claims`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `investigation_item_claims_claim_idx` ON `investigation_item_claims` (`claim_id`);--> statement-breakpoint
CREATE TABLE `__new_investigation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_suggestion_id` text,
	`title` text NOT NULL,
	`question` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`result_summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`resolved_at` integer,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `reasoning_branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_suggestion_id`) REFERENCES `reasoning_suggestions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "investigation_items_status_check" CHECK("__new_investigation_items"."status" in ('pending', 'in_progress', 'resolved', 'unresolved')),
	CONSTRAINT "investigation_items_priority_check" CHECK("__new_investigation_items"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "investigation_items_actor_check" CHECK("__new_investigation_items"."created_by" in ('user', 'ai'))
);
--> statement-breakpoint
INSERT INTO `__new_investigation_items`("id", "case_id", "branch_id", "origin_suggestion_id", "title", "question", "notes", "result_summary", "status", "priority", "created_by", "created_at", "updated_at", "started_at", "resolved_at") SELECT "id", "case_id", "branch_id", "origin_suggestion_id", "title", "question", "notes", '', "status", 'normal', "created_by", "created_at", "updated_at", NULL, "resolved_at" FROM `investigation_items`;--> statement-breakpoint
DROP TABLE `investigation_items`;--> statement-breakpoint
ALTER TABLE `__new_investigation_items` RENAME TO `investigation_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `investigation_items_case_status_idx` ON `investigation_items` (`case_id`,`status`);--> statement-breakpoint
CREATE INDEX `investigation_items_branch_idx` ON `investigation_items` (`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `investigation_items_origin_suggestion_unique` ON `investigation_items` (`origin_suggestion_id`);--> statement-breakpoint
INSERT INTO `investigation_item_updates` (
	`id`, `investigation_item_id`, `from_status`, `to_status`, `note`, `changed_by`, `changed_at`
) SELECT
	'migration-' || `id`, `id`, NULL, `status`, '迁移现有调查事项', `created_by`, `created_at`
FROM `investigation_items`;
