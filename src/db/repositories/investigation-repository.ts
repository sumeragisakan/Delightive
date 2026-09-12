import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { ReasoningCitation } from "../../ai/reasoning-output";
import type { DatabaseConnection } from "../connection";
import {
  cases,
  claims,
  events,
  investigationItemClaims,
  investigationItemEvents,
  investigationItemLocations,
  investigationItemPeople,
  investigationItemSources,
  investigationItems,
  investigationItemUpdates,
  locations,
  people,
  reasoningBranches,
  reasoningRuns,
  reasoningSuggestions,
  sources,
  type ActorKind,
  type InvestigationItemPriority,
  type InvestigationItemStatus,
  type SourceKind,
} from "../schema";
import { EvidenceRepository } from "./evidence-repository";
import { ReasoningWorkspaceRepository } from "./reasoning-workspace-repository";

type ItemRow = typeof investigationItems.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;
type EventRow = typeof events.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type LocationRow = typeof locations.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type UpdateRow = typeof investigationItemUpdates.$inferSelect;

type ContextRole = "target" | "context";

export type InvestigationItemView = ItemRow & {
  claims: Array<{
    claim: ClaimRow;
    claimRevision: number;
    isStale: boolean;
    role: "target" | "context" | "result";
  }>;
  events: Array<{
    event: EventRow;
    eventRevision: number;
    isStale: boolean;
    role: ContextRole;
  }>;
  isStale: boolean;
  locations: Array<{ location: LocationRow; role: ContextRole }>;
  originSuggestion: {
    id: string;
    runId: string;
    title: string;
  } | null;
  people: Array<{ person: PersonRow; role: ContextRole }>;
  sources: Array<{
    isStale: boolean;
    role: "target" | "context" | "result";
    source: SourceRow;
    sourceRevision: number;
  }>;
  staleReasons: string[];
  updates: UpdateRow[];
};

export type InvestigationAssociations = {
  claimIds?: string[];
  eventIds?: string[];
  locationIds?: string[];
  personIds?: string[];
  sourceIds?: string[];
  targetClaimId?: string | null;
};

export class InvestigationRepository {
  private readonly evidence: EvidenceRepository;
  private readonly reasoning: ReasoningWorkspaceRepository;

  constructor(private readonly connection: DatabaseConnection) {
    this.evidence = new EvidenceRepository(connection);
    this.reasoning = new ReasoningWorkspaceRepository(connection);
  }

  countOpenItems(caseId: string) {
    return this.connection.db
      .select({ id: investigationItems.id })
      .from(investigationItems)
      .where(
        and(
          eq(investigationItems.caseId, caseId),
          inArray(investigationItems.status, ["pending", "in_progress"]),
        ),
      )
      .all().length;
  }

  listItems(caseId: string, branchId: string): InvestigationItemView[] {
    this.assertActiveBranch(caseId, branchId);
    return this.connection.db
      .select()
      .from(investigationItems)
      .where(
        and(
          eq(investigationItems.caseId, caseId),
          eq(investigationItems.branchId, branchId),
        ),
      )
      .orderBy(desc(investigationItems.updatedAt))
      .all()
      .map((item) => this.hydrateItem(item));
  }

  getItem(caseId: string, itemId: string): InvestigationItemView {
    return this.hydrateItem(this.getItemRow(caseId, itemId));
  }

  createItem(input: {
    associations?: InvestigationAssociations;
    branchId: string;
    caseId: string;
    createdBy?: ActorKind;
    notes?: string;
    originSuggestionId?: string | null;
    priority?: InvestigationItemPriority;
    question: string;
    title: string;
  }) {
    this.assertActiveBranch(input.caseId, input.branchId);
    const title = requireText(input.title, "调查标题");
    const question = requireText(input.question, "待验证问题");
    const notes = input.notes?.trim() ?? "";
    const createdBy = input.createdBy ?? "user";
    if (input.originSuggestionId) {
      this.assertOriginSuggestion(input.caseId, input.originSuggestionId);
    }
    const associations = this.resolveAssociations(
      input.caseId,
      input.branchId,
      input.associations ?? {},
    );

    const transaction = this.connection.sqlite.transaction(() => {
      const item = this.connection.db
        .insert(investigationItems)
        .values({
          branchId: input.branchId,
          caseId: input.caseId,
          createdBy,
          id: randomUUID(),
          notes,
          originSuggestionId: input.originSuggestionId ?? null,
          priority: input.priority ?? "normal",
          question,
          title,
        })
        .returning()
        .get();
      this.replaceContextAssociations(item.id, associations);
      this.recordUpdate({
        actor: createdBy,
        fromStatus: null,
        itemId: item.id,
        note: createdBy === "ai" ? "由 AI 调查缺口建议建立" : "手动建立调查事项",
        toStatus: "pending",
      });
      this.touchCase(input.caseId);
      return item;
    });

    return transaction();
  }

