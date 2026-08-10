export function normalizeWishlistState(state = {}) {
  const items = {};
  for (const [key, item] of Object.entries(state?.items ?? {})) {
    const quantity = Number(item?.quantity);
    if (typeof item?.itemId !== "string" || typeof item?.pack !== "string" || !Number.isSafeInteger(quantity) || quantity < 1) continue;
    items[key] = {
      itemId: item.itemId,
      pack: item.pack,
      name: String(item.name ?? ""),
      entryType: item.entryType === "spell" ? "spell" : "item",
      price: Math.max(0, Number(item.price) || 0),
      quantity,
      players: Array.isArray(item.players) ? item.players.filter((player) => typeof player?.userId === "string" && Number(player.quantity) > 0) : [],
    };
  }
  return { items };
}

export function wishlistTotal(state) {
  return Object.values(normalizeWishlistState(state).items).reduce((total, item) => total + item.price * item.quantity, 0);
}
