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
