import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import type { DatabaseConnection } from "../connection";
import {
  type ActorKind,
  type ClaimRelationKind,
  type ConflictDecision,
  cases,
  claimLinks,
  claimReviews,
  claimRevisions,
  claims,
  contradictionReviews,
  reasoningBranches,
} from "../schema";
import { invalidateDownstreamClaims } from "../services/invalidation-service";
import { ReasoningRepository } from "./reasoning-repository";

type BranchRow = typeof reasoningBranches.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;
type ClaimLinkRow = typeof claimLinks.$inferSelect;
type ClaimReviewRow = typeof claimReviews.$inferSelect;
type ContradictionReviewRow = typeof contradictionReviews.$inferSelect;

export type ReasoningBranch = BranchRow & {
  depth: number;
  path: string[];
};

export type ReasoningIssue = {
  code:
    | "archived"
    | "invalid_kind"
    | "invalid_status"
    | "no_premises"
    | "premise_unavailable"
    | "premise_stale"
    | "scope_violation"
    | "unresolved_conflict";
  message: string;
};

export type ReasoningClaim = ClaimRow & {
  branch: BranchRow | null;
  premises: Array<{
    claim: ClaimRow;
    isStale: boolean;
    link: ClaimLinkRow;
  }>;
  reviews: ClaimReviewRow[];
  issues: ReasoningIssue[];
};

export type ReasoningConflict = {
  conclusion: ClaimRow;
  isOpen: boolean;
  latestReview: ContradictionReviewRow | null;
  link: ClaimLinkRow;
  premise: ClaimRow;
};

export type ReasoningWorkspace = {
  acceptedInferences: ReasoningClaim[];
  branches: ReasoningBranch[];
  conflicts: ReasoningConflict[];
  exploration: ReasoningClaim[];
  premiseOptions: Array<ClaimRow & { branchName: string | null }>;
  selectedBranch: ReasoningBranch | null;
};

export class ReasoningWorkspaceRepository {
  private readonly reasoning: ReasoningRepository;

  constructor(private readonly connection: DatabaseConnection) {
    this.reasoning = new ReasoningRepository(connection);
  }

  listBranches(caseId: string, includeArchived = true): ReasoningBranch[] {
    const rows = this.connection.db
      .select()
      .from(reasoningBranches)
      .where(eq(reasoningBranches.caseId, caseId))
      .orderBy(asc(reasoningBranches.createdAt))
      .all()
      .filter((branch) => includeArchived || branch.status === "active");
    const byId = new Map(rows.map((branch) => [branch.id, branch]));

    return rows
      .map((branch) => {
        const path: string[] = [];
        const visited = new Set<string>();
        let current: BranchRow | undefined = branch;

        while (current && !visited.has(current.id)) {
          visited.add(current.id);
          path.unshift(current.name);
          current = current.parentBranchId
            ? byId.get(current.parentBranchId)
            : undefined;
        }

        return { ...branch, depth: Math.max(0, path.length - 1), path };
      })
      .sort((left, right) =>
        left.path.join(" / ").localeCompare(right.path.join(" / "), "zh-CN"),
      );
  }

  createBranch(input: {
    caseId: string;
    description?: string;
    name: string;
    parentBranchId?: string | null;
  }) {
    this.assertCaseExists(input.caseId);
    if (input.parentBranchId) {
      this.getActiveBranchOrThrow(input.caseId, input.parentBranchId);
    }

    const branch = this.connection.db
      .insert(reasoningBranches)
      .values({
        id: randomUUID(),
        caseId: input.caseId,
        description: input.description?.trim() ?? "",
        name: requireText(input.name, "Branch name"),
        parentBranchId: input.parentBranchId ?? null,
      })
      .returning()
      .get();
    this.touchCase(input.caseId);
    return branch;
  }

  updateBranch(
    caseId: string,
    branchId: string,
    input: {
      description?: string;
      name: string;
      parentBranchId?: string | null;
    },
  ) {
    const branch = this.getActiveBranchOrThrow(caseId, branchId);
    const parentBranchId = input.parentBranchId ?? null;

    if (parentBranchId === branch.id) {
      throw new Error("A branch cannot be its own parent.");
    }
    if (parentBranchId) {
      this.getActiveBranchOrThrow(caseId, parentBranchId);
      if (this.isBranchDescendant(branch.id, parentBranchId)) {
        throw new Error("This parent would create a branch cycle.");
      }
    }

    const updated = this.connection.db
      .update(reasoningBranches)
      .set({
        description: input.description?.trim() ?? "",
        name: requireText(input.name, "Branch name"),
        parentBranchId,
        updatedAt: new Date(),
      })
      .where(eq(reasoningBranches.id, branch.id))
      .returning()
      .get();
    this.touchCase(caseId);
    return updated;
  }

