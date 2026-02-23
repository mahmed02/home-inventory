import { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export type ItemMovementEvent = {
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  movedByUserId: string | null;
  ownerUserId: string | null;
  householdId: string | null;
  source: string;
};

export async function recordItemMovement(
  queryable: Queryable,
  params: ItemMovementEvent
): Promise<void> {
  if (params.fromLocationId === params.toLocationId) {
    return;
  }

  await queryable.query(
    `
    INSERT INTO movement_history(
      item_id,
      from_location_id,
      to_location_id,
      moved_by_user_id,
      owner_user_id,
      household_id,
      source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      params.itemId,
      params.fromLocationId,
      params.toLocationId,
      params.movedByUserId,
      params.ownerUserId,
      params.householdId,
      params.source,
    ]
  );
}
