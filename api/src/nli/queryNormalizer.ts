function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const LOCATION_HINT_PATTERN =
  /^(.*?)\s+(?:in|inside|at|from)\s+(?:the\s+)?([a-z0-9][a-z0-9\s-]*)$/i;

const IRREGULAR_SINGULARS: Record<string, string> = {
  batteries: "battery",
  boxes: "box",
  cartons: "carton",
  eggs: "egg",
  gloves: "glove",
  shelves: "shelf",
  tools: "tool",
};

function singularizeToken(token: string): string {
  const lower = token.toLowerCase();
  const irregular = IRREGULAR_SINGULARS[lower];
  if (irregular) {
    return irregular;
  }

  if (lower.endsWith("ies") && lower.length > 3) {
    return `${lower.slice(0, -3)}y`;
  }

  if (/(xes|zes|ches|shes|sses)$/.test(lower) && lower.length > 4) {
    return lower.slice(0, -2);
  }

  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
    return lower.slice(0, -1);
  }

  return lower;
}

export function normalizeLookupSubject(subject: string): {
  normalizedSubject: string;
  locationHint: string | null;
} {
  const normalized = normalizeWhitespace(subject.toLowerCase());
  const locationMatch = normalized.match(LOCATION_HINT_PATTERN);
  const baseSubject = normalizeWhitespace(
    (locationMatch ? locationMatch[1] : normalized).replace(/\s+(left|remaining|available)$/i, "")
  );
  const locationHint = locationMatch ? normalizeWhitespace(locationMatch[2]) : null;

  const normalizedSubject = normalizeWhitespace(
    baseSubject
      .split(" ")
      .map((token) => singularizeToken(token))
      .join(" ")
  );

  return {
    normalizedSubject: normalizedSubject || baseSubject,
    locationHint,
  };
}
