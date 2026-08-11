/** Return a stable document identity without relying on a display name. */
export function actorIdentity(actor) {
  return actor?.uuid ?? actor?.id ?? null;
}

/**
 * Build the concrete actor choices for the sale source dialog.
 * Earlier roles win when the same document is supplied more than once.
 */
export function buildSaleSourceOptions(candidates) {
  const seen = new Set();
  const options = [];
  for (const candidate of candidates) {
    const actor = candidate?.actor;
    const identity = actorIdentity(actor);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    options.push({ ...candidate, actor, actorId: actor.id, actorUuid: actor.uuid ?? null });
  }
  return options;
}
