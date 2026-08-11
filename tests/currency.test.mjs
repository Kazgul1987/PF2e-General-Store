import assert from "node:assert/strict";
import test from "node:test";
import { normalizePrice } from "../scripts/pf2e/currency.js";

test("PF2e mixed-denomination prices normalize to integer copper", () => {
  assert.equal(normalizePrice({ value: { gp: 2, sp: 5 } }), 250);
  assert.equal(normalizePrice({ value: { gp: 1, sp: 2, cp: 3 } }), 123);
});

test("PF2e silver and copper-only prices normalize without NaN", () => {
  assert.equal(normalizePrice({ value: { sp: 5 } }), 50);
  assert.equal(normalizePrice({ value: { cp: 3 } }), 3);
  assert.equal(Number.isNaN(normalizePrice({ value: {} })), false);
});
