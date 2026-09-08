import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { claimLinks, claimReviews, contradictionReviews } from "../schema";
import { CaseRepository } from "./case-repository";
import { EvidenceRepository } from "./evidence-repository";
import { ReasoningWorkspaceRepository } from "./reasoning-workspace-repository";
import { buildReasoningContext } from "../services/reasoning-context-service";

describe("reasoning workspace domain", () => {
  let connection: DatabaseConnection;
  let cases: CaseRepository;
  let evidence: EvidenceRepository;
  let reasoning: ReasoningWorkspaceRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    cases = new CaseRepository(connection);
    evidence = new EvidenceRepository(connection);
    reasoning = new ReasoningWorkspaceRepository(connection);
  });

  afterEach(() => {
    connection.sqlite.close();
  });

  it("keeps sibling drafts isolated while allowing ancestor drafts", () => {
    const mystery = cases.createCase({ title: "分支可见性" });
    const root = reasoning.createBranch({ caseId: mystery.id, name: "主假设" });
    const child = reasoning.createBranch({
      caseId: mystery.id,
      name: "主假设 / 时间修正",
      parentBranchId: root.id,
    });
    const sibling = reasoning.createBranch({
      caseId: mystery.id,
      name: "另一条路线",
      parentBranchId: root.id,
    });
    const ancestorDraft = reasoning.createHypothesis({
      branchId: root.id,
      caseId: mystery.id,
      content: "X 提前离开",
    });
    const siblingDraft = reasoning.createHypothesis({
      branchId: sibling.id,
      caseId: mystery.id,
      content: "Y 调整了钟",
    });
    const conclusion = reasoning.createHypothesis({
      branchId: child.id,
      caseId: mystery.id,
      content: "时间线存在五分钟误差",
    });

    expect(() =>
      reasoning.addArgument({
        caseId: mystery.id,
        conclusionClaimId: conclusion.id,
        premiseClaimId: ancestorDraft.id,
        relation: "depends_on",
      }),
    ).not.toThrow();
    expect(() =>
      reasoning.addArgument({
        caseId: mystery.id,
        conclusionClaimId: conclusion.id,
        premiseClaimId: siblingDraft.id,
        relation: "depends_on",
      }),
    ).toThrow("not visible");
    expect(
      reasoning
        .getWorkspace(mystery.id, child.id)
        .premiseOptions.map(({ id }) => id),
    ).toContain(ancestorDraft.id);
    expect(
      reasoning
        .getWorkspace(mystery.id, child.id)
        .premiseOptions.map(({ id }) => id),
    ).not.toContain(siblingDraft.id);
    expect(() =>
      reasoning.updateBranch(mystery.id, root.id, {
        name: root.name,
        parentBranchId: child.id,
      }),
    ).toThrow("cycle");
  });

  it("promotes a supported hypothesis and records its premise snapshot", () => {
    const mystery = cases.createCase({ title: "可信推论" });
    const source = evidence.createSource({ caseId: mystery.id, title: "正文" });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "门在二十二点锁上",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const branch = reasoning.createBranch({ caseId: mystery.id, name: "密室路线" });
    const unsupported = reasoning.createHypothesis({
      branchId: branch.id,
      caseId: mystery.id,
      content: "无人能从正门离开",
    });

    expect(() => reasoning.promoteHypothesis(mystery.id, unsupported.id)).toThrow(
      "至少需要一条",
    );
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: unsupported.id,
      premiseClaimId: fact.id,
      rationale: "门锁后无法正常通行",
      relation: "supports",
      strength: 90,
    });
    const promoted = reasoning.promoteHypothesis(
      mystery.id,
      unsupported.id,
      "人工复核通过",
    );

    expect(promoted).toMatchObject({ kind: "inference", status: "accepted" });
    const review = connection.db
      .select()
      .from(claimReviews)
      .where(eq(claimReviews.claimId, promoted.id))
      .get();
    expect(review?.decision).toBe("promoted");
    expect(JSON.parse(review?.premiseSnapshot ?? "[]")).toMatchObject([
      { claimId: fact.id, relation: "supports", revision: 1 },
    ]);
  });

  it("reconfirms an inference against the latest accepted premise revision", () => {
    const mystery = cases.createCase({ title: "复核链" });
    const source = evidence.createSource({ caseId: mystery.id, title: "列车时刻表" });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "末班车二十二点发车",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const branch = reasoning.createBranch({ caseId: mystery.id, name: "车站路线" });
    const hypothesis = reasoning.createHypothesis({
      branchId: branch.id,
      caseId: mystery.id,
      content: "X 能赶上末班车",
    });
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: hypothesis.id,
      premiseClaimId: fact.id,
      relation: "depends_on",
    });
    reasoning.promoteHypothesis(mystery.id, hypothesis.id);

    evidence.updateSource(mystery.id, source.id, {
      kind: "user",
      title: "修订时刻表",
    });
    evidence.updateEvidenceClaim(mystery.id, fact.id, {
      content: "末班车二十二点零五分发车",
      status: "accepted",
    });
    expect(reasoning.assessClaim(mystery.id, hypothesis.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "premise_stale" })]),
    );

    const reconfirmed = reasoning.reconfirmInference(
      mystery.id,
      hypothesis.id,
      "已按新时刻表复核",
    );
    expect(reconfirmed.status).toBe("accepted");
    const link = connection.db
      .select()
      .from(claimLinks)
      .where(eq(claimLinks.conclusionClaimId, hypothesis.id))
      .get();
    expect(link?.premiseRevision).toBe(2);
  });

  it("blocks promotion on open conflicts and preserves explicit resolutions", () => {
    const mystery = cases.createCase({ title: "冲突审查" });
    const source = evidence.createSource({ caseId: mystery.id, title: "卷宗" });
    const support = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "钥匙只在管理员手中",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const counter = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "备用钥匙曾借给访客",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const branch = reasoning.createBranch({ caseId: mystery.id, name: "钥匙路线" });
    const hypothesis = reasoning.createHypothesis({
      branchId: branch.id,
      caseId: mystery.id,
      content: "只有管理员能开门",
    });
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: hypothesis.id,
      premiseClaimId: support.id,
      relation: "supports",
    });
    const contradiction = reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: hypothesis.id,
      premiseClaimId: counter.id,
      relation: "contradicts",
    });

    expect(() => reasoning.promoteHypothesis(mystery.id, hypothesis.id)).toThrow(
      "未处理的矛盾",
    );
    reasoning.reviewConflict({
      caseId: mystery.id,
      decision: "retained",
      linkId: contradiction.link.id,
      note: "矛盾成立，但不足以推翻结论",
    });
    expect(reasoning.listConflicts(mystery.id)[0].isOpen).toBe(false);
    expect(reasoning.promoteHypothesis(mystery.id, hypothesis.id).status).toBe(
      "accepted",
    );
    expect(reasoning.listConflicts(mystery.id)[0].isOpen).toBe(false);
    expect(connection.db.select().from(contradictionReviews).all().length).toBe(2);
  });

  it("separates trusted inferences from branch-scoped exploration for AI", () => {
    const mystery = cases.createCase({ title: "推理上下文" });
    const source = evidence.createSource({ caseId: mystery.id, title: "现场记录" });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "窗台有新鲜泥迹",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const first = reasoning.createBranch({ caseId: mystery.id, name: "翻窗路线" });
    const sibling = reasoning.createBranch({ caseId: mystery.id, name: "伪造路线" });
    const trusted = reasoning.createHypothesis({
      branchId: first.id,
      caseId: mystery.id,
      content: "有人近期接触过窗台",
    });
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: trusted.id,
      premiseClaimId: fact.id,
      relation: "supports",
    });
    reasoning.promoteHypothesis(mystery.id, trusted.id);
    const localDraft = reasoning.createHypothesis({
      branchId: first.id,
      caseId: mystery.id,
      content: "犯人从窗户进入",
    });
    reasoning.createHypothesis({
      branchId: sibling.id,
      caseId: mystery.id,
      content: "泥迹是后来伪造的",
    });

    const context = buildReasoningContext(connection, mystery.id, first.id);
    expect(context.fixedEvidence.map(({ id }) => id)).toEqual([fact.id]);
    expect(context.acceptedInferences).toMatchObject([
      { id: trusted.id, revision: 3, status: "accepted" },
    ]);
    expect(context.exploration.claims.map(({ id }) => id)).toEqual([localDraft.id]);
  });
});
