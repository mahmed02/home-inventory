import { Request } from "express";

export function requestOwnerUserId(req: Request): string | null {
  return req.authUserId ?? null;
}

export function ownerScopeSql(column: string, paramIndex: number): string {
  return `(${column} = $${paramIndex} OR ($${paramIndex}::uuid IS NULL AND ${column} IS NULL))`;
}
