CREATE TABLE `claim_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`claim_revision` integer NOT NULL,
	`decision` text NOT NULL,
	`premise_snapshot` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT 'user' NOT NULL,
	`reviewed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "claim_reviews_decision_check" CHECK("claim_reviews"."decision" in ('promoted', 'reconfirmed', 'demoted', 'rejected')),
	CONSTRAINT "claim_reviews_actor_check" CHECK("claim_reviews"."reviewed_by" in ('user', 'ai')),
	CONSTRAINT "claim_reviews_revision_check" CHECK("claim_reviews"."claim_revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `claim_reviews_claim_history_idx` ON `claim_reviews` (`claim_id`,`reviewed_at`);
--> statement-breakpoint
CREATE TABLE `contradiction_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_link_id` text NOT NULL,
	`premise_revision` integer NOT NULL,
	`conclusion_revision` integer NOT NULL,
	`decision` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT 'user' NOT NULL,
	`reviewed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`claim_link_id`) REFERENCES `claim_links`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contradiction_reviews_decision_check" CHECK("contradiction_reviews"."decision" in ('retained', 'prefer_premise', 'prefer_conclusion', 'both_review', 'dismissed')),
	CONSTRAINT "contradiction_reviews_premise_revision_check" CHECK("contradiction_reviews"."premise_revision" >= 1),
	CONSTRAINT "contradiction_reviews_conclusion_revision_check" CHECK("contradiction_reviews"."conclusion_revision" >= 1),
	CONSTRAINT "contradiction_reviews_actor_check" CHECK("contradiction_reviews"."reviewed_by" in ('user', 'ai'))
);
--> statement-breakpoint
CREATE INDEX `contradiction_reviews_link_history_idx` ON `contradiction_reviews` (`claim_link_id`,`reviewed_at`);
--> statement-breakpoint
PRAGMA optimize;
