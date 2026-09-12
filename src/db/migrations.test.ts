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

describe("AI review loop migration", () => {
  it("preserves prior runs and suggestions while adding review workflow tables", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      runMigration(sqlite, "0000_initial_schema.sql");
      runMigration(sqlite, "0001_timeline_precision_and_event_revisions.sql");
      runMigration(sqlite, "0002_evidence_source_revisions.sql");
      runMigration(sqlite, "0003_reasoning_reviews_and_conflicts.sql");
      runMigration(sqlite, "0004_ai_reasoning_runs.sql");
      sqlite.prepare("insert into cases (id, title) values (?, ?)").run(
        "case-1",
        "旧 AI 案件",
      );
      sqlite
        .prepare("insert into reasoning_branches (id, case_id, name) values (?, ?, ?)")
        .run("branch-1", "case-1", "旧分支");
      sqlite
        .prepare(
          `insert into reasoning_runs (
            id, case_id, branch_id, mode, status, provider, model, summary
          ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "run-1",
          "case-1",
          "branch-1",
          "hypothesis_expansion",
          "completed",
          "openai",
          "old-model",
          "原运行摘要",
        );
      sqlite
        .prepare(
          `insert into reasoning_suggestions (
            id, run_id, kind, status, title, content, rationale, confidence
          ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "suggestion-1",
          "run-1",
          "hypothesis",
          "dismissed",
          "旧建议",
          "原始正文",
          "原始理由",
          60,
        );

      runMigration(sqlite, "0005_ai_review_loop.sql");

      expect(
        sqlite.prepare("select summary, request_key, retry_of_run_id from reasoning_runs where id = ?").get("run-1"),
      ).toEqual({
        request_key: null,
        retry_of_run_id: null,
        summary: "原运行摘要",
      });
      expect(
        sqlite.prepare("select content, resolution_kind, resolved_by from reasoning_suggestions where id = ?").get("suggestion-1"),
      ).toEqual({
        content: "原始正文",
        resolution_kind: "dismissed",
        resolved_by: "user",
      });
      expect(
        sqlite
          .prepare("select name from sqlite_master where type = 'table' and name in (?, ?, ?) order by name")
          .pluck()
          .all("investigation_items", "investigation_item_claims", "reasoning_suggestion_edits"),
      ).toEqual([
        "investigation_item_claims",
        "investigation_items",
        "reasoning_suggestion_edits",
      ]);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});

describe("investigation workflow migration", () => {
  it("preserves lightweight investigation items and initializes workflow history", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      runMigration(sqlite, "0000_initial_schema.sql");
      runMigration(sqlite, "0001_timeline_precision_and_event_revisions.sql");
      runMigration(sqlite, "0002_evidence_source_revisions.sql");
      runMigration(sqlite, "0003_reasoning_reviews_and_conflicts.sql");
      runMigration(sqlite, "0004_ai_reasoning_runs.sql");
      runMigration(sqlite, "0005_ai_review_loop.sql");
      sqlite.prepare("insert into cases (id, title) values (?, ?)").run(
        "case-1",
        "旧调查案件",
      );
      sqlite
        .prepare("insert into reasoning_branches (id, case_id, name) values (?, ?, ?)")
        .run("branch-1", "case-1", "旧分支");
      sqlite
        .prepare("insert into claims (id, case_id, kind, status, content) values (?, ?, ?, ?, ?)")
        .run("claim-1", "case-1", "fact", "accepted", "门已锁");
      sqlite
        .prepare(
          `insert into investigation_items (
            id, case_id, branch_id, title, question, notes, status, created_by
          ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "item-1",
          "case-1",
          "branch-1",
          "检查后门",
          "后门是否可以通行？",
          "旧笔记",
          "in_progress",
          "user",
        );
      sqlite
        .prepare(
          `insert into investigation_item_claims (
            investigation_item_id, claim_id, claim_revision, role
          ) values (?, ?, ?, ?)`,
        )
        .run("item-1", "claim-1", 1, "target");

      runMigration(sqlite, "0006_investigation_workflow.sql");

      expect(
        sqlite
          .prepare(
            `select title, notes, status, priority, result_summary, started_at
             from investigation_items where id = ?`,
          )
          .get("item-1"),
      ).toEqual({
        notes: "旧笔记",
        priority: "normal",
        result_summary: "",
        started_at: null,
        status: "in_progress",
        title: "检查后门",
      });
      expect(
        sqlite
          .prepare(
            "select from_status, to_status, note from investigation_item_updates where investigation_item_id = ?",
          )
          .get("item-1"),
      ).toEqual({
        from_status: null,
        note: "迁移现有调查事项",
        to_status: "in_progress",
      });
      expect(
        sqlite
          .prepare("select role from investigation_item_claims where investigation_item_id = ?")
          .pluck()
          .get("item-1"),
      ).toBe("target");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});

describe("AI runtime settings migration", () => {
  it("adds constrained non-secret settings without changing existing runs", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    try {
      for (const migration of [
        "0000_initial_schema.sql",
        "0001_timeline_precision_and_event_revisions.sql",
        "0002_evidence_source_revisions.sql",
        "0003_reasoning_reviews_and_conflicts.sql",
        "0004_ai_reasoning_runs.sql",
        "0005_ai_review_loop.sql",
        "0006_investigation_workflow.sql",
      ]) {
        runMigration(sqlite, migration);
      }
      sqlite.prepare("insert into cases (id, title) values (?, ?)").run(
        "case-1",
        "已有 AI 案件",
      );
      sqlite
        .prepare("insert into reasoning_branches (id, case_id, name) values (?, ?, ?)")
        .run("branch-1", "case-1", "主线");
      sqlite
        .prepare(
          `insert into reasoning_runs (
            id, case_id, branch_id, mode, status, provider, model, summary
          ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "run-1",
          "case-1",
          "branch-1",
          "consistency_check",
          "completed",
          "openai",
          "old-model",
          "原运行仍应保留",
        );

      runMigration(sqlite, "0007_ai_runtime_settings.sql");

      expect(
        sqlite.prepare("select model, summary from reasoning_runs where id = ?").get("run-1"),
      ).toEqual({ model: "old-model", summary: "原运行仍应保留" });
      sqlite
        .prepare(
          `insert into ai_runtime_settings (
            id, provider, model, timeout_ms, max_output_tokens, enabled
          ) values (?, ?, ?, ?, ?, ?)`,
        )
        .run("default", "openai", "gpt-test", 60000, 2500, 1);
      expect(
        sqlite.prepare("select model, timeout_ms, max_output_tokens, enabled from ai_runtime_settings").get(),
      ).toEqual({
        enabled: 1,
        max_output_tokens: 2500,
        model: "gpt-test",
        timeout_ms: 60000,
      });
      expect(() =>
        sqlite
          .prepare("update ai_runtime_settings set timeout_ms = ? where id = ?")
          .run(1000, "default"),
      ).toThrow();
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
