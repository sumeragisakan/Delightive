import type { DatabaseConnection } from "../connection";

export function invalidateClaimsForEvent(
  connection: DatabaseConnection,
  eventId: string,
  changedAt = new Date(),
) {
  const affected = connection.sqlite
    .prepare(
      `
        with recursive affected(id) as (
          select claim_id
          from claim_events
          where event_id = ?
          union
          select links.conclusion_claim_id
          from claim_links as links
          join affected on links.premise_claim_id = affected.id
        )
        select id from affected
      `,
    )
    .all(eventId) as Array<{ id: string }>;

  connection.sqlite
    .prepare(
      `
        with recursive affected(id) as (
          select claim_id
          from claim_events
          where event_id = ?
          union
          select links.conclusion_claim_id
          from claim_links as links
          join affected on links.premise_claim_id = affected.id
        )
        update claims
        set status = 'needs_review', updated_at = ?
        where id in (select id from affected)
          and status = 'accepted'
      `,
    )
    .run(eventId, changedAt.getTime());

  return affected.map(({ id }) => id);
}