  createFromSuggestion(input: {
    branchId: string;
    caseId: string;
    citations: ReasoningCitation[];
    notes: string;
    originSuggestionId: string;
    question: string;
    targetClaimId: string | null;
    title: string;
  }) {
    const claimIds = input.citations.map(({ claimId }) => claimId);
    return this.createItem({
      associations: { claimIds, targetClaimId: input.targetClaimId },
      branchId: input.branchId,
      caseId: input.caseId,
      createdBy: "ai",
      notes: input.notes,
      originSuggestionId: input.originSuggestionId,
      question: input.question,
      title: input.title,
    });
  }

  updateItem(
    caseId: string,
    itemId: string,
    input: {
      associations: InvestigationAssociations;
      notes: string;
      priority: InvestigationItemPriority;
      question: string;
      title: string;
    },
  ) {
    const current = this.getItemRow(caseId, itemId);
    assertOpen(current);
    const associations = this.resolveAssociations(
      caseId,
      current.branchId,
      input.associations,
    );
    const transaction = this.connection.sqlite.transaction(() => {
      const updated = this.connection.db
        .update(investigationItems)
        .set({
          notes: input.notes.trim(),
          priority: input.priority,
          question: requireText(input.question, "待验证问题"),
          title: requireText(input.title, "调查标题"),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(investigationItems.id, itemId),
            eq(investigationItems.caseId, caseId),
            eq(investigationItems.status, current.status),
          ),
        )
        .returning()
        .get();
      if (!updated) throw new Error("调查状态已变化，请刷新页面后重试。");
      this.replaceContextAssociations(itemId, associations);
      this.touchCase(caseId);
      return updated;
    });
    return transaction();
  }

  changeStatus(
    caseId: string,
    itemId: string,
    toStatus: Extract<InvestigationItemStatus, "pending" | "in_progress">,
    note = "",
  ) {
    const current = this.getItemRow(caseId, itemId);
    const permitted =
      (current.status === "pending" && toStatus === "in_progress") ||
      (current.status === "in_progress" && toStatus === "pending") ||
      ((current.status === "resolved" || current.status === "unresolved") &&
        toStatus === "pending");
    if (!permitted) throw new Error("当前调查状态不能执行这项变更。");
    const changedAt = new Date();
    const transaction = this.connection.sqlite.transaction(() => {
      const updated = this.connection.db
        .update(investigationItems)
        .set({
          resolvedAt: toStatus === "pending" ? null : current.resolvedAt,
          startedAt:
            toStatus === "in_progress"
              ? (current.startedAt ?? changedAt)
              : current.startedAt,
          status: toStatus,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(investigationItems.id, itemId),
            eq(investigationItems.caseId, caseId),
            eq(investigationItems.status, current.status),
          ),
        )
        .returning()
        .get();
      if (!updated) throw new Error("调查状态已变化，请刷新页面后重试。");
      this.recordUpdate({
        actor: "user",
        fromStatus: current.status,
        itemId,
        note: note.trim(),
        toStatus,
      });
      this.touchCase(caseId, changedAt);
      return updated;
    });
    return transaction();
  }

