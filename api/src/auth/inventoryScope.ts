import { Request } from "express";
import { pool } from "../db/pool";
import { isUuid, normalizeOptionalText } from "../utils";

export type HouseholdRole = "owner" | "editor" | "viewer";

export type InventoryScope = {
  userId: string | null;
  ownerUserId: string | null;
  householdId: string | null;
  role: HouseholdRole | null;
  mode: "household" | "owner_legacy";
};

type ScopeResolution =
  | { ok: true; scope: InventoryScope }
  | { ok: false; status: 400 | 404; message: string };

function requestedHouseholdId(req: Request): string | null | "INVALID" {
  const headerValue = req.headers["x-household-id"];
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const normalized = normalizeOptionalText(raw);
  if (!normalized) {
    return null;
  }
  return isUuid(normalized) ? normalized : "INVALID";
}

export async function resolveInventoryScope(req: Request): Promise<ScopeResolution> {
  const authUserId = req.authUserId ?? null;
  if (!authUserId) {
    return {
      ok: true,
      scope: {
        userId: null,
        ownerUserId: null,
        householdId: null,
        role: null,
        mode: "owner_legacy",
      },
    };
  }

  const requested = requestedHouseholdId(req);
  if (requested === "INVALID") {
    return { ok: false, status: 400, message: "x-household-id must be a valid UUID" };
  }

  const values: string[] = [authUserId];
  let whereClause = "user_id = $1";
  if (requested) {
    whereClause += " AND household_id = $2";
    values.push(requested);
  }

  const membership = await pool.query<{ household_id: string; role: HouseholdRole }>(
    `
    SELECT household_id, role
    FROM household_members
    WHERE ${whereClause}
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, created_at ASC
    LIMIT 1
    `,
    values
  );

  if ((membership.rowCount ?? 0) === 0) {
    if (requested) {
      return { ok: false, status: 404, message: "Household not found" };
    }
    return {
      ok: true,
      scope: {
        userId: authUserId,
        ownerUserId: authUserId,
        householdId: null,
        role: null,
        mode: "owner_legacy",
      },
    };
  }

  const selected = membership.rows[0];
  return {
    ok: true,
    scope: {
      userId: authUserId,
      ownerUserId: authUserId,
      householdId: selected.household_id,
      role: selected.role,
      mode: "household",
    },
  };
}

export function inventoryScopeSql(
  scope: InventoryScope,
  householdColumn: string,
  ownerColumn: string,
  paramIndex: number
): { sql: string; params: [string | null] } {
  if (scope.householdId) {
    return {
      sql: `${householdColumn} = $${paramIndex}`,
      params: [scope.householdId],
    };
  }

  return {
    sql: `(${ownerColumn} = $${paramIndex} OR ($${paramIndex}::uuid IS NULL AND ${ownerColumn} IS NULL))`,
    params: [scope.ownerUserId],
  };
}

export function canWriteInventory(scope: InventoryScope): boolean {
  if (!scope.householdId) {
    return true;
  }
  return scope.role === "owner" || scope.role === "editor";
}
