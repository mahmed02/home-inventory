import { InventoryScope } from "../auth/inventoryScope";
import { SemanticSearchMode, semanticItemSearch } from "../search/semanticSearch";
import { ItemLookupResolution, ResolvedItemCandidate } from "./lookupTypes";

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

export async function resolveItemCandidates(params: {
  scope: InventoryScope;
  subject: string;
  mode?: SemanticSearchMode;
  limit?: number;
  offset?: number;
}): Promise<ItemLookupResolution> {
  const searched = await semanticItemSearch({
    scope: params.scope,
    query: params.subject,
    mode: params.mode ?? "hybrid",
    limit: params.limit ?? 3,
    offset: params.offset ?? 0,
  });

  const candidates: ResolvedItemCandidate[] = searched.results.map((row) => ({
    id: row.id,
    name: row.name,
    image_url: row.image_url,
    quantity: row.quantity,
    location_path: row.location_path,
    lexical_score: row.lexical_score,
    semantic_score: row.semantic_score,
    score: row.score,
  }));

  return {
    subject: params.subject,
    candidates,
    top: candidates[0] ?? null,
    match_count: searched.total,
    ambiguous: hasAmbiguousTopMatch(candidates),
  };
}
