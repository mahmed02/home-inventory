import { Request, Response, Router } from "express";
import { generateSessionToken, hashSessionToken } from "../auth/session";
import { pool } from "../db/pool";
import { sendInternalError, sendValidationError } from "../middleware/http";
import { asOptionalText, asRequiredText } from "../middleware/validation";
import { isUuid } from "../utils";

const householdsRouter = Router();
const HOUSEHOLD_ROLES = new Set(["owner", "editor", "viewer"]);
const INVITATION_TTL_HOURS = 7 * 24;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireAuthUserId(req: Request, res: Response): string | null {
  if (!req.authUserId) {
    res.status(401).json({ error: "User authentication required" });
    return null;
  }
  return req.authUserId;
}

function normalizeEmail(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return EMAIL_REGEX.test(normalized) ? normalized : null;
}

function normalizeRole(
  value: unknown,
  defaultRole = "viewer"
): "owner" | "editor" | "viewer" | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : defaultRole;
  if (!HOUSEHOLD_ROLES.has(normalized)) {
    return null;
  }
  return normalized as "owner" | "editor" | "viewer";
}

async function getMemberRole(householdId: string, userId: string): Promise<string | null> {
  const membership = await pool.query<{ role: string }>(
    `
    SELECT role
    FROM household_members
    WHERE household_id = $1 AND user_id = $2
    LIMIT 1
    `,
    [householdId, userId]
  );
  if ((membership.rowCount ?? 0) === 0) {
    return null;
  }
  return membership.rows[0].role;
}

