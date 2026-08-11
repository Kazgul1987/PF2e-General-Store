import assert from "node:assert/strict";
import test from "node:test";
import { checkoutCart, shouldRunInitialSearch, switchStoreActor } from "../scripts/applications/store-workflows.js";

const cart = () => new Map([["A", { id: "A" }], ["B", { id: "B" }], ["C", { id: "C" }]]);

test("checkout removes every successfully purchased cart entry", async () => {
  const value = cart();
  assert.equal((await checkoutCart(value, async () => ({ ok: true }))).ok, true);
  assert.deepEqual([...value.keys()], []);
});

test("checkout preserves failed and unprocessed entries after partial success", async () => {
  const value = cart(); const attempted = [];
  const result = await checkoutCart(value, async ({ id }) => { attempted.push(id); return { ok: id !== "B" }; });
  assert.deepEqual(result, { ok: false, failedKey: "B" });
  assert.deepEqual(attempted, ["A", "B"]);
  assert.deepEqual([...value.keys()], ["B", "C"]);
});

test("checkout leaves the cart unchanged on immediate failure", async () => {
  const value = cart();
  await checkoutCart(value, async () => ({ ok: false }));
  assert.deepEqual([...value.keys()], ["A", "B", "C"]);
});

test("checkout propagates an exception while preserving failed and unprocessed entries", async () => {
  const value = cart(); const attempted = [];
  await assert.rejects(checkoutCart(value, async ({ id }) => {
    attempted.push(id);
    if (id === "B") throw new Error("purchase failed unexpectedly");
    return { ok: true };
  }), /purchase failed unexpectedly/);
  assert.deepEqual(attempted, ["A", "B"]);
  assert.deepEqual([...value.keys()], ["B", "C"]);
});

test("an initialized search with no results does not run initialization again", () => {
  assert.equal(shouldRunInitialSearch({ hasSearched: true, results: [] }), false);
  assert.equal(shouldRunInitialSearch({ hasSearched: false, results: [] }), true);
});

test("switching actors clears actor-owned cart and selection state", () => {
  const store = { actor: { id: "A" }, viewState: { cart: cart(), selected: { id: "item" }, description: "details" } };
  assert.equal(switchStoreActor(store, { id: "B" }), true);
  assert.deepEqual([...store.viewState.cart], []);
  assert.equal(store.viewState.selected, null);
  assert.equal(store.viewState.description, null);
  assert.equal(store.actor.id, "B");
});

test("reopening for the same actor preserves its cart", () => {
  const value = cart();
  const store = { actor: { id: "A" }, viewState: { cart: value, selected: null, description: null } };
  assert.equal(switchStoreActor(store, { id: "A" }), false);
  assert.equal(store.viewState.cart, value);
});
