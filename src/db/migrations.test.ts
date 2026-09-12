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

describe("evidence migration", () => {
  it("preserves existing sources and initializes dependency revisions", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      runMigration(sqlite, "0000_initial_schema.sql");
      runMigration(sqlite, "0001_timeline_precision_and_event_revisions.sql");
      sqlite
        .prepare("insert into cases (id, title) values (?, ?)")
        .run("case-1", "旧证据库");
      sqlite
        .prepare(
          `insert into sources (id, case_id, kind, title, locator, excerpt)
           values (?, ?, ?, ?, ?, ?)`,
        )
        .run("source-1", "case-1", "chapter", "第三章", "p.42", "钟声响起");
      sqlite
        .prepare(
          `insert into claims (id, case_id, kind, status, content)
           values (?, ?, ?, ?, ?)`,
        )
        .run("claim-1", "case-1", "fact", "accepted", "午夜听见钟声");
      sqlite
        .prepare(
          `insert into claim_sources (claim_id, source_id, relation, notes)
           values (?, ?, ?, ?)`,
        )
        .run("claim-1", "source-1", "origin", "原文出处");

      runMigration(sqlite, "0002_evidence_source_revisions.sql");

      expect(
        sqlite
          .prepare(
            "select title, revision, archived_at from sources where id = ?",
          )
          .get("source-1"),
      ).toEqual({ archived_at: null, revision: 1, title: "第三章" });
      expect(
        sqlite
          .prepare(
            "select source_revision from claim_sources where claim_id = ?",
          )
          .pluck()
          .get("claim-1"),
      ).toBe(1);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = ?",
          )
          .pluck()
          .get("source_revisions"),
      ).toBe("source_revisions");
    } finally {
      sqlite.close();
    }
  });
});

describe("reasoning review migration", () => {
  it("preserves existing branches, claims, and argument links", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      runMigration(sqlite, "0000_initial_schema.sql");
      runMigration(sqlite, "0001_timeline_precision_and_event_revisions.sql");
      runMigration(sqlite, "0002_evidence_source_revisions.sql");
      sqlite.prepare("insert into cases (id, title) values (?, ?)").run(
        "case-1",
        "旧推理案件",
      );
      sqlite
        .prepare(
          "insert into reasoning_branches (id, case_id, name) values (?, ?, ?)",
        )
        .run("branch-1", "case-1", "原有分支");
      sqlite
        .prepare(
          `insert into claims (id, case_id, branch_id, kind, status, content)
           values (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "claim-1",
          "case-1",
          null,
          "fact",
          "accepted",
          "门已锁",
          "claim-2",
          "case-1",
          "branch-1",
          "hypothesis",
          "draft",
          "无人从门离开",
        );
      sqlite
        .prepare(
          `insert into claim_links (
            id, premise_claim_id, conclusion_claim_id, relation, premise_revision
          ) values (?, ?, ?, ?, ?)`,
        )
        .run("link-1", "claim-1", "claim-2", "supports", 1);

      runMigration(sqlite, "0003_reasoning_reviews_and_conflicts.sql");

      expect(
        sqlite.prepare("select name from reasoning_branches where id = ?").pluck().get(
          "branch-1",
        ),
      ).toBe("原有分支");
      expect(
        sqlite.prepare("select relation from claim_links where id = ?").pluck().get(
          "link-1",
        ),
      ).toBe("supports");
      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = ?",
          )
          .pluck()
          .get("claim_reviews"),
      ).toBe("claim_reviews");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});

describe("AI reasoning run migration", () => {
  it("adds auditable run, snapshot, and suggestion tables without changing existing claims", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      runMigration(sqlite, "0000_initial_schema.sql");
      runMigration(sqlite, "0001_timeline_precision_and_event_revisions.sql");
      runMigration(sqlite, "0002_evidence_source_revisions.sql");
      runMigration(sqlite, "0003_reasoning_reviews_and_conflicts.sql");
      sqlite.prepare("insert into cases (id, title) values (?, ?)").run(
        "case-1",
        "迁移前案件",
      );
      sqlite
        .prepare("insert into claims (id, case_id, kind, status, content) values (?, ?, ?, ?, ?)")
        .run("claim-1", "case-1", "fact", "accepted", "原有事实");

      runMigration(sqlite, "0004_ai_reasoning_runs.sql");

      expect(sqlite.prepare("select content from claims where id = ?").pluck().get("claim-1")).toBe("原有事实");
      expect(
        sqlite
          .prepare("select name from sqlite_master where type = 'table' and name like 'reasoning_%' order by name")
          .pluck()
          .all(),
      ).toEqual(expect.arrayContaining([
        "reasoning_run_inputs",
        "reasoning_runs",
        "reasoning_suggestions",
      ]));
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