householdsRouter.get("/households", async (req, res) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const result = await pool.query<{
      household_id: string;
      household_name: string;
      role: string;
      created_at: string;
      created_by_user_id: string | null;
    }>(
      `
      SELECT
        h.id AS household_id,
        h.name AS household_name,
        hm.role,
        h.created_at,
        h.created_by_user_id
      FROM household_members hm
      JOIN households h ON h.id = hm.household_id
      WHERE hm.user_id = $1
      ORDER BY h.created_at ASC
      `,
      [userId]
    );

    return res.status(200).json({
      households: result.rows.map((row) => ({
        id: row.household_id,
        name: row.household_name,
        role: row.role,
        created_at: row.created_at,
        created_by_user_id: row.created_by_user_id,
      })),
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

householdsRouter.post("/households", async (req, res) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) {
    return;
  }

  const name = asOptionalText(req.body.name) ?? "My Household";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const household = await client.query<{ id: string; name: string; created_at: string }>(
      `
      INSERT INTO households(name, created_by_user_id)
      VALUES ($1, $2)
      RETURNING id, name, created_at
      `,
      [name, userId]
    );

    const householdId = household.rows[0].id;
    await client.query(
      `
      INSERT INTO household_members(household_id, user_id, role, invited_by_user_id)
      VALUES ($1, $2, 'owner', $2)
      ON CONFLICT (household_id, user_id) DO NOTHING
      `,
      [householdId, userId]
    );
    await client.query("COMMIT");

    return res.status(201).json({
      household: household.rows[0],
      role: "owner",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

householdsRouter.get("/households/:householdId/members", async (req, res) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) {
    return;
  }

  const householdId = req.params.householdId;
  if (!isUuid(householdId)) {
    return sendValidationError(res, "Invalid household id");
  }

  try {
    const requesterRole = await getMemberRole(householdId, userId);
    if (!requesterRole) {
      return res.status(404).json({ error: "Household not found" });
    }

    const members = await pool.query<{
      user_id: string;
      email: string;
      display_name: string | null;
      role: string;
      joined_at: string;
    }>(
      `
      SELECT hm.user_id, u.email, u.display_name, hm.role, hm.created_at AS joined_at
      FROM household_members hm
      JOIN users u ON u.id = hm.user_id
      WHERE hm.household_id = $1
      ORDER BY
        CASE hm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
        hm.created_at ASC
      `,
      [householdId]
    );

    return res.status(200).json({
      household_id: householdId,
      requester_role: requesterRole,
      members: members.rows,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

householdsRouter.post("/households/:householdId/invitations", async (req, res) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) {
    return;
  }

  const householdId = req.params.householdId;
  if (!isUuid(householdId)) {
    return sendValidationError(res, "Invalid household id");
  }

  const email = normalizeEmail(asRequiredText(req.body.email));
  const role = normalizeRole(req.body.role, "viewer");
  if (!email) {
    return sendValidationError(res, "valid email is required");
  }
  if (!role) {
    return sendValidationError(res, "role must be one of owner, editor, viewer");
  }

  try {
    const requesterRole = await getMemberRole(householdId, userId);
    if (!requesterRole) {
      return res.status(404).json({ error: "Household not found" });
    }
    if (requesterRole !== "owner") {
      return res.status(403).json({ error: "Only owners can manage invitations" });
    }

    const existingMember = await pool.query(
      `
      SELECT 1
      FROM household_members hm
      JOIN users u ON u.id = hm.user_id
      WHERE hm.household_id = $1 AND u.email = $2
      LIMIT 1
      `,
      [householdId, email]
    );
    if ((existingMember.rowCount ?? 0) > 0) {
      return res.status(409).json({ error: "User is already a household member" });
    }

    const pendingInvite = await pool.query(
      `
      SELECT 1
      FROM household_invitations
      WHERE household_id = $1
        AND email = $2
        AND status = 'pending'
        AND revoked_at IS NULL
        AND accepted_at IS NULL
        AND expires_at > now()
      LIMIT 1
      `,
      [householdId, email]
    );
    if ((pendingInvite.rowCount ?? 0) > 0) {
      return res.status(409).json({ error: "An active invitation already exists for this email" });
    }

    const invitationToken = generateSessionToken();
    const tokenHash = hashSessionToken(invitationToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000).toISOString();

    const inserted = await pool.query<{
      id: string;
      household_id: string;
      email: string;
      role: string;
      expires_at: string;
      status: string;
      created_at: string;
    }>(
      `
      INSERT INTO household_invitations(
        household_id,
        email,
        role,
        token_hash,
        invited_by_user_id,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, household_id, email, role, expires_at, status, created_at
      `,
      [householdId, email, role, tokenHash, userId, expiresAt]
    );

    return res.status(201).json({
      invitation: inserted.rows[0],
      invitation_token: invitationToken,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

householdsRouter.delete("/households/:householdId/invitations/:invitationId", async (req, res) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) {
    return;
  }

  const householdId = req.params.householdId;
  const invitationId = req.params.invitationId;
  if (!isUuid(householdId)) {
    return sendValidationError(res, "Invalid household id");
  }
  if (!isUuid(invitationId)) {
    return sendValidationError(res, "Invalid invitation id");
  }

  try {
    const requesterRole = await getMemberRole(householdId, userId);
    if (!requesterRole) {
      return res.status(404).json({ error: "Household not found" });
    }
    if (requesterRole !== "owner") {
      return res.status(403).json({ error: "Only owners can manage invitations" });
    }

    const revoked = await pool.query(
      `
      UPDATE household_invitations
      SET status = 'revoked', revoked_at = now()
      WHERE id = $1
        AND household_id = $2
        AND status = 'pending'
        AND revoked_at IS NULL
        AND accepted_at IS NULL
      `,
      [invitationId, householdId]
    );

    if ((revoked.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    return res.status(200).json({ revoked: true });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

householdsRouter.post("/households/invitations/accept", async (req, res) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) {
    return;
  }

  const token = asRequiredText(req.body.token);
  if (!token) {
    return sendValidationError(res, "token is required");
  }

  const tokenHash = hashSessionToken(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const user = await client.query<{ email: string }>(
      `
      SELECT email
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if ((user.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "User authentication required" });
    }

    const userEmail = user.rows[0].email;
    const invite = await client.query<{
      id: string;
      household_id: string;
      email: string;
      role: "owner" | "editor" | "viewer";
    }>(
      `
      SELECT id, household_id, email, role
      FROM household_invitations
      WHERE token_hash = $1
        AND status = 'pending'
        AND revoked_at IS NULL
        AND accepted_at IS NULL
        AND expires_at > now()
      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if ((invite.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid or expired invitation token" });
    }

    const invitation = invite.rows[0];
    if (invitation.email !== userEmail) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Invitation does not match authenticated user" });
    }

    const roleAssigned = invitation.role;
    await client.query(
      `
      INSERT INTO household_members(household_id, user_id, role, invited_by_user_id)
      VALUES ($1, $2, $3, $2)
      ON CONFLICT (household_id, user_id) DO UPDATE
      SET role = CASE
        WHEN household_members.role = 'owner' THEN household_members.role
        ELSE EXCLUDED.role
      END
      `,
      [invitation.household_id, userId, roleAssigned]
    );

    await client.query(
      `
      UPDATE household_invitations
      SET status = 'accepted',
          accepted_by_user_id = $2,
          accepted_at = now()
      WHERE id = $1
      `,
      [invitation.id, userId]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      accepted: true,
      household_id: invitation.household_id,
      role: roleAssigned,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

export default householdsRouter;
