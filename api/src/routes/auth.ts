import { Router } from "express";
import { PoolClient } from "pg";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { getDbErrorCode, sendInternalError, sendValidationError } from "../middleware/http";
import { asOptionalText, asRequiredText } from "../middleware/validation";
import { ensureOwnerHouseholdForUser } from "../auth/households";
import { hashPassword, verifyPassword } from "../auth/password";
import { generateSessionToken, hashSessionToken } from "../auth/session";
import { sendPasswordResetEmail, sendVerificationEmail } from "../notifications/email";

const authRouter = Router();
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const PASSWORD_RESET_TTL_MINUTES = 30;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return EMAIL_REGEX.test(normalized) ? normalized : null;
}

function validatePassword(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    return null;
  }
  return value;
}

function sessionExpiryIso(): string {
  return new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000).toISOString();
}

function passwordResetExpiryIso(): string {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();
}

function emailVerificationExpiryIso(): string {
  return new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

type Queryable = Pick<PoolClient, "query">;

type AuthUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  email_verified_at: string | Date | null;
};

function isVerified(emailVerifiedAt: string | Date | null): boolean {
  if (typeof emailVerifiedAt === "string") {
    return emailVerifiedAt.length > 0;
  }
  if (emailVerifiedAt instanceof Date) {
    return !Number.isNaN(emailVerifiedAt.getTime());
  }
  return false;
}

async function dispatchEmail<T>(
  label: string,
  sender: () => Promise<T>
): Promise<{ sent: boolean; error_message: string | null }> {
  try {
    await sender();
    return { sent: true, error_message: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    console.error(`${label} failed: ${errorMessage}`);
    return { sent: false, error_message: errorMessage };
  }
}

async function issueSession(
  userId: string,
  queryable: Queryable = pool
): Promise<{ token: string; expires_at: string }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessionExpiryIso();

  await queryable.query(
    `
    INSERT INTO user_sessions(user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expiresAt]
  );

  return { token, expires_at: expiresAt };
}

async function issueEmailVerificationToken(
  userId: string,
  queryable: Queryable = pool
): Promise<{ verification_token: string; expires_at: string }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = emailVerificationExpiryIso();

  await queryable.query(
    `
    UPDATE email_verification_tokens
    SET used_at = now()
    WHERE user_id = $1
      AND used_at IS NULL
    `,
    [userId]
  );

  await queryable.query(
    `
    INSERT INTO email_verification_tokens(user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expiresAt]
  );

  return {
    verification_token: token,
    expires_at: expiresAt,
  };
}

