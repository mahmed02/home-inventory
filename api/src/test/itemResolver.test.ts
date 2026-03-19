import assert from "node:assert/strict";
import test from "node:test";

process.env.SEARCH_PROVIDER = "memory";

type LexicalItemSourceRow = {
  id: string;
  name: string;
  image_url: string | null;
  quantity: number | null;
  description: string | null;
  keywords: string[];
  location_path: string;
};

function buildRow(
  overrides: Partial<LexicalItemSourceRow> & Pick<LexicalItemSourceRow, "id" | "name">
): LexicalItemSourceRow {
  return {
    id: overrides.id,
    name: overrides.name,
    image_url: overrides.image_url ?? null,
    quantity: overrides.quantity ?? null,
    description: overrides.description ?? null,
    keywords: overrides.keywords ?? [],
    location_path: overrides.location_path ?? "House > Garage",
  };
}

test("rankKeywordCandidates treats item keywords as lexical aliases", async () => {
  const { rankKeywordCandidates } = await import("../nli/itemResolver");

  const ranked = rankKeywordCandidates({
    subject: "egg carton",
    limit: 5,
    rows: [
      buildRow({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Egg Box",
        keywords: ["egg", "eggs", "carton"],
        quantity: 4,
        location_path: "House > Pantry",
      }),
    ],
  });

  assert.equal(ranked.confident, true);
  assert.equal(ranked.matchCount, 1);
  assert.equal(ranked.candidates[0]?.name, "Egg Box");
  assert.equal(ranked.candidates[0]?.quantity, 4);
});

test("rankKeywordCandidates stays non-confident on weak partial lexical overlap", async () => {
  const { rankKeywordCandidates } = await import("../nli/itemResolver");

  const ranked = rankKeywordCandidates({
    subject: "air pump",
    limit: 5,
    rows: [
      buildRow({
        id: "22222222-2222-4222-8222-222222222222",
        name: "Air Compressor",
        keywords: ["air", "compressor"],
      }),
    ],
  });

  assert.equal(ranked.matchCount, 1);
  assert.equal(ranked.candidates[0]?.name, "Air Compressor");
  assert.equal(ranked.confident, false);
});

test("rankKeywordCandidates supports stable lexical pagination", async () => {
  const { rankKeywordCandidates } = await import("../nli/itemResolver");

  const ranked = rankKeywordCandidates({
    subject: "drill",
    limit: 1,
    offset: 1,
    rows: [
      buildRow({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Drill Alpha",
        keywords: ["power"],
      }),
      buildRow({
        id: "44444444-4444-4444-8444-444444444444",
        name: "Workshop Tool",
        description: "Drill for concrete anchors",
        keywords: ["tool"],
      }),
      buildRow({
        id: "55555555-5555-4555-8555-555555555555",
        name: "Bit Organizer",
        keywords: ["drill", "bits"],
      }),
    ],
  });

  assert.equal(ranked.matchCount, 3);
  assert.equal(ranked.confident, true);
  assert.equal(ranked.candidates.length, 1);
  assert.equal(ranked.candidates[0]?.name, "Workshop Tool");
});
