import assert from "node:assert/strict";
import test from "node:test";
import { checkoutCart } from "../scripts/applications/store-workflows.js";

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
