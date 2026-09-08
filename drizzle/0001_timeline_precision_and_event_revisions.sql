ALTER TABLE `events` RENAME COLUMN `start_offset_minutes` TO `start_offset_seconds`;
--> statement-breakpoint
ALTER TABLE `events` RENAME COLUMN `end_offset_minutes` TO `end_offset_seconds`;
--> statement-breakpoint
ALTER TABLE `events` RENAME COLUMN `relative_offset_minutes` TO `relative_offset_seconds`;
--> statement-breakpoint
UPDATE `events`
SET
	`start_offset_seconds` = CASE
		WHEN `start_offset_seconds` IS NULL THEN NULL
		ELSE `start_offset_seconds` * 60
	END,
	`end_offset_seconds` = CASE
		WHEN `end_offset_seconds` IS NULL THEN NULL
		ELSE `end_offset_seconds` * 60
	END,
	`relative_offset_seconds` = CASE
		WHEN `relative_offset_seconds` IS NULL THEN NULL
		ELSE `relative_offset_seconds` * 60
	END;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `archived_at` integer;
--> statement-breakpoint
DROP INDEX `events_case_time_idx`;
--> statement-breakpoint
CREATE INDEX `events_case_timeline_idx`
ON `events` (`case_id`, `archived_at`, `start_offset_seconds`, `sort_order`);
--> statement-breakpoint
CREATE TABLE `event_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`changed_by` text DEFAULT 'user' NOT NULL,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_revisions_revision_check" CHECK(`event_revisions`.`revision` >= 1),
	CONSTRAINT "event_revisions_changed_by_check" CHECK(`event_revisions`.`changed_by` in ('user', 'ai'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_revisions_event_revision_unique`
ON `event_revisions` (`event_id`, `revision`);
--> statement-breakpoint
CREATE INDEX `event_revisions_event_idx`
ON `event_revisions` (`event_id`);
--> statement-breakpoint
ALTER TABLE `claim_events`
ADD COLUMN `event_revision` integer DEFAULT 1 NOT NULL
CHECK (`event_revision` >= 1);
--> statement-breakpoint
PRAGMA optimize;
