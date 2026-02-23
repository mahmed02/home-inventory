import { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export type LocationQrCodeRow = {
  id: string;
  location_id: string;
  code: string;
  owner_user_id: string | null;
  household_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function ensureLocationQrCode(
  queryable: Queryable,
  params: { locationId: string; ownerUserId: string | null; householdId: string | null }
): Promise<LocationQrCodeRow> {
  const result = await queryable.query<LocationQrCodeRow>(
    `
    INSERT INTO location_qr_codes(location_id, owner_user_id, household_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (location_id) DO UPDATE
      SET
        owner_user_id = COALESCE(location_qr_codes.owner_user_id, EXCLUDED.owner_user_id),
        household_id = COALESCE(location_qr_codes.household_id, EXCLUDED.household_id)
    RETURNING id, location_id, code, owner_user_id, household_id, created_at, updated_at
    `,
    [params.locationId, params.ownerUserId, params.householdId]
  );

  return result.rows[0];
}
