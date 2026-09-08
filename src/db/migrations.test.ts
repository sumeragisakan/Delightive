import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

function runMigration(sqlite: Database.Database, filename: string) {
  const source = readFileSync(
    path.resolve(process.cwd(), "drizzle", filename),
    "utf8",
  );

  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) {
      sqlite.exec(statement);
    }
  }
}

describe("timeline migration", () => {
  it("preserves minute-based event data while converting it to seconds", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      runMigration(sqlite, "0000_initial_schema.sql");
      sqlite
        .prepare("insert into cases (id, title) values (?, ?)")
        .run("case-1", "旧时间线");
      sqlite
        .prepare(
          `insert into events (
            id,
            case_id,
            title,
            time_kind,
            start_offset_minutes,
            end_offset_minutes,
            relative_offset_minutes
          ) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("event-1", "case-1", "钟声", "range", 2, 3, -1);
      sqlite
        .prepare(
          `insert into claims (id, case_id, kind, status, content)
           values (?, ?, ?, ?, ?)`,
        )
        .run("claim-1", "case-1", "fact", "accepted", "钟声响起");
      sqlite
        .prepare(
          `insert into claim_events (claim_id, event_id, role)
           values (?, ?, ?)`,
        )
        .run("claim-1", "event-1", "context");

      runMigration(sqlite, "0001_timeline_precision_and_event_revisions.sql");

      expect(
        sqlite
          .prepare(
            `select
              start_offset_seconds,
              end_offset_seconds,
              relative_offset_seconds,
              archived_at
             from events
             where id = ?`,
          )
          .get("event-1"),
      ).toEqual({
        archived_at: null,
        end_offset_seconds: 180,
        relative_offset_seconds: -60,
        start_offset_seconds: 120,
      });
      expect(
        sqlite
          .prepare(
            "select event_revision from claim_events where event_id = ?",
          )
          .pluck()
          .get("event-1"),
      ).toBe(1);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = ?",
          )
          .pluck()
          .get("event_revisions"),
      ).toBe("event_revisions");
    } finally {
      sqlite.close();
    }
  });
});
