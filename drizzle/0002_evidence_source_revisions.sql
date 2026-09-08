CREATE TABLE `source_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`changed_by` text DEFAULT 'user' NOT NULL,
	`changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_revisions_revision_check" CHECK(`source_revisions`.`revision` >= 1),
	CONSTRAINT "source_revisions_changed_by_check" CHECK(`source_revisions`.`changed_by` in ('user', 'ai'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_revisions_source_revision_unique`
ON `source_revisions` (`source_id`, `revision`);
--> statement-breakpoint
CREATE INDEX `source_revisions_source_idx`
ON `source_revisions` (`source_id`);
--> statement-breakpoint
ALTER TABLE `sources`
ADD COLUMN `revision` integer DEFAULT 1 NOT NULL
CHECK (`revision` >= 1);
--> statement-breakpoint
ALTER TABLE `sources` ADD COLUMN `archived_at` integer;
--> statement-breakpoint
DROP INDEX `sources_case_idx`;
--> statement-breakpoint
CREATE INDEX `sources_case_evidence_idx`
ON `sources` (`case_id`, `archived_at`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `claim_sources`
ADD COLUMN `source_revision` integer DEFAULT 1 NOT NULL
CHECK (`source_revision` >= 1);
--> statement-breakpoint
CREATE INDEX `claims_case_evidence_idx`
ON `claims` (`case_id`, `archived_at`, `kind`, `status`, `updated_at`);
--> statement-breakpoint
PRAGMA optimize;
