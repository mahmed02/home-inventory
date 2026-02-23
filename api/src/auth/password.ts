import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const HASH_PREFIX = "scrypt";
const HASH_KEY_BYTES = 64;
const SALT_BYTES = 16;

function splitPasswordHash(serializedHash: string): { salt: string; hash: string } | null {
  const [prefix, salt, hash] = serializedHash.split(":");
  if (prefix !== HASH_PREFIX || !salt || !hash) {
    return null;
  }
  return { salt, hash };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(password, salt, HASH_KEY_BYTES).toString("hex");
  return `${HASH_PREFIX}:${salt}:${hash}`;
}

export function verifyPassword(password: string, serializedHash: string): boolean {
  const parsed = splitPasswordHash(serializedHash);
  if (!parsed) {
    return false;
  }

  const expected = Buffer.from(parsed.hash, "hex");
  const actual = Buffer.from(
    scryptSync(password, parsed.salt, HASH_KEY_BYTES).toString("hex"),
    "hex"
  );

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