  setBranchArchived(caseId: string, branchId: string, archived: boolean) {
    const branch = this.getBranchOrThrow(caseId, branchId);

    if ((branch.status === "archived") === archived) {
      return branch;
    }
    if (archived) {
      const activeChild = this.connection.db
        .select({ id: reasoningBranches.id })
        .from(reasoningBranches)
        .where(
          and(
            eq(reasoningBranches.parentBranchId, branchId),
            eq(reasoningBranches.status, "active"),
          ),
        )
        .get();
      if (activeChild) {
        throw new Error("Archive active child branches first.");
      }
    } else if (branch.parentBranchId) {
      this.getActiveBranchOrThrow(caseId, branch.parentBranchId);
    }

    const updated = this.connection.db
      .update(reasoningBranches)
      .set({ status: archived ? "archived" : "active", updatedAt: new Date() })
      .where(eq(reasoningBranches.id, branchId))
      .returning()
      .get();
    this.touchCase(caseId);
    return updated;
  }

  createHypothesis(input: {
    branchId: string;
    caseId: string;
    confidence?: number | null;
    content: string;
    createdBy?: ActorKind;
  }) {
    this.getActiveBranchOrThrow(input.caseId, input.branchId);
    const claim = this.reasoning.createClaim({
      branchId: input.branchId,
      caseId: input.caseId,
      confidence: input.confidence ?? null,
      content: input.content,
      createdBy: input.createdBy ?? "user",
      kind: "hypothesis",
      status: "draft",
    });
    this.touchCase(input.caseId);
    return claim;
  }

  reviseReasoningClaim(
    caseId: string,
    claimId: string,
    input: {
      confidence?: number | null;
      content: string;
      changedBy?: ActorKind;
      note?: string;
    },
  ) {
    const claim = this.getReasoningClaimOrThrow(caseId, claimId);
    assertPercentage(input.confidence, "Claim confidence");

    return this.mutateClaim(claim, input.changedBy ?? "user", (changedAt) => {
      const wasAccepted = claim.status === "accepted";
      const updated = this.connection.db
        .update(claims)
        .set({
          confidence: input.confidence ?? null,
          content: requireText(input.content, "Claim content"),
          revision: claim.revision + 1,
          status: wasAccepted ? "needs_review" : claim.status,
          updatedAt: changedAt,
        })
        .where(eq(claims.id, claim.id))
        .returning()
        .get();

      if (wasAccepted) {
        this.recordClaimReview(
          updated,
          "demoted",
          input.note?.trim() || "内容改变，转入待复核。",
          input.changedBy ?? "user",
          changedAt,
        );
      }
      return updated;
    });
  }

  addArgument(input: {
    caseId: string;
    conclusionClaimId: string;
    createdBy?: ActorKind;
    premiseClaimId: string;
    rationale?: string;
    relation: ClaimRelationKind;
    strength?: number | null;
  }) {
    const conclusion = this.getReasoningClaimOrThrow(
      input.caseId,
      input.conclusionClaimId,
    );
    const premise = this.getClaimForCaseOrThrow(
      input.caseId,
      input.premiseClaimId,
    );

    if (!this.isPremiseAccessible(premise, conclusion)) {
      throw new Error("This premise is not visible from the conclusion branch.");
    }

    return this.mutateClaim(
      conclusion,
      input.createdBy ?? "user",
      (changedAt) => {
        const link = this.reasoning.linkClaims({
          conclusionClaimId: conclusion.id,
          createdBy: input.createdBy ?? "user",
          premiseClaimId: premise.id,
          rationale: input.rationale,
          relation: input.relation,
          strength: input.strength,
        });
        const wasAccepted = conclusion.status === "accepted";
        const updated = this.connection.db
          .update(claims)
          .set({
            revision: conclusion.revision + 1,
            status: wasAccepted ? "needs_review" : conclusion.status,
            updatedAt: changedAt,
          })
          .where(eq(claims.id, conclusion.id))
          .returning()
          .get();

        if (wasAccepted) {
          this.recordClaimReview(
            updated,
            "demoted",
            "论证关系改变，转入待复核。",
            input.createdBy ?? "user",
            changedAt,
          );
        }
        return { claim: updated, link };
      },
    );
  }

