/** Purchase cart entries in insertion order, removing each completed entry immediately. */
export async function checkoutCart(cart, purchase) {
  for (const [key, item] of [...cart.entries()]) {
    const result = await purchase(item);
    if (!result?.ok) return { ok: false, failedKey: key };
    cart.delete(key);
  }
  return { ok: true };
}
