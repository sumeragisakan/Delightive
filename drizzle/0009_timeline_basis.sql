ALTER TABLE events ADD COLUMN time_precision text NOT NULL DEFAULT 'second' CONSTRAINT events_time_precision_check CHECK (time_precision IN ('minute', 'second'));
--> statement-breakpoint
ALTER TABLE events ADD COLUMN time_basis_revision integer NOT NULL DEFAULT 1 CONSTRAINT events_time_basis_check CHECK (time_basis_revision >= 1);
--> statement-breakpoint
ALTER TABLE claim_events ADD COLUMN event_time_basis_revision integer NOT NULL DEFAULT 1 CONSTRAINT claim_events_time_basis_check CHECK (event_time_basis_revision >= 1);
--> statement-breakpoint
ALTER TABLE investigation_item_events ADD COLUMN event_time_basis_revision integer NOT NULL DEFAULT 1 CONSTRAINT investigation_events_time_basis_check CHECK (event_time_basis_revision >= 1);
