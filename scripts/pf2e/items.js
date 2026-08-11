/** PF2e physical inventory types offered by the normal store. */
export const PURCHASABLE_ITEM_TYPES = new Set([
  "ammo",
  "armor",
  "backpack",
  "book",
  "consumable",
  "equipment",
  "shield",
  "treasure",
  "weapon",
]);

export function isPurchasableItemType(type) {
  return PURCHASABLE_ITEM_TYPES.has(type);
}

export function isPurchasableItem(item) {
  return isPurchasableItemType(item?.type);
}
