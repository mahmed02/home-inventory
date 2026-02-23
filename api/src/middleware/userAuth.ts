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

  const token = parseBearerToken(req.headers.authorization);
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
      if (req.path.startsWith("/auth/")) {
        next();
        return;
      }
      res.status(401).json({ error: "Invalid or expired session" });
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