  removeArgument(caseId: string, linkId: string, changedBy: ActorKind = "user") {
    const link = this.getLinkForCaseOrThrow(caseId, linkId);
    const conclusion = this.getReasoningClaimOrThrow(
      caseId,
      link.conclusionClaimId,
    );

    return this.mutateClaim(conclusion, changedBy, (changedAt) => {
      this.connection.db.delete(claimLinks).where(eq(claimLinks.id, link.id)).run();
      const wasAccepted = conclusion.status === "accepted";
      const updated = this.connection.db
        .update(claims)
        .set({
          revision: conclusion.revision + 1,
          status: wasAccepted ? "needs_review" : conclusion.status,
          updatedAt: changedAt,
        })
        .where(eq(claims.id, conclusion.id))
        .returning()
        .get();

      if (wasAccepted) {
        this.recordClaimReview(
          updated,
          "demoted",
          "论证关系改变，转入待复核。",
          changedBy,
          changedAt,
        );
      }
      return updated;
    });
  }

  promoteHypothesis(
    caseId: string,
    claimId: string,
    note = "",
    reviewedBy: ActorKind = "user",
  ) {
    const claim = this.getReasoningClaimOrThrow(caseId, claimId);
    const issues = this.inspectDependencies(claim, false);

    if (claim.kind !== "hypothesis" || !["draft", "needs_review"].includes(claim.status)) {
      throw new Error("Only an active hypothesis can be promoted.");
    }
    if (issues.length > 0) {
      throw new Error(issues[0].message);
    }

    return this.mutateClaim(claim, reviewedBy, (changedAt) => {
      const updated = this.connection.db
        .update(claims)
        .set({
          kind: "inference",
          revision: claim.revision + 1,
          status: "accepted",
          updatedAt: changedAt,
        })
        .where(eq(claims.id, claim.id))
        .returning()
        .get();
      this.carryForwardConflictReviews(claim, updated, reviewedBy, changedAt);
      this.recordClaimReview(
        updated,
        "promoted",
        note,
        reviewedBy,
        changedAt,
      );
      return updated;
    });
  }

  reconfirmInference(
    caseId: string,
    claimId: string,
    note = "",
    reviewedBy: ActorKind = "user",
  ) {
    const claim = this.getReasoningClaimOrThrow(caseId, claimId);
    const issues = this.inspectDependencies(claim, true);

    if (claim.kind !== "inference" || claim.status !== "needs_review") {
      throw new Error("Only an inference awaiting review can be reconfirmed.");
    }
    if (issues.length > 0) {
      throw new Error(issues[0].message);
    }

    return this.mutateClaim(claim, reviewedBy, (changedAt) => {
      this.refreshPremiseVersions(claim.id);
      const updated = this.connection.db
        .update(claims)
        .set({
          revision: claim.revision + 1,
          status: "accepted",
          updatedAt: changedAt,
        })
        .where(eq(claims.id, claim.id))
        .returning()
        .get();
      this.carryForwardConflictReviews(claim, updated, reviewedBy, changedAt);
      this.recordClaimReview(
        updated,
        "reconfirmed",
        note,
        reviewedBy,
        changedAt,
      );
      return updated;
    });
  }

  demoteInference(
    caseId: string,
    claimId: string,
    note = "",
    reviewedBy: ActorKind = "user",
  ) {
    const claim = this.getReasoningClaimOrThrow(caseId, claimId);
    if (claim.kind !== "inference" || claim.status !== "accepted") {
      throw new Error("Only an accepted inference can be demoted.");
    }

    return this.changeClaimStatus(
      claim,
      "needs_review",
      "demoted",
      note,
      reviewedBy,
    );
  }

  rejectReasoningClaim(
    caseId: string,
    claimId: string,
    note = "",
    reviewedBy: ActorKind = "user",
  ) {
    const claim = this.getReasoningClaimOrThrow(caseId, claimId);
    if (claim.status === "rejected") {
      return claim;
    }
    return this.changeClaimStatus(
      claim,
      "rejected",
      "rejected",
      note,
      reviewedBy,
    );
  }

