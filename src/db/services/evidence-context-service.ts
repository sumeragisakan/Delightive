import type { DatabaseConnection } from "../connection";
import { cases } from "../schema";
import { EvidenceRepository } from "../repositories/evidence-repository";
import { eq } from "drizzle-orm";

export function buildEvidenceContext(
  connection: DatabaseConnection,
  caseId: string,
) {
  const caseFile = connection.db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .get();

  if (!caseFile) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const evidence = new EvidenceRepository(connection).listEvidenceClaims(
    caseId,
    false,
  );
  const acceptedEvidence = evidence.filter(
    (claim) =>
      claim.status === "accepted" &&
      claim.sources.some(
        (link) =>
          !link.isStale &&
          link.source.archivedAt === null &&
          link.relation !== "contradicts",
      ) &&
      claim.events.every((link) => !link.isStale),
  );
  const referencedSources = new Map<
    string,
    (typeof acceptedEvidence)[number]["sources"][number]["source"]
  >();

  for (const claim of acceptedEvidence) {
    for (const link of claim.sources) {
      if (!link.isStale && link.source.archivedAt === null) {
        referencedSources.set(link.source.id, link.source);
      }
    }
  }

  return {
    case: {
      id: caseFile.id,
      timelineMode: caseFile.timelineMode,
      timelineOriginAt: caseFile.timelineOriginAt?.toISOString() ?? null,
      timelineOriginLabel: caseFile.timelineOriginLabel,
      title: caseFile.title,
    },
    evidence: acceptedEvidence.map((claim) => ({
      confidence: claim.confidence,
      content: claim.content,
      events: claim.events.map((link) => ({
        id: link.event.id,
        revision: link.eventRevision,
        role: link.role,
        title: link.event.title,
      })),
      id: claim.id,
      kind: claim.kind,
      locations: claim.locations.map((link) => ({
        id: link.location.id,
        name: link.location.name,
        role: link.role,
      })),
      people: claim.people.map((link) => ({
        displayName: link.person.displayName,
        id: link.person.id,
        role: link.role,
      })),
      revision: claim.revision,
      sources: claim.sources.map((link) => ({
        id: link.source.id,
        relation: link.relation,
        revision: link.sourceRevision,
      })),
      speaker:
        claim.kind === "statement" && claim.speaker
          ? {
              displayName: claim.speaker.displayName,
              id: claim.speaker.id,
            }
          : null,
    })),
    excluded: {
      draft: evidence.filter((claim) => claim.status === "draft").length,
      ineligibleAccepted:
        evidence.filter((claim) => claim.status === "accepted").length -
        acceptedEvidence.length,
      needsReview: evidence.filter((claim) => claim.status === "needs_review")
        .length,
      rejected: evidence.filter((claim) => claim.status === "rejected").length,
      superseded: evidence.filter((claim) => claim.status === "superseded")
        .length,
    },
    sources: [...referencedSources.values()].map((source) => ({
      excerpt: source.excerpt,
      id: source.id,
      kind: source.kind,
      locator: source.locator,
      revision: source.revision,
      title: source.title,
    })),
  };
}

export type EvidenceContext = ReturnType<typeof buildEvidenceContext>;
