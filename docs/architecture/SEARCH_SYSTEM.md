# Search and Lookup System

Last updated: **2026-03-18**

This document explains how the inventory search and natural-language lookup system currently works, and how the planned optional LLM normalizer fits into that design.

---

## 1) High-Level Overview

There are two connected layers:

1. **Search / retrieval**
   - Finds candidate items from inventory data.
   - Supports lexical, semantic, and hybrid retrieval.
   - Semantic retrieval is currently backed by **Pinecone** in deployed environments.

2. **Natural-language lookup**
   - Interprets a user question such as:
     - `where is my drill`
     - `do I have eggs`
     - `how many drills do I have`
     - `set quantity of batteries to 12`
   - Converts that request into a structured intent and parameters.
   - Routes the request to deterministic inventory handlers.

The current philosophy is:

- Use **deterministic execution** for reads and writes.
- Use search only to resolve candidate items or locations.
- Keep any future LLM usage limited to **query normalization**, not direct data access or mutation.

---

## 2) Current Search / Retrieval Layer

### Retrieval modes

The item search layer supports:

- `lexical`
- `semantic`
- `hybrid`

The main runtime code lives under:

- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/search/semanticSearch.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/search/pineconeClient.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/search/itemEmbeddings.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/search/embeddings.ts`

### Provider model

Search is implemented behind a provider abstraction.

In deployed environments, the semantic layer is typically:

- `SEARCH_PROVIDER=pinecone`

For deterministic CI/test runs, the system can use:

- `SEARCH_PROVIDER=memory`

This lets tests run without a live Pinecone dependency.

### What Pinecone is doing

Pinecone is used for the **semantic retrieval step**:

- inventory items are indexed as embeddings
- a user query is embedded
- Pinecone returns semantically similar items

The app then applies local logic to shape the result set used by the API and NLI layers.

### What hybrid means

Hybrid search combines:

- lexical signals
- semantic similarity
- small local reranking logic

That is why a query can still behave reasonably even when the exact item name is not used.

---

## 3) Current Natural-Language Lookup Flow

The current lookup pipeline is intentionally split into small modules.

### Main files

- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/inventoryAssistant.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/intentParser.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/readItemResolver.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/itemResolver.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/itemIntentHandlers.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/locationIntentHandlers.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/quantityIntentHandlers.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/lookupResponses.ts`
- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/lookupTypes.ts`

### Current pipeline

1. A request reaches:
   - `GET /api/items/lookup?q=...`
   - or `GET /shortcut/find-item?q=...`

2. The route calls:
   - `answerInventoryQuestion(...)`
   - file: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/inventoryAssistant.ts`

3. `intentParser.ts` converts the raw query into a deterministic structured intent.

4. Read-style item intents use:
   - `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/readItemResolver.ts`
   - which builds on `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/itemResolver.ts`

5. `itemResolver.ts` calls the shared search system to get candidate items.

6. The appropriate handler formats the final response.

---

## 4) How the Deterministic Parser Works

The parser in:

- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/intentParser.ts`

uses a normalized text string plus ordered pattern matching.

### What it extracts

The parser currently identifies:

- `intent`
- `subject`
- `amount` (for quantity mutations)
- `confidence`

### Example

Input:

```txt
Where is my drill?
```

Normalized form:

```txt
where is my drill
```

Parsed result:

```json
{
  "intent": "find_item",
  "subject": "drill",
  "confidence": 0.9,
  "amount": null
}
```

### Supported intent categories

Current examples include:

- `find_item`
- `list_location`
- `check_item_existence`
- `count_items`
- `get_item_quantity`
- `set_item_quantity`
- `add_item_quantity`
- `remove_item_quantity`
- `unsupported_action`

### Important limitation

The parser is **pattern-based**, not truly language-native.

That means it is strong for known phrasings, but weaker on:

- paraphrases
- informal speech
- incomplete queries
- synonym-heavy requests

It usually does not hard-fail. Instead, it can produce a **soft failure** such as:

- the wrong intent
- weak subject extraction
- generic fallback behavior

---

## 5) Shared Read-Intent Contract

One recent cleanup was separating item read behavior from item write behavior.

Read-style item requests now follow one shared contract:

- resolve candidate set
- decide whether the result is:
  - no match
  - single resolved item
  - ambiguous multi-match
- let each handler format the response

This contract powers:

- location lookup for one item
- existence checks
- count of matching item records
- quantity lookup for a single resolved item

That logic lives in:

- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/readItemResolver.ts`

