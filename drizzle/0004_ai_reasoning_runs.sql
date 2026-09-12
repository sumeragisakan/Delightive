CREATE TABLE `reasoning_run_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`context_json` text NOT NULL,
	`context_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `reasoning_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reasoning_run_inputs_run_unique` ON `reasoning_run_inputs` (`run_id`);--> statement-breakpoint
CREATE INDEX `reasoning_run_inputs_fingerprint_idx` ON `reasoning_run_inputs` (`context_fingerprint`);--> statement-breakpoint
CREATE TABLE `reasoning_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`focus_claim_id` text,
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
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `reasoning_branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`focus_claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reasoning_runs_mode_check" CHECK("reasoning_runs"."mode" in ('consistency_check', 'hypothesis_expansion', 'counterexample_search', 'investigation_gaps')),
	CONSTRAINT "reasoning_runs_status_check" CHECK("reasoning_runs"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "reasoning_runs_usage_check" CHECK(("reasoning_runs"."input_tokens" is null or "reasoning_runs"."input_tokens" >= 0) and ("reasoning_runs"."output_tokens" is null or "reasoning_runs"."output_tokens" >= 0) and ("reasoning_runs"."total_tokens" is null or "reasoning_runs"."total_tokens" >= 0))
);
--> statement-breakpoint
CREATE INDEX `reasoning_runs_case_history_idx` ON `reasoning_runs` (`case_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reasoning_runs_branch_history_idx` ON `reasoning_runs` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reasoning_suggestions` (
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
	`accepted_claim_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `reasoning_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reasoning_suggestions_kind_check" CHECK("reasoning_suggestions"."kind" in ('hypothesis', 'counterexample', 'contradiction', 'investigation_gap')),
	CONSTRAINT "reasoning_suggestions_status_check" CHECK("reasoning_suggestions"."status" in ('pending', 'accepted', 'dismissed', 'invalid')),
	CONSTRAINT "reasoning_suggestions_confidence_check" CHECK("reasoning_suggestions"."confidence" >= 0 and "reasoning_suggestions"."confidence" <= 100)
);
--> statement-breakpoint
CREATE INDEX `reasoning_suggestions_run_idx` ON `reasoning_suggestions` (`run_id`);--> statement-breakpoint
CREATE INDEX `reasoning_suggestions_status_idx` ON `reasoning_suggestions` (`status`);
