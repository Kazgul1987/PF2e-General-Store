import assert from "node:assert/strict";
import test from "node:test";
import { buildSaleSourceOptions } from "../scripts/applications/sale-source-options.js";

const actor = (id) => ({ id, uuid: `Actor.${id}`, name: id });

test("sale source options preserve current, configured, party, and loot actor order", () => {
  const options = buildSaleSourceOptions([
    { actor: actor("A"), role: "actor" },
    { actor: actor("B"), role: "sellActor" },
    { actor: actor("C"), role: "party" },
    { actor: actor("D"), role: "loot" },
  ]);
  assert.deepEqual(options.map(({ actorId }) => actorId), ["A", "B", "C", "D"]);
});

test("sale source options deduplicate documents by UUID", () => {
  const current = actor("A");
  assert.deepEqual(buildSaleSourceOptions([{ actor: current }, { actor: { ...current, name: "renamed" } }]).map(({ actorId }) => actorId), ["A"]);
});

test("sale source options ignore a missing configured actor", () => {
  assert.deepEqual(buildSaleSourceOptions([{ actor: actor("A") }, null, { actor: null }]).map(({ actorId }) => actorId), ["A"]);
});
