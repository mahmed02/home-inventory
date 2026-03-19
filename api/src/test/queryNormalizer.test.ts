import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLookupSubject } from "../nli/queryNormalizer";
import { lexicalQueryTerms } from "../search/embeddings";

test("normalizeLookupSubject singularizes common plural inventory terms", () => {
  const normalized = normalizeLookupSubject("eggs");
  assert.equal(normalized.normalizedSubject, "egg");
  assert.equal(normalized.locationHint, null);

  const batteries = normalizeLookupSubject("AA batteries");
  assert.equal(batteries.normalizedSubject, "aa battery");
});

test("normalizeLookupSubject extracts trailing location hints", () => {
  const normalized = normalizeLookupSubject("egg cartons in the fridge");
  assert.equal(normalized.normalizedSubject, "egg carton");
  assert.equal(normalized.locationHint, "fridge");
});

test("lexicalQueryTerms keeps lexical matching literal instead of expanding synonyms", () => {
  assert.deepEqual(lexicalQueryTerms("air pump"), ["air", "pump"]);
  assert.deepEqual(lexicalQueryTerms("winter gloves"), ["winter", "gloves"]);
});