  reviewConflict(input: {
    caseId: string;
    decision: ConflictDecision;
    linkId: string;
    note?: string;
    reviewedBy?: ActorKind;
  }) {
    const link = this.getLinkForCaseOrThrow(input.caseId, input.linkId);
    if (link.relation !== "contradicts") {
      throw new Error("Only contradiction links can be reviewed as conflicts.");
    }

    const review = this.connection.sqlite.transaction(() => {
      const actor = input.reviewedBy ?? "user";
      const note = input.note?.trim() ?? "";
      let premise = this.getClaimForCaseOrThrow(input.caseId, link.premiseClaimId);
      let conclusion = this.getClaimForCaseOrThrow(
        input.caseId,
        link.conclusionClaimId,
      );

      if (input.decision === "prefer_premise" && conclusion.status === "accepted") {
        this.changeClaimStatus(
          conclusion,
          "needs_review",
          "demoted",
          note || "冲突审查中暂不采纳此侧。",
          actor,
        );
      }
      if (input.decision === "prefer_conclusion" && premise.status === "accepted") {
        this.changeClaimStatus(
          premise,
          "needs_review",
          "demoted",
          note || "冲突审查中暂不采纳此侧。",
          actor,
        );
      }
      if (input.decision === "both_review") {
        if (premise.status === "accepted") {
          this.changeClaimStatus(
            premise,
            "needs_review",
            "demoted",
            note || "冲突双方都需要复核。",
            actor,
          );
        }
        if (conclusion.status === "accepted") {
          this.changeClaimStatus(
            conclusion,
            "needs_review",
            "demoted",
            note || "冲突双方都需要复核。",
            actor,
          );
        }
      }

      premise = this.getClaimForCaseOrThrow(input.caseId, link.premiseClaimId);
      conclusion = this.getClaimForCaseOrThrow(
        input.caseId,
        link.conclusionClaimId,
      );
      this.connection.db
        .update(claimLinks)
        .set({ premiseRevision: premise.revision })
        .where(eq(claimLinks.id, link.id))
        .run();

      const result = this.connection.db
        .insert(contradictionReviews)
        .values({
          id: randomUUID(),
          claimLinkId: link.id,
          conclusionRevision: conclusion.revision,
          decision: input.decision,
          note,
          premiseRevision: premise.revision,
          reviewedAt: new Date(),
          reviewedBy: actor,
        })
        .returning()
        .get();
      this.touchCase(input.caseId);
      return result;
    });

    return review();
  }

  getWorkspace(caseId: string, requestedBranchId?: string | null): ReasoningWorkspace {
    this.assertCaseExists(caseId);
    const branches = this.listBranches(caseId);
    const activeBranches = branches.filter((branch) => branch.status === "active");
    const selectedBranch =
      activeBranches.find((branch) => branch.id === requestedBranchId) ??
      activeBranches[0] ??
      null;
    const allClaims = this.connection.db
      .select()
      .from(claims)
      .where(eq(claims.caseId, caseId))
      .orderBy(desc(claims.updatedAt))
      .all();
    const reasoningRows = allClaims.filter(
      (claim) =>
        claim.archivedAt === null &&
        (claim.kind === "hypothesis" || claim.kind === "inference"),
    );
    const hydrated = reasoningRows.map((claim) => this.hydrateClaim(claim));
    const lineageIds = new Set(
      selectedBranch ? this.getBranchLineageIds(selectedBranch.id) : [],
    );
    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
    const premiseOptions = allClaims
      .filter(
        (claim) =>
          claim.archivedAt === null &&
          ((["fact", "statement"].includes(claim.kind) &&
            claim.status === "accepted") ||
            (claim.kind === "inference" && claim.status === "accepted") ||
            (!!claim.branchId &&
              lineageIds.has(claim.branchId) &&
              !["rejected", "superseded"].includes(claim.status))),
      )
      .map((claim) => ({
        ...claim,
        branchName: claim.branchId ? (branchNames.get(claim.branchId) ?? null) : null,
      }));

    return {
      acceptedInferences: hydrated.filter(
        (claim) => claim.kind === "inference" && claim.status === "accepted",
      ),
      branches,
      conflicts: this.listConflicts(caseId),
      exploration: hydrated.filter(
        (claim) =>
          claim.status !== "accepted" &&
          !!claim.branchId &&
          lineageIds.has(claim.branchId),
      ),
      premiseOptions,
      selectedBranch,
    };
  }

