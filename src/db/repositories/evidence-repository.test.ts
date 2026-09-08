import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import {
  claimRevisions,
  claimSources,
  claims,
  sourceRevisions,
} from "../schema";
import { CaseRepository } from "./case-repository";
import { EvidenceRepository } from "./evidence-repository";
import { EventRepository } from "./event-repository";
import { LocationRepository } from "./location-repository";
import { ReasoningRepository } from "./reasoning-repository";
import { buildEvidenceContext } from "../services/evidence-context-service";

describe("evidence domain services", () => {
  let connection: DatabaseConnection;
  let cases: CaseRepository;
  let evidence: EvidenceRepository;
  let events: EventRepository;
  let locations: LocationRepository;
  let reasoning: ReasoningRepository;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    cases = new CaseRepository(connection);
    evidence = new EvidenceRepository(connection);
    events = new EventRepository(connection);
    locations = new LocationRepository(connection);
    reasoning = new ReasoningRepository(connection);
  });

  afterEach(() => {
    connection.sqlite.close();
  });

  it("requires active provenance for accepted facts and keeps statements distinct", () => {
    const mystery = cases.createCase({ title: "旅馆谜案" });
    const otherCase = cases.createCase({ title: "另案" });
    const witness = cases.createPerson({
      caseId: mystery.id,
      displayName: "目击者 X",
    });
    const chapter = evidence.createSource({
      caseId: mystery.id,
      kind: "chapter",
      title: "第三章",
    });
    const foreignSource = evidence.createSource({
      caseId: otherCase.id,
      title: "不相关笔记",
    });

    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "午夜钟声响起",
      kind: "fact",
      sourceId: chapter.id,
      status: "accepted",
    });
    const statement = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "X 声称自己没有听见钟声",
      kind: "statement",
      sourceId: chapter.id,
      speakerPersonId: witness.id,
      status: "accepted",
    });

    expect(fact.status).toBe("accepted");
    expect(
      evidence.listEvidenceClaims(mystery.id).find(({ id }) => id === statement.id)
        ?.speaker?.displayName,
    ).toBe("目击者 X");
    expect(() =>
      evidence.createEvidenceClaim({
        caseId: mystery.id,
        content: "没有出处的断言",
        kind: "fact",
        status: "accepted",
      }),
    ).toThrow("provenance");
    expect(() =>
      evidence.createEvidenceClaim({
        caseId: mystery.id,
        content: "跨案件出处",
        kind: "fact",
        sourceId: foreignSource.id,
      }),
    ).toThrow("requested case");
    expect(() =>
      evidence.createEvidenceClaim({
        caseId: mystery.id,
        content: "被错误标成人物发言的事实",
        kind: "fact",
        speakerPersonId: witness.id,
      }),
    ).toThrow("use a statement");
  });

  it("revisions a source and invalidates direct and downstream accepted claims", () => {
    const mystery = cases.createCase({ title: "车站谜案" });
    const source = evidence.createSource({
      caseId: mystery.id,
      excerpt: "列车在十点到站",
      kind: "chapter",
      title: "时刻表",
    });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "列车在十点到站",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    const inference = reasoning.createClaim({
      caseId: mystery.id,
      content: "X 有机会登车",
      kind: "inference",
      status: "accepted",
    });
    reasoning.linkClaims({
      conclusionClaimId: inference.id,
      premiseClaimId: fact.id,
      relation: "supports",
    });

    const result = evidence.updateSource(mystery.id, source.id, {
      excerpt: "列车在十点零五分到站",
      kind: "chapter",
      title: "修订时刻表",
    });

    expect(result.source.revision).toBe(2);
    expect(result.invalidatedClaimIds).toEqual(
      expect.arrayContaining([fact.id, inference.id]),
    );
    expect(
      connection.db.select().from(sourceRevisions).all().map(({ revision }) => revision),
    ).toEqual([1]);
    expect(
      connection.db
        .select({ id: claims.id, status: claims.status })
        .from(claims)
        .where(eq(claims.caseId, mystery.id))
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { id: fact.id, status: "needs_review" },
        { id: inference.id, status: "needs_review" },
      ]),
    );
    expect(
      evidence.listEvidenceClaims(mystery.id)[0].sources[0].isStale,
    ).toBe(true);

    evidence.updateEvidenceClaim(mystery.id, fact.id, {
      content: "列车在十点零五分到站",
      status: "accepted",
    });
    expect(
      connection.db
        .select({ sourceRevision: claimSources.sourceRevision })
        .from(claimSources)
        .where(eq(claimSources.claimId, fact.id))
        .get()?.sourceRevision,
    ).toBe(2);
    expect(
      evidence.listEvidenceClaims(mystery.id)[0].sources[0].isStale,
    ).toBe(false);
  });

  it("revisions source and entity links as part of the evidence aggregate", () => {
    const mystery = cases.createCase({ title: "钟楼谜案" });
    const firstSource = evidence.createSource({
      caseId: mystery.id,
      title: "第一章",
    });
    const secondSource = evidence.createSource({
      caseId: mystery.id,
      title: "第二章",
    });
    const person = cases.createPerson({ caseId: mystery.id, displayName: "X" });
    const location = locations.createLocation({
      caseId: mystery.id,
      name: "钟楼",
    });
    const event = events.createEvent({
      caseId: mystery.id,
      title: "钟声响起",
    });
    const fact = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "X 在钟楼附近",
      kind: "fact",
      sourceId: firstSource.id,
      status: "accepted",
    });

    evidence.addSourceLink({
      caseId: mystery.id,
      claimId: fact.id,
      relation: "supports",
      sourceId: secondSource.id,
    });
    evidence.addEventLink({
      caseId: mystery.id,
      claimId: fact.id,
      eventId: event.id,
    });
    evidence.addPersonLink({
      caseId: mystery.id,
      claimId: fact.id,
      personId: person.id,
    });
    evidence.addLocationLink({
      caseId: mystery.id,
      claimId: fact.id,
      locationId: location.id,
    });

    const hydrated = evidence.listEvidenceClaims(mystery.id)[0];
    expect(hydrated.revision).toBe(5);
    expect(hydrated.events[0].event.title).toBe("钟声响起");
    expect(hydrated.people[0].person.displayName).toBe("X");
    expect(hydrated.locations[0].location.name).toBe("钟楼");
    expect(
      connection.db
        .select()
        .from(claimRevisions)
        .where(eq(claimRevisions.claimId, fact.id))
        .orderBy(asc(claimRevisions.revision))
        .all()
        .map(({ revision }) => revision),
    ).toEqual([1, 2, 3, 4]);
    expect(() =>
      evidence.removeSourceLink({
        caseId: mystery.id,
        claimId: fact.id,
        relation: "origin",
        sourceId: firstSource.id,
      }),
    ).not.toThrow();
    expect(() =>
      evidence.removeSourceLink({
        caseId: mystery.id,
        claimId: fact.id,
        relation: "supports",
        sourceId: secondSource.id,
      }),
    ).toThrow("at least one active source");
  });

  it("archives instead of deleting and rejects cross-case entity links", () => {
    const mystery = cases.createCase({ title: "主案件" });
    const otherCase = cases.createCase({ title: "另案" });
    const source = evidence.createSource({ caseId: mystery.id, title: "原文" });
    const foreignPerson = cases.createPerson({
      caseId: otherCase.id,
      displayName: "局外人",
    });
    const draft = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "尚待确认",
      kind: "fact",
      sourceId: source.id,
    });

    expect(() =>
      evidence.addPersonLink({
        caseId: mystery.id,
        claimId: draft.id,
        personId: foreignPerson.id,
      }),
    ).toThrow("same case");

    evidence.setClaimArchived(mystery.id, draft.id, true);
    expect(evidence.listEvidenceClaims(mystery.id, false)).toEqual([]);
    evidence.setClaimArchived(mystery.id, draft.id, false);
    expect(evidence.listEvidenceClaims(mystery.id, false)).toHaveLength(1);

    evidence.setSourceArchived(mystery.id, source.id, true);
    expect(evidence.listSources(mystery.id, false)).toEqual([]);
  });

  it("builds an AI-ready context from accepted, current evidence only", () => {
    const mystery = cases.createCase({ title: "上下文案" });
    const source = evidence.createSource({
      caseId: mystery.id,
      excerpt: "钟在午夜响起",
      title: "正文",
    });
    const accepted = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "钟在午夜响起",
      kind: "fact",
      sourceId: source.id,
      status: "accepted",
    });
    evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "钟可能被人调整",
      kind: "fact",
      status: "draft",
    });
    reasoning.createClaim({
      caseId: mystery.id,
      content: "X 调整了钟",
      kind: "inference",
      status: "accepted",
    });

    const context = buildEvidenceContext(connection, mystery.id);
    expect(context.evidence).toMatchObject([
      {
        content: "钟在午夜响起",
        id: accepted.id,
        kind: "fact",
        revision: 1,
        sources: [{ id: source.id, relation: "origin", revision: 1 }],
      },
    ]);
    expect(context.sources).toMatchObject([
      { id: source.id, revision: 1, title: "正文" },
    ]);
    expect(context.excluded.draft).toBe(1);

    evidence.updateSource(mystery.id, source.id, {
      excerpt: "钟在午夜过后响起",
      kind: "user",
      title: "修订正文",
    });
    const revisedContext = buildEvidenceContext(connection, mystery.id);
    expect(revisedContext.evidence).toEqual([]);
    expect(revisedContext.excluded.needsReview).toBe(1);
  });
});