  completeItem(input: {
    caseId: string;
    draftClaim?: {
      content: string;
      kind: "fact" | "statement";
      speakerPersonId?: string | null;
    } | null;
    existingSourceId?: string | null;
    itemId: string;
    newSource?: {
      excerpt?: string | null;
      kind: SourceKind;
      locator?: string | null;
      notes?: string;
      title: string;
    } | null;
    outcome: Extract<InvestigationItemStatus, "resolved" | "unresolved">;
    resultSummary: string;
  }) {
    const current = this.getItemRow(input.caseId, input.itemId);
    assertOpen(current);
    const resultSummary = requireText(input.resultSummary, "调查结果");
    if (input.existingSourceId && input.newSource) {
      throw new Error("请选择既有来源或新建来源，不能同时使用两种方式。");
    }
    if (input.existingSourceId) {
      this.getActiveSource(input.caseId, input.existingSourceId);
    }
    if (input.draftClaim?.kind === "statement" && input.draftClaim.speakerPersonId) {
      this.getPerson(input.caseId, input.draftClaim.speakerPersonId);
    }

    const transaction = this.connection.sqlite.transaction(() => {
      const source = input.newSource
        ? this.evidence.createSource({ caseId: input.caseId, ...input.newSource })
        : input.existingSourceId
          ? this.getActiveSource(input.caseId, input.existingSourceId)
          : null;
      const claim = input.draftClaim?.content.trim()
        ? this.evidence.createEvidenceClaim({
            caseId: input.caseId,
            content: input.draftClaim.content,
            createdBy: "user",
            kind: input.draftClaim.kind,
            sourceId: source?.id ?? null,
            sourceRelation: "origin",
            speakerPersonId: input.draftClaim.speakerPersonId ?? null,
            status: "draft",
          })
        : null;
      const changedAt = new Date();
      const item = this.connection.db
        .update(investigationItems)
        .set({
          resolvedAt: changedAt,
          resultSummary,
          startedAt: current.startedAt ?? changedAt,
          status: input.outcome,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(investigationItems.id, input.itemId),
            eq(investigationItems.caseId, input.caseId),
            eq(investigationItems.status, current.status),
          ),
        )
        .returning()
        .get();
      if (!item) throw new Error("调查状态已变化，请刷新页面后重试。");
      if (source) {
        this.connection.db
          .insert(investigationItemSources)
          .values({
            investigationItemId: input.itemId,
            role: "result",
            sourceId: source.id,
            sourceRevision: source.revision,
          })
          .onConflictDoUpdate({
            set: { role: "result", sourceRevision: source.revision },
            target: [
              investigationItemSources.investigationItemId,
              investigationItemSources.sourceId,
            ],
          })
          .run();
      }
      if (claim) {
        this.connection.db
          .insert(investigationItemClaims)
          .values({
            claimId: claim.id,
            claimRevision: claim.revision,
            investigationItemId: input.itemId,
            role: "result",
          })
          .run();
      }
      this.recordUpdate({
        actor: "user",
        claimId: claim?.id ?? null,
        fromStatus: current.status,
        itemId: input.itemId,
        note: resultSummary,
        sourceId: source?.id ?? null,
        toStatus: input.outcome,
      });
      this.touchCase(input.caseId, changedAt);
      return { claim, item, source };
    });
    return transaction();
  }

