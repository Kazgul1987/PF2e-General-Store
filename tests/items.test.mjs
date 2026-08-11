import assert from "node:assert/strict";
import test from "node:test";
import { filterPurchasableEntries } from "../scripts/data/compendium-index.js";
import { PURCHASABLE_ITEM_TYPES, isPurchasableItem, isPurchasableItemType } from "../scripts/pf2e/items.js";

const allowed = ["weapon", "armor", "consumable", "equipment", "shield", "treasure", "backpack", "book", "ammo"];
const rejected = ["feat", "action", "effect", "condition", "class", "background", "ancestry", "spell"];

test("the authoritative physical-item allowlist contains every supported store type", () => {
  assert.deepEqual([...PURCHASABLE_ITEM_TYPES].sort(), [...allowed].sort());
  for (const type of allowed) assert.equal(isPurchasableItemType(type), true, type);
  assert.equal(isPurchasableItem({ type: "weapon" }), true);
});

test("non-physical items and raw spells are rejected from the normal item path", () => {
  for (const type of rejected) assert.equal(isPurchasableItemType(type), false, type);
  assert.equal(isPurchasableItem(null), false);
});

test("normal compendium entries are filtered before store search", () => {
  const entries = [{ type: "weapon", name: "Longsword" }, { type: "feat", name: "Power Attack" }, { type: "action", name: "Treat Wounds" }, { type: "consumable", name: "Healing Potion" }];
  assert.deepEqual(filterPurchasableEntries(entries).map(({ name }) => name), ["Longsword", "Healing Potion"]);
});
