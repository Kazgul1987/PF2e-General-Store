import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = { utils: { deepClone: structuredClone } };
const notifications = [];
globalThis.game = { user: { isGM: true }, i18n: { localize: (key) => key } };
globalThis.ui = { notifications: { error: (message) => notifications.push(message) } };

const { sellItems } = await import("../scripts/pf2e/sales.js");

function fixture({ mutationFails = false, restorationFails = false } = {}) {
  let copper = 0;
  let removeCurrencyCalls = 0;
  const coinValue = (coins) => (coins.pp ?? 0) * 1000 + (coins.gp ?? 0) * 100 + (coins.sp ?? 0) * 10 + (coins.cp ?? 0);
  const source = {
    _id: "item-1", id: "item-1", name: "Sword", quantity: 1,
    assetValue: { copperValue: 100 }, isOfType: () => false,
    system: { quantity: 1 },
    toObject() { return { _id: this.id, name: this.name, system: { quantity: 1 } }; },
  };
  const entries = new Map([[source.id, source]]);
  const items = { get: (id) => entries.get(id), [Symbol.iterator]: () => entries.values() };
  const sourceActor = {
    id: "source", isOwner: true, items,
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) entries.delete(id);
      if (mutationFails) throw new Error("mutation failed");
    },
    async createEmbeddedDocuments(_type, snapshots) {
      if (restorationFails) throw new Error("restoration failed");
      for (const snapshot of snapshots) entries.set(snapshot._id, { ...snapshot, id: snapshot._id });
    },
  };
  const payoutActor = {
    id: "payout", isOwner: true,
    inventory: {
      currency: { get copperValue() { return copper; } },
      async addCurrency(coins) { copper += coinValue(coins); },
      async removeCurrency(coins) { removeCurrencyCalls += 1; copper -= coinValue(coins); },
    },
  };
  return { sourceActor, payoutActor, selections: [{ itemId: source.id, quantity: 1 }],
    get copper() { return copper; }, get removeCurrencyCalls() { return removeCurrencyCalls; } };
}

test("successful sale mutates inventory and pays seller", async () => {
  const data = fixture();
  const result = await sellItems(data);
  assert.equal(result.ok, true);
  assert.equal(data.sourceActor.items.get("item-1"), undefined);
  assert.equal(data.copper, 50);
});

test("failed mutation with successful item restoration removes payout", async () => {
  const data = fixture({ mutationFails: true });
  await assert.rejects(sellItems(data), /mutation failed/);
  assert.ok(data.sourceActor.items.get("item-1"));
  assert.equal(data.copper, 0);
  assert.equal(data.removeCurrencyCalls, 1);
});

test("failed item restoration preserves payout and emits serious warning", async () => {
  notifications.length = 0;
  const data = fixture({ mutationFails: true, restorationFails: true });
  await assert.rejects(sellItems(data), /mutation failed/);
  assert.equal(data.sourceActor.items.get("item-1"), undefined);
  assert.equal(data.copper, 50);
  assert.equal(data.removeCurrencyCalls, 0);
  assert.deepEqual(notifications, ["PF2EGeneralStore.Errors.SaleItemRollbackFailed"]);
});
