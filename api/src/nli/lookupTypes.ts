export type InventoryIntent =
  | "find_item"
  | "list_location"
  | "check_item_existence"
  | "count_items"
  | "get_item_quantity"
  | "set_item_quantity"
  | "add_item_quantity"
  | "remove_item_quantity"
  | "unsupported_action";

export type ParsedInventoryIntent = {
  intent: InventoryIntent;
  subject: string;
  confidence: number;
  rawQuery: string;
  normalizedQuery: string;
  amount: number | null;
};

export type InventoryAssistantResponse = {
  query: string;
  normalized_query: string;
  intent: InventoryIntent;
  confidence: number;
  fallback: boolean;
  answer: string;
  item: string | null;
  location_path: string | null;
  notes: string;
  match_count: number;
  requires_confirmation: boolean;
  quantity?: number | null;
  previous_quantity?: number | null;
  quantity_operation?: "get" | "set" | "add" | "remove" | null;
};

export type InventoryAssistantOptions = {
  allowQuantityMutations?: boolean;
  idempotencyKey?: string | null;
};

export type QuantityMutationOperation = "set" | "add" | "remove";

export type ResolvedItemCandidate = {
  id: string;
  name: string;
  image_url: string | null;
  quantity: number | null;
  location_path: string;
  lexical_score: number;
  semantic_score: number;
  score: number;
};

export type ItemLookupResolution = {
  subject: string;
  candidates: ResolvedItemCandidate[];
  top: ResolvedItemCandidate | null;
  match_count: number;
  ambiguous: boolean;
};

export type ReadItemLookup = {
  subject: string;
  candidates: ResolvedItemCandidate[];
  top: ResolvedItemCandidate | null;
  match_count: number;
  has_matches: boolean;
  ambiguous: boolean;
};

export type SingleReadItemResolution =
  | {
      status: "none";
      lookup: ReadItemLookup;
      item: null;
    }
  | {
      status: "ambiguous";
      lookup: ReadItemLookup;
      item: null;
      names: string[];
    }
  | {
      status: "single";
      lookup: ReadItemLookup;
      item: ResolvedItemCandidate;
    };
