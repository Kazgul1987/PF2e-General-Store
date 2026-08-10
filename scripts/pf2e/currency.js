export function coinsToCopper(coins = {}) {
  return (Number(coins.pp) || 0) * 1000 + (Number(coins.gp) || 0) * 100 + (Number(coins.sp) || 0) * 10 + (Number(coins.cp) || 0);
}

export function copperToCoins(value) {
  let copper = Math.max(0, Math.round(Number(value) || 0));
  const pp = Math.floor(copper / 1000); copper %= 1000;
  const gp = Math.floor(copper / 100); copper %= 100;
  const sp = Math.floor(copper / 10);
  return { pp, gp, sp, cp: copper % 10 };
}

export function normalizePrice(price) {
  const value = price?.value ?? price;
  if (typeof value === "number") return Math.max(0, Math.round(value * 100));
  if (value?.value) return coinsToCopper(value.value);
  return coinsToCopper(value);
}

export function getActorCopper(actor) {
  const direct = Number(actor?.inventory?.currency?.copperValue);
  if (Number.isFinite(direct)) return direct;
  const currency = actor?.inventory?.coins ?? actor?.inventory?.currency ?? actor?.system?.currency ?? {};
  return coinsToCopper(currency);
}

export function canAfford(actor, copper) { return getActorCopper(actor) >= copper; }

export async function pay(actor, copper) {
  if (!actor?.inventory?.removeCurrency) throw new Error("PF2e removeCurrency API unavailable");
  if (!canAfford(actor, copper)) return false;
  await actor.inventory.removeCurrency(copperToCoins(copper), { byValue: true });
  return true;
}

export async function payout(actor, copper) {
  if (!actor?.inventory?.addCoins) throw new Error("PF2e addCoins API unavailable");
  await actor.inventory.addCoins(copperToCoins(copper));
}

export function formatCopper(copper) {
  const coins = copperToCoins(copper);
  return ["pp", "gp", "sp", "cp"].filter((key) => coins[key] || key === "cp").map((key) => `${coins[key]} ${key}`).join(" ");
}
