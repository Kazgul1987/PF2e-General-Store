import assert from "node:assert/strict";
import test from "node:test";

import {
  addWishlistContribution,
  normalizeWishlistState,
  removeOwnWishlistContribution,
  removePlayerFromWishlist,
} from "../scripts/wishlist/model.js";

const item = { itemId: "abc123", pack: "pf2e.equipment-srd", name: "Healing Potion", price: 4 };
const contributor = (userId, name, quantity) => ({ userId, name, quantity });

test("contributions remain visible, contributor-scoped, and totalled", () => {
  let state = { items: {} };
  state = addWishlistContribution(state, { ...item, quantity: 2 }, contributor("A", "Alice", 2)).state;
  state = addWishlistContribution(state, { ...item, quantity: 3 }, contributor("B", "Bob", 3)).state;
  const key = `${item.pack}.${item.itemId}`;
  assert.equal(state.items[key].quantity, 5);
  assert.deepEqual(state.items[key].players.map(({ userId, quantity }) => ({ userId, quantity })), [
    { userId: "A", quantity: 2 }, { userId: "B", quantity: 3 },
  ]);

  state = removeOwnWishlistContribution(state, key, "A", 1).state;
  assert.equal(state.items[key].quantity, 4);
  assert.deepEqual(state.items[key].players.map(({ userId, quantity }) => ({ userId, quantity })), [
    { userId: "A", quantity: 1 }, { userId: "B", quantity: 3 },
  ]);
  state = removeOwnWishlistContribution(state, key, "A", 1).state;
  assert.deepEqual(state.items[key].players.map(({ userId, quantity }) => ({ userId, quantity })), [
    { userId: "B", quantity: 3 },
  ]);
  state = removeOwnWishlistContribution(state, key, "B", 3).state;
  assert.equal(state.items[key], undefined);
});

test("one contributor cannot change another contributor through own removal", () => {
  const key = `${item.pack}.${item.itemId}`;
  let state = normalizeWishlistState({ items: { [key]: { ...item, quantity: 5, players: [
    contributor("A", "Alice", 2), contributor("B", "Bob", 3),
  ] } } });
  state = removeOwnWishlistContribution(state, key, "A", 1).state;
  assert.equal(state.items[key].players.find((player) => player.userId === "B").quantity, 3);
});

test("normalization repairs totals and merges duplicate contributors", () => {
  const key = `${item.pack}.${item.itemId}`;
  const normalized = normalizeWishlistState({ items: { [key]: { ...item, quantity: 99, players: [
    contributor("A", "Alice", 1), contributor("A", "Alice", 2), contributor("B", "Bob", 3),
  ] } } });
  assert.equal(normalized.items[key].quantity, 6);
  assert.deepEqual(normalized.items[key].players.map(({ userId, quantity }) => ({ userId, quantity })), [
    { userId: "A", quantity: 3 }, { userId: "B", quantity: 3 },
  ]);
});

test("global-only legacy quantity is preserved but never assigned to a user", () => {
  const key = `${item.pack}.${item.itemId}`;
  const normalized = normalizeWishlistState({ items: { [key]: { ...item, quantity: 5, players: [] } } });
  assert.equal(normalized.items[key].quantity, 5);
  assert.equal(normalized.items[key].unattributedQuantity, 5);
  assert.deepEqual(normalized.items[key].players, []);
});

test("GM contributor removal remains available", () => {
  const key = `${item.pack}.${item.itemId}`;
  const state = normalizeWishlistState({ items: { [key]: { ...item, quantity: 2, players: [contributor("A", "Alice", 2)] } } });
  assert.equal(removePlayerFromWishlist(state, key, "A").state.items[key], undefined);
});
