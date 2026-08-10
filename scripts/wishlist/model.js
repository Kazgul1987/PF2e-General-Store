function normalizePlayer(player = {}) {
  const userId = typeof player.userId === "string" ? player.userId.trim() : "";
  const name = typeof player.name === "string" ? player.name.trim() : "";
  if (!userId && !name) return null;
  return {
    userId, name,
    avatar: typeof player.avatar === "string" ? player.avatar.trim() : "",
    tokenSrc: typeof player.tokenSrc === "string" ? player.tokenSrc.trim() : "",
    quantity: Math.max(0, Number(player.quantity) || 0),
  };
}

function normalizeItem(item = {}) {
  const quantity = Number(item.quantity) || 0;
  const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
  const pack = typeof item.pack === "string" ? item.pack.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!itemId || !pack || !name || quantity <= 0) return null;
  return {
    itemId, pack, name, entryType: item.entryType === "spell" ? "spell" : "item",
    price: Math.max(0, Number(item.price) || 0), quantity,
    players: Array.isArray(item.players) ? item.players.map(normalizePlayer).filter(Boolean) : [],
  };
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

export function addWishlistItem(state, item, player) {
  const next = normalizeWishlistState(state); const normalized = normalizeItem(item);
  if (!normalized) return result(next);
  const key = `${normalized.pack}.${normalized.itemId}`; const existing = next.items[key];
  const contributor = normalizePlayer(player);
  if (!existing) next.items[key] = { ...normalized, players: contributor ? [contributor] : [] };
  else {
    existing.quantity += normalized.quantity; existing.price = normalized.price; existing.name = normalized.name;
    if (contributor) {
      const old = existing.players.find((entry) => entry.userId === contributor.userId);
      if (old) old.quantity += contributor.quantity; else existing.players.push(contributor);
    }
  }
  return result(next);
}

export function removeWishlistItem(state, key) {
  const next = normalizeWishlistState(state); delete next.items[key]; return result(next);
}

export function removeWishlistQuantity(state, key, quantity) {
  const next = normalizeWishlistState(state); const item = next.items[key];
  const count = Number(quantity);
  if (!item || !Number.isSafeInteger(count) || count < 1) return result(next);
  item.quantity -= Math.min(count, item.quantity);
  if (item.quantity <= 0) delete next.items[key];
  return result(next);
}

export function setWishlistItemQuantity(state, key, quantity) {
  const next = normalizeWishlistState(state); const value = Number(quantity) || 0;
  if (next.items[key]) { if (value <= 0) delete next.items[key]; else next.items[key].quantity = value; }
  return result(next);
}

export function moveWishlistItemToCart(state, key, quantity) {
  const next = normalizeWishlistState(state); const item = next.items[key];
  if (!item) return result(next, { moved: null });
  const moved = { ...item, quantity: Math.min(Number(quantity) || item.quantity, item.quantity) };
  item.quantity -= moved.quantity; if (item.quantity <= 0) delete next.items[key];
  return result(next, { moved });
}

export function moveWishlistPlayerToCart(state, key, userId, quantity) {
  const next = normalizeWishlistState(state); const item = next.items[key];
  const index = item?.players.findIndex((player) => player.userId === userId) ?? -1;
  if (!item || index < 0) return result(next, { moved: null });
  const player = item.players[index]; const count = Math.min(Number(quantity) || 0, player.quantity || 0);
  if (count <= 0) return result(next, { moved: null });
  const moved = { ...item, quantity: count }; player.quantity -= count; item.quantity -= count;
  if (player.quantity <= 0) item.players.splice(index, 1);
  if (item.quantity <= 0 || item.players.length === 0) delete next.items[key];
  return result(next, { moved });
}

export function removePlayerFromWishlist(state, key, userId, quantity) {
  const value = moveWishlistPlayerToCart(state, key, userId, quantity);
  return { state: value.state, total: value.total, removed: value.moved };
}
