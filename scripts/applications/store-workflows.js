/** Purchase cart entries in insertion order, removing each completed entry immediately. */
export async function checkoutCart(cart, purchase) {
  for (const [key, item] of [...cart.entries()]) {
    const result = await purchase(item);
    if (!result?.ok) return { ok: false, failedKey: key };
    cart.delete(key);
  }
  return { ok: true };
}

/** Determine whether the StoreApp lifecycle still needs to start its first search. */
export function shouldRunInitialSearch({ hasSearched }) {
  return !hasSearched;
}

/** Clear actor-owned state when an open store is moved to a different actor. */
export function switchStoreActor(store, actor) {
  if (!actor) return false;
  const actorChanged = store.actor?.id !== actor.id;
  if (actorChanged) {
    store.viewState.cart.clear();
    store.viewState.selected = null;
    store.viewState.description = null;
  }
  store.actor = actor;
  return actorChanged;
}