  listConflicts(caseId: string): ReasoningConflict[] {
    const links = this.connection.db
      .select({ link: claimLinks })
      .from(claimLinks)
      .innerJoin(claims, eq(claimLinks.premiseClaimId, claims.id))
      .where(and(eq(claims.caseId, caseId), eq(claimLinks.relation, "contradicts")))
      .all()
      .map(({ link }) => link);

    return links.map((link) => {
      const premise = this.getClaimForCaseOrThrow(caseId, link.premiseClaimId);
      const conclusion = this.getClaimForCaseOrThrow(
        caseId,
        link.conclusionClaimId,
      );
      const latestReview = this.connection.db
        .select()
        .from(contradictionReviews)
        .where(eq(contradictionReviews.claimLinkId, link.id))
        .orderBy(desc(contradictionReviews.reviewedAt))
        .get() ?? null;
      const isCurrent =
        latestReview?.premiseRevision === premise.revision &&
        latestReview?.conclusionRevision === conclusion.revision;

      return {
        conclusion,
        isOpen: !isCurrent || latestReview?.decision === "both_review",
        latestReview,
        link,
        premise,
      };
    });
  }

  assessClaim(caseId: string, claimId: string) {
    const claim = this.getReasoningClaimOrThrow(caseId, claimId);
    return this.inspectDependencies(claim, false);
  }

  private hydrateClaim(claim: ClaimRow): ReasoningClaim {
    const branch = claim.branchId
      ? (this.connection.db
          .select()
          .from(reasoningBranches)
          .where(eq(reasoningBranches.id, claim.branchId))
          .get() ?? null)
      : null;
    const links = this.connection.db
      .select()
      .from(claimLinks)
      .where(eq(claimLinks.conclusionClaimId, claim.id))
      .orderBy(asc(claimLinks.createdAt))
      .all();
    const reviews = this.connection.db
      .select()
      .from(claimReviews)
      .where(eq(claimReviews.claimId, claim.id))
      .orderBy(desc(claimReviews.reviewedAt))
      .all();

    return {
      ...claim,
      branch,
      issues: this.inspectDependencies(claim, false),
      premises: links.map((link) => {
        const premise = this.getClaimForCaseOrThrow(claim.caseId, link.premiseClaimId);
        return { claim: premise, isStale: link.premiseRevision !== premise.revision, link };
      }),
      reviews,
    };
  }

  private inspectDependencies(claim: ClaimRow, allowStale: boolean): ReasoningIssue[] {
    const issues: ReasoningIssue[] = [];
    if (claim.archivedAt) {
      issues.push({ code: "archived", message: "已归档的推理不能进入可信层。" });
    }
    if (claim.kind !== "hypothesis" && claim.kind !== "inference") {
      issues.push({ code: "invalid_kind", message: "只有假设或推论可以接受审查。" });
    }

    const premiseLinks = this.connection.db
      .select()
      .from(claimLinks)
      .where(
        and(
          eq(claimLinks.conclusionClaimId, claim.id),
          inArray(claimLinks.relation, ["supports", "depends_on", "qualifies"]),
        ),
      )
      .all();

    if (premiseLinks.length === 0) {
      issues.push({ code: "no_premises", message: "至少需要一条非冲突前提。" });
    }
    for (const link of premiseLinks) {
      const premise = this.getClaimForCaseOrThrow(claim.caseId, link.premiseClaimId);
      if (premise.archivedAt || premise.status !== "accepted") {
        issues.push({
          code: "premise_unavailable",
          message: `前提“${summarize(premise.content)}”尚未被接受或已归档。`,
        });
      }
      if (!allowStale && link.premiseRevision !== premise.revision) {
        issues.push({
          code: "premise_stale",
          message: `前提“${summarize(premise.content)}”已有新修订。`,
        });
      }
      if (!this.isPremiseAccessible(premise, claim)) {
        issues.push({
          code: "scope_violation",
          message: "论证引用了当前分支不可见的草稿。",
        });
      }
    }

    if (this.listConflicts(claim.caseId).some(
      (conflict) =>
        conflict.isOpen &&
        (conflict.premise.id === claim.id || conflict.conclusion.id === claim.id),
    )) {
      issues.push({
        code: "unresolved_conflict",
        message: "这条推理仍有未处理的矛盾关系。",
      });
    }
    return deduplicateIssues(issues);
  }

