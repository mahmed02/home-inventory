import { Request, Response, Router } from "express";
import { PoolClient } from "pg";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { getDbErrorCode, sendInternalError, sendValidationError } from "../middleware/http";
import { createInMemoryRateLimit } from "../middleware/rateLimit";
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
const AUTH_RATE_WINDOW_MS = env.authRateLimitWindowSeconds * 1000;
const LOGIN_FAILURE_WINDOW_MS = env.authLoginFailureWindowSeconds * 1000;
const LOGIN_FAILURE_LOCKOUT_MS = env.authLoginFailureLockoutSeconds * 1000;

type LoginFailureEntry = {
  count: number;
  windowResetAtMs: number;
  blockedUntilMs: number;
};

const loginFailureStore = new Map<string, LoginFailureEntry>();

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

function resolveClientIp(req: Request): string {
  if (typeof req.ip === "string" && req.ip.trim().length > 0) {
    return req.ip.trim();
  }
  return "unknown";
}

function resolveAuthIdentityKey(req: Request, explicitEmail?: string | null): string {
  const emailFromBody = normalizeEmail(
    asOptionalText((req.body as { email?: unknown } | null)?.email)
  );
  const emailSegment = explicitEmail ?? emailFromBody ?? "unknown";
  return `${resolveClientIp(req)}:${emailSegment}`;
}