  private hydrateItem(item: ItemRow): InvestigationItemView {
    const itemClaims = this.connection.db
      .select({ claim: claims, link: investigationItemClaims })
      .from(investigationItemClaims)
      .innerJoin(claims, eq(investigationItemClaims.claimId, claims.id))
      .where(eq(investigationItemClaims.investigationItemId, item.id))
      .all()
      .map(({ claim, link }) => ({
        claim,
        claimRevision: link.claimRevision,
        isStale: claim.revision !== link.claimRevision || claim.archivedAt !== null,
        role: link.role,
      }));
    const itemEvents = this.connection.db
      .select({ event: events, link: investigationItemEvents })
      .from(investigationItemEvents)
      .innerJoin(events, eq(investigationItemEvents.eventId, events.id))
      .where(eq(investigationItemEvents.investigationItemId, item.id))
      .all()
      .map(({ event, link }) => ({
        event,
        eventRevision: link.eventRevision,
        isStale: event.revision !== link.eventRevision || event.archivedAt !== null,
        role: link.role,
      }));
    const itemSources = this.connection.db
      .select({ link: investigationItemSources, source: sources })
      .from(investigationItemSources)
      .innerJoin(sources, eq(investigationItemSources.sourceId, sources.id))
      .where(eq(investigationItemSources.investigationItemId, item.id))
      .all()
      .map(({ link, source }) => ({
        isStale: source.revision !== link.sourceRevision || source.archivedAt !== null,
        role: link.role,
        source,
        sourceRevision: link.sourceRevision,
      }));
    const staleReasons = [
      ...itemClaims.filter(({ isStale }) => isStale).map(({ claim }) => `命题“${claim.content}”已有新修订`),
      ...itemEvents.filter(({ isStale }) => isStale).map(({ event }) => `事件“${event.title}”已有新修订`),
      ...itemSources.filter(({ isStale }) => isStale).map(({ source }) => `来源“${source.title}”已有新修订`),
    ];
    const originSuggestion = item.originSuggestionId
      ? this.connection.db
          .select({
            id: reasoningSuggestions.id,
            runId: reasoningSuggestions.runId,
            title: reasoningSuggestions.title,
          })
          .from(reasoningSuggestions)
          .where(eq(reasoningSuggestions.id, item.originSuggestionId))
          .get() ?? null
      : null;

    return {
      ...item,
      claims: itemClaims,
      events: itemEvents,
      isStale: staleReasons.length > 0,
      locations: this.connection.db
        .select({ link: investigationItemLocations, location: locations })
        .from(investigationItemLocations)
        .innerJoin(locations, eq(investigationItemLocations.locationId, locations.id))
        .where(eq(investigationItemLocations.investigationItemId, item.id))
        .all()
        .map(({ link, location }) => ({ location, role: link.role })),
      originSuggestion,
      people: this.connection.db
        .select({ link: investigationItemPeople, person: people })
        .from(investigationItemPeople)
        .innerJoin(people, eq(investigationItemPeople.personId, people.id))
        .where(eq(investigationItemPeople.investigationItemId, item.id))
        .all()
        .map(({ link, person }) => ({ person, role: link.role })),
      sources: itemSources,
      staleReasons,
      updates: this.connection.db
        .select()
        .from(investigationItemUpdates)
        .where(eq(investigationItemUpdates.investigationItemId, item.id))
        .orderBy(desc(investigationItemUpdates.changedAt))
        .all(),
    };
  }

  private resolveAssociations(
    caseId: string,
    branchId: string,
    input: InvestigationAssociations,
  ) {
    const targetClaimId = input.targetClaimId ?? null;
    const claimIds = unique([...(input.claimIds ?? []), ...(targetClaimId ? [targetClaimId] : [])]);
    const visibleClaims = new Map(
      this.reasoning
        .getWorkspace(caseId, branchId)
        .premiseOptions.map((claim) => [claim.id, claim]),
    );
    const claimLinks = claimIds.map((claimId) => {
      const claim = visibleClaims.get(claimId);
      if (!claim) throw new Error("关联命题不在当前分支的可见范围内。");
      return {
        claimId,
        claimRevision: claim.revision,
        role: claimId === targetClaimId ? "target" as const : "context" as const,
      };
    });
    const eventLinks = unique(input.eventIds ?? []).map((eventId) => {
      const event = this.getActiveEvent(caseId, eventId);
      return { eventId, eventRevision: event.revision, role: "context" as const };
    });
    const personLinks = unique(input.personIds ?? []).map((personId) => {
      this.getPerson(caseId, personId);
      return { personId, role: "context" as const };
    });
    const locationLinks = unique(input.locationIds ?? []).map((locationId) => {
      this.getLocation(caseId, locationId);
      return { locationId, role: "context" as const };
    });
    const sourceLinks = unique(input.sourceIds ?? []).map((sourceId) => {
      const source = this.getActiveSource(caseId, sourceId);
      return { role: "context" as const, sourceId, sourceRevision: source.revision };
    });
    return { claimLinks, eventLinks, locationLinks, personLinks, sourceLinks };
  }

