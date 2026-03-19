import { InventoryScope } from "../auth/inventoryScope";
import { resolveItemCandidates } from "./itemResolver";
import { ReadItemLookup, ResolvedItemCandidate, SingleReadItemResolution } from "./lookupTypes";

function hasAmbiguousTopMatch(candidates: ResolvedItemCandidate[]): boolean {
  if (candidates.length < 2) {
    return false;
  }

  const top = candidates[0];
  const next = candidates[1];
  if (top.name.toLowerCase() === next.name.toLowerCase()) {
    return false;
  }

  return Math.abs(top.score - next.score) <= 0.08;
}

function applyLocationHint(
  candidates: ResolvedItemCandidate[],
  locationHint: string | null | undefined
): ResolvedItemCandidate[] {
  if (!locationHint) {
    return candidates;
  }

  const normalizedHint = locationHint.trim().toLowerCase();
  if (!normalizedHint) {
    return candidates;
  }

  const hinted = candidates.filter((candidate) =>
    candidate.location_path.toLowerCase().includes(normalizedHint)
  );

  return hinted.length > 0 ? hinted : candidates;
}

export async function resolveReadItemLookup(params: {
  scope: InventoryScope;
  subject: string;
  locationHint?: string | null;
  limit?: number;
}): Promise<ReadItemLookup> {
  const resolution = await resolveItemCandidates({
    scope: params.scope,
    subject: params.subject,
    limit: params.limit ?? 10,
  });

  const candidates = applyLocationHint(resolution.candidates, params.locationHint);

  return {
    subject: resolution.subject,
    candidates,
    top: candidates[0] ?? null,
    match_count: candidates.length,
    has_matches: candidates.length > 0,
    ambiguous: hasAmbiguousTopMatch(candidates),
  };
}

export function resolveSingleReadItem(lookup: ReadItemLookup): SingleReadItemResolution {
  if (!lookup.top) {
    return {
      status: "none",
      lookup,
      item: null,
    };
  }

  if (lookup.ambiguous) {
    return {
      status: "ambiguous",
      lookup,
      item: null,
      names: lookup.candidates.map((row) => row.name),
    };
  }

  return {
    status: "single",
    lookup,
    item: lookup.top,
  };
}
