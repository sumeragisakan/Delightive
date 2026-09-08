import type { DatabaseConnection } from "../connection";

export function invalidateClaimsForEvent(
  connection: DatabaseConnection,
  eventId: string,
  changedAt = new Date(),
) {
  return invalidateClaims(
    connection,
    "select claim_id from claim_events where event_id = ?",
    eventId,
    changedAt,
  );
}

export function invalidateClaimsForSource(
  connection: DatabaseConnection,
  sourceId: string,
  changedAt = new Date(),
) {
  return invalidateClaims(
    connection,
    "select claim_id from claim_sources where source_id = ?",
    sourceId,
    changedAt,
  );
}

export function invalidateDownstreamClaims(
  connection: DatabaseConnection,
  claimId: string,
  changedAt = new Date(),
) {
  return invalidateClaims(
    connection,
    "select conclusion_claim_id from claim_links where premise_claim_id = ?",
    claimId,
    changedAt,
  );
}

function invalidateClaims(
  connection: DatabaseConnection,
  seedQuery: string,
  seedId: string,
  changedAt: Date,
) {
  const commonTableExpression = `
    with recursive affected(id) as (
      ${seedQuery}
      union
      select links.conclusion_claim_id
      from claim_links as links
      join affected on links.premise_claim_id = affected.id
    )
  `;
  const affected = connection.sqlite
    .prepare(`${commonTableExpression} select id from affected`)
    .all(seedId) as Array<{ id: string }>;

  connection.sqlite
    .prepare(
      `
        ${commonTableExpression}
        update claims
        set status = 'needs_review', updated_at = ?
        where id in (select id from affected)
          and status = 'accepted'
      `,
    )
    .run(seedId, changedAt.getTime());

  return affected.map(({ id }) => id);
}
