import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { lexicalQueryTerms } from "../search/embeddings";
import { SemanticSearchMode, semanticItemSearch } from "../search/semanticSearch";
import { ItemLookupResolution, ResolvedItemCandidate } from "./lookupTypes";

export type LexicalItemSourceRow = {
  id: string;
  name: string;
  image_url: string | null;
  quantity: number | null;
  description: string | null;
  keywords: string[];
  location_path: string;
};

type RankedLexicalCandidate = ResolvedItemCandidate & {
  token_overlap_score: number;
};

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

function computeLexicalScore(row: LexicalItemSourceRow, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return 0;
  }

  let score = 0;
  if (row.name.toLowerCase().includes(needle)) {
    score += 3;
  }
  if ((row.description ?? "").toLowerCase().includes(needle)) {
    score += 1.5;
  }
  if ((row.keywords ?? []).join(" ").toLowerCase().includes(needle)) {
    score += 1;
  }
  return score;
}

function computeTokenOverlapScore(row: LexicalItemSourceRow, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const text = `${row.name} ${row.description ?? ""} ${(row.keywords ?? []).join(" ")}`
    .toLowerCase()
    .trim();

  let count = 0;
  for (const term of queryTerms) {
    if (text.includes(term)) {
      count += 1;
    }
  }
  return count;
}

function sortByRank(rows: RankedLexicalCandidate[]): RankedLexicalCandidate[] {
  return rows.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.lexical_score !== a.lexical_score) {
      return b.lexical_score - a.lexical_score;
    }
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name);
    }
    return a.id.localeCompare(b.id);
  });
}

async function fetchScopedItems(scope: InventoryScope): Promise<LexicalItemSourceRow[]> {
  const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
  const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 1);
  const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 1);

  const result = await pool.query<LexicalItemSourceRow>(
    `
    WITH RECURSIVE location_paths AS (
      SELECT id, parent_id, name, name::text AS path
      FROM locations
      WHERE parent_id IS NULL AND ${rootScope.sql}
      UNION ALL
      SELECT l.id, l.parent_id, l.name, lp.path || ' > ' || l.name
      FROM locations l
      JOIN location_paths lp ON l.parent_id = lp.id
      WHERE ${recursiveScope.sql}
    )
    SELECT
      i.id,
      i.name,
      i.image_url,
      i.quantity,
      i.description,
      i.keywords,
      lp.path AS location_path
    FROM items i
    JOIN location_paths lp ON lp.id = i.location_id
    WHERE ${itemScope.sql}
    ORDER BY i.name ASC, i.id ASC
    `,
    rootScope.params
  );

  return result.rows;
}

export function rankKeywordCandidates(params: {
  rows: LexicalItemSourceRow[];
  subject: string;
  limit: number;
  offset?: number;
}): {
  candidates: ResolvedItemCandidate[];
  matchCount: number;
  confident: boolean;
} {
  const queryTerms = lexicalQueryTerms(params.subject);

  const ranked: RankedLexicalCandidate[] = [];
  for (const row of params.rows) {
    const lexicalScore = computeLexicalScore(row, params.subject);
    const tokenOverlapScore = computeTokenOverlapScore(row, queryTerms);
    if (lexicalScore <= 0 && tokenOverlapScore <= 0) {
      continue;
    }

    ranked.push({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      quantity: row.quantity,
      location_path: row.location_path,
      lexical_score: lexicalScore,
      semantic_score: 0,
      score: lexicalScore + tokenOverlapScore * 0.35,
      token_overlap_score: tokenOverlapScore,
    });
  }

  const ordered = sortByRank(ranked);
  const offset = params.offset ?? 0;
  const candidates = ordered.slice(offset, offset + params.limit).map((row) => ({
    id: row.id,
    name: row.name,
    image_url: row.image_url,
    quantity: row.quantity,
    location_path: row.location_path,
    lexical_score: row.lexical_score,
    semantic_score: row.semantic_score,
    score: row.score,
  }));

  if (candidates.length === 0) {
    return { candidates: [], matchCount: 0, confident: false };
  }

  const top = ordered[0];
  const matchedAllTerms = queryTerms.length > 0 && top.token_overlap_score >= queryTerms.length;
  const confident = top.lexical_score > 0 || matchedAllTerms;

  return {
    candidates,
    matchCount: ordered.length,
    confident,
  };
}

function buildResolution(
  subject: string,
  candidates: ResolvedItemCandidate[],
  matchCount = candidates.length
): ItemLookupResolution {
  return {
    subject,
    candidates,
    top: candidates[0] ?? null,
    match_count: matchCount,
    ambiguous: hasAmbiguousTopMatch(candidates),
  };
}

export async function resolveItemCandidates(params: {
  scope: InventoryScope;
  subject: string;
  mode?: SemanticSearchMode;
  limit?: number;
  offset?: number;
}): Promise<ItemLookupResolution> {
  const mode = params.mode ?? "hybrid";
  const limit = params.limit ?? 3;

  if (mode !== "semantic") {
    const lexical = rankKeywordCandidates({
      rows: await fetchScopedItems(params.scope),
      subject: params.subject,
      limit,
      offset: params.offset ?? 0,
    });

    if (lexical.confident) {
      return buildResolution(params.subject, lexical.candidates, lexical.matchCount);
    }

    const searched = await semanticItemSearch({
      scope: params.scope,
      query: params.subject,
      mode,
      limit,
      offset: params.offset ?? 0,
    });

    const semanticCandidates: ResolvedItemCandidate[] = searched.results.map((row) => ({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      quantity: row.quantity,
      location_path: row.location_path,
      lexical_score: row.lexical_score,
      semantic_score: row.semantic_score,
      score: row.score,
    }));

    if (semanticCandidates.length > 0) {
      return buildResolution(params.subject, semanticCandidates, searched.total);
    }

    if (lexical.candidates.length > 0) {
      return buildResolution(params.subject, lexical.candidates, lexical.matchCount);
    }

    return buildResolution(params.subject, []);
  }

  const searched = await semanticItemSearch({
    scope: params.scope,
    query: params.subject,
    mode,
    limit,
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

  return buildResolution(params.subject, candidates, searched.total);
}
