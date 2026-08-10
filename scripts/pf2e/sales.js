import { coinsToCopper, payout, pay } from "./currency.js";
import { log } from "../logger.js";

function itemQuantity(item) {
  const quantity = Number(item?.quantity ?? item?.system?.quantity ?? 1);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
}

function baseSaleCopper(item) {
  const value = item?.assetValue;
  if (!value) return 0;
  const copper = Number(value.copperValue) || coinsToCopper(value);
  return item.isOfType?.("treasure") ? copper : copper * 0.5;
}

/** Authoritative multi-item sale. Payout happens first and is removed again if item mutation fails. */
export async function sellItems({ sourceActor, payoutActor, selections, store = null }) {
  if (!sourceActor?.isOwner || !payoutActor?.isOwner) throw new Error("PF2EGeneralStore.Errors.Permission");
  if (!Array.isArray(selections) || selections.length === 0) throw new Error("PF2EGeneralStore.Errors.InvalidSale");

  const resolved = [];
  const seen = new Set();
  for (const selection of selections) {
    const itemId = typeof selection?.itemId === "string" ? selection.itemId : "";
    const quantity = Number(selection?.quantity);
    const item = sourceActor.items?.get(itemId);
    const available = itemQuantity(item);
    if (!item || seen.has(itemId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > available) {
      throw new Error("PF2EGeneralStore.Errors.InvalidSale");
    }
    seen.add(itemId);
    resolved.push({ item, quantity, available });
  }

  // Historic behavior is treasure at 100% and other inventory at 50%. A store
  // multiplier scales that baseline when explicitly configured.
  const multiplier = Math.max(0, Number(store?.pricing?.sellMultiplier ?? 0.5)) / 0.5;
  const payoutCopper = Math.max(0, Math.round(resolved.reduce(
    (total, { item, quantity, available }) => total + baseSaleCopper(item) * (quantity / available), 0,
  ) * multiplier));
  const context = {
    actorId: sourceActor.id, payoutActorId: payoutActor.id,
    storeId: store?.id ?? "", payoutCopper,
    selections: resolved.map(({ item, quantity }) => ({ itemId: item.id, quantity })),
  };
  const snapshots = resolved.map(({ item }) => foundry.utils.deepClone(item.toObject()));

  await payout(payoutActor, payoutCopper);
  try {
    const deletions = resolved.filter(({ quantity, available }) => quantity === available).map(({ item }) => item.id);
    const partials = resolved.filter(({ quantity, available }) => quantity < available);
    if (deletions.length) await sourceActor.deleteEmbeddedDocuments("Item", deletions);
    for (const { item, quantity, available } of partials) await item.update({ "system.quantity": available - quantity });
    return { ok: true, payoutCopper, itemCount: resolved.length };
  } catch (error) {
    try {
      const existingIds = new Set(Array.from(sourceActor.items ?? []).map((item) => item.id));
      const missing = snapshots.filter((source) => !existingIds.has(source._id));
      if (missing.length) await sourceActor.createEmbeddedDocuments("Item", missing, { keepId: true });
      for (const source of snapshots.filter((entry) => existingIds.has(entry._id))) {
        await sourceActor.items.get(source._id)?.update({ "system.quantity": source.system?.quantity ?? 1 });
      }
    } catch (itemRollbackError) {
      log.error("Sale item rollback failed; world state is inconsistent", { ...context, itemRollbackError });
      if (game.user?.isGM) ui.notifications?.error("PF2e General Store: Sale item rollback failed; check actor inventory.");
    }
    try {
      if (!(await pay(payoutActor, payoutCopper))) throw new Error("Payout actor no longer has rollback funds");
    } catch (rollbackError) {
      log.error("Sale rollback failed; world state is inconsistent", { ...context, rollbackError });
      if (game.user?.isGM) ui.notifications?.error("PF2e General Store: Sale rollback failed; check actor inventories and currency.");
    }
    log.error("Sale failed", { ...context, error });
    throw error;
  }
}

export function quoteSale({ sourceActor, selections, store = null }) {
  const resolved = selections.map(({ itemId, quantity }) => ({ item: sourceActor.items?.get(itemId), quantity: Number(quantity) }));
  const multiplier = Math.max(0, Number(store?.pricing?.sellMultiplier ?? 0.5)) / 0.5;
  return Math.max(0, Math.round(resolved.reduce((total, { item, quantity }) => (
    item ? total + baseSaleCopper(item) * (quantity / itemQuantity(item)) : total
  ), 0) * multiplier));
}
