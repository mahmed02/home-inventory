import assert from "node:assert/strict";
import test from "node:test";
import { parseInventoryIntent } from "../nli/intentParser";

test("parseInventoryIntent maps item lookup phrases", () => {
  const parsed = parseInventoryIntent("Where is my drill?");
  assert.equal(parsed.intent, "find_item");
  assert.equal(parsed.subject, "drill");
  assert.equal(parsed.normalizedSubject, "drill");
  assert.equal(parsed.locationHint, null);
  assert.equal(parsed.amount, null);
});

test("parseInventoryIntent maps location listing phrases", () => {
  const parsed = parseInventoryIntent("what is in the garage");
  assert.equal(parsed.intent, "list_location");
  assert.equal(parsed.subject, "garage");
});

test("parseInventoryIntent maps count and existence phrases to the right read intents", () => {
  const countParsed = parseInventoryIntent("how many drills do I have");
  assert.equal(countParsed.intent, "count_items");
  assert.equal(countParsed.subject, "drills");
  assert.equal(countParsed.normalizedSubject, "drill");

  const haveParsed = parseInventoryIntent("do I have eggs");
  assert.equal(haveParsed.intent, "check_item_existence");
  assert.equal(haveParsed.subject, "eggs");
  assert.equal(haveParsed.normalizedSubject, "egg");
});

test("parseInventoryIntent maps quantity read phrases", () => {
  const parsed = parseInventoryIntent("get count of aa battery pack");
  assert.equal(parsed.intent, "get_item_quantity");
  assert.equal(parsed.subject, "aa battery pack");
  assert.equal(parsed.normalizedSubject, "aa battery pack");
  assert.equal(parsed.amount, null);
});

test("parseInventoryIntent maps quantity mutation phrases", () => {
  const addParsed = parseInventoryIntent("add 3 aa battery pack");
  assert.equal(addParsed.intent, "add_item_quantity");
  assert.equal(addParsed.subject, "aa battery pack");
  assert.equal(addParsed.amount, 3);

  const removeParsed = parseInventoryIntent("remove 2 aa battery pack");
  assert.equal(removeParsed.intent, "remove_item_quantity");
  assert.equal(removeParsed.subject, "aa battery pack");
  assert.equal(removeParsed.amount, 2);

  const setParsed = parseInventoryIntent("set quantity of aa battery pack to 9");
  assert.equal(setParsed.intent, "set_item_quantity");
  assert.equal(setParsed.subject, "aa battery pack");
  assert.equal(setParsed.amount, 9);
});

test("parseInventoryIntent extracts location hints and broader existence phrasing", () => {
  const existenceParsed = parseInventoryIntent("any eggs left in the fridge");
  assert.equal(existenceParsed.intent, "check_item_existence");
  assert.equal(existenceParsed.subject, "eggs left in the fridge");
  assert.equal(existenceParsed.normalizedSubject, "egg");
  assert.equal(existenceParsed.locationHint, "fridge");

  const findParsed = parseInventoryIntent("where is my drill in the garage");
  assert.equal(findParsed.intent, "find_item");
  assert.equal(findParsed.normalizedSubject, "drill");
  assert.equal(findParsed.locationHint, "garage");
});

test("parseInventoryIntent treats 'how much' as quantity lookup phrasing", () => {
  const parsed = parseInventoryIntent("how much batteries do i have");
  assert.equal(parsed.intent, "get_item_quantity");
  assert.equal(parsed.normalizedSubject, "battery");
});

test("parseInventoryIntent maps unsupported write requests safely", () => {
  const parsed = parseInventoryIntent("move the drill to attic");
  assert.equal(parsed.intent, "unsupported_action");
  assert.equal(parsed.subject, "drill to attic");
});
