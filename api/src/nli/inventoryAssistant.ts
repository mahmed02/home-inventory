import { InventoryScope } from "../auth/inventoryScope";
import { parseInventoryIntent } from "./intentParser";
import {
  checkItemExistenceIntent,
  countItemsIntent,
  findItemIntent,
  getItemQuantityIntent,
} from "./itemIntentHandlers";
import { listLocationIntent } from "./locationIntentHandlers";
import { unsupportedActionResponse } from "./lookupResponses";
import {
  InventoryAssistantOptions,
  InventoryAssistantResponse,
  InventoryIntent,
  ParsedInventoryIntent,
  QuantityMutationOperation,
} from "./lookupTypes";
import { mutateItemQuantityIntent } from "./quantityIntentHandlers";

export { parseInventoryIntent } from "./intentParser";
export type {
  InventoryAssistantOptions,
  InventoryAssistantResponse,
  InventoryIntent,
  ParsedInventoryIntent,
  QuantityMutationOperation,
} from "./lookupTypes";

export async function answerInventoryQuestion(
  query: string,
  scope: InventoryScope,
  options: InventoryAssistantOptions = {}
): Promise<InventoryAssistantResponse> {
  const parsed = parseInventoryIntent(query);

  switch (parsed.intent) {
    case "find_item":
      return findItemIntent(parsed, scope);
    case "list_location":
      return listLocationIntent(parsed, scope);
    case "check_item_existence":
      return checkItemExistenceIntent(parsed, scope);
    case "count_items":
      return countItemsIntent(parsed, scope);
    case "get_item_quantity":
      return getItemQuantityIntent(parsed, scope);
    case "set_item_quantity":
      return mutateItemQuantityIntent(parsed, scope, "set", options);
    case "add_item_quantity":
      return mutateItemQuantityIntent(parsed, scope, "add", options);
    case "remove_item_quantity":
      return mutateItemQuantityIntent(parsed, scope, "remove", options);
    case "unsupported_action":
      return unsupportedActionResponse(parsed);
    default:
      return findItemIntent(parsed, scope);
  }
}
