const MODULE_ID = "pf2e-general-store";
const SHOP_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/shop-dialog.hbs`;
const GM_FILTERS_TEMPLATE = `modules/${MODULE_ID}/templates/gm-filters.hbs`;
const GM_FILTERS_SETTING = "gmFilters";
const BULK_ORDER_SETTING = "bulkOrderState";
const PACK_INDEX_CACHE = new Map();
const ITEM_INDEX_CACHE = new Map();
const ITEM_DESCRIPTION_CACHE = new Map();
const DEFAULT_DESCRIPTION_PLACEHOLDER =
  '<p class="store-description__placeholder">Wähle ein Item aus, um die Beschreibung zu sehen.</p>';
const DEFAULT_GM_FILTERS = {
  traits: [],
  minLevel: null,
  maxLevel: null,
  rarity: null,
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

async function getCachedItemIndexEntries() {
  if (ITEM_INDEX_CACHE.has("items")) {
    return ITEM_INDEX_CACHE.get("items");
  }

  const packs = getItemCompendiumPacks();
  const indices = await Promise.all(packs.map((pack) => getPackIndex(pack)));
  const entries = indices.flatMap((index, indexPosition) =>
    Array.from(index).map((entry) => ({
      entry,
      pack: packs[indexPosition],
    }))
  );

  ITEM_INDEX_CACHE.set("items", entries);
  return entries;
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

function normalizeRarity(rarityValue) {
  if (typeof rarityValue !== "string") {
    return null;
  }
  const normalized = rarityValue.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const allowedRarities = new Set(["common", "uncommon", "rare", "unique"]);
  return allowedRarities.has(normalized) ? normalized : null;
}

function formatRarityLabel(rarity) {
  switch (rarity) {
    case "common":
      return "Common";
    case "uncommon":
      return "Uncommon";
    case "rare":
      return "Rare";
    case "unique":
      return "Unique";
    default:
      return rarity ? rarity.charAt(0).toUpperCase() + rarity.slice(1) : "";
  }
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
  const rarity = normalizeRarity(filters.rarity);

  return {
    traits: normalizedTraits,
    minLevel,
    maxLevel,
    rarity,
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
  void refreshBulkOrderUi();
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
      (result) => {
        const traitsValue = (result.traits ?? []).join("|");
        return `
      <li class="store-result" data-item-id="${result.itemId}">
        <button
          class="store-result__button"
          type="button"
          data-pack="${result.pack}"
          data-item-id="${result.itemId}"
          data-name="${result.name}"
          data-price="${result.priceGold}"
          data-icon="${result.icon}"
          data-level="${result.level ?? ""}"
          data-rarity="${result.rarity ?? ""}"
          data-legacy="${result.isLegacy ? "true" : "false"}"
          data-traits="${traitsValue}"
        >
          <img class="store-result__icon" src="${result.icon}" alt="" />
          <span class="store-result__details">
            <span class="store-result__name">${result.name}</span>
            <span class="store-result__level">Level ${result.level ?? "–"}</span>
            ${result.isLegacy ? '<span class="store-result__legacy">Legacy</span>' : ""}
            ${
              result.rarity
                ? `<span class="store-result__rarity store-result__rarity--${result.rarity}">${formatRarityLabel(
                    result.rarity
                  )}</span>`
                : ""
            }
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
    `;
      }
    )
    .join("");

  listElement.append(itemsHtml);
}

function getDescriptionContainer(listElement) {
  const dialog = listElement.closest(".pf2e-general-store-dialog");
  return dialog.find(".store-description__content");
}

function resetResultSelection(listElement) {
  listElement.find(".store-result__button.selected").removeClass("selected");
  const descriptionContainer = getDescriptionContainer(listElement);
  if (descriptionContainer.length) {
    descriptionContainer.data("activeDescriptionKey", null);
    descriptionContainer.html(DEFAULT_DESCRIPTION_PLACEHOLDER);
  }
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
  if (normalizedFilters.rarity) {
    const entryRarity = normalizeRarity(entry.system?.traits?.rarity);
    if (entryRarity !== normalizedFilters.rarity) {
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

async function refreshBulkOrderUi() {
  const dialogs = document.querySelectorAll(".pf2e-general-store-dialog");
  dialogs.forEach((dialog) => updateBulkOrderPanel($(dialog)));

  const gmDialogs = document.querySelectorAll(".pf2e-general-store-gm");
  gmDialogs.forEach((dialog) => updateGmBulkOrderPanel($(dialog)));

  const cartDialogs = document.querySelectorAll(
    '.pf2e-general-store-cart-dialog[data-bulk-mode="true"]'
  );
  await Promise.all(
    Array.from(cartDialogs).map(async (dialog) => {
    const listElement = dialog.querySelector(".cart-dialog__items");
    const totalElement = dialog.querySelector("[data-cart-dialog-total]");
    const appElement = dialog.closest(".app");
    const checkoutButton = appElement?.querySelector('button[data-button="checkout"]');
    if (!listElement) {
      return;
    }
    const state = getBulkOrderState();
    if (checkoutButton) {
      checkoutButton.disabled = !(state.active && areAllBulkOrdersConfirmed(state));
    }
    if (!state.active) {
      return;
    }
    const items = getBulkCartDialogItems(state);
    listElement.innerHTML = await buildBulkCartDialogItemsHtml(items);
    if (totalElement) {
      totalElement.textContent = `${formatGold(state.totalPrice)} gp`;
    }
    })
  );
}

async function updateSearchResults(query, listElement, gmFiltersOverride) {
  const searchTerm = query.trim().toLowerCase();
  if (!searchTerm) {
    renderSearchResults([], listElement);
    resetResultSelection(listElement);
    return;
  }

  const gmFilters = gmFiltersOverride ?? getCurrentGmFilters();
  const itemEntries = await getCachedItemIndexEntries();

  const results = itemEntries
    .filter(({ entry }) => isAllowedItemEntry(entry))
    .filter(({ entry }) => entryMatchesGmFilters(entry, gmFilters))
    .filter(({ entry }) => entry.name?.toLowerCase().includes(searchTerm))
    .map(({ entry, pack }) => ({
      icon: entry.img ?? "icons/svg/item-bag.svg",
      name: entry.name ?? "",
      priceGold: getPriceInGold(entry),
      traits: normalizeTraits(entry.system?.traits),
      level: normalizeLevel(entry.system?.level),
      rarity: normalizeRarity(entry.system?.traits?.rarity),
      isLegacy: isLegacyItem(entry),
      pack: pack.collection,
      itemId: entry._id,
    }));

  renderSearchResults(results, listElement);
  resetResultSelection(listElement);
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

function formatCurrencyInGold(currency) {
  if (!currency) {
    return null;
  }
  const totalCopper = getCurrencyInCopper(currency);
  return `${formatGold(totalCopper / 100)} gp`;
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
  const actorCurrencyDisplay = formatCurrencyInGold(actorCurrency);
  const partyActor = getPartyStashActor();
  const { currency: partyCurrency } = getActorCurrency(partyActor);
  const partyCurrencyDisplay = partyActor ? formatCurrencyInGold(partyCurrency) : null;
  const partyAvailability = partyActor
    ? partyCurrencyDisplay ?? "Nicht verfügbar"
    : "Nicht verfügbar";
  const actorAvailability = actorCurrencyDisplay ?? "Nicht verfügbar";
  const actorName = actor?.name ?? "Unbekannter Actor";
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
            <span>${actorName}</span>
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

function buildCartItemDetailsHtml(item) {
  const traits = Array.isArray(item.traits) ? item.traits : [];
  const levelLabel = item.level ?? "–";
  const legacyHtml = item.isLegacy
    ? '<span class="store-result__legacy">Legacy</span>'
    : "";
  const rarityHtml = item.rarity
    ? `<span class="store-result__rarity store-result__rarity--${item.rarity}">${formatRarityLabel(
        item.rarity
      )}</span>`
    : "";
  const traitsHtml = traits.length
    ? `<span class="store-result__traits">${traits
        .map((trait) => `<span class="store-result__trait">${trait}</span>`)
        .join("")}</span>`
    : "";
  const icon = item.icon ?? "icons/svg/item-bag.svg";
  return `
    <div class="cart-dialog__item-info">
      <img class="store-result__icon" src="${icon}" alt="" />
      <span class="store-result__details">
        <span class="store-result__name">${item.name}</span>
        <span class="store-result__level">Level ${levelLabel}</span>
        ${legacyHtml}
        ${rarityHtml}
        ${traitsHtml}
      </span>
    </div>
  `;
}

function buildCartDialogItemsHtml(items) {
  if (!items.length) {
    return '<li class="cart-dialog__placeholder">Keine Items im Warenkorb.</li>';
  }
  return items
    .map(
      (item) => `
        <li class="cart-dialog__item" data-item-key="${item.key}">
          ${buildCartItemDetailsHtml(item)}
          <input class="cart-dialog__qty" type="number" min="1" value="${item.quantity}" />
          <span class="cart-dialog__total">${formatGold(
            item.price * item.quantity
          )} gp</span>
          <button class="cart-dialog__remove" type="button">Entfernen</button>
        </li>
      `
    )
    .join("");
}

function areAllBulkOrdersConfirmed(state) {
  const players = Object.entries(state.players ?? {});
  return (
    players.length > 0 &&
    players.every(([, player]) => player.items?.length && player.confirmed)
  );
}

function getBulkCartDialogItems(state) {
  const itemsMap = new Map();
  const players = Object.entries(state.players ?? {});

  players.forEach(([userId, player]) => {
    const user = game.users?.get(userId);
    const character = user?.character;
    const name = character?.name ?? user?.name ?? player?.name ?? "Unbekannt";
    const avatar =
      character?.prototypeToken?.texture?.src ??
      character?.img ??
      user?.avatar ??
      "icons/svg/mystery-man.svg";

    const playerItems = Array.isArray(player?.items) ? player.items : [];
    playerItems.forEach((item) => {
      const key = `${item.pack}.${item.itemId}`;
      const existing = itemsMap.get(key) ?? {
        key,
        itemId: item.itemId,
        pack: item.pack,
        name: item.name,
        price: item.price,
        quantity: 0,
        players: [],
      };
      existing.quantity += item.quantity;
      existing.players.push({
        userId,
        name,
        avatar,
        quantity: item.quantity,
      });
      itemsMap.set(key, existing);
    });
  });

  return Array.from(itemsMap.values());
}

async function resolveBulkCartItemDisplay(item) {
  const pack = game.packs.get(item.pack);
  if (!pack) {
    return {
      icon: "icons/svg/item-bag.svg",
      name: item.name,
      level: null,
      rarity: null,
      traits: [],
      isLegacy: false,
    };
  }
  const index = await getPackIndex(pack);
  const entry = index?.get ? index.get(item.itemId) : null;
  if (!entry) {
    return {
      icon: "icons/svg/item-bag.svg",
      name: item.name,
      level: null,
      rarity: null,
      traits: [],
      isLegacy: false,
    };
  }
  return {
    icon: entry.img ?? "icons/svg/item-bag.svg",
    name: entry.name ?? item.name,
    level: normalizeLevel(entry.system?.level),
    rarity: normalizeRarity(entry.system?.traits?.rarity),
    traits: normalizeTraits(entry.system?.traits),
    isLegacy: isLegacyItem(entry),
  };
}

async function buildBulkCartDialogItemsHtml(items) {
  if (!items.length) {
    return '<li class="cart-dialog__placeholder">Keine Items im Warenkorb.</li>';
  }
  const currentUserId = game.user?.id;
  const resolvedItems = await Promise.all(
    items.map(async (item) => ({
      item,
      display: await resolveBulkCartItemDisplay(item),
    }))
  );
  return resolvedItems
    .map(({ item, display }) => {
      const displayData = { ...item, ...display };
      return `
        <li class="cart-dialog__item cart-dialog__item--bulk" data-item-key="${item.key}">
          <div class="cart-dialog__item-main">
            ${buildCartItemDetailsHtml(displayData)}
            <ul class="cart-dialog__players">
              ${item.players
                .map(
                  (player) => `
                    <li class="cart-dialog__player">
                      <img class="cart-dialog__avatar" src="${player.avatar}" alt="" />
                      <span class="cart-dialog__player-name">${player.name}</span>
                      <span class="cart-dialog__player-qty">x${player.quantity}</span>
                      ${
                        player.userId === currentUserId
                          ? `<button class="cart-dialog__bulk-remove" type="button" data-pack="${item.pack}" data-item-id="${item.itemId}">Entfernen</button>`
                          : ""
                      }
                    </li>
                  `
                )
                .join("")}
            </ul>
          </div>
          <span class="cart-dialog__qty-display">x${item.quantity}</span>
          <span class="cart-dialog__total">${formatGold(
            item.price * item.quantity
          )} gp</span>
        </li>
      `;
    })
    .join("");
}

function buildCartDialogContent({
  actorName,
  actorAvailability,
  partyAvailability,
  items,
  total,
  isBulkOrder = false,
  itemsHtml,
}) {
  const listHtml = itemsHtml ?? buildCartDialogItemsHtml(items);
  return `
    <form class="pf2e-general-store-cart-dialog" ${
      isBulkOrder ? 'data-bulk-mode="true"' : ""
    }>
      <ul class="cart-dialog__items">
        ${listHtml}
      </ul>
      <div class="cart-dialog__summary">
        Gesamt: <span data-cart-dialog-total>${formatGold(total)} gp</span>
      </div>
      ${
        isBulkOrder
          ? ""
          : `
      <fieldset class="form-group">
        <legend>Zahlungsquelle</legend>
        <label class="store-option">
          <span class="store-option__row">
            <input type="checkbox" name="payment-actor" />
            <span>${actorName}</span>
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
      `
      }
    </form>
  `;
}

async function handleCartCheckout({ actor, items, useActor, useParty }) {
  if (!actor) {
    ui.notifications.error("Kein gültiger Actor ausgewählt.");
    return { ok: false };
  }
  if (!Array.isArray(items) || !items.length) {
    ui.notifications.warn("Der Warenkorb ist leer.");
    return { ok: false };
  }
  if (!useActor && !useParty) {
    ui.notifications.warn("Bitte wähle eine Zahlungsquelle aus.");
    return { ok: false };
  }
  if (useActor && useParty) {
    ui.notifications.warn("Bitte wähle genau eine Zahlungsquelle aus.");
    return { ok: false };
  }

  let paymentActor = null;
  if (useActor) {
    paymentActor = actor;
  } else if (useParty) {
    paymentActor = getPartyStashActor();
    if (!paymentActor) {
      ui.notifications.error("Kein Party-Stash gefunden.");
      return { ok: false };
    }
  }

  const itemDocuments = new Map();
  for (const item of items) {
    const pack = game.packs.get(item.pack);
    if (!pack) {
      ui.notifications.error("Compendium nicht gefunden.");
      return { ok: false };
    }
    const document = await pack.getDocument(item.itemId);
    if (!document) {
      ui.notifications.error("Mindestens ein Item konnte nicht geladen werden.");
      return { ok: false };
    }
    itemDocuments.set(item.key, document);
  }

  const totalPrice = items.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );
  const paymentResult = await deductCurrency(paymentActor, totalPrice);
  if (!paymentResult.ok) {
    if (paymentResult.reason === "insufficient-funds") {
      ui.notifications.warn("Nicht genug Gold für den Kauf.");
    }
    return { ok: false };
  }

  for (const item of items) {
    const itemDocument = itemDocuments.get(item.key);
    if (!itemDocument) {
      continue;
    }
    const itemData = itemDocument.toObject();
    delete itemData._id;
    itemData.system = itemData.system ?? {};
    itemData.system.quantity = item.quantity;
    await actor.createEmbeddedDocuments("Item", [itemData]);
  }

  ui.notifications.info("Warenkorb erfolgreich gekauft.");
  return { ok: true };
}

function openCartQuantityDialog({ name, priceGold }) {
  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(value);
    };
    const content = `
      <form class="pf2e-general-store-cart">
        <p class="purchase-title">${name}</p>
        <p class="purchase-price">${formatGold(priceGold)} gp</p>
        <div class="form-group">
          <label for="pf2e-general-store-cart-quantity">Menge</label>
          <input id="pf2e-general-store-cart-quantity" type="number" name="quantity" min="1" value="1" />
        </div>
      </form>
    `;

    const dialog = new Dialog({
      title: "Menge auswählen",
      content,
      buttons: {
        add: {
          label: "Hinzufügen",
          callback: (html) => {
            const form = html[0]?.querySelector("form");
            if (!form) {
              finalize(null);
              return true;
            }
            const quantity = Number(form.elements.quantity?.value);
            if (!Number.isFinite(quantity) || quantity < 1) {
              ui.notifications.warn("Bitte gib eine gültige Menge an.");
              return false;
            }
            finalize(quantity);
            return true;
          },
        },
        close: {
          label: "Abbrechen",
          callback: () => {
            finalize(null);
          },
        },
      },
      default: "add",
      close: () => {
        finalize(null);
      },
    });

    dialog.render(true);
  });
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
  const players = Object.entries(state.players ?? {});
  const playersHtml = players.length
    ? players
        .map(([playerId, playerData]) => {
          const user = game.users?.get(playerId);
          const character = user?.character;
          const name = character?.name ?? user?.name ?? playerData?.name ?? "Unbekannt";
          const avatar =
            character?.prototypeToken?.texture?.src ??
            character?.img ??
            user?.avatar ??
            "icons/svg/mystery-man.svg";
          const confirmed = Boolean(playerData?.confirmed);
          return `
            <li class="bulk-order__player">
              <span class="bulk-order__player-token">
                <img src="${avatar}" alt="" />
                ${
                  confirmed
                    ? '<span class="bulk-order__player-check" title="Bestätigt"><i class="fas fa-check" aria-hidden="true"></i></span>'
                    : ""
                }
              </span>
              <span class="bulk-order__player-name">${name}</span>
            </li>
          `;
        })
        .join("")
    : '<li class="bulk-order__placeholder">Noch keine Spieler.</li>';
  bulkSection.find(".bulk-order__players").html(playersHtml);
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
  confirmButton.text(player.confirmed ? "Bestätigt" : "Eigene Auswahl bestätigen");
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
  const allConfirmed = areAllBulkOrdersConfirmed(state);
  bulkSection.find(".bulk-order__gm-confirm").prop("disabled", !allConfirmed);
}

function setupResultInteractions(resultsList) {
  const descriptionContainer = getDescriptionContainer(resultsList);

  resultsList.on("click", ".store-result__button", (event) => {
    const target = $(event.currentTarget);
    const name = target.data("name") ?? "Unbekanntes Item";
    const priceGold = Number(target.data("price")) || 0;
    const packCollection = target.data("pack");
    const itemId = target.data("itemId");
    resultsList.find(".store-result__button.selected").removeClass("selected");
    target.addClass("selected");
    if (descriptionContainer.length) {
      descriptionContainer.html(
        '<p class="store-description__placeholder">Lade Beschreibung...</p>'
      );
      if (packCollection && itemId) {
        const cacheKey = `${packCollection}.${itemId}`;
        descriptionContainer.data("activeDescriptionKey", cacheKey);
        void getItemDescription(packCollection, itemId).then((description) => {
          if (descriptionContainer.data("activeDescriptionKey") !== cacheKey) {
            return;
          }
          descriptionContainer.html(description || DEFAULT_DESCRIPTION_PLACEHOLDER);
        });
      } else {
        descriptionContainer.data("activeDescriptionKey", null);
        descriptionContainer.html(DEFAULT_DESCRIPTION_PLACEHOLDER);
      }
    }
    if (isBulkOrderActive()) {
      requestBulkOrderAction("addItem", {
        itemId,
        pack: packCollection,
        price: priceGold,
        name,
      });
    }
  });
}

async function openShopDialog(actor) {
  const actorName = actor?.name ?? "Unbekannter Actor";
  const { currency: actorCurrency } = getActorCurrency(actor);
  const actorGold = formatCurrencyInGold(actorCurrency);
  const partyActor = getPartyStashActor();
  const { currency: partyCurrency } = getActorCurrency(partyActor);
  const partyGold = partyActor ? formatCurrencyInGold(partyCurrency) : null;
  const content = await renderTemplate(SHOP_DIALOG_TEMPLATE, {
    actorName,
    actorGold,
    partyGold,
  });

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

    const cartItems = new Map();
    const cartTotalElement = html.find("[data-cart-total]");
    const getCartItemsArray = () =>
      Array.from(cartItems.entries()).map(([key, item]) => ({ key, ...item }));
    const getCartTotal = () =>
      getCartItemsArray().reduce(
        (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
        0
      );
    const updateCartSummary = () => {
      cartTotalElement.text(`${formatGold(getCartTotal())} gp`);
    };
    const addSelectedItemToCart = async () => {
      const selected = html.find(".store-result__button.selected");
      if (!selected.length) {
        ui.notifications.warn("Bitte wähle zuerst ein Item aus.");
        return;
      }
      const name = selected.data("name") ?? "Unbekanntes Item";
      const priceGold = Number(selected.data("price")) || 0;
      const packCollection = selected.data("pack");
      const itemId = selected.data("itemId");
      const icon = selected.data("icon") ?? "icons/svg/item-bag.svg";
      const levelValue = selected.data("level");
      const level = Number.isFinite(Number(levelValue)) ? Number(levelValue) : null;
      const rarity = selected.data("rarity") || null;
      const isLegacy = Boolean(selected.data("legacy"));
      const traitsValue = selected.data("traits");
      const traits =
        typeof traitsValue === "string" && traitsValue.length
          ? traitsValue.split("|").filter((trait) => trait)
          : [];
      if (!packCollection || !itemId) {
        ui.notifications.warn("Kein gültiges Item ausgewählt.");
        return;
      }
      const quantity = await openCartQuantityDialog({ name, priceGold });
      if (!Number.isFinite(quantity) || quantity < 1) {
        return;
      }
      const key = `${packCollection}.${itemId}`;
      const existing = cartItems.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        cartItems.set(key, {
          itemId,
          pack: packCollection,
          name,
          icon,
          traits,
          rarity,
          level,
          isLegacy,
          price: priceGold,
          quantity,
        });
      }
      updateCartSummary();
    };
    const openCartDialog = async () => {
      const { currency: actorCurrency } = getActorCurrency(actor);
      const actorAvailability = formatCurrencyInGold(actorCurrency) ?? "Nicht verfügbar";
      const partyActor = getPartyStashActor();
      const { currency: partyCurrency } = getActorCurrency(partyActor);
      const partyAvailability = partyActor
        ? formatCurrencyInGold(partyCurrency) ?? "Nicht verfügbar"
        : "Nicht verfügbar";
      const actorName = actor?.name ?? "Unbekannter Actor";
      const bulkActive = isBulkOrderActive();
      const bulkState = bulkActive ? getBulkOrderState() : null;
      const bulkItems = bulkActive ? getBulkCartDialogItems(bulkState) : [];
      const bulkTotal = bulkActive ? bulkState.totalPrice : 0;
      const bulkAllConfirmed =
        bulkActive && bulkState ? areAllBulkOrdersConfirmed(bulkState) : false;
      const bulkItemsHtml = bulkActive
        ? await buildBulkCartDialogItemsHtml(bulkItems)
        : null;
      const dialog = new Dialog({
        title: "Einkaufskorb",
        content: buildCartDialogContent({
          actorName,
          actorAvailability,
          partyAvailability,
          items: bulkActive ? bulkItems : getCartItemsArray(),
          total: bulkActive ? bulkTotal : getCartTotal(),
          isBulkOrder: bulkActive,
          itemsHtml: bulkItemsHtml,
        }),
        buttons: bulkActive
          ? {
              checkout: {
                label: "Zur Kasse",
                callback: async () => {
                  await confirmBulkOrder(getBulkOrderState());
                  return false;
                },
              },
              close: {
                label: "Schließen",
              },
            }
          : {
              checkout: {
                label: "Zur Kasse",
                callback: async (dialogHtml) => {
                  const form = dialogHtml[0]?.querySelector("form");
                  if (!form) {
                    return false;
                  }
                  const useActor = form.elements["payment-actor"]?.checked ?? false;
                  const useParty = form.elements["payment-party"]?.checked ?? false;
                  const items = getCartItemsArray();
                  const result = await handleCartCheckout({
                    actor,
                    items,
                    useActor,
                    useParty,
                  });
                  if (!result.ok) {
                    return false;
                  }
                  cartItems.clear();
                  updateCartSummary();
                  return true;
                },
              },
              close: {
                label: "Schließen",
              },
            },
        default: bulkActive ? "close" : "checkout",
      });

      dialog.render(true);

      Hooks.once("renderDialog", (app, dialogHtml) => {
        if (app !== dialog) {
          return;
        }
        if (bulkActive) {
          const checkoutButton = dialogHtml.find('button[data-button="checkout"]');
          checkoutButton.prop("disabled", !bulkAllConfirmed);
        }
        const listElement = dialogHtml.find(".cart-dialog__items");
        const renderCartDialogList = async () => {
          if (bulkActive) {
            const state = getBulkOrderState();
            const items = getBulkCartDialogItems(state);
            listElement.html(await buildBulkCartDialogItemsHtml(items));
            dialogHtml
              .find("[data-cart-dialog-total]")
              .text(`${formatGold(state.totalPrice)} gp`);
            return;
          }
          listElement.html(buildCartDialogItemsHtml(getCartItemsArray()));
          dialogHtml
            .find("[data-cart-dialog-total]")
            .text(`${formatGold(getCartTotal())} gp`);
        };

        if (bulkActive) {
          dialogHtml.on("click", ".cart-dialog__bulk-remove", (event) => {
            const target = $(event.currentTarget);
            requestBulkOrderAction("removeItem", {
              itemId: target.data("itemId"),
              pack: target.data("pack"),
            });
          });
          return;
        }

        dialogHtml.on("click", ".cart-dialog__remove", (event) => {
          const key = $(event.currentTarget)
            .closest(".cart-dialog__item")
            .data("itemKey");
          if (!key) {
            return;
          }
          cartItems.delete(key);
          updateCartSummary();
          void renderCartDialogList();
        });

        dialogHtml.on("change", ".cart-dialog__qty", (event) => {
          const input = event.currentTarget;
          const key = $(input).closest(".cart-dialog__item").data("itemKey");
          if (!key || !cartItems.has(key)) {
            return;
          }
          let quantity = Number(input.value);
          if (!Number.isFinite(quantity) || quantity < 1) {
            ui.notifications.warn("Bitte gib eine gültige Menge an.");
            quantity = 1;
          }
          const item = cartItems.get(key);
          item.quantity = quantity;
          cartItems.set(key, item);
          updateCartSummary();
          void renderCartDialogList();
        });
      });
    };

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

    html.on("click", ".store-cart__add", () => {
      void addSelectedItemToCart();
    });
    html.on("click", ".store-cart__view", () => {
      void openCartDialog();
    });

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

    updateCartSummary();
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
    rarityOptions: [
      { value: "", label: "Keine", selected: !filters.rarity },
      { value: "common", label: "Common", selected: filters.rarity === "common" },
      { value: "uncommon", label: "Uncommon", selected: filters.rarity === "uncommon" },
      { value: "rare", label: "Rare", selected: filters.rarity === "rare" },
      { value: "unique", label: "Unique", selected: filters.rarity === "unique" },
    ],
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
            const rarityValue = form.elements["rarity"]?.value ?? "";
            const minLevel = minValue === "" ? null : Number(minValue);
            const maxLevel = maxValue === "" ? null : Number(maxValue);

            void setCurrentGmFilters({
              traits: parseTraitsInput(traitsValue),
              minLevel: Number.isFinite(minLevel) ? minLevel : null,
              maxLevel: Number.isFinite(maxLevel) ? maxLevel : null,
              rarity: rarityValue,
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

function invalidateCompendiumCaches() {
  PACK_INDEX_CACHE.clear();
  ITEM_INDEX_CACHE.clear();
  ITEM_DESCRIPTION_CACHE.clear();
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
  invalidateCompendiumCaches();
  registerPF2eGeneralStore();
});

Hooks.once("ready", () => {
  currentGmFilters = getCurrentGmFilters();
  currentBulkOrder = getBulkOrderState();
  Hooks.on("updateCompendium", invalidateCompendiumCaches);
  Hooks.on("createCompendium", invalidateCompendiumCaches);
  Hooks.on("deleteCompendium", invalidateCompendiumCaches);
  game.socket?.on(`module.${MODULE_ID}`, (payload) => {
    if (payload?.type === "gmFiltersUpdate") {
      currentGmFilters = normalizeGmFilters(payload.filters ?? {});
      refreshOpenStoreDialogs();
      return;
    }
    if (payload?.type === "bulkOrderUpdate") {
      currentBulkOrder = normalizeBulkOrderState(payload.state ?? {});
      void refreshBulkOrderUi();
      return;
    }
    if (payload?.type === "bulkOrderAction") {
      void handleBulkOrderAction(payload);
    }
  });
});
