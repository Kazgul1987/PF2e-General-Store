const MODULE_ID = "pf2e-general-store";
const SHOP_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/shop-dialog.hbs`;
const GM_FILTERS_TEMPLATE = `modules/${MODULE_ID}/templates/gm-filters.hbs`;
const GM_FILTERS_SETTING = "gmFilters";
const BULK_ORDER_SETTING = "bulkOrderState";
const PACK_INDEX_CACHE = new Map();
const ITEM_DESCRIPTION_CACHE = new Map();
const TOOLTIP_DELAY = 250;
const DEFAULT_GM_FILTERS = {
  traits: [],
  minLevel: null,
  maxLevel: null,
};
const DEFAULT_BULK_ORDER = {
  active: false,
  gmConfirmed: false,
  totalPrice: 0,
  players: {},
};
let currentGmFilters = { ...DEFAULT_GM_FILTERS };
let currentBulkOrder = { ...DEFAULT_BULK_ORDER };

function debounce(callback, delay = 250) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}

function getItemCompendiumPacks() {
  return game.packs.filter((pack) => pack.documentName === "Item");
}

function getPackIndex(pack) {
  if (!PACK_INDEX_CACHE.has(pack.collection)) {
    PACK_INDEX_CACHE.set(
      pack.collection,
      pack.getIndex({
        fields: [
          "img",
          "system.level",
          "system.price",
          "system.publication",
          "system.remaster",
          "system.source",
          "system.traits",
          "flags.pf2e.legacy",
          "type",
        ],
      })
    );
  }
  return PACK_INDEX_CACHE.get(pack.collection);
}

const ALLOWED_ITEM_TYPES = new Set([
  "equipment",
  "weapon",
  "shield",
  "armor",
  "consumable",
  "treasure",
  "backpack",
]);

function isAllowedItemEntry(entry) {
  if (!entry) {
    return false;
  }
  if (ALLOWED_ITEM_TYPES.has(entry.type)) {
    return true;
  }
  return entry.system?.consumableType === "ammo";
}

async function getItemDescription(packCollection, itemId) {
  const cacheKey = `${packCollection}.${itemId}`;
  if (ITEM_DESCRIPTION_CACHE.has(cacheKey)) {
    return ITEM_DESCRIPTION_CACHE.get(cacheKey);
  }

  const pack = game.packs.get(packCollection);
  if (!pack) {
    return "<em>Beschreibung nicht verfügbar.</em>";
  }

  const item = await pack.getDocument(itemId);
  const description =
    item?.system?.description?.value ??
    item?.system?.description ??
    "<em>Keine Beschreibung verfügbar.</em>";
  const enriched = await TextEditor.enrichHTML(description, { async: true });
  const html = enriched || "<em>Keine Beschreibung verfügbar.</em>";
  ITEM_DESCRIPTION_CACHE.set(cacheKey, html);
  return html;
}

function getPriceInGold(entry) {
  const priceData = entry.system?.price?.value ?? entry.system?.price;
  if (typeof priceData === "number") {
    return priceData;
  }
  if (typeof priceData?.gp === "number") {
    return priceData.gp;
  }
  if (typeof priceData?.value?.gp === "number") {
    return priceData.value.gp;
  }
  return 0;
}

function formatGold(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function normalizeTraits(traitsData) {
  if (!traitsData) {
    return [];
  }
  if (Array.isArray(traitsData)) {
    return traitsData.filter((trait) => typeof trait === "string" && trait.trim());
  }
  if (Array.isArray(traitsData?.value)) {
    return traitsData.value.filter(
      (trait) => typeof trait === "string" && trait.trim()
    );
  }
  return [];
}

function normalizeGmFilters(filters = {}) {
  const traits = Array.isArray(filters.traits) ? filters.traits : [];
  const normalizedTraits = traits
    .filter((trait) => typeof trait === "string")
    .map((trait) => trait.trim())
    .filter((trait) => trait.length > 0)
    .map((trait) => trait.toLowerCase());

  const minLevel = Number.isFinite(filters.minLevel)
    ? filters.minLevel
    : Number.isFinite(Number(filters.minLevel))
      ? Number(filters.minLevel)
      : null;
  const maxLevel = Number.isFinite(filters.maxLevel)
    ? filters.maxLevel
    : Number.isFinite(Number(filters.maxLevel))
      ? Number(filters.maxLevel)
      : null;

  return {
    traits: normalizedTraits,
    minLevel,
    maxLevel,
  };
}

function normalizeLevel(levelData) {
  const levelValue = levelData?.value ?? levelData;
  return Number.isFinite(levelValue) ? levelValue : null;
}

function parseTraitsInput(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[,;]+/)
    .map((trait) => trait.trim())
    .filter((trait) => trait.length > 0)
    .map((trait) => trait.toLowerCase());
}

function formatTraitsInput(traits) {
  if (!Array.isArray(traits)) {
    return "";
  }
  return traits.join(", ");
}

function getCurrentGmFilters() {
  return normalizeGmFilters(
    game.settings?.get(MODULE_ID, GM_FILTERS_SETTING) ?? currentGmFilters
  );
}

function calculateBulkOrderTotal(players) {
  return Object.values(players).reduce((sum, player) => {
    const itemsTotal = Array.isArray(player.items)
      ? player.items.reduce(
          (itemSum, item) =>
            itemSum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
          0
        )
      : 0;
    return sum + itemsTotal;
  }, 0);
}

function normalizeBulkOrderState(state = {}) {
  const players = typeof state.players === "object" && state.players ? state.players : {};
  const normalizedPlayers = Object.entries(players).reduce((acc, [userId, data]) => {
    const items = Array.isArray(data?.items)
      ? data.items
          .map((item) => ({
            itemId: item?.itemId ?? null,
            pack: item?.pack ?? null,
            quantity: Math.max(1, Number(item?.quantity) || 1),
            price: Number(item?.price) || 0,
            name: item?.name ?? "Unbekanntes Item",
          }))
          .filter((item) => item.itemId && item.pack)
      : [];
    acc[userId] = {
      name: data?.name ?? game.users?.get(userId)?.name ?? "Unbekannt",
      confirmed: Boolean(data?.confirmed),
      needsReconfirm: Boolean(data?.needsReconfirm),
      items,
    };
    return acc;
  }, {});

  const totalPrice = calculateBulkOrderTotal(normalizedPlayers);
  return {
    active: Boolean(state.active),
    gmConfirmed: Boolean(state.gmConfirmed),
    players: normalizedPlayers,
    totalPrice,
  };
}

function getBulkOrderState() {
  return normalizeBulkOrderState(
    game.settings?.get(MODULE_ID, BULK_ORDER_SETTING) ?? currentBulkOrder
  );
}

async function setBulkOrderState(nextState) {
  const normalized = normalizeBulkOrderState(nextState);
  currentBulkOrder = normalized;
  await game.settings.set(MODULE_ID, BULK_ORDER_SETTING, normalized);
  game.socket?.emit(`module.${MODULE_ID}`, {
    type: "bulkOrderUpdate",
    state: normalized,
  });
  refreshBulkOrderUi();
}

function isBulkOrderActive() {
  return getBulkOrderState().active;
}

async function setCurrentGmFilters(filters) {
  const normalized = normalizeGmFilters(filters);
  currentGmFilters = normalized;
  await game.settings.set(MODULE_ID, GM_FILTERS_SETTING, normalized);
  game.socket?.emit(`module.${MODULE_ID}`, {
    type: "gmFiltersUpdate",
    filters: normalized,
  });
  refreshOpenStoreDialogs();
}

function isLegacyItem(entry) {
  const legacyFlag = entry?.flags?.pf2e?.legacy;
  if (legacyFlag === true) {
    return true;
  }

  const remasterFlag = entry?.system?.publication?.remaster ?? entry?.system?.remaster;
  if (remasterFlag === true) {
    return false;
  }
  if (remasterFlag === false) {
    return true;
  }

  const source = entry?.system?.publication?.title ?? entry?.system?.source?.value ?? "";
  if (typeof source === "string" && source.toLowerCase().includes("legacy")) {
    return true;
  }

  return false;
}

function renderSearchResults(results, listElement) {
  listElement.empty();
  if (!results.length) {
    listElement.append('<li class="placeholder">Keine Ergebnisse.</li>');
    return;
  }

  const itemsHtml = results
    .map(
      (result) => `
      <li class="store-result">
        <button
          class="store-result__button"
          type="button"
          data-pack="${result.pack}"
          data-item-id="${result.itemId}"
          data-name="${result.name}"
          data-price="${result.priceGold}"
        >
          <img class="store-result__icon" src="${result.icon}" alt="" />
          <span class="store-result__details">
            <span class="store-result__name">${result.name}</span>
            <span class="store-result__level">Level ${result.level ?? "–"}</span>
            ${result.isLegacy ? '<span class="store-result__legacy">Legacy</span>' : ""}
            ${
              result.traits?.length
                ? `<span class="store-result__traits">${result.traits
                    .map((trait) => `<span class="store-result__trait">${trait}</span>`)
                    .join("")}</span>`
                : ""
            }
          </span>
          <span class="store-result__price">${formatGold(result.priceGold)} gp</span>
        </button>
      </li>
    `
    )
    .join("");

  listElement.append(itemsHtml);
}

function entryMatchesGmFilters(entry, filters) {
  const normalizedFilters = normalizeGmFilters(filters);
  if (normalizedFilters.traits.length) {
    const entryTraits = normalizeTraits(entry.system?.traits).map((trait) =>
      trait.toLowerCase()
    );
    const hasAllTraits = normalizedFilters.traits.every((trait) =>
      entryTraits.includes(trait)
    );
    if (!hasAllTraits) {
      return false;
    }
  }

  const level = normalizeLevel(entry.system?.level);
  if (normalizedFilters.minLevel !== null) {
    if (level === null || level < normalizedFilters.minLevel) {
      return false;
    }
  }
  if (normalizedFilters.maxLevel !== null) {
    if (level === null || level > normalizedFilters.maxLevel) {
      return false;
    }
  }
  return true;
}

function refreshOpenStoreDialogs() {
  const activeDialogs = document.querySelectorAll(".pf2e-general-store-dialog");
  if (!activeDialogs.length) {
    return;
  }
  const filters = getCurrentGmFilters();
  activeDialogs.forEach((dialog) => {
    const searchInput = dialog.querySelector('input[name="store-search"]');
    const resultsList = dialog.querySelector(".store-results ul");
    if (!searchInput || !resultsList) {
      return;
    }
    void updateSearchResults(searchInput.value ?? "", $(resultsList), filters);
  });
}

function refreshBulkOrderUi() {
  const dialogs = document.querySelectorAll(".pf2e-general-store-dialog");
  dialogs.forEach((dialog) => updateBulkOrderPanel($(dialog)));

  const gmDialogs = document.querySelectorAll(".pf2e-general-store-gm");
  gmDialogs.forEach((dialog) => updateGmBulkOrderPanel($(dialog)));
}

async function updateSearchResults(query, listElement, gmFiltersOverride) {
  const searchTerm = query.trim().toLowerCase();
  if (!searchTerm) {
    renderSearchResults([], listElement);
    return;
  }

  const gmFilters = gmFiltersOverride ?? getCurrentGmFilters();
  const packs = getItemCompendiumPacks();
  const indices = await Promise.all(packs.map((pack) => getPackIndex(pack)));

  const results = indices
    .flatMap((index, indexPosition) =>
      Array.from(index).map((entry) => ({
        entry,
        pack: packs[indexPosition],
      }))
    )
    .filter(({ entry }) => isAllowedItemEntry(entry))
    .filter(({ entry }) => entryMatchesGmFilters(entry, gmFilters))
    .filter(({ entry }) => entry.name?.toLowerCase().includes(searchTerm))
    .map(({ entry, pack }) => ({
      icon: entry.img ?? "icons/svg/item-bag.svg",
      name: entry.name ?? "",
      priceGold: getPriceInGold(entry),
      traits: normalizeTraits(entry.system?.traits),
      level: normalizeLevel(entry.system?.level),
      isLegacy: isLegacyItem(entry),
      pack: pack.collection,
      itemId: entry._id,
    }));

  renderSearchResults(results, listElement);
}

function ensureBulkOrderPlayer(state, userId, userName) {
  const players = { ...state.players };
  const existing = players[userId];
  players[userId] = {
    name: existing?.name ?? userName ?? "Unbekannt",
    confirmed: existing?.confirmed ?? false,
    needsReconfirm: existing?.needsReconfirm ?? false,
    items: Array.isArray(existing?.items) ? [...existing.items] : [],
  };
  return { ...state, players };
}

function requestBulkOrderAction(action, data = {}) {
  game.socket?.emit(`module.${MODULE_ID}`, {
    type: "bulkOrderAction",
    action,
    data,
    userId: game.user?.id,
  });
}

async function handleBulkOrderAction(payload) {
  if (!game.user?.isGM) {
    return;
  }
  const state = getBulkOrderState();
  const { action, data, userId } = payload ?? {};

  if (action === "setActive") {
    await setBulkOrderState({
      ...state,
      active: Boolean(data?.active),
      gmConfirmed: false,
    });
    return;
  }

  if (!state.active) {
    return;
  }

  const userName = game.users?.get(userId)?.name ?? "Unbekannt";
  const nextState = ensureBulkOrderPlayer(state, userId, userName);
  const player = nextState.players[userId];

  if (action === "addItem") {
    const itemId = data?.itemId;
    const pack = data?.pack;
    if (!itemId || !pack) {
      return;
    }
    const price = Number(data?.price) || 0;
    const name = data?.name ?? "Unbekanntes Item";
    const wasConfirmed = player.confirmed;
    const existingItem = player.items.find(
      (item) => item.itemId === itemId && item.pack === pack
    );
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      player.items.push({ itemId, pack, quantity: 1, price, name });
    }
    player.confirmed = false;
    player.needsReconfirm = wasConfirmed || player.needsReconfirm;
    await setBulkOrderState({
      ...nextState,
      gmConfirmed: false,
      players: { ...nextState.players, [userId]: player },
    });
    return;
  }

  if (action === "removeItem") {
    const itemId = data?.itemId;
    const pack = data?.pack;
    if (!itemId || !pack) {
      return;
    }
    const wasConfirmed = player.confirmed;
    player.items = player.items.filter(
      (item) => !(item.itemId === itemId && item.pack === pack)
    );
    player.confirmed = false;
    player.needsReconfirm = wasConfirmed || player.needsReconfirm;
    const updatedPlayers = { ...nextState.players, [userId]: player };
    if (!player.items.length) {
      delete updatedPlayers[userId];
    }
    await setBulkOrderState({
      ...nextState,
      gmConfirmed: false,
      players: updatedPlayers,
    });
    return;
  }

  if (action === "confirmPlayer") {
    if (!player.items.length) {
      return;
    }
    player.confirmed = true;
    player.needsReconfirm = false;
    await setBulkOrderState({
      ...nextState,
      players: { ...nextState.players, [userId]: player },
    });
    return;
  }

  if (action === "gmConfirm") {
    await confirmBulkOrder(nextState);
  }
}

function positionTooltip(tooltip, event) {
  const offset = 16;
  tooltip.css({
    left: event.pageX + offset,
    top: event.pageY + offset,
  });
}

function getCurrencyInCopper(currency = {}) {
  const pp = Number(currency.pp) || 0;
  const gp = Number(currency.gp) || 0;
  const sp = Number(currency.sp) || 0;
  const cp = Number(currency.cp) || 0;
  return pp * 1000 + gp * 100 + sp * 10 + cp;
}

function hasCurrencyValues(currency) {
  if (!currency || typeof currency !== "object") {
    return false;
  }
  if (typeof CoinsPF2e !== "undefined" && currency instanceof CoinsPF2e) {
    return true;
  }
  return ["pp", "gp", "sp", "cp"].some(
    (key) => key in currency || Number.isFinite(currency[key])
  );
}

function getActorCurrency(actor) {
  const inventoryCurrency = actor?.inventory?.currency;
  if (hasCurrencyValues(inventoryCurrency)) {
    return { currency: inventoryCurrency, path: "system.currency" };
  }
  const directCurrency = actor?.system?.currency;
  if (hasCurrencyValues(directCurrency)) {
    return { currency: directCurrency, path: "system.currency" };
  }
  if (hasCurrencyValues(directCurrency?.value)) {
    return { currency: directCurrency.value, path: "system.currency.value" };
  }
  return { currency: null, path: null };
}

function splitCopper(totalCopper) {
  const remaining = Math.max(0, Math.floor(totalCopper));
  const pp = Math.floor(remaining / 1000);
  const gp = Math.floor((remaining % 1000) / 100);
  const sp = Math.floor((remaining % 100) / 10);
  const cp = remaining % 10;
  return { pp, gp, sp, cp };
}

function getCurrencyUpdate(actor, costGold) {
  const costCopper = Math.round(costGold * 100);
  if (!actor?.inventory?.removeCurrency) {
    return { ok: false, reason: "missing-inventory" };
  }
  const { currency } = getActorCurrency(actor);
  const availableCopper =
    actor?.inventory?.currency?.copperValue ?? getCurrencyInCopper(currency ?? {});
  if (!Number.isFinite(availableCopper)) {
    return { ok: false, reason: "missing-currency" };
  }
  if (availableCopper < costCopper) {
    return { ok: false, reason: "insufficient-funds" };
  }
  return { ok: true, costCopper, costCoins: splitCopper(costCopper) };
}

function formatCurrencyDisplay(currency) {
  if (!currency) {
    return null;
  }
  const totalCopper = getCurrencyInCopper(currency);
  const { pp, gp, sp, cp } = splitCopper(totalCopper);
  const parts = [];
  if (pp) {
    parts.push(`${pp} pp`);
  }
  if (gp) {
    parts.push(`${gp} gp`);
  }
  if (sp) {
    parts.push(`${sp} sp`);
  }
  if (cp || parts.length === 0) {
    parts.push(`${cp} cp`);
  }
  return parts.join(" ");
}

function getPartyStashActor() {
  if (game.party) {
    return game.party;
  }
  if (game.actors?.party) {
    return game.actors.party;
  }
  return game.actors?.find((actor) => actor.type === "party") ?? null;
}

async function deductCurrency(actor, costGold) {
  if (!actor?.inventory?.removeCurrency) {
    const actorName = actor?.name ?? "Unbekannter Actor";
    const message = `Kein unterstütztes Inventory für ${actorName} gefunden.`;
    ui.notifications.warn(message);
    console.warn(message, actor);
    return { ok: false, reason: "missing-inventory" };
  }
  const update = getCurrencyUpdate(actor, costGold);
  if (!update.ok) {
    return update;
  }
  await actor.inventory.removeCurrency(update.costCoins, { byValue: true });
  return { ok: true };
}

async function handlePurchase({ actor, packCollection, itemId, name, priceGold, quantity, useActor, useParty }) {
  if (!actor) {
    ui.notifications.error("Kein gültiger Actor ausgewählt.");
    return;
  }

  const pack = game.packs.get(packCollection);
  if (!pack) {
    ui.notifications.error("Compendium nicht gefunden.");
    return;
  }

  const item = await pack.getDocument(itemId);
  if (!item) {
    ui.notifications.error("Item konnte nicht geladen werden.");
    return;
  }

  const totalPrice = priceGold * quantity;
  let paymentActor = null;

  if (useActor) {
    paymentActor = actor;
  } else if (useParty) {
    paymentActor = getPartyStashActor();
    if (!paymentActor) {
      ui.notifications.error("Kein Party-Stash gefunden.");
      return;
    }
  }

  const paymentResult = await deductCurrency(paymentActor, totalPrice);
  if (!paymentResult.ok) {
    if (paymentResult.reason === "insufficient-funds") {
      ui.notifications.warn("Nicht genug Gold für den Kauf.");
    }
    return;
  }

  const itemData = item.toObject();
  delete itemData._id;
  itemData.system = itemData.system ?? {};
  itemData.system.quantity = quantity;
  await actor.createEmbeddedDocuments("Item", [itemData]);
  ui.notifications.info(`${name} wurde gekauft.`);
}

async function confirmBulkOrder(state) {
  const normalizedState = normalizeBulkOrderState(state);
  const players = Object.entries(normalizedState.players ?? {});
  if (!players.length) {
    ui.notifications.warn("Keine Sammelbestellungen vorhanden.");
    return;
  }
  const allConfirmed = players.every(
    ([, player]) => player.items?.length && player.confirmed
  );
  if (!allConfirmed) {
    ui.notifications.warn("Nicht alle Spieler haben bestätigt.");
    return;
  }

  const itemDocuments = new Map();
  for (const [, player] of players) {
    for (const item of player.items ?? []) {
      const key = `${item.pack}.${item.itemId}`;
      if (itemDocuments.has(key)) {
        continue;
      }
      const pack = game.packs.get(item.pack);
      if (!pack) {
        ui.notifications.error("Compendium nicht gefunden.");
        return;
      }
      const document = await pack.getDocument(item.itemId);
      if (!document) {
        ui.notifications.error("Mindestens ein Item konnte nicht geladen werden.");
        return;
      }
      itemDocuments.set(key, document);
    }
  }

  const totalCost = normalizedState.totalPrice;
  const partyActor = getPartyStashActor();
  const partyCurrency = getActorCurrency(partyActor);
  const partyAvailable = partyCurrency.currency
    ? getCurrencyInCopper(partyCurrency.currency) / 100
    : 0;
  const partyUsed = Math.min(partyAvailable, totalCost);

  const paymentPlan = [];
  for (const [userId, player] of players) {
    const actor = game.users?.get(userId)?.character ?? null;
    if (!actor) {
      ui.notifications.error(`Kein Charakter für ${player.name} gefunden.`);
      return;
    }
    const playerTotal = (player.items ?? []).reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const share = totalCost > 0 ? (playerTotal / totalCost) * partyUsed : 0;
    const remainder = Math.max(0, playerTotal - share);
    paymentPlan.push({ actor, player, remainder });
  }

  if (partyUsed > 0 && (!partyCurrency.currency || !partyActor?.inventory?.removeCurrency)) {
    ui.notifications.error("Party-Stash konnte nicht belastet werden.");
    return;
  }

  const partyUpdate =
    partyUsed > 0 && partyActor ? getCurrencyUpdate(partyActor, partyUsed) : { ok: true };
  if (partyUsed > 0 && !partyUpdate.ok) {
    ui.notifications.warn("Party-Stash hat nicht genug Gold.");
    return;
  }

  const actorUpdates = paymentPlan.map(({ actor, remainder }) =>
    remainder > 0
      ? { actor, remainder, update: getCurrencyUpdate(actor, remainder) }
      : { actor, remainder: 0, update: { ok: true } }
  );

  for (const entry of actorUpdates) {
    if (!entry) {
      continue;
    }
    if (!entry.update.ok) {
      if (entry.update.reason === "insufficient-funds") {
        ui.notifications.warn("Nicht genug Gold für die Sammelbestellung.");
      } else {
        ui.notifications.warn("Zahlung konnte nicht vorbereitet werden.");
      }
      return;
    }
  }

  if (partyUsed > 0 && partyActor) {
    await partyActor.inventory.removeCurrency(partyUpdate.costCoins, { byValue: true });
  }
  for (const entry of actorUpdates) {
    if (!entry || entry.remainder <= 0) {
      continue;
    }
    await entry.actor.inventory.removeCurrency(entry.update.costCoins, { byValue: true });
  }

  for (const [userId, player] of players) {
    const actor = game.users?.get(userId)?.character ?? null;
    if (!actor) {
      continue;
    }
    for (const item of player.items ?? []) {
      const itemDocument = itemDocuments.get(`${item.pack}.${item.itemId}`);
      if (!itemDocument) {
        continue;
      }
      const itemData = itemDocument.toObject();
      delete itemData._id;
      itemData.system = itemData.system ?? {};
      itemData.system.quantity = item.quantity;
      await actor.createEmbeddedDocuments("Item", [itemData]);
    }
  }

  ui.notifications.info("Sammelbestellung abgeschlossen.");
  await setBulkOrderState({
    ...normalizedState,
    gmConfirmed: true,
    players: {},
  });
}

function openPurchaseDialog({ actor, packCollection, itemId, name, priceGold }) {
  const { currency: actorCurrency } = getActorCurrency(actor);
  const actorCurrencyDisplay = formatCurrencyDisplay(actorCurrency);
  const partyActor = getPartyStashActor();
  const { currency: partyCurrency } = getActorCurrency(partyActor);
  const partyCurrencyDisplay = partyActor ? formatCurrencyDisplay(partyCurrency) : null;
  const partyAvailability = partyActor
    ? partyCurrencyDisplay ?? "Nicht verfügbar"
    : "Nicht verfügbar";
  const actorAvailability = actorCurrencyDisplay ?? "Nicht verfügbar";
  const content = `
    <form class="pf2e-general-store-purchase">
      <p class="purchase-title">${name}</p>
      <p class="purchase-price">${formatGold(priceGold)} gp</p>
      <div class="form-group">
        <label for="pf2e-general-store-quantity">Menge</label>
        <input id="pf2e-general-store-quantity" type="number" name="quantity" min="1" value="1" />
      </div>
      <fieldset class="form-group">
        <legend>Zahlungsquelle</legend>
        <label class="store-option">
          <span class="store-option__row">
            <input type="checkbox" name="payment-actor" />
            <span>Gold vom Actor</span>
          </span>
          <span class="store-option__availability">Verfügbar: ${actorAvailability}</span>
        </label>
        <label class="store-option">
          <span class="store-option__row">
            <input type="checkbox" name="payment-party" />
            <span>Party-Stash</span>
          </span>
          <span class="store-option__availability">Verfügbar: ${partyAvailability}</span>
        </label>
      </fieldset>
    </form>
  `;

  const dialog = new Dialog({
    title: "Kauf bestätigen",
    content,
    buttons: {
      buy: {
        label: "Kaufen",
        callback: (html) => {
          const form = html[0]?.querySelector("form");
          if (!form) {
            return false;
          }
          const quantity = Number(form.elements.quantity?.value);
          const useActor = form.elements["payment-actor"]?.checked ?? false;
          const useParty = form.elements["payment-party"]?.checked ?? false;

          if (!Number.isFinite(quantity) || quantity < 1) {
            ui.notifications.warn("Bitte gib eine gültige Menge an.");
            return false;
          }

          if (!useActor && !useParty) {
            ui.notifications.warn("Bitte wähle eine Zahlungsquelle aus.");
            return false;
          }

          if (useActor && useParty) {
            ui.notifications.warn("Bitte wähle genau eine Zahlungsquelle aus.");
            return false;
          }

          void handlePurchase({
            actor,
            packCollection,
            itemId,
            name,
            priceGold,
            quantity,
            useActor,
            useParty,
          });

          return true;
        },
      },
      close: {
        label: "Abbrechen",
      },
    },
    default: "buy",
  });

  dialog.render(true);
}

function getPlayerOrder(state, userId) {
  return (
    state.players?.[userId] ?? {
      name: "Unbekannt",
      confirmed: false,
      needsReconfirm: false,
      items: [],
    }
  );
}

function buildBulkOrderItemsHtml(items, allowRemove) {
  if (!items.length) {
    return '<li class="bulk-order__placeholder">Keine Items ausgewählt.</li>';
  }
  return items
    .map(
      (item) => `
        <li class="bulk-order__item">
          <span class="bulk-order__item-name">${item.name}</span>
          <span class="bulk-order__item-qty">x${item.quantity}</span>
          <span class="bulk-order__item-unit">${formatGold(item.price)} gp</span>
          <span class="bulk-order__item-price">${formatGold(
            item.price * item.quantity
          )} gp</span>
          ${
            allowRemove
              ? `<button class="bulk-order__remove" type="button" data-pack="${
                  item.pack
                }" data-item-id="${item.itemId}" aria-label="Item entfernen">✕</button>`
              : ""
          }
        </li>
      `
    )
    .join("");
}

function buildGmBulkOrderItemsHtml(items) {
  if (!items.length) {
    return '<li class="bulk-order__placeholder">Keine Items ausgewählt.</li>';
  }
  return items
    .map(
      (item) => `
        <li class="bulk-order__gm-item">
          <span class="bulk-order__gm-item-name">${item.name}</span>
          <span class="bulk-order__gm-item-qty">x${item.quantity}</span>
          <span class="bulk-order__gm-item-unit">${formatGold(item.price)} gp</span>
          <span class="bulk-order__gm-item-total">${formatGold(
            item.price * item.quantity
          )} gp</span>
        </li>
      `
    )
    .join("");
}

function updateBulkOrderPanel(dialogElement) {
  const state = getBulkOrderState();
  const bulkSection = dialogElement.find("[data-bulk-order]");
  if (!bulkSection.length) {
    return;
  }
  if (!state.active) {
    bulkSection.addClass("is-hidden");
    return;
  }
  bulkSection.removeClass("is-hidden");

  const userId = game.user?.id;
  const player = getPlayerOrder(state, userId);
  const items = player.items ?? [];
  const total = items.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );
  bulkSection.find(".bulk-order__items").html(buildBulkOrderItemsHtml(items, true));
  bulkSection.find(".bulk-order__total").text(`${formatGold(total)} gp`);
  const statusText = player.confirmed
    ? "Bestätigt"
    : player.needsReconfirm
      ? "Erneute Bestätigung erforderlich"
      : "Noch nicht bestätigt";
  bulkSection.find(".bulk-order__status").text(statusText);
  const confirmButton = bulkSection.find(".bulk-order__confirm");
  confirmButton.prop("disabled", items.length === 0 || player.confirmed);
  confirmButton.text(player.confirmed ? "Bestätigt" : "Bestätigen");
}

function updateGmBulkOrderPanel(dialogElement) {
  const state = getBulkOrderState();
  const bulkSection = dialogElement.find("[data-bulk-order-gm]");
  if (!bulkSection.length) {
    return;
  }
  const activeToggle = dialogElement.find('input[name="bulk-active"]');
  activeToggle.prop("checked", state.active);

  if (!state.active) {
    bulkSection.removeClass("is-hidden");
    bulkSection.find(".bulk-order__gm-total").text("0 gp");
    bulkSection.find(".bulk-order__gm-list").html(
      '<li class="bulk-order__placeholder">Sammelbestellung ist deaktiviert.</li>'
    );
    bulkSection.find(".bulk-order__gm-confirm").prop("disabled", true);
    return;
  }

  bulkSection.removeClass("is-hidden");
  const players = Object.entries(state.players ?? {});
  const listHtml = players.length
    ? players
        .map(([userId, player]) => {
          const items = player.items ?? [];
          const itemCount = items.length;
          const statusLabel = player.confirmed
            ? "Bestätigt"
            : player.needsReconfirm
              ? "Neu bestätigen"
              : "Offen";
          const total = items.reduce(
            (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
            0
          );
          return `
            <li class="bulk-order__gm-player">
              <div class="bulk-order__gm-player-header">
                <span class="bulk-order__gm-name">${player.name}</span>
                <span class="bulk-order__gm-items">${itemCount} Items</span>
                <span class="bulk-order__gm-status">${statusLabel}</span>
                <span class="bulk-order__gm-player-total">${formatGold(total)} gp</span>
              </div>
              <ul class="bulk-order__gm-player-items">
                ${buildGmBulkOrderItemsHtml(items)}
              </ul>
            </li>
          `;
        })
        .join("")
    : '<li class="bulk-order__placeholder">Noch keine Bestellungen.</li>';
  bulkSection.find(".bulk-order__gm-list").html(listHtml);
  bulkSection.find(".bulk-order__gm-total").text(`${formatGold(state.totalPrice)} gp`);
  const allConfirmed =
    players.length > 0 &&
    players.every(([, player]) => player.items?.length && player.confirmed);
  bulkSection.find(".bulk-order__gm-confirm").prop("disabled", !allConfirmed);
}

function setupResultInteractions(resultsList) {
  const tooltip = $('<div class="pf2e-general-store-tooltip" role="tooltip"></div>')
    .appendTo(document.body)
    .hide();
  let activeKey = null;
  let tooltipTimeout = null;

  const showTooltip = async (event, target) => {
    const pack = target.data("pack");
    const itemId = target.data("itemId");
    if (!pack || !itemId) {
      return;
    }
    const cacheKey = `${pack}.${itemId}`;
    activeKey = cacheKey;
    tooltip.html('<span class="tooltip-loading">Lade Beschreibung...</span>');
    tooltip.show();
    positionTooltip(tooltip, event);
    const description = await getItemDescription(pack, itemId);
    if (activeKey !== cacheKey) {
      return;
    }
    tooltip.html(`<div class="tooltip-content">${description}</div>`);
    positionTooltip(tooltip, event);
  };

  resultsList.on("mouseenter", ".store-result__button", (event) => {
    const target = $(event.currentTarget);
    tooltipTimeout = setTimeout(() => {
      void showTooltip(event, target);
    }, TOOLTIP_DELAY);
  });

  resultsList.on("mousemove", ".store-result__button", (event) => {
    if (!tooltip.is(":visible")) {
      return;
    }
    positionTooltip(tooltip, event);
  });

  resultsList.on("mouseleave", ".store-result__button", () => {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    activeKey = null;
    tooltip.hide();
  });

  resultsList.on("click", ".store-result__button", (event) => {
    const target = $(event.currentTarget);
    const name = target.data("name") ?? "Unbekanntes Item";
    const priceGold = Number(target.data("price")) || 0;
    const packCollection = target.data("pack");
    const itemId = target.data("itemId");
    if (isBulkOrderActive()) {
      requestBulkOrderAction("addItem", {
        itemId,
        pack: packCollection,
        price: priceGold,
        name,
      });
      return;
    }
    openPurchaseDialog({
      actor: resultsList.data("actor"),
      packCollection,
      itemId,
      name,
      priceGold,
    });
  });
}

async function openShopDialog(actor) {
  const content = await renderTemplate(SHOP_DIALOG_TEMPLATE, {});

  const dialog = new Dialog(
    {
      title: "General Store",
      content,
      buttons: {
        close: {
          label: "Schließen",
        },
      },
      default: "close",
    },
    {
      width: 720,
      height: 650,
      resizable: true,
    }
  );

  dialog.render(true);

  Hooks.once("renderDialog", (app, html) => {
    if (app !== dialog) {
      return;
    }

    const searchInput = html.find('input[name="store-search"]');
    const resultsList = html.find(".store-results ul");
    resultsList.data("actor", actor ?? null);
    const debouncedSearch = debounce((value) => {
      void updateSearchResults(value, resultsList);
    });

    searchInput.on("input", (event) => {
      debouncedSearch(event.currentTarget.value);
    });

    setupResultInteractions(resultsList);

    html.on("click", ".bulk-order__confirm", () => {
      requestBulkOrderAction("confirmPlayer");
    });

    html.on("click", ".bulk-order__remove", (event) => {
      const target = $(event.currentTarget);
      requestBulkOrderAction("removeItem", {
        itemId: target.data("itemId"),
        pack: target.data("pack"),
      });
    });

    updateBulkOrderPanel(html);
    void updateSearchResults(searchInput.val() ?? "", resultsList);
  });
}

function getDefaultShopActor() {
  const controlledActor = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  return controlledActor ?? game.user?.character ?? null;
}

function openGmMenu() {
  const filters = getCurrentGmFilters();
  const content = renderTemplate(GM_FILTERS_TEMPLATE, {
    traitsInput: formatTraitsInput(filters.traits),
    minLevel: Number.isFinite(filters.minLevel) ? filters.minLevel : "",
    maxLevel: Number.isFinite(filters.maxLevel) ? filters.maxLevel : "",
  });

  content.then((htmlContent) => {
    const dialog = new Dialog({
      title: "General Store (GM)",
      content: htmlContent,
      buttons: {
        save: {
          label: "Filter speichern",
          callback: (html) => {
            const form = html[0]?.querySelector("form");
            if (!form) {
              return false;
            }
            const traitsValue = form.elements["gm-traits"]?.value ?? "";
            const minValue = form.elements["min-level"]?.value ?? "";
            const maxValue = form.elements["max-level"]?.value ?? "";
            const minLevel = minValue === "" ? null : Number(minValue);
            const maxLevel = maxValue === "" ? null : Number(maxValue);

            void setCurrentGmFilters({
              traits: parseTraitsInput(traitsValue),
              minLevel: Number.isFinite(minLevel) ? minLevel : null,
              maxLevel: Number.isFinite(maxLevel) ? maxLevel : null,
            });
            return true;
          },
        },
        open: {
          label: "Store öffnen",
          callback: () => {
            const actor = getDefaultShopActor();
            if (!actor) {
              ui.notifications.warn("Bitte wähle einen Token oder Charakter aus.");
              return false;
            }
            void openShopDialog(actor);
            return true;
          },
        },
        close: {
          label: "Schließen",
        },
      },
      default: "save",
    });

    dialog.render(true);

    Hooks.once("renderDialog", (app, html) => {
      if (app !== dialog) {
        return;
      }

      html.on("change", 'input[name="bulk-active"]', (event) => {
        const active = event.currentTarget.checked;
        void setBulkOrderState({
          ...getBulkOrderState(),
          active,
          gmConfirmed: false,
        });
      });

      html.on("click", ".bulk-order__gm-confirm", () => {
        void confirmBulkOrder(getBulkOrderState());
      });

      updateGmBulkOrderPanel(html);
    });
  });
}

function addActorSheetHeaderControl(app, html) {
  if (!game.user?.isGM) {
    return;
  }
  const appElement = html.closest(".app");
  const header = appElement.find(".window-header");
  if (!header.length || header.find(".pf2e-general-store-btn").length) {
    return;
  }

  const button = $(`
    <a class="pf2e-general-store-btn" title="General Store">
      <i class="fas fa-store" aria-hidden="true"></i>
    </a>
  `);

  button.on("click", (event) => {
    event.preventDefault();
    openShopDialog(app.actor ?? null);
  });

  header.find(".window-title").after(button);
}

function addGmControlsButton(app, html) {
  if (!game.user?.isGM) {
    return;
  }

  const controlsRoot = html.closest("#controls");
  const targetContainer = controlsRoot.find(".main-controls, .control-tools").first();
  if (!targetContainer.length || targetContainer.find(".pf2e-general-store-control").length) {
    return;
  }

  const button = $(`
    <li class="control-tool pf2e-general-store-control" title="General Store (GM)">
      <i class="fas fa-store" aria-hidden="true"></i>
    </li>
  `);

  button.on("click", (event) => {
    event.preventDefault();
    openGmMenu();
  });

  targetContainer.append(button);
}

function addGmChatControlButton(app, html) {
  if (!game.user?.isGM) {
    return;
  }

  const isV13 = Number(game.release?.generation ?? 0) >= 13;
  const existingControl = document.getElementById("pf2e-general-store-chat-control");

  if (isV13) {
    const tabsFlexcol =
      document.getElementsByClassName("tabs")[0]?.getElementsByClassName("flexcol")[0];
    if (!tabsFlexcol || existingControl) {
      return;
    }

    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "pf2e-general-store-control";
    buttonElement.id = "pf2e-general-store-chat-control";
    buttonElement.title = "General Store (GM)";

    const iconElement = document.createElement("i");
    iconElement.className = "fas fa-store";
    iconElement.setAttribute("aria-hidden", "true");
    buttonElement.append(iconElement);

    buttonElement.onclick = (event) => {
      event.preventDefault();
      openGmMenu();
    };

    tabsFlexcol.append(buttonElement);
    return;
  }

  const chatControlLeft = document.getElementsByClassName("chat-control-icon")[0];
  if (!chatControlLeft || existingControl) {
    return;
  }

  const buttonElement = document.createElement("a");
  buttonElement.className = "chat-control-icon pf2e-general-store-control";
  buttonElement.id = "pf2e-general-store-chat-control";
  buttonElement.title = "General Store (GM)";

  const iconElement = document.createElement("i");
  iconElement.className = "fas fa-store";
  iconElement.setAttribute("aria-hidden", "true");
  buttonElement.append(iconElement);

  buttonElement.onclick = (event) => {
    event.preventDefault();
    openGmMenu();
  };

  chatControlLeft.insertBefore(buttonElement, chatControlLeft.firstElementChild);
}

export function registerPF2eGeneralStore() {
  Hooks.on("renderActorSheet", addActorSheetHeaderControl);
  Hooks.on("renderActorSheetPF2e", addActorSheetHeaderControl);
  Hooks.on("renderSceneControls", addGmControlsButton);
  Hooks.on("renderSceneNavigation", addGmChatControlButton);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, GM_FILTERS_SETTING, {
    name: "General Store GM Filter",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_GM_FILTERS,
  });
  game.settings.register(MODULE_ID, BULK_ORDER_SETTING, {
    name: "General Store Sammelbestellung",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_BULK_ORDER,
  });
  registerPF2eGeneralStore();
});

Hooks.once("ready", () => {
  currentGmFilters = getCurrentGmFilters();
  currentBulkOrder = getBulkOrderState();
  game.socket?.on(`module.${MODULE_ID}`, (payload) => {
    if (payload?.type === "gmFiltersUpdate") {
      currentGmFilters = normalizeGmFilters(payload.filters ?? {});
      refreshOpenStoreDialogs();
      return;
    }
    if (payload?.type === "bulkOrderUpdate") {
      currentBulkOrder = normalizeBulkOrderState(payload.state ?? {});
      refreshBulkOrderUi();
      return;
    }
    if (payload?.type === "bulkOrderAction") {
      void handleBulkOrderAction(payload);
    }
  });
});
