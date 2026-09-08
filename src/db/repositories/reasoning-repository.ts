import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { DatabaseConnection } from "../connection";
import {
  type ActorKind,
  type ClaimKind,
  type ClaimRelationKind,
  type ClaimStatus,
  claimEvents,
  claimLinks,
  claimRevisions,
  claims,
  events,
  reasoningBranches,
} from "../schema";
import { invalidateDownstreamClaims } from "../services/invalidation-service";

type ClaimRow = typeof claims.$inferSelect;
type ClaimEventRow = typeof claimEvents.$inferSelect;
type ClaimLinkRow = typeof claimLinks.$inferSelect;

export class ReasoningRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  createClaim(input: {
    caseId: string;
    content: string;
    kind: ClaimKind;
    status?: ClaimStatus;
    branchId?: string | null;
    speakerPersonId?: string | null;
    confidence?: number | null;
    createdBy?: ActorKind;
  }): ClaimRow {
    const content = requireContent(input.content);
    assertPercentage(input.confidence, "Claim confidence");

    if (input.kind === "fact" && input.branchId) {
      throw new Error("Facts belong to the shared fact layer, not a branch.");
    }

    if (input.branchId) {
      const branch = this.connection.db
        .select({ caseId: reasoningBranches.caseId })
        .from(reasoningBranches)
        .where(eq(reasoningBranches.id, input.branchId))
        .get();

      if (!branch || branch.caseId !== input.caseId) {
        throw new Error("Claim branch must belong to the same case.");
      }
    }

    return this.connection.db
      .insert(claims)
      .values({
        id: randomUUID(),
        caseId: input.caseId,
        content,
        kind: input.kind,
        status: input.status ?? "draft",
        branchId: input.branchId ?? null,
        speakerPersonId: input.speakerPersonId ?? null,
        confidence: input.confidence ?? null,
        createdBy: input.createdBy ?? "user",
      })
      .returning()
      .get();
  }

  linkClaims(input: {
    premiseClaimId: string;
    conclusionClaimId: string;
    relation: ClaimRelationKind;
    rationale?: string;
    strength?: number | null;
    createdBy?: ActorKind;
  }): ClaimLinkRow {
    assertPercentage(input.strength, "Link strength");

    if (input.premiseClaimId === input.conclusionClaimId) {
      throw new Error("A claim cannot be evidence for itself.");
    }

    const premise = this.getClaimOrThrow(input.premiseClaimId);
    const conclusion = this.getClaimOrThrow(input.conclusionClaimId);

    if (premise.caseId !== conclusion.caseId) {
      throw new Error("Linked claims must belong to the same case.");
    }

    if (
      input.relation !== "contradicts" &&
      this.wouldCreateDependencyCycle(
        input.premiseClaimId,
        input.conclusionClaimId,
      )
    ) {
      throw new Error("This link would create a circular argument.");
    }

    return this.connection.db
      .insert(claimLinks)
      .values({
        id: randomUUID(),
        premiseClaimId: premise.id,
        conclusionClaimId: conclusion.id,
        relation: input.relation,
        premiseRevision: premise.revision,
        rationale: input.rationale?.trim() ?? "",
        strength: input.strength ?? null,
        createdBy: input.createdBy ?? "user",
      })
      .returning()
      .get();
  }

  attachEvent(input: {
    claimId: string;
    eventId: string;
    role?: ClaimEventRow["role"];
  }): ClaimEventRow {
    const claim = this.getClaimOrThrow(input.claimId);
    const event = this.connection.db
      .select()
      .from(events)
      .where(eq(events.id, input.eventId))
      .get();

    if (!event || event.caseId !== claim.caseId) {
      throw new Error("Claim and event must belong to the same case.");
    }
    if (event.archivedAt) {
      throw new Error("Archived events cannot be attached to claims.");
    }

    return this.connection.db
      .insert(claimEvents)
      .values({
        claimId: claim.id,
        eventId: event.id,
        eventRevision: event.revision,
        role: input.role ?? "context",
      })
      .returning()
      .get();
  }

  reviseClaim(
    claimId: string,
    input: {
      content?: string;
      status?: ClaimStatus;
      confidence?: number | null;
      changedBy?: ActorKind;
    },
  ) {
    assertPercentage(input.confidence, "Claim confidence");

    const revise = this.connection.sqlite.transaction(() => {
      const current = this.getClaimOrThrow(claimId);
      const updatedAt = new Date();
      const nextRevision = current.revision + 1;

      this.connection.db
        .insert(claimRevisions)
        .values({
          id: randomUUID(),
          claimId,
          revision: current.revision,
          snapshot: JSON.stringify(current),
          changedBy: input.changedBy ?? "user",
          changedAt: updatedAt,
        })
        .run();

      const updated = this.connection.db
        .update(claims)
        .set({
          content:
            input.content === undefined
              ? current.content
              : requireContent(input.content),
          status: input.status ?? current.status,
          confidence:
            input.confidence === undefined
              ? current.confidence
              : input.confidence,
          revision: nextRevision,
          updatedAt,
        })
        .where(eq(claims.id, claimId))
        .returning()
        .get();

      this.connection.sqlite
        .prepare(
          `
            update claim_events
            set event_revision = (
              select revision
              from events
              where events.id = claim_events.event_id
            )
            where claim_id = ?
          `,
        )
        .run(claimId);
      this.connection.sqlite
        .prepare(
          `
            update claim_sources
            set source_revision = (
              select revision
              from sources
              where sources.id = claim_sources.source_id
            )
            where claim_id = ?
          `,
        )
        .run(claimId);
      const invalidatedClaimIds = invalidateDownstreamClaims(
        this.connection,
        claimId,
        updatedAt,
      );

      return {
        claim: updated,
        invalidatedClaimIds,
      };
    });

    return revise();
  }

  getClaimOrThrow(claimId: string): ClaimRow {
    const claim = this.connection.db
      .select()
      .from(claims)
      .where(eq(claims.id, claimId))
      .get();

    if (!claim) {
      throw new Error(`Claim not found: ${claimId}`);
    }

    return claim;
  }

  private wouldCreateDependencyCycle(
    premiseClaimId: string,
    conclusionClaimId: string,
  ) {
    const result = this.connection.sqlite
      .prepare(
        `
          with recursive downstream(id) as (
            select conclusion_claim_id
            from claim_links
            where premise_claim_id = ?
              and relation <> 'contradicts'
            union
            select links.conclusion_claim_id
            from claim_links as links
            join downstream on links.premise_claim_id = downstream.id
            where links.relation <> 'contradicts'
          )
          select 1 as found
          from downstream
          where id = ?
          limit 1
        `,
      )
      .get(conclusionClaimId, premiseClaimId);

    return result !== undefined;
  }
}

function requireContent(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("Claim content cannot be empty.");
  }

  return normalized;
}

function assertPercentage(value: number | null | undefined, label: string) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error(`${label} must be an integer between 0 and 100.`);
  }
}