  private replaceContextAssociations(
    itemId: string,
    input: ReturnType<InvestigationRepository["resolveAssociations"]>,
  ) {
    this.connection.db
      .delete(investigationItemClaims)
      .where(
        and(
          eq(investigationItemClaims.investigationItemId, itemId),
          ne(investigationItemClaims.role, "result"),
        ),
      )
      .run();
    this.connection.db.delete(investigationItemPeople).where(eq(investigationItemPeople.investigationItemId, itemId)).run();
    this.connection.db.delete(investigationItemEvents).where(eq(investigationItemEvents.investigationItemId, itemId)).run();
    this.connection.db.delete(investigationItemLocations).where(eq(investigationItemLocations.investigationItemId, itemId)).run();
    this.connection.db
      .delete(investigationItemSources)
      .where(
        and(
          eq(investigationItemSources.investigationItemId, itemId),
          ne(investigationItemSources.role, "result"),
        ),
      )
      .run();
    if (input.claimLinks.length) this.connection.db.insert(investigationItemClaims).values(input.claimLinks.map((link) => ({ ...link, investigationItemId: itemId }))).run();
    if (input.personLinks.length) this.connection.db.insert(investigationItemPeople).values(input.personLinks.map((link) => ({ ...link, investigationItemId: itemId }))).run();
    if (input.eventLinks.length) this.connection.db.insert(investigationItemEvents).values(input.eventLinks.map((link) => ({ ...link, investigationItemId: itemId }))).run();
    if (input.locationLinks.length) this.connection.db.insert(investigationItemLocations).values(input.locationLinks.map((link) => ({ ...link, investigationItemId: itemId }))).run();
    if (input.sourceLinks.length) this.connection.db.insert(investigationItemSources).values(input.sourceLinks.map((link) => ({ ...link, investigationItemId: itemId }))).run();
  }

  private assertActiveBranch(caseId: string, branchId: string) {
    const branch = this.connection.db
      .select()
      .from(reasoningBranches)
      .where(
        and(eq(reasoningBranches.id, branchId), eq(reasoningBranches.caseId, caseId)),
      )
      .get();
    if (!branch || branch.status !== "active") {
      throw new Error("调查事项只能归属于当前案件的活动推理分支。");
    }
  }

  private assertOriginSuggestion(caseId: string, suggestionId: string) {
    const suggestion = this.connection.db
      .select({ kind: reasoningSuggestions.kind })
      .from(reasoningSuggestions)
      .innerJoin(reasoningRuns, eq(reasoningSuggestions.runId, reasoningRuns.id))
      .where(
        and(eq(reasoningSuggestions.id, suggestionId), eq(reasoningRuns.caseId, caseId)),
      )
      .get();
    if (!suggestion || suggestion.kind !== "investigation_gap") {
      throw new Error("调查事项来源必须是当前案件的调查缺口建议。");
    }
  }

  private getItemRow(caseId: string, itemId: string) {
    const item = this.connection.db
      .select()
      .from(investigationItems)
      .where(
        and(eq(investigationItems.id, itemId), eq(investigationItems.caseId, caseId)),
      )
      .get();
    if (!item) throw new Error("调查事项不存在或不属于当前案件。");
    return item;
  }

  private getActiveSource(caseId: string, sourceId: string) {
    const source = this.connection.db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.caseId, caseId)))
      .get();
    if (!source || source.archivedAt !== null) throw new Error("关联来源不可用。");
    return source;
  }

  private getActiveEvent(caseId: string, eventId: string) {
    const event = this.connection.db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.caseId, caseId)))
      .get();
    if (!event || event.archivedAt !== null) throw new Error("关联事件不可用。");
    return event;
  }

  private getPerson(caseId: string, personId: string) {
    const person = this.connection.db
      .select()
      .from(people)
      .where(and(eq(people.id, personId), eq(people.caseId, caseId)))
      .get();
    if (!person) throw new Error("关联人物不属于当前案件。");
    return person;
  }

  private getLocation(caseId: string, locationId: string) {
    const location = this.connection.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.caseId, caseId)))
      .get();
    if (!location) throw new Error("关联地点不属于当前案件。");
    return location;
  }

  private recordUpdate(input: {
    actor: ActorKind;
    claimId?: string | null;
    fromStatus: InvestigationItemStatus | null;
    itemId: string;
    note: string;
    sourceId?: string | null;
    toStatus: InvestigationItemStatus;
  }) {
    this.connection.db
      .insert(investigationItemUpdates)
      .values({
        changedBy: input.actor,
        claimId: input.claimId ?? null,
        fromStatus: input.fromStatus,
        id: randomUUID(),
        investigationItemId: input.itemId,
        note: input.note,
        sourceId: input.sourceId ?? null,
        toStatus: input.toStatus,
      })
      .run();
  }

  private touchCase(caseId: string, changedAt = new Date()) {
    this.connection.db
      .update(cases)
      .set({ updatedAt: changedAt })
      .where(eq(cases.id, caseId))
      .run();
  }
}

function assertOpen(item: ItemRow) {
  if (item.status === "resolved" || item.status === "unresolved") {
    throw new Error("已结束的调查需要先重新打开。");
  }
}

function requireText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空。`);
  return normalized;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
