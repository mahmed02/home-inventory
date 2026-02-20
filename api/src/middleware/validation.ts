import { isUuid, normalizeOptionalText } from "../utils";

export function asRequiredText(value: unknown): string | null {
  return normalizeOptionalText(value);
}

export function asOptionalText(value: unknown): string | null {
  return normalizeOptionalText(value);
}

export function asOptionalUuid(value: unknown): string | null | "INVALID" {
  const normalized = value === null ? null : normalizeOptionalText(value);
  if (normalized === null) {
    return null;
  }
  return isUuid(normalized) ? normalized : "INVALID";
}

export function asRequiredUuid(value: unknown): string | "INVALID" {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return "INVALID";
  }
  return isUuid(normalized) ? normalized : "INVALID";
}

export function asKeywords(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((k: unknown): k is string => typeof k === "string");
}
