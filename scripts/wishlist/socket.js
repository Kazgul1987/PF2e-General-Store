import { SOCKET_TYPES } from "../constants.js";
import { log } from "../logger.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PACK_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const TYPES = new Set([SOCKET_TYPES.WISHLIST_ADD, SOCKET_TYPES.WISHLIST_REMOVE_OWN]);

/**
 * Foundry v14 module socket listeners receive emitted arguments, but no
 * server-attested sender identity. `userId` is therefore validated attribution,
 * not authentication. The protocol exposes only contributor-scoped player
 * operations; display metadata and documents are always resolved by the GM.
 */
export async function validateWishlistRequest(payload) {
  if (!payload || typeof payload !== "object" || !TYPES.has(payload.type) || !REQUEST_ID.test(payload.requestId ?? "")) return null;
  const quantity = Number(payload.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return null;
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const user = game.users?.get(userId);
  if (!DOCUMENT_ID.test(userId) || !user || user.isGM || !user.active) return null;
  if (payload.type === SOCKET_TYPES.WISHLIST_ADD) {
    if (!PACK_ID.test(payload.packId ?? "") || !DOCUMENT_ID.test(payload.itemId ?? "")) return null;
    const pack = game.packs?.get(payload.packId);
    const item = await pack?.getDocument(payload.itemId);
    if (!item || !["Item", "Spell"].includes(pack.documentName)) return null;
    return { type: payload.type, requestId: payload.requestId, quantity, pack, item, user };
  }
  if (typeof payload.itemKey !== "string" || payload.itemKey.length > 256) return null;
  return { type: payload.type, requestId: payload.requestId, quantity, itemKey: payload.itemKey, user };
}

/** Build contributor display data only from GM-visible Foundry documents. */
export function contributorFromUser(user) {
  return {
    userId: user.id,
    name: user.name ?? "",
    avatar: user.avatar ?? "",
    tokenSrc: user.character?.prototypeToken?.texture?.src ?? user.character?.img ?? "",
  };
}

export function rejectWishlistRequest(payload) {
  log.warn("Rejected wishlist socket request", {
    requestId: typeof payload?.requestId === "string" ? payload.requestId : null,
    type: typeof payload?.type === "string" ? payload.type : null,
  });
}
