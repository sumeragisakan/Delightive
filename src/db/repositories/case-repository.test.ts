import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { CaseRepository } from "./case-repository";
import { ReasoningRepository } from "./reasoning-repository";

describe("CaseRepository workspace operations", () => {
  let connection: DatabaseConnection;
  let cases: CaseRepository;
  let reasoning: ReasoningRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    cases = new CaseRepository(connection);
    reasoning = new ReasoningRepository(connection);
  });

  afterEach(() => {
    connection.sqlite.close();
  });

  it("returns dashboard counts for each case", () => {
    const mystery = cases.createCase({ title: "钟楼谜案" });
    cases.createPerson({ caseId: mystery.id, displayName: "X" });
    cases.createPerson({ caseId: mystery.id, displayName: "X" });
    cases.createEvent({ caseId: mystery.id, title: "钟声响起" });
    reasoning.createClaim({
      caseId: mystery.id,
      content: "钟声在午夜前响起",
      kind: "fact",
      status: "accepted",
    });

    expect(cases.getCaseSummary(mystery.id)).toMatchObject({
      claimCount: 1,
      eventCount: 1,
      peopleCount: 2,
      title: "钟楼谜案",
    });
  });

  it("updates and archives a case without deleting its records", () => {
    const mystery = cases.createCase({ title: "旧标题" });
    cases.createPerson({ caseId: mystery.id, displayName: "目击者" });

    const updated = cases.updateCase(mystery.id, {
      description: "第一卷至第三卷",
      timelineMode: "ordinal",
      title: "旅馆谜案",
    });
    cases.setCaseStatus(mystery.id, "archived");

    expect(updated).toMatchObject({
      description: "第一卷至第三卷",
      timelineMode: "ordinal",
      title: "旅馆谜案",
    });
    expect(cases.getCaseSummary(mystery.id)).toMatchObject({
      peopleCount: 1,
      status: "archived",
    });
  });

  it("edits people and maintains their aliases", () => {
    const mystery = cases.createCase({ title: "双生谜案" });
    const person = cases.createPerson({
      caseId: mystery.id,
      displayName: "王明",
    });
    const alias = cases.addPersonAlias({
      alias: "嫌疑人 1 号",
      kind: "description",
      personId: person.id,
    });

    cases.updatePerson(mystery.id, person.id, {
      color: "#315f72",
      description: "穿深色外套的王明",
      displayName: "王明",
    });

    expect(cases.listPeople(mystery.id)).toMatchObject([
      {
        aliases: [{ alias: "嫌疑人 1 号", kind: "description" }],
        color: "#315f72",
        description: "穿深色外套的王明",
      },
    ]);

    cases.removePersonAlias(mystery.id, alias.id);
    expect(cases.listPeople(mystery.id)[0].aliases).toEqual([]);

    cases.deletePerson(mystery.id, person.id);
    expect(cases.listPeople(mystery.id)).toEqual([]);
  });

  it("rejects person mutations across case boundaries", () => {
    const firstCase = cases.createCase({ title: "案件 A" });
    const secondCase = cases.createCase({ title: "案件 B" });
    const person = cases.createPerson({
      caseId: firstCase.id,
      displayName: "X",
    });

    expect(() =>
      cases.updatePerson(secondCase.id, person.id, {
        color: null,
        displayName: "越界修改",
      }),
    ).toThrow("requested case");
    expect(cases.listPeople(firstCase.id)[0].displayName).toBe("X");
  });
});
