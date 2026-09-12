CREATE TABLE `search_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`parent_id` text,
	`case_id` text NOT NULL,
	`branch_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`layer` text,
	`status` text DEFAULT '' NOT NULL,
	`created_by` text,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "search_documents_entity_type_check" CHECK("search_documents"."entity_type" in ('case', 'person', 'location', 'event', 'source', 'branch', 'claim', 'investigation', 'ai_run', 'ai_suggestion')),
	CONSTRAINT "search_documents_layer_check" CHECK("search_documents"."layer" is null or "search_documents"."layer" in ('fixed', 'trusted', 'draft')),
	CONSTRAINT "search_documents_actor_check" CHECK("search_documents"."created_by" is null or "search_documents"."created_by" in ('user', 'ai')),
	CONSTRAINT "search_documents_archived_check" CHECK("search_documents"."archived" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_entity_unique` ON `search_documents` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `search_documents_case_filter_idx` ON `search_documents` (`case_id`,`archived`,`entity_type`);--> statement-breakpoint
CREATE INDEX `search_documents_branch_filter_idx` ON `search_documents` (`branch_id`);--> statement-breakpoint
CREATE INDEX `search_documents_layer_status_idx` ON `search_documents` (`layer`,`status`);--> statement-breakpoint
CREATE INDEX `search_documents_updated_idx` ON `search_documents` (`updated_at`);--> statement-breakpoint
CREATE VIRTUAL TABLE `search_documents_fts` USING fts5(
	`title`,
	`body`,
	`keywords`,
	content='search_documents',
	content_rowid='id',
	tokenize='trigram case_sensitive 0'
);--> statement-breakpoint
CREATE TRIGGER `search_documents_fts_insert` AFTER INSERT ON `search_documents` BEGIN
	INSERT INTO `search_documents_fts` (`rowid`, `title`, `body`, `keywords`)
	VALUES (new.`id`, new.`title`, new.`body`, new.`keywords`);
END;--> statement-breakpoint
CREATE TRIGGER `search_documents_fts_delete` AFTER DELETE ON `search_documents` BEGIN
	INSERT INTO `search_documents_fts` (`search_documents_fts`, `rowid`, `title`, `body`, `keywords`)
	VALUES ('delete', old.`id`, old.`title`, old.`body`, old.`keywords`);
END;--> statement-breakpoint
CREATE TRIGGER `search_documents_fts_update` AFTER UPDATE ON `search_documents` BEGIN
	INSERT INTO `search_documents_fts` (`search_documents_fts`, `rowid`, `title`, `body`, `keywords`)
	VALUES ('delete', old.`id`, old.`title`, old.`body`, old.`keywords`);
	INSERT INTO `search_documents_fts` (`rowid`, `title`, `body`, `keywords`)
	VALUES (new.`id`, new.`title`, new.`body`, new.`keywords`);
END;
