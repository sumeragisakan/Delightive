CREATE TABLE `ai_runtime_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`model` text NOT NULL,
	`timeout_ms` integer DEFAULT 60000 NOT NULL,
	`max_output_tokens` integer DEFAULT 2500 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "ai_runtime_settings_singleton_check" CHECK("ai_runtime_settings"."id" = 'default'),
	CONSTRAINT "ai_runtime_settings_provider_check" CHECK("ai_runtime_settings"."provider" in ('openai')),
	CONSTRAINT "ai_runtime_settings_timeout_check" CHECK("ai_runtime_settings"."timeout_ms" between 5000 and 180000),
	CONSTRAINT "ai_runtime_settings_output_check" CHECK("ai_runtime_settings"."max_output_tokens" between 256 and 10000),
	CONSTRAINT "ai_runtime_settings_enabled_check" CHECK("ai_runtime_settings"."enabled" in (0, 1))
);
