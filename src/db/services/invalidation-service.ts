import type { DatabaseConnection } from "../connection";

export function invalidateClaimsForEvent(
  connection: DatabaseConnection,
  eventId: string,
  changedAt = new Date(),
) {
  // Derived time changes do not fabricate a user revision of descendant events.
  connection.sqlite.prepare(`
    with recursive affected_events(id) as (
      select id from events where anchor_event_id = ?
      union
      select e.id from events e join affected_events a on e.anchor_event_id = a.id
    )
    update events set time_basis_revision = time_basis_revision + 1
    where id in (select id from affected_events)
  `).run(eventId);
  return invalidateClaims(
    connection,
    `select claim_id from claim_events where event_id in (
      with recursive affected_events(id) as (
        select ? union
        select e.id from events e join affected_events a on e.anchor_event_id = a.id
      ) select id from affected_events
    )`,
    eventId,
    changedAt,
  );
}

export function invalidateClaimsForTimelineBasis(connection: DatabaseConnection, caseId: string, changedAt = new Date()) {
  connection.sqlite.prepare("update events set time_basis_revision = time_basis_revision + 1 where case_id = ?").run(caseId);
  return invalidateClaims(connection,
    "select ce.claim_id from claim_events ce join events e on e.id = ce.event_id where e.case_id = ?",
    caseId, changedAt);
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
