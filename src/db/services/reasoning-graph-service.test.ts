import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../connection";
import { AiReasoningRepository } from "../repositories/ai-reasoning-repository";
import { CaseRepository } from "../repositories/case-repository";
import { EvidenceRepository } from "../repositories/evidence-repository";
import { EventRepository } from "../repositories/event-repository";
import { InvestigationRepository } from "../repositories/investigation-repository";
import { LocationRepository } from "../repositories/location-repository";
import { ReasoningWorkspaceRepository } from "../repositories/reasoning-workspace-repository";
import { ReasoningGraphService } from "./reasoning-graph-service";

describe("reasoning graph projection", () => {
  let connection: DatabaseConnection;
  let ai: AiReasoningRepository;
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
    ai = new AiReasoningRepository(connection);
    cases = new CaseRepository(connection);
    evidence = new EvidenceRepository(connection);
    events = new EventRepository(connection);
    investigations = new InvestigationRepository(connection);
    locations = new LocationRepository(connection);
    reasoning = new ReasoningWorkspaceRepository(connection);
  });

  afterEach(() => connection.sqlite.close());

  it("projects a branch-isolated, revision-aware reasoning workflow", () => {
    const mystery = cases.createCase({ title: "钟楼谜案" });
    const witness = cases.createPerson({
      caseId: mystery.id,
      displayName: "嫌疑人 X",
    });
    const tower = locations.createLocation({ caseId: mystery.id, name: "钟楼" });
    const bell = events.createEvent({
      caseId: mystery.id,
      displayTime: "午夜",
      locationId: tower.id,
      startOffsetSeconds: 0,
      timeKind: "exact",
      title: "钟声响起",
    });
    const chapter = evidence.createSource({
      caseId: mystery.id,
      excerpt: "X 在钟声前进入钟楼。",
      kind: "chapter",
      title: "第三章",
    });
    const investigationSource = evidence.createSource({
      caseId: mystery.id,
      title: "值班记录",
    });
    const presence = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "X 在钟声前进入钟楼",
      eventId: bell.id,
      kind: "fact",
      locationId: tower.id,
      personId: witness.id,
      sourceId: chapter.id,
      status: "accepted",
    });
    const clock = evidence.createEvidenceClaim({
      caseId: mystery.id,
      content: "塔钟比标准时间慢五分钟",
      kind: "fact",
      sourceId: chapter.id,
      status: "accepted",
    });

    const root = reasoning.createBranch({ caseId: mystery.id, name: "主路线" });
    const child = reasoning.createBranch({
      caseId: mystery.id,
      name: "时间修正",
      parentBranchId: root.id,
    });
    const sibling = reasoning.createBranch({
      caseId: mystery.id,
      name: "伪造路线",
      parentBranchId: root.id,
    });
    const trusted = reasoning.createHypothesis({
      branchId: root.id,
      caseId: mystery.id,
      content: "X 能接触塔钟",
    });
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: trusted.id,
      premiseClaimId: presence.id,
      relation: "supports",
    });
    reasoning.promoteHypothesis(mystery.id, trusted.id);

    const localDraft = reasoning.createHypothesis({
      branchId: child.id,
      caseId: mystery.id,
      content: "X 调慢塔钟以制造不在场证明",
    });
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: localDraft.id,
      premiseClaimId: trusted.id,
      relation: "depends_on",
    });
    reasoning.addArgument({
      caseId: mystery.id,
      conclusionClaimId: localDraft.id,
      premiseClaimId: clock.id,
      rationale: "慢五分钟也可能来自机械误差",
      relation: "contradicts",
    });
    const siblingDraft = reasoning.createHypothesis({
      branchId: sibling.id,
      caseId: mystery.id,
      content: "钟声记录由他人伪造",
    });
    reasoning.createContradiction({
      caseId: mystery.id,
      conclusionClaimId: siblingDraft.id,
      premiseClaimId: presence.id,
    });

    addAiSuggestion(ai, mystery.id, root.id, clock.id, "检查塔钟误差来源");
    addAiSuggestion(ai, mystery.id, sibling.id, presence.id, "兄弟分支建议");

    const item = investigations.createItem({
      associations: {
        eventIds: [bell.id],
        locationIds: [tower.id],
        personIds: [witness.id],
        sourceIds: [investigationSource.id],
        targetClaimId: localDraft.id,
      },
      branchId: child.id,
      caseId: mystery.id,
      priority: "high",
      question: "塔钟是否被人为调整？",
      title: "检查塔钟机芯",
    });
    evidence.updateSource(mystery.id, investigationSource.id, {
      kind: "document",
      title: "修订后的值班记录",
    });
    evidence.updateEvidenceClaim(mystery.id, clock.id, {
      content: "塔钟比标准时间慢四至五分钟",
      status: "accepted",
    });

    const graph = new ReasoningGraphService(connection).build(mystery.id, child.id);
    expect(graph?.selectedBranch?.id).toBe(child.id);
    expect(graph?.nodes.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `claim:${presence.id}`,
        `claim:${trusted.id}`,
        `claim:${localDraft.id}`,
        `event:${bell.id}`,
        `location:${tower.id}`,
        `person:${witness.id}`,
        `source:${chapter.id}`,
        `investigation:${item.id}`,
      ]),
    );
    expect(graph?.nodes.map(({ id }) => id)).not.toContain(`claim:${siblingDraft.id}`);
    expect(graph?.nodes.some(({ title }) => title === "兄弟分支建议")).toBe(false);
    expect(graph?.nodes.find(({ title }) => title === "检查塔钟误差来源")).toMatchObject({
      kind: "suggestion",
      stale: true,
    });
    expect(graph?.nodes.find(({ id }) => id === `investigation:${item.id}`)).toMatchObject({
      kind: "investigation",
      stale: true,
    });
    expect(graph?.nodes.find(({ id }) => id === `claim:${trusted.id}`)?.lane).toBe(
      "trusted",
    );
    expect(graph?.nodes.find(({ id }) => id === `claim:${presence.id}`)?.unresolvedConflict).toBe(
      false,
    );
    expect(graph?.summary.openConflicts).toBe(1);
    expect(graph?.edges).toContainEqual(
      expect.objectContaining({
        kind: "contradiction",
        source: `claim:${clock.id}`,
        target: `claim:${localDraft.id}`,
        unresolved: true,
      }),
    );
    expect(graph?.nodes.every(({ updatedAt }) => updatedAt === null || typeof updatedAt === "string")).toBe(
      true,
    );
    expect(new ReasoningGraphService(connection).build("missing")).toBeNull();
  });
});

function addAiSuggestion(
  ai: AiReasoningRepository,
  caseId: string,
  branchId: string,
  claimId: string,
  title: string,
) {
  const { run } = ai.createRun({
    branchId,
    caseId,
    contextFingerprint: `${branchId}-fingerprint`,
    contextJson: "{}",
    focusClaimId: null,
    mode: "hypothesis_expansion",
    model: "test-model",
    provider: "mock",
    requestKey: `${branchId}-request`,
    userPrompt: "",
  });
  ai.completeRun({
    durationMs: 12,
    inputTokens: 10,
    outputTokens: 20,
    remoteResponseId: null,
    runId: run.id,
    suggestions: [
      {
        output: {
          citations: [{ claimId, relation: "supports", revision: 1 }],
          confidence: 70,
          content: "继续验证这一可能性。",
          kind: "hypothesis",
          rationale: "当前事实尚不能排除该解释。",
          secondaryClaimId: null,
          targetClaimId: null,
          title,
        },
        validationIssues: [],
      },
    ],
    summary: "测试推演",
    totalTokens: 30,
  });
}
