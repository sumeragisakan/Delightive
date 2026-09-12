import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../db/connection";

import {
  CASE_BUNDLE_TABLES,
  CaseBundleError,
  exportCaseBundle,
  importCaseBundle,
  parseCaseBundleText,
  previewCaseBundle,
  serializeCaseBundle,
  validateCaseBundle,
} from "./case-bundle";

const migrations = [
  "0000_initial_schema.sql",
  "0001_timeline_precision_and_event_revisions.sql",
  "0002_evidence_source_revisions.sql",
  "0003_reasoning_reviews_and_conflicts.sql",
  "0004_ai_reasoning_runs.sql",
  "0005_ai_review_loop.sql",
  "0006_investigation_workflow.sql",
  "0007_ai_runtime_settings.sql",
  "0008_global_search.sql",
];

describe("case bundle portability", () => {
  it("round-trips the complete case graph with fresh IDs and valid audit snapshots", () => {
    const connection = createFixture();
    try {
      const exported = exportCaseBundle(connection, "case-1");
      expect(Object.hasOwn(exported.tables, "search_documents")).toBe(false);
      expect(CASE_BUNDLE_TABLES.every((table) => exported.tables[table].length > 0)).toBe(true);
      expect(previewCaseBundle(connection, exported)).toMatchObject({
        counts: {
          claims: 2,
          events: 2,
          investigationItems: 1,
          people: 1,
          reasoningRuns: 1,
          sources: 1,
        },
        originalTitle: "钟楼旅馆谜案",
      });

      process.env.OPENAI_API_KEY = "must-not-be-exported";
      const serialized = serializeCaseBundle(exported);
      expect(serialized).not.toContain("must-not-be-exported");
      expect(serialized).not.toContain("D:\\private");
      expect(serialized).toContain("[本机路径已省略]/evidence.txt");
      const parsed = parseCaseBundleText(connection, serialized);
      const imported = importCaseBundle(connection, parsed, "钟楼旅馆谜案（副本）");

      expect(imported.title).toBe("钟楼旅馆谜案（副本）");
      expect(imported.caseId).not.toBe("case-1");
      expect(connection.sqlite.prepare("select count(*) from cases").pluck().get()).toBe(2);
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);

      const importedBundle = exportCaseBundle(connection, imported.caseId);
      for (const table of CASE_BUNDLE_TABLES) {
        expect(importedBundle.tables[table]).toHaveLength(exported.tables[table].length);
      }
      const originalIds = new Set(
        CASE_BUNDLE_TABLES.flatMap((table) =>
          exported.tables[table]
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string"),
        ),
      );
      for (const table of CASE_BUNDLE_TABLES) {
        for (const row of importedBundle.tables[table]) {
          if (typeof row.id === "string") expect(originalIds.has(row.id)).toBe(false);
        }
      }

      const importedClaimId = connection.sqlite
        .prepare("select id from claims where case_id = ? and content = ?")
        .pluck()
        .get(imported.caseId, "午夜听见钟声") as string;
      const importedInput = connection.sqlite
        .prepare(
          `select reasoning_run_inputs.context_json
           from reasoning_run_inputs
           join reasoning_runs on reasoning_runs.id = reasoning_run_inputs.run_id
           where reasoning_runs.case_id = ?`,
        )
        .pluck()
        .get(imported.caseId) as string;
      expect(importedInput).toContain(importedClaimId);
      expect(importedInput).not.toContain("claim-1");

      expect(
        connection.sqlite
          .prepare(
            `select parent.name
             from locations child
             join locations parent on parent.id = child.parent_location_id
             where child.case_id = ? and child.name = ?`,
          )
          .pluck()
          .get(imported.caseId, "地下室"),
      ).toBe("旅馆");
      expect(
        connection.sqlite
          .prepare("select request_key from reasoning_runs where case_id = ?")
          .pluck()
          .get(imported.caseId),
      ).not.toBe("request-1");

      const importedAgain = importCaseBundle(connection, exported);
      expect(importedAgain.caseId).not.toBe(imported.caseId);
      expect(
        connection.sqlite
          .prepare("select count(distinct request_key) from reasoning_runs")
          .pluck()
          .get(),
      ).toBe(3);
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      delete process.env.OPENAI_API_KEY;
      connection.sqlite.close();
    }
  });

  it("rejects unsupported, incomplete, and orphaned packages before writing", () => {
    const connection = createFixture();
    try {
      const source = exportCaseBundle(connection, "case-1");
      const badVersion = structuredClone(source) as unknown as Record<string, unknown>;
      badVersion.formatVersion = 99;
      expect(() => validateCaseBundle(connection, badVersion)).toThrow(
        "不支持的案件包版本",
      );

      const orphaned = structuredClone(source);
      orphaned.tables.person_aliases[0].person_id = "person-outside-bundle";
      expect(() => validateCaseBundle(connection, orphaned)).toThrow(
        "指向案件包之外的记录",
      );

      const extraTable = structuredClone(source) as unknown as {
        tables: Record<string, unknown>;
      };
      extraTable.tables.secrets = [];
      expect(() => validateCaseBundle(connection, extraTable)).toThrow(
        "字段与当前版本不匹配",
      );
      expect(connection.sqlite.prepare("select count(*) from cases").pluck().get()).toBe(1);
    } finally {
      connection.sqlite.close();
    }
  });

  it("rolls back every table when a database constraint rejects an import", () => {
    const connection = createFixture();
    try {
      const source = exportCaseBundle(connection, "case-1");
      source.tables.cases[0].status = "not-a-status";
      expect(() => importCaseBundle(connection, source)).toThrow(CaseBundleError);
      expect(connection.sqlite.prepare("select count(*) from cases").pluck().get()).toBe(1);
      expect(connection.sqlite.prepare("select count(*) from people").pluck().get()).toBe(1);
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      connection.sqlite.close();
    }
  });
});

