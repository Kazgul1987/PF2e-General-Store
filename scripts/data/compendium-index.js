const packPromises = new Map();
const aggregatePromises = new Map();
const descriptions = new Map();

const ITEM_FIELDS = ["img", "system.level", "system.price", "system.publication", "system.remaster", "system.source", "system.traits", "flags.pf2e.legacy", "type"];
const SPELL_FIELDS = ["img", "system.level", "system.rank", "system.publication", "system.remaster", "system.source", "system.traits", "system.ritual", "flags.pf2e.legacy", "type"];

export function getPackIndex(pack, { spells = false } = {}) {
  const key = `${pack.collection}:${spells ? "spells" : "items"}`;
  if (!packPromises.has(key)) packPromises.set(key, pack.getIndex({ fields: spells ? SPELL_FIELDS : ITEM_FIELDS }));
  return packPromises.get(key);
}

export function getItemIndex({ spells = false } = {}) {
  const key = spells ? "spells" : "items";
  if (aggregatePromises.has(key)) return aggregatePromises.get(key);
  const promise = (async () => {
    const packs = game.packs.filter((pack) => spells ? ["Item", "Spell"].includes(pack.documentName) : pack.documentName === "Item");
    const indexes = await Promise.all(packs.map((pack) => getPackIndex(pack, { spells })));
    const seen = new Set();
    return indexes.flatMap((index, position) => Array.from(index).flatMap((entry) => {
      if (spells && packs[position].documentName === "Item" && entry.type !== "spell") return [];
      const id = entry.uuid ?? `${packs[position].collection}.${entry._id}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ entry, pack: packs[position] }];
    }));
  })().catch((error) => { aggregatePromises.delete(key); throw error; });
  aggregatePromises.set(key, promise);
  return promise;
}

export function hasItemIndex({ spells = false } = {}) { return aggregatePromises.has(spells ? "spells" : "items"); }

export async function getItemDescription(packId, itemId) {
  const key = `${packId}.${itemId}`;
  if (descriptions.has(key)) return descriptions.get(key);
  const item = await game.packs.get(packId)?.getDocument(itemId);
  const source = item?.system?.description?.value ?? item?.system?.description ?? game.i18n.localize("PF2EGeneralStore.Errors.NoDescription");
  const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(source, { async: true });
  descriptions.set(key, html);
  return html;
}

export function invalidatePack(packId) {
  for (const key of packPromises.keys()) if (key.startsWith(`${packId}:`)) packPromises.delete(key);
  invalidateAll();
}

export function invalidateAll() {
  packPromises.clear(); aggregatePromises.clear(); descriptions.clear();
}

export function registerCompendiumInvalidationHooks() {
  Hooks.on("updateCompendium", (pack) => invalidatePack(pack?.collection));
  Hooks.on("createCompendium", invalidateAll);
  Hooks.on("deleteCompendium", invalidateAll);
}
