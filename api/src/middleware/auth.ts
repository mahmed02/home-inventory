import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

function safeStringEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);

  if (leftBuf.length !== rightBuf.length) {
    return false;
  }

  return timingSafeEqual(leftBuf, rightBuf);
}

function parseBasicAuthHeader(headerValue: string): { username: string; password: string } | null {
  const [scheme, token] = headerValue.split(" ", 2);
  if (scheme?.toLowerCase() !== "basic" || !token) {
    return null;
  }

  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const separatorIdx = decoded.indexOf(":");
    if (separatorIdx < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIdx),
      password: decoded.slice(separatorIdx + 1),
    };
  } catch {
    return null;
  }
}

function shouldBypassAuth(req: Request): boolean {
  return req.path === "/health";
}

export function requireBasicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.requireAuth || shouldBypassAuth(req)) {
    next();
    return;
  }

  const rawAuth = req.headers.authorization;
  const credentials = rawAuth ? parseBasicAuthHeader(rawAuth) : null;

  if (
    credentials &&
    safeStringEqual(credentials.username, env.basicAuthUser) &&
    safeStringEqual(credentials.password, env.basicAuthPass)
  ) {
    next();
    return;
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="home-inventory"');
  res.status(401).json({ error: "Authentication required" });
}
