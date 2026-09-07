import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { claimRevisions, claims, people } from "../schema";
import { CaseRepository } from "./case-repository";
import { ReasoningRepository } from "./reasoning-repository";

describe("Delightive data model", () => {
  let connection: DatabaseConnection;
  let caseRepository: CaseRepository;
  let reasoningRepository: ReasoningRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    caseRepository = new CaseRepository(connection);
    reasoningRepository = new ReasoningRepository(connection);
  });

  afterEach(() => {
    connection.sqlite.close();
  });

  it("allows duplicate display names and ambiguous aliases", () => {
    const mystery = caseRepository.createCase({ title: "双生谜案" });
    const first = caseRepository.createPerson({
      caseId: mystery.id,
      displayName: "王明",
    });
    const second = caseRepository.createPerson({
      caseId: mystery.id,
      displayName: "王明",
    });

    caseRepository.addPersonAlias({ personId: first.id, alias: "X" });
    caseRepository.addPersonAlias({ personId: second.id, alias: "X" });

    const matchingPeople = connection.db
      .select()
      .from(people)
      .where(eq(people.displayName, "王明"))
      .all();

    expect(matchingPeople).toHaveLength(2);
    expect(() =>
      caseRepository.addPersonAlias({ personId: first.id, alias: "ｘ" }),
    ).toThrow();
  });

  it("validates event ranges and case-scoped participation", () => {
    const mystery = caseRepository.createCase({ title: "钟楼谜案" });
    const outsiderCase = caseRepository.createCase({ title: "另一个案件" });
    const witness = caseRepository.createPerson({
      caseId: mystery.id,
      displayName: "目击者",
    });
    const outsider = caseRepository.createPerson({
      caseId: outsiderCase.id,
      displayName: "局外人",
    });
    const event = caseRepository.createEvent({
      caseId: mystery.id,
      title: "钟声响起",
      timeKind: "range",
      startOffsetMinutes: 60,
      endOffsetMinutes: 65,
    });

    expect(
      caseRepository.addEventParticipant({
        eventId: event.id,
        personId: witness.id,
        role: "witness",
      }).role,
    ).toBe("witness");

    expect(() =>
      caseRepository.addEventParticipant({
        eventId: event.id,
        personId: outsider.id,
      }),
    ).toThrow("same case");

    expect(() =>
      caseRepository.createEvent({
        caseId: mystery.id,
        title: "错误时间",
        startOffsetMinutes: 20,
        endOffsetMinutes: 10,
      }),
    ).toThrow("cannot precede");
  });

  it("keeps contradictory hypotheses isolated in branches", () => {
    const mystery = caseRepository.createCase({ title: "密室谜案" });
    const branchA = caseRepository.createBranch({
      caseId: mystery.id,
      name: "X 是凶手",
    });
    const branchB = caseRepository.createBranch({
      caseId: mystery.id,
      name: "X 在掩护 Y",
    });

    const hypothesisA = reasoningRepository.createClaim({
      caseId: mystery.id,
      branchId: branchA.id,
      kind: "hypothesis",
      content: "X 是凶手",
    });
    const hypothesisB = reasoningRepository.createClaim({
      caseId: mystery.id,
      branchId: branchB.id,
      kind: "hypothesis",
      content: "X 不是凶手",
    });

    expect(hypothesisA.branchId).not.toBe(hypothesisB.branchId);
  });

  it("invalidates accepted conclusions when an upstream fact changes", () => {
    const mystery = caseRepository.createCase({ title: "车站谜案" });
    const fact = reasoningRepository.createClaim({
      caseId: mystery.id,
      kind: "fact",
      status: "accepted",
      content: "X 在 21:50 出现在车站",
    });
    const inference = reasoningRepository.createClaim({
      caseId: mystery.id,
      kind: "inference",
      status: "accepted",
      content: "X 无法在 22:00 到达仓库",
    });
    const conclusion = reasoningRepository.createClaim({
      caseId: mystery.id,
      kind: "inference",
      status: "accepted",
      content: "X 没有作案机会",
    });

    reasoningRepository.linkClaims({
      premiseClaimId: fact.id,
      conclusionClaimId: inference.id,
      relation: "supports",
    });
    reasoningRepository.linkClaims({
      premiseClaimId: inference.id,
      conclusionClaimId: conclusion.id,
      relation: "depends_on",
    });

    const result = reasoningRepository.reviseClaim(fact.id, {
      content: "车站监控中的人物可能不是 X",
    });

    expect(result.claim.revision).toBe(2);
    expect(result.invalidatedClaimIds).toEqual(
      expect.arrayContaining([inference.id, conclusion.id]),
    );
    expect(reasoningRepository.getClaimOrThrow(inference.id).status).toBe(
      "needs_review",
    );
    expect(reasoningRepository.getClaimOrThrow(conclusion.id).status).toBe(
      "needs_review",
    );
    expect(connection.db.select().from(claimRevisions).all()).toHaveLength(1);
  });

  it("rejects circular arguments", () => {
    const mystery = caseRepository.createCase({ title: "循环论证测试" });
    const first = reasoningRepository.createClaim({
      caseId: mystery.id,
      kind: "inference",
      content: "结论 A",
    });
    const second = reasoningRepository.createClaim({
      caseId: mystery.id,
      kind: "inference",
      content: "结论 B",
    });
    const third = reasoningRepository.createClaim({
      caseId: mystery.id,
      kind: "inference",
      content: "结论 C",
    });

    reasoningRepository.linkClaims({
      premiseClaimId: first.id,
      conclusionClaimId: second.id,
      relation: "supports",
    });
    reasoningRepository.linkClaims({
      premiseClaimId: second.id,
      conclusionClaimId: third.id,
      relation: "supports",
    });

    expect(() =>
      reasoningRepository.linkClaims({
        premiseClaimId: third.id,
        conclusionClaimId: first.id,
        relation: "supports",
      }),
    ).toThrow("circular argument");
  });

  it("enforces SQLite foreign keys", () => {
    expect(() =>
      connection.db
        .insert(claims)
        .values({
          id: "missing-case-claim",
          caseId: "missing-case",
          kind: "fact",
          status: "accepted",
          content: "不应写入",
        })
        .run(),
    ).toThrow();
  });
});
