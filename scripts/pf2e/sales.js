import { payout, pay } from "./currency.js";
import { log } from "../logger.js";

export async function sellItem({ sourceActor, payoutActor, item, quantity = 1, payoutCopper, storeId = "" }) {
  const count = Number(quantity);
  const current = sourceActor?.items?.get(item?.id);
  const available = Number(current?.system?.quantity ?? 1);
  if (!sourceActor?.isOwner || !payoutActor?.isOwner) throw new Error("PF2EGeneralStore.Errors.Permission");
  if (!current || !Number.isSafeInteger(count) || count < 1 || count > available || !Number.isSafeInteger(payoutCopper) || payoutCopper < 0) throw new Error("PF2EGeneralStore.Errors.InvalidSale");
  await payout(payoutActor, payoutCopper);
  try {
    if (count === available) await sourceActor.deleteEmbeddedDocuments("Item", [current.id]);
    else await current.update({ "system.quantity": available - count });
    return { ok: true, payoutCopper };
  } catch (error) {
    try { await pay(payoutActor, payoutCopper); }
    catch (rollbackError) { log.error("Sale rollback failed", { actorId: sourceActor.id, payoutActorId: payoutActor.id, itemId: current.id, storeId, rollbackError }); }
    log.error("Sale failed", { actorId: sourceActor.id, itemId: current.id, storeId, error });
    throw error;
  }
}