  private isPremiseAccessible(premise: ClaimRow, conclusion: ClaimRow) {
    if (premise.caseId !== conclusion.caseId) {
      return false;
    }
    if (["fact", "statement"].includes(premise.kind)) {
      return premise.branchId === null;
    }
    if (premise.kind === "inference" && premise.status === "accepted") {
      return true;
    }
    if (!premise.branchId || !conclusion.branchId) {
      return premise.branchId === conclusion.branchId;
    }
    return this.getBranchLineageIds(conclusion.branchId).includes(premise.branchId);
  }

  private getBranchLineageIds(branchId: string) {
    const result: string[] = [];
    const visited = new Set<string>();
    let current = this.connection.db
      .select()
      .from(reasoningBranches)
      .where(eq(reasoningBranches.id, branchId))
      .get();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      result.push(current.id);
      current = current.parentBranchId
        ? this.connection.db
            .select()
            .from(reasoningBranches)
            .where(eq(reasoningBranches.id, current.parentBranchId))
            .get()
        : undefined;
    }
    return result;
  }

  private isBranchDescendant(branchId: string, possibleDescendantId: string) {
    return this.getBranchLineageIds(possibleDescendantId).includes(branchId);
  }

  private changeClaimStatus(
    claim: ClaimRow,
    status: ClaimRow["status"],
    decision: "demoted" | "rejected",
    note: string,
    reviewedBy: ActorKind,
  ) {
    return this.mutateClaim(claim, reviewedBy, (changedAt) => {
      const updated = this.connection.db
        .update(claims)
        .set({ revision: claim.revision + 1, status, updatedAt: changedAt })
        .where(eq(claims.id, claim.id))
        .returning()
        .get();
      this.recordClaimReview(updated, decision, note, reviewedBy, changedAt);
      return updated;
    });
  }

  private mutateClaim<T>(
    claim: ClaimRow,
    changedBy: ActorKind,
    mutation: (changedAt: Date) => T,
  ) {
    const run = this.connection.sqlite.transaction(() => {
      const changedAt = new Date();
      this.recordClaimRevision(claim, changedAt, changedBy);
      const result = mutation(changedAt);
      invalidateDownstreamClaims(this.connection, claim.id, changedAt);
      this.touchCase(claim.caseId, changedAt);
      return result;
    });
    return run();
  }

  private recordClaimRevision(
    claim: ClaimRow,
    changedAt: Date,
    changedBy: ActorKind,
  ) {
    const links = this.connection.db
      .select()
      .from(claimLinks)
      .where(
        or(
          eq(claimLinks.premiseClaimId, claim.id),
          eq(claimLinks.conclusionClaimId, claim.id),
        ),
      )
      .all();
    this.connection.db
      .insert(claimRevisions)
      .values({
        id: randomUUID(),
        changedAt,
        changedBy,
        claimId: claim.id,
        revision: claim.revision,
        snapshot: JSON.stringify({ claim, links }),
      })
      .run();
  }

  private recordClaimReview(
    claim: ClaimRow,
    decision: ClaimReviewRow["decision"],
    note: string,
    reviewedBy: ActorKind,
    reviewedAt: Date,
  ) {
    this.connection.db
      .insert(claimReviews)
      .values({
        id: randomUUID(),
        claimId: claim.id,
        claimRevision: claim.revision,
        decision,
        note: note.trim(),
        premiseSnapshot: JSON.stringify(this.currentPremiseSnapshot(claim.id)),
        reviewedAt,
        reviewedBy,
      })
      .run();
  }

  private currentPremiseSnapshot(claimId: string) {
    return this.connection.db
      .select()
      .from(claimLinks)
      .where(
        and(
          eq(claimLinks.conclusionClaimId, claimId),
          inArray(claimLinks.relation, ["supports", "depends_on", "qualifies"]),
        ),
      )
      .all()
      .map((link) => {
        const premise = this.reasoning.getClaimOrThrow(link.premiseClaimId);
        return {
          claimId: premise.id,
          linkId: link.id,
          relation: link.relation,
          revision: premise.revision,
        };
      });
  }

  private carryForwardConflictReviews(
    previous: ClaimRow,
    updated: ClaimRow,
    reviewedBy: ActorKind,
    reviewedAt: Date,
  ) {
    const links = this.connection.db
      .select()
      .from(claimLinks)
      .where(
        and(
          eq(claimLinks.relation, "contradicts"),
          or(
            eq(claimLinks.premiseClaimId, previous.id),
            eq(claimLinks.conclusionClaimId, previous.id),
          ),
        ),
      )
      .all();

    for (const link of links) {
      const premise =
        link.premiseClaimId === previous.id
          ? previous
          : this.getClaimForCaseOrThrow(previous.caseId, link.premiseClaimId);
      const conclusion =
        link.conclusionClaimId === previous.id
          ? previous
          : this.getClaimForCaseOrThrow(previous.caseId, link.conclusionClaimId);
      const latestReview = this.connection.db
        .select()
        .from(contradictionReviews)
        .where(eq(contradictionReviews.claimLinkId, link.id))
        .orderBy(desc(contradictionReviews.reviewedAt))
        .get();

      if (
        !latestReview ||
        latestReview.decision === "both_review" ||
        latestReview.premiseRevision !== premise.revision ||
        latestReview.conclusionRevision !== conclusion.revision
      ) {
        continue;
      }
      const premiseRevision =
        premise.id === previous.id
          ? updated.revision
          : premise.revision;
      const conclusionRevision =
        conclusion.id === previous.id
          ? updated.revision
          : conclusion.revision;
      this.connection.db
        .insert(contradictionReviews)
        .values({
          id: randomUUID(),
          claimLinkId: link.id,
          conclusionRevision,
          decision: latestReview.decision,
          note: latestReview.note,
          premiseRevision,
          reviewedAt,
          reviewedBy,
        })
        .run();
    }
  }

  private refreshPremiseVersions(claimId: string) {
    this.connection.sqlite
      .prepare(
        `
          update claim_links
          set premise_revision = (
            select revision from claims
            where claims.id = claim_links.premise_claim_id
          )
          where conclusion_claim_id = ?
            and relation <> 'contradicts'
        `,
      )
      .run(claimId);
  }

  private getBranchOrThrow(caseId: string, branchId: string) {
    const branch = this.connection.db
      .select()
      .from(reasoningBranches)
      .where(
        and(eq(reasoningBranches.id, branchId), eq(reasoningBranches.caseId, caseId)),
      )
      .get();
    if (!branch) {
      throw new Error("Branch must belong to the requested case.");
    }
    return branch;
  }

  private getActiveBranchOrThrow(caseId: string, branchId: string) {
    const branch = this.getBranchOrThrow(caseId, branchId);
    if (branch.status !== "active") {
      throw new Error("Archived branches cannot be edited.");
    }
    return branch;
  }

  private getClaimForCaseOrThrow(caseId: string, claimId: string) {
    const claim = this.reasoning.getClaimOrThrow(claimId);
    if (claim.caseId !== caseId) {
      throw new Error("Claim must belong to the requested case.");
    }
    return claim;
  }

  private getReasoningClaimOrThrow(caseId: string, claimId: string) {
    const claim = this.getClaimForCaseOrThrow(caseId, claimId);
    if (claim.kind !== "hypothesis" && claim.kind !== "inference") {
      throw new Error("Claim must belong to the reasoning layer.");
    }
    if (claim.archivedAt) {
      throw new Error("Archived claims cannot be edited.");
    }
    return claim;
  }

  private getLinkForCaseOrThrow(caseId: string, linkId: string) {
    const link = this.connection.db
      .select()
      .from(claimLinks)
      .where(eq(claimLinks.id, linkId))
      .get();
    if (!link) {
      throw new Error("Argument link not found.");
    }
    this.getClaimForCaseOrThrow(caseId, link.premiseClaimId);
    this.getClaimForCaseOrThrow(caseId, link.conclusionClaimId);
    return link;
  }

  private assertCaseExists(caseId: string) {
    const caseFile = this.connection.db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.id, caseId))
      .get();
    if (!caseFile) {
      throw new Error(`Case not found: ${caseId}`);
    }
  }

  private touchCase(caseId: string, updatedAt = new Date()) {
    this.connection.db
      .update(cases)
      .set({ updatedAt })
      .where(eq(cases.id, caseId))
      .run();
  }
}

function requireText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }
  return normalized;
}

function assertPercentage(value: number | null | undefined, label: string) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error(`${label} must be an integer between 0 and 100.`);
  }
}

function summarize(value: string) {
  return value.length > 36 ? `${value.slice(0, 35)}…` : value;
}

function deduplicateIssues(issues: ReasoningIssue[]) {
  return issues.filter(
    (issue, index) =>
      issues.findIndex(
        (candidate) =>
          candidate.code === issue.code && candidate.message === issue.message,
      ) === index,
  );
}