authRouter.post("/auth/register", async (req, res) => {
  const email = normalizeEmail(asRequiredText(req.body.email));
  const password = validatePassword(asRequiredText(req.body.password));
  const displayName = asOptionalText(req.body.display_name);

  if (!email) {
    return sendValidationError(res, "valid email is required");
  }
  if (!password) {
    return sendValidationError(
      res,
      `password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
    );
  }

  const client = await pool.connect();
  try {
    const passwordHash = hashPassword(password);
    await client.query("BEGIN");
    const inserted = await client.query<AuthUserRow>(
      `
      INSERT INTO users(email, password_hash, display_name, email_verified_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, display_name, email_verified_at
      `,
      [email, passwordHash, displayName, null]
    );

    const user = inserted.rows[0];
    await ensureOwnerHouseholdForUser(user.id, user.email, user.display_name, client);
    const session = await issueSession(user.id, client);
    await client.query("COMMIT");

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        email_verified: isVerified(user.email_verified_at),
      },
      token: session.token,
      expires_at: session.expires_at,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (getDbErrorCode(error) === "23505") {
      return res.status(409).json({ error: "Account already exists" });
    }
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

authRouter.post("/auth/login", async (req, res) => {
  const email = normalizeEmail(asRequiredText(req.body.email));
  const password = asRequiredText(req.body.password);

  if (!email || !password) {
    return sendValidationError(res, "email and password are required");
  }

  try {
    const userResult = await pool.query<
      AuthUserRow & {
        password_hash: string;
      }
    >(
      `
      SELECT id, email, display_name, email_verified_at, password_hash
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const session = await issueSession(user.id);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        email_verified: isVerified(user.email_verified_at),
      },
      token: session.token,
      expires_at: session.expires_at,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

authRouter.post("/auth/forgot-password", async (req, res) => {
  const email = normalizeEmail(asRequiredText(req.body.email));
  if (!email) {
    return sendValidationError(res, "valid email is required");
  }

  try {
    const userResult = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(200).json({
        accepted: true,
        reset_token: null,
        expires_at: null,
      });
    }

    const userId = userResult.rows[0].id;
    const resetToken = generateSessionToken();
    const tokenHash = hashSessionToken(resetToken);
    const expiresAt = passwordResetExpiryIso();

    await pool.query(
      `
      INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      `,
      [userId, tokenHash, expiresAt]
    );

    if (env.emailProvider === "disabled") {
      // Dev/local fallback while email delivery is disabled.
      return res.status(200).json({
        accepted: true,
        reset_token: resetToken,
        expires_at: expiresAt,
      });
    }

    const delivery = await dispatchEmail("Password reset email dispatch", () =>
      sendPasswordResetEmail({
        to: email,
        resetToken,
        expiresAtIso: expiresAt,
      })
    );

    return res.status(200).json({
      accepted: true,
      reset_token: null,
      expires_at: expiresAt,
      delivery: delivery.sent ? "sent" : "failed",
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

authRouter.post("/auth/reset-password", async (req, res) => {
  const token = asRequiredText(req.body.token);
  const newPassword = validatePassword(asRequiredText(req.body.new_password));

  if (!token) {
    return sendValidationError(res, "token is required");
  }
  if (!newPassword) {
    return sendValidationError(
      res,
      `new_password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
    );
  }

  const tokenHash = hashSessionToken(token);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tokenResult = await client.query<{ id: string; user_id: string }>(
      `
      SELECT id, user_id
      FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (tokenResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const tokenRow = tokenResult.rows[0];
    const passwordHash = hashPassword(newPassword);

    await client.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      `,
      [passwordHash, tokenRow.user_id]
    );

    await client.query(
      `
      UPDATE password_reset_tokens
      SET used_at = now()
      WHERE id = $1
      `,
      [tokenRow.id]
    );

    await client.query(
      `
      UPDATE user_sessions
      SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL
      `,
      [tokenRow.user_id]
    );

    await client.query("COMMIT");
    return res.status(200).json({ reset: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

authRouter.post("/auth/verify-email", async (req, res) => {
  if (!req.authUserId) {
    return res.status(401).json({ error: "User authentication required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query<{ email: string; email_verified_at: string | null }>(
      `
      SELECT email, email_verified_at
      FROM users
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [req.authUserId]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "User authentication required" });
    }

    const user = userResult.rows[0];
    if (isVerified(user.email_verified_at)) {
      await client.query("COMMIT");
      return res.status(200).json({
        accepted: true,
        already_verified: true,
        verification_token: null,
        expires_at: null,
      });
    }

    const issued = await issueEmailVerificationToken(req.authUserId, client);
    await client.query("COMMIT");

    if (env.emailProvider === "disabled") {
      return res.status(200).json({
        accepted: true,
        already_verified: false,
        verification_token: issued.verification_token,
        expires_at: issued.expires_at,
      });
    }

    const delivery = await dispatchEmail("Verification email dispatch", () =>
      sendVerificationEmail({
        to: user.email,
        verificationToken: issued.verification_token,
        expiresAtIso: issued.expires_at,
      })
    );

    return res.status(200).json({
      accepted: true,
      already_verified: false,
      verification_token: null,
      expires_at: issued.expires_at,
      delivery: delivery.sent ? "sent" : "failed",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

authRouter.post("/auth/verify-email/resend", async (req, res) => {
  if (!req.authUserId) {
    return res.status(401).json({ error: "User authentication required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query<{ email: string; email_verified_at: string | null }>(
      `
      SELECT email, email_verified_at
      FROM users
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [req.authUserId]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "User authentication required" });
    }

    const user = userResult.rows[0];
    if (isVerified(user.email_verified_at)) {
      await client.query("COMMIT");
      return res.status(200).json({
        accepted: true,
        already_verified: true,
        verification_token: null,
        expires_at: null,
      });
    }

    const issued = await issueEmailVerificationToken(req.authUserId, client);
    await client.query("COMMIT");

    if (env.emailProvider === "disabled") {
      return res.status(200).json({
        accepted: true,
        already_verified: false,
        verification_token: issued.verification_token,
        expires_at: issued.expires_at,
      });
    }

    const delivery = await dispatchEmail("Verification resend email dispatch", () =>
      sendVerificationEmail({
        to: user.email,
        verificationToken: issued.verification_token,
        expiresAtIso: issued.expires_at,
      })
    );

    return res.status(200).json({
      accepted: true,
      already_verified: false,
      verification_token: null,
      expires_at: issued.expires_at,
      delivery: delivery.sent ? "sent" : "failed",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

authRouter.post("/auth/verify-email/confirm", async (req, res) => {
  const token = asRequiredText(req.body.token);
  if (!token) {
    return sendValidationError(res, "token is required");
  }

  const tokenHash = hashSessionToken(token);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tokenResult = await client.query<{ id: string; user_id: string }>(
      `
      SELECT id, user_id
      FROM email_verification_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (tokenResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    const tokenRow = tokenResult.rows[0];

    await client.query(
      `
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $1
      `,
      [tokenRow.user_id]
    );

    await client.query(
      `
      UPDATE email_verification_tokens
      SET used_at = now()
      WHERE user_id = $1
        AND used_at IS NULL
      `,
      [tokenRow.user_id]
    );

    await client.query("COMMIT");
    return res.status(200).json({ verified: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

authRouter.post("/auth/logout", async (req, res) => {
  if (!req.authUserId || !req.authSessionId) {
    return res.status(401).json({ error: "User authentication required" });
  }

  try {
    await pool.query(
      `
      UPDATE user_sessions
      SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      `,
      [req.authSessionId, req.authUserId]
    );

    return res.status(200).json({ logged_out: true });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

authRouter.get("/auth/me", async (req, res) => {
  if (!req.authUserId) {
    return res.status(401).json({ error: "User authentication required" });
  }

  try {
    const result = await pool.query<AuthUserRow>(
      `
      SELECT id, email, display_name, email_verified_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.authUserId]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "User authentication required" });
    }

    const user = result.rows[0];
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        email_verified: isVerified(user.email_verified_at),
      },
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default authRouter;
