CREATE TABLE `investigation_item_claims` (
	`investigation_item_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`claim_revision` integer NOT NULL,
	`role` text DEFAULT 'context' NOT NULL,
	PRIMARY KEY(`investigation_item_id`, `claim_id`),
	FOREIGN KEY (`investigation_item_id`) REFERENCES `investigation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investigation_item_claims_revision_check" CHECK("investigation_item_claims"."claim_revision" >= 1),
	CONSTRAINT "investigation_item_claims_role_check" CHECK("investigation_item_claims"."role" in ('target', 'context'))
);
--> statement-breakpoint
CREATE INDEX `investigation_item_claims_claim_idx` ON `investigation_item_claims` (`claim_id`);--> statement-breakpoint
CREATE TABLE `investigation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_suggestion_id` text,
	`title` text NOT NULL,
	`question` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `reasoning_branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_suggestion_id`) REFERENCES `reasoning_suggestions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "investigation_items_status_check" CHECK("investigation_items"."status" in ('pending', 'in_progress', 'resolved', 'unresolved')),
	CONSTRAINT "investigation_items_actor_check" CHECK("investigation_items"."created_by" in ('user', 'ai'))
);
--> statement-breakpoint
CREATE INDEX `investigation_items_case_status_idx` ON `investigation_items` (`case_id`,`status`);--> statement-breakpoint
CREATE INDEX `investigation_items_branch_idx` ON `investigation_items` (`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `investigation_items_origin_suggestion_unique` ON `investigation_items` (`origin_suggestion_id`);--> statement-breakpoint
CREATE TABLE `reasoning_suggestion_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`rationale` text NOT NULL,
	`confidence` integer NOT NULL,
	`citations_json` text NOT NULL,
	`target_claim_id` text,
	`secondary_claim_id` text,
	`note` text DEFAULT '' NOT NULL,
	`edited_by` text DEFAULT 'user' NOT NULL,
	`edited_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`suggestion_id`) REFERENCES `reasoning_suggestions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reasoning_suggestion_edits_revision_check" CHECK("reasoning_suggestion_edits"."revision" >= 1),
	CONSTRAINT "reasoning_suggestion_edits_confidence_check" CHECK("reasoning_suggestion_edits"."confidence" >= 0 and "reasoning_suggestion_edits"."confidence" <= 100),
	CONSTRAINT "reasoning_suggestion_edits_target_pair_check" CHECK("reasoning_suggestion_edits"."target_claim_id" is null or "reasoning_suggestion_edits"."secondary_claim_id" is null or "reasoning_suggestion_edits"."target_claim_id" <> "reasoning_suggestion_edits"."secondary_claim_id"),
	CONSTRAINT "reasoning_suggestion_edits_actor_check" CHECK("reasoning_suggestion_edits"."edited_by" in ('user', 'ai'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reasoning_suggestion_edits_revision_unique` ON `reasoning_suggestion_edits` (`suggestion_id`,`revision`);--> statement-breakpoint
CREATE INDEX `reasoning_suggestion_edits_history_idx` ON `reasoning_suggestion_edits` (`suggestion_id`,`edited_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reasoning_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`focus_claim_id` text,
	`retry_of_run_id` text,
	`request_key` text,
	`mode` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`user_prompt` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`remote_response_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`duration_ms` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `reasoning_branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`focus_claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`retry_of_run_id`) REFERENCES `reasoning_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reasoning_runs_mode_check" CHECK("__new_reasoning_runs"."mode" in ('consistency_check', 'hypothesis_expansion', 'counterexample_search', 'investigation_gaps')),
	CONSTRAINT "reasoning_runs_status_check" CHECK("__new_reasoning_runs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "reasoning_runs_error_code_check" CHECK("__new_reasoning_runs"."error_code" is null or "__new_reasoning_runs"."error_code" in ('authentication', 'rate_limit', 'timeout', 'network', 'invalid_output', 'provider', 'interrupted')),
	CONSTRAINT "reasoning_runs_usage_check" CHECK(("__new_reasoning_runs"."input_tokens" is null or "__new_reasoning_runs"."input_tokens" >= 0) and ("__new_reasoning_runs"."output_tokens" is null or "__new_reasoning_runs"."output_tokens" >= 0) and ("__new_reasoning_runs"."total_tokens" is null or "__new_reasoning_runs"."total_tokens" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_reasoning_runs`("id", "case_id", "branch_id", "focus_claim_id", "retry_of_run_id", "request_key", "mode", "status", "provider", "model", "user_prompt", "summary", "remote_response_id", "input_tokens", "output_tokens", "total_tokens", "duration_ms", "error_code", "error_message", "created_at", "completed_at") SELECT "id", "case_id", "branch_id", "focus_claim_id", NULL, NULL, "mode", "status", "provider", "model", "user_prompt", "summary", "remote_response_id", "input_tokens", "output_tokens", "total_tokens", "duration_ms", NULL, "error_message", "created_at", "completed_at" FROM `reasoning_runs`;--> statement-breakpoint
