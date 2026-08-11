import { normalizePrice, pay, payout } from "./currency.js";
import { log } from "../logger.js";

function itemPriceCopper(item) {
  return normalizePrice(item?.system?.price);
}

export async function purchaseItem({ buyer, paymentActor, packId, itemId, quantity = 1, expectedPriceCopper, storeId = "", purchaseSource = null }) {
  const count = Number(quantity);
  const item = await game.packs.get(packId)?.getDocument(itemId);
  const itemSource = purchaseSource ?? item?.toObject();
  const priceCopper = itemPriceCopper(purchaseSource ?? item);
  if (!buyer?.isOwner || !paymentActor?.isOwner) throw new Error("PF2EGeneralStore.Errors.Permission");
  if (!itemSource || !Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(priceCopper) || priceCopper < 0) throw new Error("PF2EGeneralStore.Errors.InvalidPurchase");
  if (Number.isSafeInteger(expectedPriceCopper) && expectedPriceCopper !== priceCopper) return { ok: false, reason: "price-changed", priceCopper };
  const total = priceCopper * count;
  if (!(await pay(paymentActor, total))) return { ok: false, reason: "insufficient-funds" };
  try {
    const source = foundry.utils.deepClone(itemSource);
    delete source._id;
    source.system ??= {};
    source.system.quantity = count;
    const [created] = await buyer.createEmbeddedDocuments("Item", [source]);
    if (!created) throw new Error("Item creation returned no document");
    return { ok: true, item: created, total };
  } catch (error) {
    try { await payout(paymentActor, total); }
    catch (rollbackError) { log.error("Purchase rollback failed", { actorId: buyer.id, paymentActorId: paymentActor.id, storeId, rollbackError }); }
    log.error("Purchase failed", { actorId: buyer.id, paymentActorId: paymentActor.id, storeId, error });
    throw error;
  }
}
