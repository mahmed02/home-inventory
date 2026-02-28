import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendInternalError } from "./http";
import { hashSessionToken } from "../auth/session";

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCookieValue(headerValue: string | undefined, name: string): string | null {
  if (!headerValue || !name) {
    return null;
  }

  const segments = headerValue.split(";");
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIdx = trimmed.indexOf("=");
    if (separatorIdx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIdx).trim();
    if (key !== name) {
      continue;
    }
    const rawValue = trimmed.slice(separatorIdx + 1).trim();
    if (!rawValue) {
      return null;
    }
    try {
      const decoded = decodeURIComponent(rawValue);
      return decoded.length > 0 ? decoded : null;
    } catch {
      return rawValue.length > 0 ? rawValue : null;
    }
  }

  return null;
}

function resolveSessionToken(req: Request): string | null {
  const bearerToken = parseBearerToken(req.headers.authorization);
  if (bearerToken) {
    return bearerToken;
  }
  return parseCookieValue(req.headers.cookie, env.sessionCookieName);
}

function skipSessionAttach(req: Request): boolean {
  return req.path === "/auth/register" || req.path === "/auth/login";
}

function bypassUserAuth(req: Request): boolean {
  return req.path === "/health" || req.path.startsWith("/auth/");
}

export async function attachUserSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (skipSessionAttach(req)) {
    next();
    return;
  }

  const token = resolveSessionToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const tokenHash = hashSessionToken(token);
    const result = await pool.query<{ session_id: string; user_id: string }>(
      `
      SELECT s.id AS session_id, s.user_id
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1
      `,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      next();
      return;
    }

    req.authUserId = result.rows[0].user_id;
    req.authSessionId = result.rows[0].session_id;
    next();
  } catch (error) {
    sendInternalError(error, res);
  }
}

export function requireUserSession(req: Request, res: Response, next: NextFunction): void {
  if (!env.requireUserAccounts || bypassUserAuth(req)) {
    next();
    return;
  }

  if (!req.authUserId) {
    res.status(401).json({ error: "User authentication required" });
    return;
  }

  next();
}
