import assert from "node:assert/strict";
import test from "node:test";

import {
  addWishlistContribution,
  moveWishlistPlayerToCart,
  normalizeWishlistState,
  removeOwnWishlistContribution,
  removePlayerFromWishlist,
} from "../scripts/wishlist/model.js";
import { SOCKET_TYPES } from "../scripts/constants.js";
import { buildWishlistMutationPayload } from "../scripts/wishlist/socket.js";

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

function wishlistWithContributors(players) {
  const key = `${item.pack}.${item.itemId}`;
  return { key, state: normalizeWishlistState({ items: {
    [key]: { ...item, quantity: players.reduce((total, player) => total + player.quantity, 0), players },
  } }) };
}

test("moving part of one's contribution reports the moved quantity and preserves totals", () => {
  const { key, state } = wishlistWithContributors([
    contributor("A", "Alice", 2), contributor("B", "Bob", 3),
  ]);
  const result = moveWishlistPlayerToCart(state, key, "A", 1);
  assert.equal(result.moved.quantity, 1);
  assert.equal(result.state.items[key].quantity, 4);
  assert.equal(result.state.items[key].players.find((player) => player.userId === "A").quantity, 1);
  assert.equal(result.state.items[key].players.find((player) => player.userId === "B").quantity, 3);
});

test("moving a full contribution removes only that contributor", () => {
  const { key, state } = wishlistWithContributors([
    contributor("A", "Alice", 2), contributor("B", "Bob", 3),
  ]);
  const result = moveWishlistPlayerToCart(state, key, "A", 2);
  assert.equal(result.moved.quantity, 2);
  assert.equal(result.state.items[key].quantity, 3);
  assert.equal(result.state.items[key].players.some((player) => player.userId === "A"), false);
  assert.equal(result.state.items[key].players.find((player) => player.userId === "B").quantity, 3);
});

test("moving the final contribution removes the wishlist item", () => {
  const { key, state } = wishlistWithContributors([contributor("A", "Alice", 2)]);
  const result = moveWishlistPlayerToCart(state, key, "A", 2);
  assert.equal(result.moved.quantity, 2);
  assert.equal(result.state.items[key], undefined);
});

test("wishlist-to-cart synchronization uses the clamped moved quantity and remove-own protocol", () => {
  const { key, state } = wishlistWithContributors([contributor("A", "Alice", 2)]);
  const result = moveWishlistPlayerToCart(state, key, "A", 5);
  assert.equal(result.moved.quantity, 2);

  const payload = buildWishlistMutationPayload(
    "removePlayerFromWishlist",
    [key, "untrusted-ui-contributor", result.moved.quantity],
    { requestId: "request_123", userId: "A" },
  );
  assert.deepEqual(payload, {
    type: SOCKET_TYPES.WISHLIST_REMOVE_OWN,
    requestId: "request_123",
    userId: "A",
    itemKey: key,
    quantity: 2,
  });
  assert.equal("mutationType" in payload, false);
  assert.notEqual(payload.type, "wishlist:add");
  assert.notEqual(payload.type, "wishlist:move-to-cart");
});
