import { log } from "../logger.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ALLOWED_MUTATIONS = new Set(["addItem", "removePlayerFromWishlist"]);

/** Validate the legacy-compatible, explicitly whitelisted wishlist protocol. */
export function validateWishlistRequest(payload) {
  if (!payload || typeof payload !== "object" || !REQUEST_ID.test(payload.requestId ?? "")) return null;
  if (!ALLOWED_MUTATIONS.has(payload.mutationType) || !Array.isArray(payload.args)) return null;
  const user = game.users?.get(payload.userId);
  if (!user?.active || user.isGM) return null;
  const [first, second, third] = payload.args;
  if (payload.mutationType === "addItem") {
    const quantity = Number(first?.quantity);
    if (payload.args.length !== 2 || typeof first?.itemId !== "string" || typeof first?.pack !== "string"
      || !Number.isSafeInteger(quantity) || quantity < 1 || second?.userId !== user.id) return null;
  } else {
    const quantity = Number(third);
    if (payload.args.length !== 3 || typeof first !== "string" || second !== user.id
      || !Number.isSafeInteger(quantity) || quantity < 1) return null;
  }
  return { requestId: payload.requestId, mutationType: payload.mutationType, args: payload.args, user };
}

export function rejectWishlistRequest(payload) {
  log.warn("Rejected wishlist socket request", {
    requestId: typeof payload?.requestId === "string" ? payload.requestId : null,
    type: typeof payload?.mutationType === "string" ? payload.mutationType : null,
    userId: typeof payload?.userId === "string" ? payload.userId : null,
  });
}
