function positiveInteger(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
}

function normalizePlayer(player = {}) {
  const userId = typeof player.userId === "string" ? player.userId.trim() : "";
  const name = typeof player.name === "string" ? player.name.trim() : "";
  if (!userId) return null;
  return {
    userId,
    name,
    avatar: typeof player.avatar === "string" ? player.avatar.trim() : "",
    tokenSrc: typeof player.tokenSrc === "string" ? player.tokenSrc.trim() : "",
    quantity: positiveInteger(player.quantity),
  };
}

function normalizePlayers(players) {
  const merged = new Map();
  for (const source of Array.isArray(players) ? players : []) {
    const player = normalizePlayer(source);
    if (!player?.quantity) continue;
    const existing = merged.get(player.userId);
    if (!existing) merged.set(player.userId, player);
    else {
      existing.quantity += player.quantity;
      // Prefer the latest non-empty legacy display metadata.
      for (const field of ["name", "avatar", "tokenSrc"]) if (player[field]) existing[field] = player[field];
    }
  }
  return Array.from(merged.values());
}

export function getWishlistItemTotal(item) {
  const attributed = normalizePlayers(item?.players).reduce((total, player) => total + player.quantity, 0);
  return attributed + positiveInteger(item?.unattributedQuantity);
}

function normalizeItem(item = {}) {
  const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
  const pack = typeof item.pack === "string" ? item.pack.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!itemId || !pack || !name) return null;
  const players = normalizePlayers(item.players);
  // Preserve an old global-only quantity without assigning it to an arbitrary user.
  // Once contributors exist, their quantities are authoritative; an explicitly
  // retained unattributedQuantity remains separate until a GM cleans it up.
  const unattributedQuantity = players.length
    ? positiveInteger(item.unattributedQuantity)
    : positiveInteger(item.unattributedQuantity) || positiveInteger(item.quantity);
  const normalized = {
    itemId,
    pack,
    name,
    entryType: item.entryType === "spell" ? "spell" : "item",
    price: Math.max(0, Number(item.price) || 0),
    quantity: 0,
    players,
  };
  if (unattributedQuantity) normalized.unattributedQuantity = unattributedQuantity;
  normalized.quantity = getWishlistItemTotal(normalized);
  return normalized.quantity > 0 ? normalized : null;
}

export function normalizeWishlistState(state = {}) {
  const items = {};
  for (const [key, value] of Object.entries(state?.items ?? {})) {
    const item = normalizeItem(value);
    if (item) items[key] = item;
  }
  return { items };
}

export function wishlistTotal(state) {
  return Object.values(normalizeWishlistState(state).items).reduce((total, item) => total + item.price * item.quantity, 0);
}

const result = (state, extra = {}) => ({ state, total: wishlistTotal(state), ...extra });

/** Add quantity owned by one visible contributor. */
export function addWishlistContribution(state, item, contributor) {
  const next = normalizeWishlistState(state);
  const normalized = normalizeItem(item);
  const player = normalizePlayer(contributor);
  const quantity = positiveInteger(item?.quantity);
  if (!normalized || !player || !quantity) return result(next);
  player.quantity = quantity;
  const key = `${normalized.pack}.${normalized.itemId}`;
  const existing = next.items[key];
  if (!existing) {
    delete normalized.unattributedQuantity;
    normalized.players = [player];
    normalized.quantity = quantity;
    next.items[key] = normalized;
  } else {
    existing.price = normalized.price;
    existing.name = normalized.name;
    existing.entryType = normalized.entryType;
    const old = existing.players.find((entry) => entry.userId === player.userId);
    if (old) {
      old.quantity += quantity;
      for (const field of ["name", "avatar", "tokenSrc"]) if (player[field]) old[field] = player[field];
    } else existing.players.push(player);
    existing.quantity = getWishlistItemTotal(existing);
  }
  return result(next);
}

// Compatibility name used by the legacy application while the UI remains on Dialog.
export const addWishlistItem = addWishlistContribution;

export function removeWishlistItem(state, key) {
  const next = normalizeWishlistState(state); delete next.items[key]; return result(next);
}

/** Remove only the named contributor's quantity; other contributors are untouched. */
export function removeOwnWishlistContribution(state, key, userId, quantity) {
  const next = normalizeWishlistState(state);
  const item = next.items[key];
  const count = positiveInteger(quantity);
  const index = item?.players.findIndex((player) => player.userId === userId) ?? -1;
  if (!item || index < 0 || !count) return result(next, { removed: null });
  const player = item.players[index];
  const removedQuantity = Math.min(count, player.quantity);
  player.quantity -= removedQuantity;
  if (!player.quantity) item.players.splice(index, 1);
  item.quantity = getWishlistItemTotal(item);
  if (!item.quantity) delete next.items[key];
  return result(next, { removed: { ...item, quantity: removedQuantity } });
}

/** GM operation: remove an item quantity, consuming unattributed quantity first. */
export function removeWishlistQuantity(state, key, quantity) {
  const next = normalizeWishlistState(state); const item = next.items[key];
  let remaining = positiveInteger(quantity);
  if (!item || !remaining) return result(next);
  const anonymous = Math.min(remaining, positiveInteger(item.unattributedQuantity));
  remaining -= anonymous;
  item.unattributedQuantity = positiveInteger(item.unattributedQuantity) - anonymous;
  if (!item.unattributedQuantity) delete item.unattributedQuantity;
  for (let index = item.players.length - 1; index >= 0 && remaining; index -= 1) {
    const removed = Math.min(remaining, item.players[index].quantity);
    item.players[index].quantity -= removed; remaining -= removed;
    if (!item.players[index].quantity) item.players.splice(index, 1);
  }
  item.quantity = getWishlistItemTotal(item);
  if (!item.quantity) delete next.items[key];
  return result(next);
}

export function setWishlistItemQuantity(state, key, quantity) {
  const next = normalizeWishlistState(state); const item = next.items[key]; const value = positiveInteger(quantity);
  if (!item) return result(next);
  if (!value) delete next.items[key];
  else if (value > item.quantity) {
    item.unattributedQuantity = positiveInteger(item.unattributedQuantity) + value - item.quantity;
    item.quantity = value;
  } else if (value < item.quantity) return removeWishlistQuantity(next, key, item.quantity - value);
  return result(next);
}

export function moveWishlistItemToCart(state, key, quantity) {
  const next = normalizeWishlistState(state); const item = next.items[key];
  if (!item) return result(next, { moved: null });
  const count = Math.min(positiveInteger(quantity) || item.quantity, item.quantity);
  const moved = { ...item, quantity: count };
  const changed = removeWishlistQuantity(next, key, count);
  return result(changed.state, { moved });
}

export function moveWishlistPlayerToCart(state, key, userId, quantity) {
  const value = removeOwnWishlistContribution(state, key, userId, quantity);
  return { state: value.state, total: value.total, moved: value.removed };
}

/** Explicit GM contributor-removal operation retained for administration. */
export function removePlayerFromWishlist(state, key, userId, quantity = Number.MAX_SAFE_INTEGER) {
  return removeOwnWishlistContribution(state, key, userId, quantity);
}
