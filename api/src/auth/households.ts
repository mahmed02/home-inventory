import { PoolClient } from "pg";
import { pool } from "../db/pool";

type Queryable = {
  query<T = unknown>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

function displayBaseName(email: string, displayName: string | null): string {
  const name = displayName?.trim();
  if (name && name.length > 0) {
    return name;
  }
  const [localPart] = email.split("@");
  return localPart && localPart.length > 0 ? localPart : "Household";
}

function dbFromClient(client?: PoolClient): Queryable {
  return client ?? pool;
}

export async function ensureOwnerHouseholdForUser(
  userId: string,
  email: string,
  displayName: string | null,
  client?: PoolClient
): Promise<string> {
  const db = dbFromClient(client);

  const existing = await db.query<{ household_id: string }>(
    `
    SELECT household_id
    FROM household_members
    WHERE user_id = $1
      AND role = 'owner'
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [userId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return existing.rows[0].household_id;
  }

  const householdName = `${displayBaseName(email, displayName)} Household`;
  const insertedHousehold = await db.query<{ id: string }>(
    `
    INSERT INTO households(name, created_by_user_id)
    VALUES ($1, $2)
    RETURNING id
    `,
    [householdName, userId]
  );

  const householdId = insertedHousehold.rows[0].id;
  await db.query(
    `
    INSERT INTO household_members(household_id, user_id, role, invited_by_user_id)
    VALUES ($1, $2, 'owner', $2)
    ON CONFLICT (household_id, user_id) DO NOTHING
    `,
    [householdId, userId]
  );

  return householdId;
}

export async function resolvePrimaryHouseholdIdForUser(
  userId: string | null,
  client?: PoolClient
): Promise<string | null> {
  if (!userId) {
    return null;
  }

  const db = dbFromClient(client);
  const result = await db.query<{ household_id: string }>(
    `
    SELECT household_id
    FROM household_members
    WHERE user_id = $1
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, created_at ASC
    LIMIT 1
    `,
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return result.rows[0].household_id;
}
