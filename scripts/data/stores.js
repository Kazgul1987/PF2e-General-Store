import { FLAGS, MODULE_ID, SETTINGS } from "../constants.js";

const RARITIES = new Set(["common", "uncommon", "rare", "unique"]);
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Normalize both the historic flat schema and the v14 nested schema. */
export function normalizeStoreDefinition(data = {}, fallbackId = "") {
  const id = String(data.id ?? fallbackId).trim();
  const rarity = String(data.availability?.rarity ?? data.rarity ?? "").toLowerCase();
  const traits = data.availability?.traits ?? data.traits ?? [];
  return {
    id,
    name: String(data.name ?? game.i18n.localize("PF2EGeneralStore.Store.Unnamed")).trim(),
    kind: data.kind === "npc" ? "npc" : "settlement",
    availability: {
      minLevel: Math.max(0, numberOr(data.availability?.minLevel ?? data.minLevel, 0)),
      maxLevel: Math.max(0, numberOr(data.availability?.maxLevel ?? data.maxLevel, 20)),
      rarity: RARITIES.has(rarity) ? rarity : null,
      traits: Array.isArray(traits) ? traits.filter((trait) => typeof trait === "string").map((trait) => trait.trim().toLowerCase()).filter(Boolean) : [],
    },
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
  return normalized;
}

export function getSceneStore(scene = canvas?.scene) {
  return scene?.getFlag(MODULE_ID, FLAGS.ACTIVE_STORE) || game.settings.get(MODULE_ID, SETTINGS.ACTIVE_STORE) || "";
}

export async function setSceneStore(scene, storeId) {
  const id = String(storeId ?? "");
  if (scene) await scene.setFlag(MODULE_ID, FLAGS.ACTIVE_STORE, id);
  else await game.settings.set(MODULE_ID, SETTINGS.ACTIVE_STORE, id);
  return id;
}