DROP TABLE `reasoning_runs`;--> statement-breakpoint
ALTER TABLE `__new_reasoning_runs` RENAME TO `reasoning_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reasoning_runs_case_history_idx` ON `reasoning_runs` (`case_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reasoning_runs_branch_history_idx` ON `reasoning_runs` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reasoning_runs_retry_idx` ON `reasoning_runs` (`retry_of_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reasoning_runs_request_key_unique` ON `reasoning_runs` (`request_key`);--> statement-breakpoint
CREATE TABLE `__new_reasoning_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`rationale` text NOT NULL,
	`confidence` integer NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`validation_issues_json` text DEFAULT '[]' NOT NULL,
	`target_claim_id` text,
	`secondary_claim_id` text,
	`accepted_claim_id` text,
	`accepted_claim_link_id` text,
	`resolution_kind` text,
	`resolution_note` text DEFAULT '' NOT NULL,
	`resolved_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `reasoning_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_claim_link_id`) REFERENCES `claim_links`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reasoning_suggestions_kind_check" CHECK("__new_reasoning_suggestions"."kind" in ('hypothesis', 'counterexample', 'contradiction', 'investigation_gap')),
	CONSTRAINT "reasoning_suggestions_status_check" CHECK("__new_reasoning_suggestions"."status" in ('pending', 'accepted', 'dismissed', 'invalid')),
	CONSTRAINT "reasoning_suggestions_confidence_check" CHECK("__new_reasoning_suggestions"."confidence" >= 0 and "__new_reasoning_suggestions"."confidence" <= 100),
	CONSTRAINT "reasoning_suggestions_target_pair_check" CHECK("__new_reasoning_suggestions"."target_claim_id" is null or "__new_reasoning_suggestions"."secondary_claim_id" is null or "__new_reasoning_suggestions"."target_claim_id" <> "__new_reasoning_suggestions"."secondary_claim_id"),
	CONSTRAINT "reasoning_suggestions_resolution_kind_check" CHECK("__new_reasoning_suggestions"."resolution_kind" is null or "__new_reasoning_suggestions"."resolution_kind" in ('hypothesis_created', 'conflict_created', 'investigation_created', 'dismissed')),
	CONSTRAINT "reasoning_suggestions_resolved_by_check" CHECK("__new_reasoning_suggestions"."resolved_by" is null or "__new_reasoning_suggestions"."resolved_by" in ('user', 'ai'))
);
--> statement-breakpoint
INSERT INTO `__new_reasoning_suggestions`("id", "run_id", "kind", "status", "title", "content", "rationale", "confidence", "citations_json", "validation_issues_json", "target_claim_id", "secondary_claim_id", "accepted_claim_id", "accepted_claim_link_id", "resolution_kind", "resolution_note", "resolved_by", "created_at", "resolved_at") SELECT "id", "run_id", "kind", "status", "title", "content", "rationale", "confidence", "citations_json", "validation_issues_json", NULL, NULL, "accepted_claim_id", NULL, CASE WHEN "status" = 'accepted' THEN 'hypothesis_created' WHEN "status" = 'dismissed' THEN 'dismissed' ELSE NULL END, '', CASE WHEN "status" IN ('accepted', 'dismissed') THEN 'user' ELSE NULL END, "created_at", "resolved_at" FROM `reasoning_suggestions`;--> statement-breakpoint
DROP TABLE `reasoning_suggestions`;--> statement-breakpoint
ALTER TABLE `__new_reasoning_suggestions` RENAME TO `reasoning_suggestions`;--> statement-breakpoint
CREATE INDEX `reasoning_suggestions_run_idx` ON `reasoning_suggestions` (`run_id`);--> statement-breakpoint
CREATE INDEX `reasoning_suggestions_status_idx` ON `reasoning_suggestions` (`status`);