function retryAfterSeconds(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function loginLockoutSecondsRemaining(key: string): number {
  const now = Date.now();
  const entry = loginFailureStore.get(key);
  if (!entry) {
    return 0;
  }
  if (entry.blockedUntilMs <= now) {
    entry.blockedUntilMs = 0;
    if (entry.windowResetAtMs <= now) {
      loginFailureStore.delete(key);
    }
    return 0;
  }
  return retryAfterSeconds(entry.blockedUntilMs - now);
}

function clearLoginFailures(key: string): void {
  loginFailureStore.delete(key);
}

function recordFailedLoginAttempt(key: string): number {
  const now = Date.now();
  let entry = loginFailureStore.get(key);
  if (!entry || entry.windowResetAtMs <= now) {
    entry = {
      count: 0,
      windowResetAtMs: now + LOGIN_FAILURE_WINDOW_MS,
      blockedUntilMs: 0,
    };
  }

  entry.count += 1;
  if (entry.count >= env.authLoginFailureMaxAttempts) {
    entry.blockedUntilMs = now + LOGIN_FAILURE_LOCKOUT_MS;
    entry.count = 0;
    entry.windowResetAtMs = now + LOGIN_FAILURE_WINDOW_MS;
  }

  loginFailureStore.set(key, entry);
  if (entry.blockedUntilMs > now) {
    return retryAfterSeconds(entry.blockedUntilMs - now);
  }
  return 0;
}

function cookieSameSiteValue(): "Strict" | "Lax" | "None" {
  if (env.sessionCookieSameSite === "strict") {
    return "Strict";
  }
  if (env.sessionCookieSameSite === "none") {
    return "None";
  }
  return "Lax";
}

function shouldSetSessionCookie(): boolean {
  return env.sessionTransport === "cookie" || env.sessionTransport === "hybrid";
}

function shouldReturnBearerToken(): boolean {
  return env.sessionTransport === "bearer" || env.sessionTransport === "hybrid";
}

function buildSessionCookie(token: string, expiresAtIso: string): string {
  const expiresAt = new Date(expiresAtIso);
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const segments = [
    `${env.sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${cookieSameSiteValue()}`,
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (env.sessionCookieSecure) {
    segments.push("Secure");
  }
  if (env.sessionCookieDomain) {
    segments.push(`Domain=${env.sessionCookieDomain}`);
  }
  return segments.join("; ");
}

function buildExpiredSessionCookie(): string {
  const segments = [
    `${env.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${cookieSameSiteValue()}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (env.sessionCookieSecure) {
    segments.push("Secure");
  }
  if (env.sessionCookieDomain) {
    segments.push(`Domain=${env.sessionCookieDomain}`);
  }
  return segments.join("; ");
}

function applySessionResponse(res: Response, session: { token: string; expires_at: string }) {
  if (shouldSetSessionCookie()) {
    res.append("Set-Cookie", buildSessionCookie(session.token, session.expires_at));
  }
  return {
    token: shouldReturnBearerToken() ? session.token : null,
    expires_at: session.expires_at,
    session_transport: env.sessionTransport,
  };
}

function clearSessionCookie(res: Response): void {
  if (!shouldSetSessionCookie()) {
    return;
  }
  res.append("Set-Cookie", buildExpiredSessionCookie());
}

const registerRateLimit = createInMemoryRateLimit({
  keyPrefix: "auth:register",
  max: env.authRegisterRateLimitMax,
  windowMs: AUTH_RATE_WINDOW_MS,
  message: "Too many registration attempts. Try again later.",
  keyResolver: (req) => resolveAuthIdentityKey(req),
});

const loginRateLimit = createInMemoryRateLimit({
  keyPrefix: "auth:login",
  max: env.authLoginRateLimitMax,
  windowMs: AUTH_RATE_WINDOW_MS,
  message: "Too many login attempts. Try again later.",
  keyResolver: (req) => resolveAuthIdentityKey(req),
});

const forgotPasswordRateLimit = createInMemoryRateLimit({
  keyPrefix: "auth:forgot-password",
  max: env.authForgotPasswordRateLimitMax,
  windowMs: AUTH_RATE_WINDOW_MS,
  message: "Too many password reset requests. Try again later.",
  keyResolver: (req) => resolveAuthIdentityKey(req),
});

const resetPasswordRateLimit = createInMemoryRateLimit({
  keyPrefix: "auth:reset-password",
  max: env.authResetPasswordRateLimitMax,
  windowMs: AUTH_RATE_WINDOW_MS,
  message: "Too many reset attempts. Try again later.",
});

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

authRouter.post("/auth/register", registerRateLimit, async (req, res) => {
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
    const sessionResponse = applySessionResponse(res, session);
    await client.query("COMMIT");

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        email_verified: isVerified(user.email_verified_at),
      },
      token: sessionResponse.token,
      expires_at: sessionResponse.expires_at,
      session_transport: sessionResponse.session_transport,
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

authRouter.post("/auth/login", loginRateLimit, async (req, res) => {
  const email = normalizeEmail(asRequiredText(req.body.email));
  const password = asRequiredText(req.body.password);

  if (!email || !password) {
    return sendValidationError(res, "email and password are required");
  }

  const loginKey = resolveAuthIdentityKey(req, email);
  const blockedSeconds = loginLockoutSecondsRemaining(loginKey);
  if (blockedSeconds > 0) {
    res.setHeader("Retry-After", String(blockedSeconds));
    return res.status(429).json({ error: "Too many invalid login attempts. Try again later." });
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
      const lockoutAfterSeconds = recordFailedLoginAttempt(loginKey);
      if (lockoutAfterSeconds > 0) {
        res.setHeader("Retry-After", String(lockoutAfterSeconds));
        return res.status(429).json({ error: "Too many invalid login attempts. Try again later." });
      }
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      const lockoutAfterSeconds = recordFailedLoginAttempt(loginKey);
      if (lockoutAfterSeconds > 0) {
        res.setHeader("Retry-After", String(lockoutAfterSeconds));
        return res.status(429).json({ error: "Too many invalid login attempts. Try again later." });
      }
      return res.status(401).json({ error: "Invalid email or password" });
    }

    clearLoginFailures(loginKey);
    const session = await issueSession(user.id);
    const sessionResponse = applySessionResponse(res, session);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        email_verified: isVerified(user.email_verified_at),
      },
      token: sessionResponse.token,
      expires_at: sessionResponse.expires_at,
      session_transport: sessionResponse.session_transport,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

authRouter.post("/auth/forgot-password", forgotPasswordRateLimit, async (req, res) => {
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
      return res.status(200).json({ accepted: true });
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
      return res.status(200).json({ accepted: true });
    }

    await dispatchEmail("Password reset email dispatch", () =>
      sendPasswordResetEmail({
        to: email,
        resetToken,
        expiresAtIso: expiresAt,
      })
    );

    return res.status(200).json({ accepted: true });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

authRouter.post("/auth/reset-password", resetPasswordRateLimit, async (req, res) => {
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
    clearSessionCookie(res);
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
        verification_token: null,
        expires_at: issued.expires_at,
        delivery: "disabled",
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
        verification_token: null,
        expires_at: issued.expires_at,
        delivery: "disabled",
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

    clearSessionCookie(res);
    return res.status(200).json({ logged_out: true, session_transport: env.sessionTransport });
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
      session_transport: env.sessionTransport,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default authRouter;
