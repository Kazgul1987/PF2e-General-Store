import { SOCKET_TYPES } from "../constants.js";
import { log } from "../logger.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PACK_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const TYPES = new Set([SOCKET_TYPES.WISHLIST_ADD, SOCKET_TYPES.WISHLIST_REMOVE]);

/**
 * Module sockets do not supply a trustworthy sender identity. Consequently this
 * protocol accepts no user/actor ID at all: requests can only adjust wishlist
 * quantities, and every compendium/item reference is resolved again by the GM.
 */
export async function validateWishlistRequest(payload) {
  if (!payload || typeof payload !== "object" || !TYPES.has(payload.type) || !REQUEST_ID.test(payload.requestId ?? "")) return null;
  const quantity = Number(payload.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return null;
  if (payload.type === SOCKET_TYPES.WISHLIST_ADD) {
    if (!PACK_ID.test(payload.packId ?? "") || !DOCUMENT_ID.test(payload.itemId ?? "")) return null;
    const pack = game.packs?.get(payload.packId);
    const item = await pack?.getDocument(payload.itemId);
    if (!item || !["Item", "Spell"].includes(pack.documentName)) return null;
    return { type: payload.type, requestId: payload.requestId, quantity, pack, item };
  }
  if (typeof payload.itemKey !== "string" || payload.itemKey.length > 256) return null;
  return { type: payload.type, requestId: payload.requestId, quantity, itemKey: payload.itemKey };
}

export function rejectWishlistRequest(payload) {
  log.warn("Rejected wishlist socket request", {
    requestId: typeof payload?.requestId === "string" ? payload.requestId : null,
    type: typeof payload?.type === "string" ? payload.type : null,
  });
}
