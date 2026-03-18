import { InventoryScope } from "../auth/inventoryScope";
import { resolveItemCandidates } from "./itemResolver";
import { ReadItemLookup, SingleReadItemResolution } from "./lookupTypes";

export async function resolveReadItemLookup(params: {
  scope: InventoryScope;
  subject: string;
  limit?: number;
}): Promise<ReadItemLookup> {
  const resolution = await resolveItemCandidates({
    scope: params.scope,
    subject: params.subject,
    limit: params.limit ?? 10,
  });

  return {
    subject: resolution.subject,
    candidates: resolution.candidates,
    top: resolution.top,
    match_count: resolution.match_count,
    has_matches: resolution.match_count > 0 && resolution.top !== null,
    ambiguous: resolution.ambiguous,
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
