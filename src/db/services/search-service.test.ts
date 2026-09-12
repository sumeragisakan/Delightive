import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import {
  parseSearchFilters,
  SearchService,
  type SearchFilters,
} from "./search-service";

describe("global search", () => {
  let connection: DatabaseConnection;
  let service: SearchService;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    seedSearchFixture(connection);
    service = new SearchService(connection);
  });

  afterEach(() => connection.sqlite.close());

  it("indexes every searchable record and finds Chinese aliases without merging duplicate names", () => {
    expect(service.rebuildCase("case-1")).toBe(13);

    const result = service.search(filters({ query: "黑伞客" }));

    expect(result.mode).toBe("full_text");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      entityId: "person-1",
      entityType: "person",
      href: "/cases/case-1#person-person-1",
      title: "X",
    });
    expect(
      connection.sqlite
        .prepare("select count(*) from search_documents where case_id = ?")
        .pluck()
        .get("case-1"),
    ).toBe(13);
  });

  it("uses substring matching for short Chinese queries and combines branch, type, layer, status, and author filters", () => {
    service.rebuildAll();

    const shortQuery = service.search(
      filters({ query: "后门", types: ["event"] }),
    );
    expect(shortQuery.mode).toBe("substring");
    expect(shortQuery.hits.map((hit) => hit.entityId)).toEqual(["event-1"]);

    const trustedInference = service.search(
      filters({
        branchId: "branch-1",
        caseId: "case-1",
        createdBy: "user",
        layers: ["trusted"],
        query: "备用钥匙",
        status: "accepted",
        types: ["claim"],
      }),
    );
    expect(trustedInference.hits).toHaveLength(1);
    expect(trustedInference.hits[0]).toMatchObject({
      branchName: "内部人员路线",
      entityId: "claim-inference",
      layer: "trusted",
    });
    const reviewInference = service.search(
      filters({
        layers: ["draft"],
        query: "待复核推论",
        status: "needs_review",
        types: ["claim"],
      }),
    );
    expect(reviewInference.hits[0]).toMatchObject({
      entityId: "claim-review",
      layer: "draft",
    });

    expect(service.search(filters({ query: "旧港仓库" })).total).toBe(0);
    expect(
      service.search(filters({ includeArchived: true, query: "旧港仓库" })).hits[0],
    ).toMatchObject({ caseId: "case-2", caseStatus: "archived" });
  });

  it("rebuilds stale documents, lazily repairs a missing case index, and treats query syntax as text", () => {
    service.rebuildCase("case-1");
    connection.sqlite
      .prepare("update people set description = ?, updated_at = ? where id = ?")
      .run("携带银色怀表", Date.now() + 1_000, "person-1");
    service.rebuildCase("case-1");

    expect(service.search(filters({ query: "旧描述" })).total).toBe(0);
    expect(service.search(filters({ query: "银色怀表" })).hits[0]?.entityId).toBe(
      "person-1",
    );

    connection.sqlite
      .prepare("delete from search_documents where case_id = ?")
      .run("case-1");
    expect(service.search(filters({ query: "银色怀表" })).hits[0]?.entityId).toBe(
      "person-1",
    );
    expect(() => service.search(filters({ query: '\") OR *' }))).not.toThrow();
  });

  it("normalizes URL parameters and rejects unknown filters", () => {
    expect(
      parseSearchFilters({
        archived: "1",
        author: "robot",
        layer: ["fixed", "bogus", "fixed"],
        page: "-4",
        sort: "updated",
        status: "impossible",
        type: ["person", "unknown"],
      }),
    ).toMatchObject({
      createdBy: null,
      includeArchived: true,
      layers: ["fixed"],
      page: 1,
      sort: "updated",
      status: null,
      types: ["person"],
    });
  });
});

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
    branchId: null,
    caseId: null,
    createdBy: null,
    includeArchived: false,
    layers: [],
    page: 1,
    query: "",
    sort: "relevance",
    status: null,
    types: [],
    ...overrides,
  };
}

function seedSearchFixture(connection: DatabaseConnection) {
  connection.sqlite.exec(`
    insert into cases (id, title, description, status, updated_at) values
      ('case-1', '钟楼旅馆谜案', '雨夜发生的密室事件', 'active', 1000),
      ('case-2', '旧港仓库', '已经封存的案件', 'archived', 900);
    insert into people (id, case_id, display_name, description, updated_at) values
      ('person-1', 'case-1', 'X', '旧描述', 1100),
      ('person-2', 'case-1', 'X', '另一位同名嫌疑人', 1200);
    insert into person_aliases (id, person_id, alias, normalized_alias, kind) values
      ('alias-1', 'person-1', '黑伞客', '黑伞客', 'code');
    insert into locations (id, case_id, name, description, updated_at) values
      ('location-1', 'case-1', '旅馆后院', '靠近厨房', 1300);
    insert into events (id, case_id, location_id, title, description, display_time, updated_at) values
      ('event-1', 'case-1', 'location-1', '后门异响', '有人在门外停留', '午夜之后', 1400);
    insert into event_participants (event_id, person_id, role, presence, notes) values
      ('event-1', 'person-1', 'witness', 'claimed', '声称当时在场');
    insert into sources (id, case_id, kind, title, locator, excerpt, notes, updated_at) values
      ('source-1', 'case-1', 'statement', '管家证词', '第二幕', '钥匙一直在抽屉里', '需要核实', 1500);
    insert into reasoning_branches (id, case_id, name, description, updated_at) values
      ('branch-1', 'case-1', '内部人员路线', '检查钥匙接触者', 1600);
    insert into claims (id, case_id, kind, status, content, created_by, updated_at) values
      ('claim-fact', 'case-1', 'fact', 'accepted', '后门在午夜前已经上锁', 'user', 1700);
    insert into claims (id, case_id, branch_id, kind, status, content, created_by, updated_at) values
      ('claim-inference', 'case-1', 'branch-1', 'inference', 'accepted', '备用钥匙可能被内部人员使用', 'user', 1800),
      ('claim-review', 'case-1', 'branch-1', 'inference', 'needs_review', '待复核推论需要重新检查', 'user', 1850);
    insert into claim_sources (claim_id, source_id, relation) values
      ('claim-fact', 'source-1', 'supports');
    insert into investigation_items (
      id, case_id, branch_id, title, question, notes, result_summary, status, priority, created_by, updated_at
    ) values (
      'investigation-1', 'case-1', 'branch-1', '核对钥匙登记', '谁接触过备用钥匙？', '询问值班员', '', 'pending', 'high', 'user', 1900
    );
    insert into reasoning_runs (
      id, case_id, branch_id, mode, status, provider, model, user_prompt, summary, completed_at
    ) values (
      'run-1', 'case-1', 'branch-1', 'investigation_gaps', 'completed', 'openai', 'test-model', '寻找证词缺口', '建议核对交接记录', 2000
    );
    insert into reasoning_suggestions (
      id, run_id, kind, status, title, content, rationale, confidence
    ) values (
      'suggestion-1', 'run-1', 'investigation_gap', 'pending', '检查值班表', '取得午夜值班表', '可确认钥匙接触者', 72
    );
  `);
}
