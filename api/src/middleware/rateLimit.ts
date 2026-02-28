import { NextFunction, Request, Response } from "express";

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  max: number;
  windowMs: number;
  message?: string;
  keyResolver?: (req: Request) => string;
};

function maybeCleanupStore(store: Map<string, RateLimitEntry>, now: number): void {
  if (store.size < 10_000) {
    return;
  }

  for (const [key, entry] of store.entries()) {
    if (entry.resetAtMs <= now) {
      store.delete(key);
    }
  }
}

export function createInMemoryRateLimit(options: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    maybeCleanupStore(store, now);

    const resolvedKey = options.keyResolver?.(req);
    const keySuffix =
      typeof resolvedKey === "string" && resolvedKey.trim().length > 0
        ? resolvedKey.trim()
        : typeof req.ip === "string" && req.ip.length > 0
          ? req.ip
          : "unknown";
    const key = `${options.keyPrefix}:${keySuffix}`;

    const existing = store.get(key);
    if (!existing || existing.resetAtMs <= now) {
      store.set(key, {
        count: 1,
        resetAtMs: now + options.windowMs,
      });
      next();
      return;
    }

    if (existing.count >= options.max) {
      res.setHeader("Retry-After", String(Math.ceil((existing.resetAtMs - now) / 1000)));
      res.status(429).json({ error: options.message ?? "Too many requests" });
      return;
    }

    existing.count += 1;
    next();
  };
}