function createFixture(): DatabaseConnection {
  const connection = createDatabase(":memory:");
  for (const migration of migrations) {
    const source = readFileSync(path.resolve(process.cwd(), "drizzle", migration), "utf8");
    for (const statement of source.split("--> statement-breakpoint")) {
      if (statement.trim()) connection.sqlite.exec(statement);
    }
  }
  connection.sqlite.pragma("foreign_keys = ON");
  seedCompleteCase(connection);
  return connection;
}

function seedCompleteCase(connection: DatabaseConnection) {
  connection.sqlite.exec(`
    insert into cases (id, title, description) values
      ('case-1', '钟楼旅馆谜案', '用于案件包往返测试');
    insert into people (id, case_id, display_name, description) values
      ('person-1', 'case-1', 'X', '同名人物可以被内部编号区分');
    insert into person_aliases (id, person_id, alias, normalized_alias, kind) values
      ('alias-1', 'person-1', '嫌疑人 1 号', '嫌疑人 1 号', 'code');
    insert into locations (id, case_id, parent_location_id, name) values
      ('location-1', 'case-1', null, '旅馆'),
      ('location-2', 'case-1', 'location-1', '地下室');
    insert into events (id, case_id, location_id, anchor_event_id, title, time_kind, revision) values
      ('event-1', 'case-1', 'location-2', null, '钟声响起', 'exact', 1),
      ('event-2', 'case-1', 'location-1', 'event-1', '发现钥匙', 'relative', 1);
    insert into event_participants (event_id, person_id, role, presence) values
      ('event-1', 'person-1', 'witness', 'confirmed');
    insert into event_revisions (id, event_id, revision, snapshot) values
      ('event-revision-1', 'event-1', 1, '{"id":"event-1","personId":"person-1"}');
    insert into sources (id, case_id, kind, title, locator, excerpt) values
      ('source-1', 'case-1', 'chapter', '第三章', 'p.42', '午夜钟声响起');
    insert into source_revisions (id, source_id, revision, snapshot) values
      ('source-revision-1', 'source-1', 1, '{"id":"source-1","title":"第三章"}');
    insert into event_sources (event_id, source_id, relation) values
      ('event-1', 'source-1', 'origin');
    insert into reasoning_branches (id, case_id, parent_branch_id, name) values
      ('branch-1', 'case-1', null, '主线'),
      ('branch-2', 'case-1', 'branch-1', '备用路线');
    insert into claims (id, case_id, branch_id, speaker_person_id, kind, status, content) values
      ('claim-1', 'case-1', null, 'person-1', 'fact', 'accepted', '午夜听见钟声'),
      ('claim-2', 'case-1', 'branch-2', null, 'hypothesis', 'draft', '钥匙在钟声后被放置');
    insert into claim_sources (claim_id, source_id, source_revision, relation) values
      ('claim-1', 'source-1', 1, 'origin');
    insert into claim_links (id, premise_claim_id, conclusion_claim_id, relation, premise_revision) values
      ('claim-link-1', 'claim-1', 'claim-2', 'supports', 1);
    insert into claim_revisions (id, claim_id, revision, snapshot) values
      ('claim-revision-1', 'claim-2', 1, '{"id":"claim-2","premiseId":"claim-1"}');
    insert into claim_reviews (id, claim_id, claim_revision, decision, premise_snapshot) values
      ('claim-review-1', 'claim-2', 1, 'promoted', '[{"claimId":"claim-1","revision":1}]');
    insert into contradiction_reviews (id, claim_link_id, premise_revision, conclusion_revision, decision) values
      ('contradiction-review-1', 'claim-link-1', 1, 1, 'retained');
    insert into claim_people (claim_id, person_id, role) values
      ('claim-2', 'person-1', 'subject');
    insert into claim_events (claim_id, event_id, event_revision, role) values
      ('claim-2', 'event-1', 1, 'context');
    insert into claim_locations (claim_id, location_id, role) values
      ('claim-2', 'location-2', 'context');
    insert into reasoning_runs (
      id, case_id, branch_id, focus_claim_id, request_key, mode, status, provider, model, summary
    ) values (
      'run-1', 'case-1', 'branch-2', 'claim-2', 'request-1', 'investigation_gaps',
      'completed', 'openai', 'test-model', '需要检查地下室'
    );
    insert into reasoning_run_inputs (id, run_id, context_json, context_fingerprint) values
      ('run-input-1', 'run-1', '{"caseId":"case-1","claims":[{"id":"claim-1"},{"id":"claim-2"}]}', 'old-fingerprint');
    insert into reasoning_suggestions (
      id, run_id, kind, status, title, content, rationale, confidence, citations_json,
      target_claim_id, accepted_claim_id, accepted_claim_link_id, resolution_kind, resolved_by
    ) values (
      'suggestion-1', 'run-1', 'investigation_gap', 'accepted', '检查地下室',
      '确认钥匙出现的位置', '可以验证假设', 82,
      '[{"claimId":"claim-1","sourceId":"source-1","eventId":"event-1","revision":1}]',
      'claim-1', 'claim-2', 'claim-link-1', 'investigation_created', 'user'
    );
    insert into reasoning_suggestion_edits (
      id, suggestion_id, revision, title, content, rationale, confidence, citations_json, target_claim_id
    ) values (
      'suggestion-edit-1', 'suggestion-1', 1, '检查地下室', '确认钥匙出现的位置',
      '可以验证假设', 82, '[{"claimId":"claim-1"}]', 'claim-1'
    );
    insert into investigation_items (
      id, case_id, branch_id, origin_suggestion_id, title, question, status, priority
    ) values (
      'investigation-1', 'case-1', 'branch-2', 'suggestion-1', '检查地下室',
      '钥匙是否在钟声后出现？', 'in_progress', 'high'
    );
    insert into investigation_item_claims (investigation_item_id, claim_id, claim_revision, role) values
      ('investigation-1', 'claim-2', 1, 'target');
    insert into investigation_item_people (investigation_item_id, person_id, role) values
      ('investigation-1', 'person-1', 'target');
    insert into investigation_item_events (investigation_item_id, event_id, event_revision, role) values
      ('investigation-1', 'event-1', 1, 'context');
    insert into investigation_item_locations (investigation_item_id, location_id, role) values
      ('investigation-1', 'location-2', 'target');
    insert into investigation_item_sources (investigation_item_id, source_id, source_revision, role) values
      ('investigation-1', 'source-1', 1, 'context');
    insert into investigation_item_updates (
      id, investigation_item_id, from_status, to_status, note, source_id, claim_id
    ) values (
      'investigation-update-1', 'investigation-1', 'pending', 'in_progress',
      '开始调查', 'source-1', 'claim-2'
    );
  `);
  connection.sqlite
    .prepare("update sources set locator = ? where id = ?")
    .run("D:\\private\\evidence.txt", "source-1");
  connection.sqlite
    .prepare("update source_revisions set snapshot = ? where id = ?")
    .run(
      JSON.stringify({ id: "source-1", locator: "D:\\private\\evidence.txt" }),
      "source-revision-1",
    );
}
