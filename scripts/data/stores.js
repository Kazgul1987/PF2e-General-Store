import { FLAGS, MODULE_ID, SETTINGS, SOCKET_TYPES } from "../constants.js";

const RARITIES = new Set(["common", "uncommon", "rare", "unique"]);
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Normalize both the historic flat schema and the v14 nested schema. */
export function normalizeStoreDefinition(data = {}, fallbackId = "") {
  const id = String(data.id ?? fallbackId).trim();
  const rarity = String(data.availability?.rarity ?? data.filters?.rarity ?? data.rarity ?? "").toLowerCase();
  const traits = data.availability?.traits ?? data.filters?.traits ?? data.traits ?? [];
  const availability = {
    minLevel: Math.max(0, numberOr(data.availability?.minLevel ?? data.filters?.minLevel ?? data.minLevel, 0)),
    maxLevel: Math.max(0, numberOr(data.availability?.maxLevel ?? data.filters?.maxLevel ?? data.maxLevel, 20)),
    rarity: RARITIES.has(rarity) ? rarity : null,
    traits: Array.isArray(traits) ? traits.filter((trait) => typeof trait === "string").map((trait) => trait.trim().toLowerCase()).filter(Boolean) : [],
  };
  return {
    id,
    name: String(data.name ?? game.i18n.localize("PF2EGeneralStore.Store.Unnamed")).trim(),
    kind: data.kind === "npc" ? "npc" : "settlement",
    availability,
    // Preserve the existing UI-facing schema while accepting the newer nested name.
    filters: { ...availability },
    pricing: {
      buyMultiplier: Math.max(0, numberOr(data.pricing?.buyMultiplier ?? data.buyMultiplier, 1)),
      sellMultiplier: Math.max(0, numberOr(data.pricing?.sellMultiplier ?? data.sellMultiplier, 0.5)),
    },
  };
}

export function getStoreDefinitions() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.STORE_DEFINITIONS) ?? {};
  return Object.fromEntries(Object.entries(stored).map(([id, value]) => [id, normalizeStoreDefinition(value, id)]).filter(([id]) => id));
}

export async function setStoreDefinitions(definitions) {
  const normalized = Object.fromEntries(Object.entries(definitions ?? {}).map(([id, value]) => [id, normalizeStoreDefinition(value, id)]).filter(([id]) => id));
  await game.settings.set(MODULE_ID, SETTINGS.STORE_DEFINITIONS, normalized);
  game.socket?.emit(`module.${MODULE_ID}`, { type: SOCKET_TYPES.STORES_UPDATE });
  return normalized;
}

export function getSceneStore(scene = canvas?.scene) {
  return scene?.getFlag(MODULE_ID, FLAGS.ACTIVE_STORE) || game.settings.get(MODULE_ID, SETTINGS.ACTIVE_STORE) || "";
}

export async function setSceneStore(scene, storeId) {
  const id = String(storeId ?? "");
  if (scene) await scene.setFlag(MODULE_ID, FLAGS.ACTIVE_STORE, id);
  else await game.settings.set(MODULE_ID, SETTINGS.ACTIVE_STORE, id);
  game.socket?.emit(`module.${MODULE_ID}`, { type: SOCKET_TYPES.ACTIVE_STORE_UPDATE, storeId: id });
  return id;
}

export function getActiveStoreId() { return getSceneStore() || null; }
export async function setActiveStoreId(storeId) { return setSceneStore(canvas?.scene, storeId); }

export function getActiveStore() {
  const id = getActiveStoreId();
  return id ? getStoreDefinitions()[id] ?? null : null;
}
