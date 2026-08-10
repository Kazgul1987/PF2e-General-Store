export const SPELL_CONSUMABLE_PRICES = Object.freeze({
  scroll: Object.freeze([0, 4, 12, 30, 70, 150, 300, 600, 1300, 3000, 8000]),
  wand: Object.freeze([0, 60, 160, 360, 700, 1500, 3000, 6500, 15000, 40000]),
});

export function getSpellConsumablePrice(type, rank) {
  return SPELL_CONSUMABLE_PRICES[String(type).toLowerCase()]?.[Number(rank)] ?? 0;
}

/** PF2e v7 stores an embedded spell source plus its selected heightened rank. */
export function embedSpellSource(consumableSource, spellSource, rank) {
  consumableSource.system ??= {};
  consumableSource.system.spell = foundry.utils.mergeObject(spellSource, { system: { location: { heightenedLevel: rank } } }, { inplace: false });
  return consumableSource;
}

const clone = (value) => foundry.utils.deepClone(value);
const rankOf = (spell) => Number(spell?.system?.level?.value ?? spell?.system?.level ?? spell?.system?.rank?.value ?? spell?.system?.rank);

export function getSpellConsumableRanks(type) {
  return Object.keys(CONFIG?.PF2E?.spellcastingItems?.[type]?.compendiumUuids ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

export function getDefaultSpellConsumableType() {
  const items = CONFIG?.PF2E?.spellcastingItems ?? {};
  return items.scroll ? "scroll" : Object.keys(items)[0] ?? null;
}

export function getDefaultSpellConsumableRank(spell, type) {
  const ranks = getSpellConsumableRanks(type); const rank = rankOf(spell);
  return ranks.includes(rank) ? rank : ranks[0] ?? (Number.isFinite(rank) ? rank : null);
}

/** Build the PF2e consumable source. PF2e expects system.spell to contain the
 * embedded spell source and system.location.heightenedLevel to record its rank. */
export async function createSpellConsumableSource(spell, options = {}) {
  const type = options.type ?? getDefaultSpellConsumableType();
  const rank = options.rank ?? getDefaultSpellConsumableRank(spell, type);
  const itemData = CONFIG?.PF2E?.spellcastingItems?.[type];
  const uuid = itemData?.compendiumUuids?.[rank];
  if (!type || rank == null || !uuid) return null;
  const template = await fromUuid(uuid);
  if (!template?.toObject) return null;
  const consumableSource = template.toObject(); delete consumableSource._id;
  consumableSource.name = game.i18n.format(itemData.nameTemplate ?? "{name}", { name: spell.name ?? "", level: rank });
  const traits = Array.isArray(spell.system?.traits?.value) ? spell.system.traits.value : [];
  consumableSource.system.traits = { ...consumableSource.system.traits, value: traits,
    rarity: spell.system?.traits?.rarity ?? consumableSource.system?.traits?.rarity };
  const spellSource = clone(spell._source ?? spell.toObject());
  spellSource._id = foundry.utils.randomID();
  embedSpellSource(consumableSource, spellSource, rank);
  if (spell.system?.description) consumableSource.system.description = clone(spell.system.description);
  if (options.mystified) consumableSource.system.identification = { ...consumableSource.system.identification, status: "unidentified" };
  return { consumableSource, consumableType: type, rank, price: getSpellConsumablePrice(type, rank), consumableImg: consumableSource.img ?? template.img ?? null };
}
