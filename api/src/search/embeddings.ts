import { env } from "../config/env";

export type EmbeddingProvider = {
  model: string;
  dimensions: number;
  embed(input: string): Promise<number[]>;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "any",
  "are",
  "at",
  "by",
  "find",
  "for",
  "i",
  "in",
  "inventory",
  "is",
  "item",
  "it",
  "locate",
  "me",
  "my",
  "of",
  "on",
  "our",
  "please",
  "show",
  "the",
  "there",
  "to",
  "was",
  "were",
  "where",
  "with",
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  air: ["pneumatic", "inflator", "compressor"],
  battery: ["batteries", "cell", "cells"],
  bin: ["container", "storage", "tote"],
  compressor: ["air", "inflator", "pump", "pneumatic"],
  container: ["bin", "storage", "tote"],
  drill: ["driver", "masonry"],
  glove: ["gloves", "mittens"],
  gloves: ["glove", "mittens", "winter"],
  inflator: ["air", "compressor", "pump", "tire"],
  pump: ["air", "compressor", "inflator"],
  pneumatic: ["air", "compressor", "inflator"],
  saw: ["blade"],
  shovel: ["spade"],
  storage: ["bin", "container", "tote"],
  tire: ["inflator", "pump"],
  tote: ["bin", "container", "storage"],
  winter: ["cold", "gloves"],
};

const PHRASE_EXPANSIONS: Array<{ pattern: RegExp; tokens: string[] }> = [
  { pattern: /\bair\s+pump\b/, tokens: ["air", "compressor", "inflator", "pneumatic"] },
  { pattern: /\btire\s+pump\b/, tokens: ["compressor", "inflator", "pump", "tire"] },
  { pattern: /\bwinter\s+gloves?\b/, tokens: ["gloves", "mittens", "winter"] },
  { pattern: /\btool\s+belt\b/, tokens: ["belt", "tool", "toolbelt"] },
];

type SemanticTerms = {
  base: string[];
  expanded: string[];
};

function clampDimensions(value: number): number {
  if (!Number.isFinite(value)) {
    return 64;
  }
  return Math.min(Math.max(Math.trunc(value), 8), 2048);
}

function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function dedupe(tokens: Iterable<string>): string[] {
  return Array.from(new Set(tokens));
}

function meaningfulTokens(value: string): string[] {
  const tokens = tokenize(value);
  const filtered = tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  if (filtered.length > 0) {
    return dedupe(filtered);
  }
  return dedupe(tokens.filter((token) => token.length > 1));
}

function resolveSemanticTerms(value: string): SemanticTerms {
  const normalized = value.toLowerCase();
  const base = meaningfulTokens(normalized);
  const expanded = new Set(base);

  for (const token of base) {
    const synonyms = TOKEN_SYNONYMS[token] ?? [];
    for (const synonym of synonyms) {
      for (const normalizedSynonym of tokenize(synonym)) {
        if (normalizedSynonym.length > 1) {
          expanded.add(normalizedSynonym);
        }
      }
    }
  }

  for (const expansion of PHRASE_EXPANSIONS) {
    if (!expansion.pattern.test(normalized)) {
      continue;
    }
    for (const expansionToken of expansion.tokens) {
      for (const normalizedExpansionToken of tokenize(expansionToken)) {
        if (normalizedExpansionToken.length > 1) {
          expanded.add(normalizedExpansionToken);
        }
      }
    }
  }

  return {
    base,
    expanded: Array.from(expanded),
  };
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, entry) => sum + entry * entry, 0));
  if (magnitude <= 0) {
    return values;
  }
  return values.map((entry) => entry / magnitude);
}

function deterministicEmbedding(input: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const terms = resolveSemanticTerms(input);
  const baseTerms = new Set(terms.base);

  for (const token of terms.expanded) {
    const index = fnv1aHash(token) % dimensions;
    const weight = baseTerms.has(token) ? 1 : 0.72;
    vector[index] += weight;
  }

  for (let index = 0; index < terms.base.length - 1; index += 1) {
    const bigram = `${terms.base[index]}_${terms.base[index + 1]}`;
    const bucket = fnv1aHash(bigram) % dimensions;
    vector[bucket] += 1.15;
  }

  return normalizeVector(vector);
}

export function semanticQueryTerms(input: string): string[] {
  return resolveSemanticTerms(input).expanded;
}

function createDeterministicProvider(): EmbeddingProvider {
  const dimensions = clampDimensions(env.embeddingDimensions);
  return {
    model: `deterministic-v1-${dimensions}`,
    dimensions,
    async embed(input: string): Promise<number[]> {
      return deterministicEmbedding(input, dimensions);
    },
  };
}

let cachedProvider: EmbeddingProvider | null = null;

export function resolveEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  switch (env.embeddingsProvider) {
    case "deterministic":
    default:
      cachedProvider = createDeterministicProvider();
      return cachedProvider;
  }
}