This makes it easier to add new read intents without rewriting the whole lookup stack.

---

## 6) Current Write Path

Quantity writes use deterministic logic in:

- `/Users/mohammedahmed/MyProjects/home_inventory/api/src/nli/quantityIntentHandlers.ts`

Examples:

- `add 3 aa battery pack`
- `remove 1 drill bit`
- `set quantity of batteries to 12`

These writes are protected by:

- auth / household role checks
- confirmation gating
- idempotency key support
- DB validation and constraints

This is important because future LLM integration must **not** bypass these controls.

---

## 7) Planned Optional LLM Normalizer

The planned LLM role is:

- convert messy natural language into a normalized structured request

The planned LLM role is **not**:

- directly reading the database
- directly searching Pinecone
- directly mutating inventory

### Why add it

The LLM can help with requests that do not fit existing patterns well, for example:

- `any eggs left in the fridge`
- `got any gloves around here`
- `how much milk do I have`
- `where'd I leave the air pump`

### Recommended placement

The LLM should sit between:

- deterministic parsing
- handler dispatch

In other words:

1. try regex parser first
2. if the parse is weak or ambiguous, call the LLM normalizer
3. validate the LLM output against a strict schema
4. pass the normalized request into the existing deterministic handlers

### Proposed normalized schema

```ts
type NormalizedInventoryIntent = {
  intent:
    | "find_item"
    | "check_item_existence"
    | "count_items"
    | "get_item_quantity"
    | "list_location"
    | "set_item_quantity"
    | "add_item_quantity"
    | "remove_item_quantity"
    | "unsupported_action"
    | "unknown";

  subject: string | null;
  amount: number | null;
  location_hint: string | null;
  confidence: number;
  parser_source: "deterministic" | "llm";
  explanation: string | null;
};
```

### Safety rule

The LLM may normalize intent and parameters.

The backend must still:

- validate the result
- resolve inventory candidates deterministically
- enforce permission checks
- enforce confirmation/idempotency for writes

---

## 8) Example End-to-End Flow

Example query:

```txt
do I have egg box
```

Current flow:

1. `intentParser.ts`
   - intent: `check_item_existence`
   - subject: `egg box`

2. `readItemResolver.ts`
   - resolves candidate set using shared item search

3. `itemResolver.ts`
   - calls the search layer

4. `semanticSearch.ts`
   - uses Pinecone-backed retrieval when enabled

5. `itemIntentHandlers.ts`
   - formats the final answer, for example:
   - `Yes, Egg Box is in House > Pantry. Quantity: 4.`

Planned future flow for a harder query:

```txt
any eggs left in the fridge
```

1. deterministic parser is weak
2. LLM normalizer produces:

```json
{
  "intent": "check_item_existence",
  "subject": "eggs",
  "location_hint": "fridge",
  "amount": null,
  "confidence": 0.89,
  "parser_source": "llm",
  "explanation": "User is asking for item existence with a location hint."
}
```

3. the existing deterministic resolver/handler flow runs from there

---

## 9) Summary

Current state:

- Pinecone handles semantic retrieval
- deterministic parsing handles natural-language intent extraction
- read and write handlers execute inventory logic deterministically

Near-future direction:

- keep deterministic execution as the source of truth
- optionally add an LLM only for structured query normalization
- validate LLM output strictly before running any resolver or mutation logic

This keeps the system safer, easier to reason about, and easier to extend.
