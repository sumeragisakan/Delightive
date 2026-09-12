import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { claims, sources } from "../schema";
import { CaseRepository } from "./case-repository";
import { EvidenceRepository } from "./evidence-repository";
import { EventRepository } from "./event-repository";
import { InvestigationRepository } from "./investigation-repository";
import { LocationRepository } from "./location-repository";
import { ReasoningWorkspaceRepository } from "./reasoning-workspace-repository";

describe("InvestigationRepository workflow", () => {
  let connection: DatabaseConnection;
  let cases: CaseRepository;
  let evidence: EvidenceRepository;
  let events: EventRepository;
  let investigations: InvestigationRepository;
  let locations: LocationRepository;
  let reasoning: ReasoningWorkspaceRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    cases = new CaseRepository(connection);
    evidence = new EvidenceRepository(connection);
    events = new EventRepository(connection);
    investigations = new InvestigationRepository(connection);
    locations = new LocationRepository(connection);
    reasoning = new ReasoningWorkspaceRepository(connection);
  });

  afterEach(() => connection.sqlite.close());

  function createFixture() {
    const mystery = cases.createCase({ title: "钟楼谜案" });
    const branch = cases.createBranch({ caseId: mystery.id, name: "主路线" });
    const person = cases.createPerson({ caseId: mystery.id, displayName: "X" });
    const location = locations.createLocation({ caseId: mystery.id, name: "后门" });
    const event = events.createEvent({
      caseId: mystery.id,
      locationId: location.id,
      title: "门锁被检查",
    });
    const source = evidence.createSource({
      caseId: mystery.id,
      kind: "document",
      title: "门锁记录",
    });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "二十二点后门处于锁闭状态",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    return { branch, event, fact, location, mystery, person, source };
  }

  it("creates a manual item with revision-aware case associations", () => {
    const fixture = createFixture();
    const created = investigations.createItem({
      associations: {
        claimIds: [fixture.fact.id],
        eventIds: [fixture.event.id],
        locationIds: [fixture.location.id],
        personIds: [fixture.person.id],
        sourceIds: [fixture.source.id],
        targetClaimId: fixture.fact.id,
      },
      branchId: fixture.branch.id,
      caseId: fixture.mystery.id,
      notes: "检查备用钥匙",
      priority: "high",
      question: "后门是否可能被备用钥匙打开？",
      title: "核对后门通路",
    });

    const item = investigations.getItem(fixture.mystery.id, created.id);
    expect(item).toMatchObject({
      isStale: false,
      priority: "high",
      status: "pending",
      title: "核对后门通路",
    });
    expect(item.claims[0]).toMatchObject({ claimRevision: 1, role: "target" });
    expect(item.events[0]).toMatchObject({ eventRevision: 1, role: "context" });
    expect(item.people[0].person.id).toBe(fixture.person.id);
    expect(item.locations[0].location.id).toBe(fixture.location.id);
    expect(item.sources[0]).toMatchObject({ role: "context", sourceRevision: 1 });
    expect(item.updates[0]).toMatchObject({ fromStatus: null, toStatus: "pending" });
    expect(cases.getCaseSummary(fixture.mystery.id)?.openInvestigationCount).toBe(1);
  });

  it("detects when a linked claim revision changes", () => {
    const fixture = createFixture();
    const item = investigations.createItem({
      associations: { targetClaimId: fixture.fact.id },
      branchId: fixture.branch.id,
      caseId: fixture.mystery.id,
      question: "锁闭时间是否准确？",
      title: "复核锁闭时间",
    });
    evidence.updateEvidenceClaim(fixture.mystery.id, fixture.fact.id, {
      content: "二十二点零五分后门处于锁闭状态",
      status: "accepted",
    });

    const refreshed = investigations.getItem(fixture.mystery.id, item.id);
    expect(refreshed.isStale).toBe(true);
    expect(refreshed.staleReasons[0]).toContain("已有新修订");
    expect(refreshed.claims[0]).toMatchObject({ claimRevision: 1, isStale: true });
  });

  it("rejects associations from another case", () => {
    const fixture = createFixture();
    const other = cases.createCase({ title: "另一个案件" });
    const outsider = cases.createPerson({ caseId: other.id, displayName: "越界人物" });

    expect(() =>
      investigations.createItem({
        associations: { personIds: [outsider.id] },
        branchId: fixture.branch.id,
        caseId: fixture.mystery.id,
        question: "不应成功",
        title: "越界任务",
      }),
    ).toThrow("不属于当前案件");
  });

  it("records state changes and resolves to a new source plus a draft fact", () => {
    const fixture = createFixture();
    const created = investigations.createItem({
      associations: { targetClaimId: fixture.fact.id },
      branchId: fixture.branch.id,
      caseId: fixture.mystery.id,
      priority: "urgent",
      question: "备用钥匙是否曾被借出？",
      title: "核对钥匙登记",
    });
    investigations.changeStatus(
      fixture.mystery.id,
      created.id,
      "in_progress",
      "开始查阅登记簿",
    );
    const completed = investigations.completeItem({
      caseId: fixture.mystery.id,
      draftClaim: {
        content: "案发当晚备用钥匙没有借出记录",
        kind: "fact",
      },
      itemId: created.id,
      newSource: {
        excerpt: "当日无借出签名",
        kind: "document",
        title: "备用钥匙登记簿",
      },
      outcome: "resolved",
      resultSummary: "登记簿中没有案发当晚的借出记录。",
    });

    expect(completed.source?.title).toBe("备用钥匙登记簿");
    expect(completed.claim).toMatchObject({ kind: "fact", status: "draft" });
    expect(
      connection.db.select().from(claims).where(eq(claims.id, completed.claim!.id)).get(),
    ).toMatchObject({ createdBy: "user", status: "draft" });
    expect(
      connection.db.select().from(sources).where(eq(sources.id, completed.source!.id)).get(),
    ).toMatchObject({ title: "备用钥匙登记簿" });

    const item = investigations.getItem(fixture.mystery.id, created.id);
    expect(item).toMatchObject({
      resultSummary: "登记簿中没有案发当晚的借出记录。",
      status: "resolved",
    });
    expect(item.claims).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "result" })]),
    );
    expect(item.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "result" })]),
    );
    expect(item.updates).toHaveLength(3);
    expect(cases.getCaseSummary(fixture.mystery.id)?.openInvestigationCount).toBe(0);
  });

  it("can reopen a closed item while preserving its result audit", () => {
    const fixture = createFixture();
    const created = investigations.createItem({
      branchId: fixture.branch.id,
      caseId: fixture.mystery.id,
      question: "是否能确认脚印来源？",
      title: "核对脚印",
    });
    investigations.completeItem({
      caseId: fixture.mystery.id,
      itemId: created.id,
      outcome: "unresolved",
      resultSummary: "样本不足，暂时无法确认。",
    });
    expect(() =>
      investigations.updateItem(fixture.mystery.id, created.id, {
        associations: {},
        notes: "",
        priority: "normal",
        question: "修改关闭任务",
        title: "修改关闭任务",
      }),
    ).toThrow("先重新打开");

    investigations.changeStatus(fixture.mystery.id, created.id, "pending", "取得新样本");
    const reopened = investigations.getItem(fixture.mystery.id, created.id);
    expect(reopened).toMatchObject({
      resolvedAt: null,
      resultSummary: "样本不足，暂时无法确认。",
      status: "pending",
    });
    expect(reopened.updates).toHaveLength(3);
  });

  it("prevents a branch with open investigations from being archived", () => {
    const fixture = createFixture();
    const created = investigations.createItem({
      branchId: fixture.branch.id,
      caseId: fixture.mystery.id,
      question: "仍需调查的问题",
      title: "未结束任务",
    });

    expect(() =>
      reasoning.setBranchArchived(fixture.mystery.id, fixture.branch.id, true),
    ).toThrow("归档分支前");

    investigations.completeItem({
      caseId: fixture.mystery.id,
      itemId: created.id,
      outcome: "unresolved",
      resultSummary: "暂时无法取得更多资料。",
    });
    expect(
      reasoning.setBranchArchived(fixture.mystery.id, fixture.branch.id, true),
    ).toMatchObject({ status: "archived" });
  });
});
