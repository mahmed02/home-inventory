import { InventoryIntent, ParsedInventoryIntent } from "./lookupTypes";
import { normalizeLookupSubject } from "./queryNormalizer";

export function roundConfidence(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 100) / 100;
}

function normalizePunctuation(value: string): string {
  return value
    .trim()
    .replace(/[\s]+/g, " ")
    .replace(/[?.!]+$/g, "");
}

function cleanupSubject(raw: string): string {
  return normalizePunctuation(raw)
    .replace(/^(is|are|was|were)\s+/i, "")
    .replace(/^(of|from|to)\s+/i, "")
    .replace(/^(the|a|an|my|our|any)\s+/i, "")
    .replace(/\s+(please|in inventory|in the inventory)$/i, "")
    .trim();
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function buildParsedIntent(params: {
  intent: InventoryIntent;
  subject: string;
  confidence: number;
  rawQuery: string;
  normalizedQuery: string;
  amount: number | null;
}): ParsedInventoryIntent {
  const subject = params.subject || params.normalizedQuery;
  const normalized = normalizeLookupSubject(subject);
  return {
    intent: params.intent,
    subject,
    normalizedSubject: normalized.normalizedSubject,
    locationHint: normalized.locationHint,
    confidence: params.confidence,
    rawQuery: params.rawQuery,
    normalizedQuery: params.normalizedQuery,
    amount: params.amount,
  };
}

export function parseInventoryIntent(query: string): ParsedInventoryIntent {
  const normalizedQuery = normalizePunctuation(query).toLowerCase();

  const setQuantityMatch =
    normalizedQuery.match(
      /^(?:set|update)\s+(?:the\s+)?(?:count|quantity)\s+(?:of\s+)?(.+?)\s+(?:to|=)\s*(\d+)$/i
    ) || normalizedQuery.match(/^(?:set|update)\s+(.+?)\s+(?:count|quantity)\s+(?:to|=)\s*(\d+)$/i);
  if (setQuantityMatch) {
    const amount = parseNonNegativeInt(setQuantityMatch[2]);
    const subject = cleanupSubject(setQuantityMatch[1]);
    if (amount !== null && subject) {
      return buildParsedIntent({
        intent: "set_item_quantity",
        subject,
        confidence: 0.95,
        rawQuery: query,
        normalizedQuery,
        amount,
      });
    }
  }

  const addQuantityMatch = normalizedQuery.match(/^(?:add|increase)\s+(?:(\d+)\s+)?(.+)$/i);
  if (addQuantityMatch) {
    const explicitAmount = addQuantityMatch[1];
    const parsedAmount = parsePositiveInt(explicitAmount);
    if (explicitAmount && parsedAmount === null) {
      return buildParsedIntent({
        intent: "unsupported_action",
        subject: cleanupSubject(addQuantityMatch[2]) || normalizedQuery,
        confidence: 0.8,
        rawQuery: query,
        normalizedQuery,
        amount: null,
      });
    }
    const amount = parsedAmount ?? 1;
    const subject = cleanupSubject(addQuantityMatch[2]);
    if (subject) {
      return buildParsedIntent({
        intent: "add_item_quantity",
        subject,
        confidence: 0.88,
        rawQuery: query,
        normalizedQuery,
        amount,
      });
    }
  }

  const removeQuantityMatch = normalizedQuery.match(
    /^(?:remove|decrease|subtract)\s+(?:(\d+)\s+)?(.+)$/i
  );
  if (removeQuantityMatch) {
    const explicitAmount = removeQuantityMatch[1];
    const parsedAmount = parsePositiveInt(explicitAmount);
    if (explicitAmount && parsedAmount === null) {
      return buildParsedIntent({
        intent: "unsupported_action",
        subject: cleanupSubject(removeQuantityMatch[2]) || normalizedQuery,
        confidence: 0.8,
        rawQuery: query,
        normalizedQuery,
        amount: null,
      });
    }
    const amount = parsedAmount ?? 1;
    const subject = cleanupSubject(removeQuantityMatch[2]);
    if (subject) {
      return buildParsedIntent({
        intent: "remove_item_quantity",
        subject,
        confidence: 0.88,
        rawQuery: query,
        normalizedQuery,
        amount,
      });
    }
  }

  const getQuantityMatch =
    normalizedQuery.match(/^(?:get|show)\s+(?:the\s+)?(?:count|quantity)\s+(?:of\s+)?(.+)$/i) ||
    normalizedQuery.match(
      /^(?:what(?:'s| is)\s+(?:the\s+)?(?:count|quantity)\s+(?:of\s+)?)(.+)$/i
    ) ||
    normalizedQuery.match(/^how many(?:\s+of)?\s+(?:my|our)\s+(.+?)(?:\s+do\s+i\s+have)?$/i) ||
    normalizedQuery.match(/^how much\s+(.+?)(?:\s+do\s+i\s+have)?$/i);
  if (getQuantityMatch) {
    const subject = cleanupSubject(getQuantityMatch[1]);
    return buildParsedIntent({
      intent: "get_item_quantity",
      subject: subject || normalizedQuery,
      confidence: 0.9,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    });
  }

  const unsupportedMatch = normalizedQuery.match(/^(move|delete|rename|update|edit)\s+(.+)$/i);
  if (unsupportedMatch) {
    const subject = cleanupSubject(unsupportedMatch[2]);
    return buildParsedIntent({
      intent: "unsupported_action",
      subject: subject || normalizedQuery,
      confidence: 0.96,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    });
  }

  const listLocationMatch = normalizedQuery.match(
    /^(?:what(?:'s| is)|show|list)\s+(?:in|inside)\s+(.+)$/i
  );
  if (listLocationMatch) {
    const subject = cleanupSubject(listLocationMatch[1]);
    return buildParsedIntent({
      intent: "list_location",
      subject: subject || normalizedQuery,
      confidence: 0.92,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    });
  }

  const countMatch = normalizedQuery.match(
    /^how many\s+(.+?)(?:\s+do\s+i\s+have|\s+are\s+there)?$/i
  );
  if (countMatch) {
    const subject = cleanupSubject(countMatch[1]);
    return buildParsedIntent({
      intent: "count_items",
      subject: subject || normalizedQuery,
      confidence: 0.93,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    });
  }

  const whereMatch = normalizedQuery.match(
    /^(?:where\s+(?:is|are|was|were)|where's|where can i find|locate|find)\s+(.+)$/i
  );
  if (whereMatch) {
    const subject = cleanupSubject(whereMatch[1]);
    return buildParsedIntent({
      intent: "find_item",
      subject: subject || normalizedQuery,
      confidence: 0.9,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    });
  }

  const haveMatch =
    normalizedQuery.match(/^do\s+i\s+have\s+(.+)$/i) ||
    normalizedQuery.match(/^(?:any|got any)\s+(.+)$/i) ||
    normalizedQuery.match(/^are\s+there\s+any\s+(.+)$/i) ||
    normalizedQuery.match(/^is\s+there\s+(?:a|an|any)\s+(.+)$/i);
  if (haveMatch) {
    const subject = cleanupSubject(haveMatch[1]);
    return buildParsedIntent({
      intent: "check_item_existence",
      subject: subject || normalizedQuery,
      confidence: 0.82,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    });
  }

  return buildParsedIntent({
    intent: "find_item",
    subject: cleanupSubject(normalizedQuery) || normalizedQuery,
    confidence: 0.55,
    rawQuery: query,
    normalizedQuery,
    amount: null,
  });
}

export function scoreConfidence(
  parseConfidence: number,
  lexicalScore: number,
  semanticScore: number
): number {
  const lexicalNorm = Math.max(0, Math.min(1, lexicalScore / 5));
  const semanticNorm = Math.max(0, Math.min(1, (semanticScore + 1) / 2));
  return roundConfidence(parseConfidence * 0.4 + lexicalNorm * 0.4 + semanticNorm * 0.2);
}

export function isQueryIntent(parsed: ParsedInventoryIntent, intent: InventoryIntent): boolean {
  return parsed.intent === intent;
}
