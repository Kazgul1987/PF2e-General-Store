const MODULE_ID = "pf2e-general-store";
const SHOP_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/shop-dialog.hbs`;
const GM_FILTERS_TEMPLATE = `modules/${MODULE_ID}/templates/gm-filters.hbs`;
const WISHLIST_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/wishlist-dialog.hbs`;
const GM_FILTERS_SETTING = "gmFilters";
const SHOW_STORE_BUTTON_SETTING = "showStoreButtonForPlayers";
const WISHLIST_SETTING = "wishlistState";
const PACK_INDEX_CACHE = new Map();
const ITEM_INDEX_CACHE = new Map();
const ITEM_DESCRIPTION_CACHE = new Map();
let itemIndexBuildPromise = null;
const DEFAULT_DESCRIPTION_PLACEHOLDER =
  '<p class="store-description__placeholder">Wähle ein Item aus, um die Beschreibung zu sehen.</p>';
const DEFAULT_GM_FILTERS = {
  traits: [],
  minLevel: null,
  maxLevel: null,
  rarity: null,
};
const DEFAULT_WISHLIST_STATE = {
  items: {},
};
let currentGmFilters = { ...DEFAULT_GM_FILTERS };
let currentWishlistState = { ...DEFAULT_WISHLIST_STATE };
const pendingWishlistMutationRequests = new Map();
const WISHLIST_MUTATION_REQUEST_TIMEOUT_MS = 5000;

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
  if (itemIndexBuildPromise) {
    return itemIndexBuildPromise;
  }

  itemIndexBuildPromise = (async () => {
    try {
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
    } finally {
      itemIndexBuildPromise = null;
    }
  })();

  return itemIndexBuildPromise;
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

function normalizeWishlistPlayer(player = {}) {
  const userId = typeof player.userId === "string" ? player.userId.trim() : "";
  const name = typeof player.name === "string" ? player.name.trim() : "";
  const avatar = typeof player.avatar === "string" ? player.avatar.trim() : "";
  const tokenSrc = typeof player.tokenSrc === "string" ? player.tokenSrc.trim() : "";
  const quantity = Number(player.quantity) || 0;

  if (!userId && !name) {
    return null;
  }

  return {
    userId,
    name,
    avatar,
    tokenSrc,
    quantity: quantity > 0 ? quantity : 0,
  };
}

function normalizeWishlistItem(item = {}) {
  const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
  const pack = typeof item.pack === "string" ? item.pack.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const price = Number(item.price) || 0;
  const quantity = Number(item.quantity) || 0;
  const players = Array.isArray(item.players)
    ? item.players.map(normalizeWishlistPlayer).filter(Boolean)
    : [];

  if (!itemId || !pack || !name || quantity <= 0) {
    return null;
  }

  return {
    itemId,
    pack,
    name,
    price: price > 0 ? price : 0,
    quantity,
    players,
  };
}

function normalizeWishlistState(state = {}) {
  const items = {};
  if (state && typeof state === "object" && state.items && typeof state.items === "object") {
    Object.entries(state.items).forEach(([key, value]) => {
      const normalized = normalizeWishlistItem(value);
      if (normalized) {
        items[key] = normalized;
      }
    });
  }
  return { items };
}

function calculateWishlistTotal(state) {
  const wishlistState = normalizeWishlistState(state);
  return Object.values(wishlistState.items).reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );
}

function buildWishlistDialogItems(state, currentUserId) {
  const wishlistState = normalizeWishlistState(state);
  return Object.entries(wishlistState.items).map(([key, item]) => {
    const players = Array.isArray(item.players)
      ? item.players.map((player) => ({
          name: player.name || "Unbekannter Spieler",
          avatarSrc: player.tokenSrc || player.avatar || "",
          quantity: player.quantity,
        }))
      : [];
    const userEntry = Array.isArray(item.players)
      ? item.players.find((player) => player.userId === currentUserId)
      : null;
    const totalValue = (Number(item.price) || 0) * (Number(item.quantity) || 0);
    return {
      key,
      name: item.name,
      quantity: item.quantity,
      totalLabel: `${formatGold(totalValue)} gp`,
      players,
      canSelect: Boolean(userEntry && userEntry.quantity > 0),
      selectQuantity: userEntry?.quantity ?? 0,
    };
  });
}

function getWishlistState() {
  return normalizeWishlistState(
    game.settings?.get(MODULE_ID, WISHLIST_SETTING) ?? currentWishlistState
  );
}

async function setWishlistState(state) {
  const normalized = normalizeWishlistState(state);
  if (!game.user?.isGM) {
    return normalized;
  }
  currentWishlistState = normalized;
  await game.settings.set(MODULE_ID, WISHLIST_SETTING, normalized);
  game.socket?.emit(`module.${MODULE_ID}`, {
    type: "wishlistUpdate",
    state: normalized,
    total: calculateWishlistTotal(normalized),
  });
  return normalized;
}

function isWishlistEmpty(state) {
  const wishlistState = normalizeWishlistState(state);
  return Object.keys(wishlistState.items).length === 0;
}

function addWishlistItem(state, item, player) {
  const wishlistState = normalizeWishlistState(state);
  const normalizedItem = normalizeWishlistItem(item);
  if (!normalizedItem) {
    return { state: wishlistState, total: calculateWishlistTotal(wishlistState) };
  }
  const key = `${normalizedItem.pack}.${normalizedItem.itemId}`;
  const existing = wishlistState.items[key];
  if (existing) {
    existing.quantity += normalizedItem.quantity;
    existing.price = normalizedItem.price;
    existing.name = normalizedItem.name;
    if (player) {
      const normalizedPlayer = normalizeWishlistPlayer(player);
      if (normalizedPlayer) {
        const existingPlayer = existing.players.find(
          (entry) => entry.userId === normalizedPlayer.userId
        );
        if (existingPlayer) {
          existingPlayer.quantity += normalizedPlayer.quantity;
        } else {
          existing.players.push(normalizedPlayer);
        }
      }
    }
    wishlistState.items[key] = existing;
  } else {
    const players = [];
    const normalizedPlayer = normalizeWishlistPlayer(player);
    if (normalizedPlayer) {
      players.push(normalizedPlayer);
    }
    wishlistState.items[key] = { ...normalizedItem, players };
  }
  return { state: wishlistState, total: calculateWishlistTotal(wishlistState) };
}

function removeWishlistItem(state, key) {
  const wishlistState = normalizeWishlistState(state);
  if (key && wishlistState.items[key]) {
    delete wishlistState.items[key];
  }
  return { state: wishlistState, total: calculateWishlistTotal(wishlistState) };
}

function setWishlistItemQuantity(state, key, quantity) {
  const wishlistState = normalizeWishlistState(state);
  if (!key || !wishlistState.items[key]) {
    return { state: wishlistState, total: calculateWishlistTotal(wishlistState) };
  }
  const nextQuantity = Number(quantity) || 0;
  if (nextQuantity <= 0) {
    delete wishlistState.items[key];
  } else {
    wishlistState.items[key].quantity = nextQuantity;
  }
  return { state: wishlistState, total: calculateWishlistTotal(wishlistState) };
}

function moveWishlistItemToCart(state, key, quantity) {
  const wishlistState = normalizeWishlistState(state);
  const item = wishlistState.items[key];
  if (!item) {
    return { state: wishlistState, total: calculateWishlistTotal(wishlistState), moved: null };
  }
  const moveQuantity = Number(quantity) || item.quantity;
  const moved = { ...item, quantity: Math.min(moveQuantity, item.quantity) };
  const remaining = item.quantity - moved.quantity;
  if (remaining <= 0) {
    delete wishlistState.items[key];
  } else {
    wishlistState.items[key].quantity = remaining;
  }
  return { state: wishlistState, total: calculateWishlistTotal(wishlistState), moved };
}

function moveWishlistPlayerToCart(state, key, userId, quantity) {
  const wishlistState = normalizeWishlistState(state);
  const item = wishlistState.items[key];
  if (!item || !userId) {
    return { state: wishlistState, total: calculateWishlistTotal(wishlistState), moved: null };
  }
  const playerIndex = Array.isArray(item.players)
    ? item.players.findIndex((player) => player.userId === userId)
    : -1;
  if (playerIndex < 0) {
    return { state: wishlistState, total: calculateWishlistTotal(wishlistState), moved: null };
  }
  const playerEntry = item.players[playerIndex];
  const moveQuantity = Math.min(Number(quantity) || 0, playerEntry.quantity || 0);
  if (moveQuantity <= 0) {
    return { state: wishlistState, total: calculateWishlistTotal(wishlistState), moved: null };
  }

  const moved = { ...item, quantity: moveQuantity };
  playerEntry.quantity -= moveQuantity;
  item.quantity -= moveQuantity;

  if (playerEntry.quantity <= 0) {
    item.players.splice(playerIndex, 1);
  }

  if (item.quantity <= 0 || item.players.length === 0) {
    delete wishlistState.items[key];
  } else {
    wishlistState.items[key] = item;
  }

  return { state: wishlistState, total: calculateWishlistTotal(wishlistState), moved };
}

function removePlayerFromWishlist(state, key, userId, quantity) {
  const result = moveWishlistPlayerToCart(state, key, userId, quantity);
  if (!result) {
    return result;
  }
  return { state: result.state, total: result.total, removed: result.moved };
}

const WISHLIST_MUTATIONS = {
  addItem: addWishlistItem,
  removeItem: removeWishlistItem,
  setQuantity: setWishlistItemQuantity,
  moveToCart: moveWishlistItemToCart,
  movePlayerToCart: moveWishlistPlayerToCart,
  removePlayerFromWishlist,
};

function getWishlistMutation(type) {
  const mutation = WISHLIST_MUTATIONS[type];
  return typeof mutation === "function" ? mutation : null;
}

function getWishlistMutationRequestId() {
  if (typeof foundry?.utils?.randomID === "function") {
    return foundry.utils.randomID();
  }
  if (typeof randomID === "function") {
    return randomID();
  }
  return Math.random().toString(36).slice(2);
}

async function applyWishlistMutationAsGm(type, ...args) {
  const mutation = getWishlistMutation(type);
  if (!mutation) {
    return null;
  }
  const result = mutation(getWishlistState(), ...args);
  await setWishlistState(result.state);
  return result;
}

function requestWishlistMutation(type, args) {
  if (!game.socket) {
    ui.notifications?.warn("Wishlist-Synchronisation nicht verfügbar.");
    return Promise.resolve(null);
  }
  const requestId = getWishlistMutationRequestId();
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingWishlistMutationRequests.delete(requestId);
      ui.notifications?.warn("Wishlist-Aktualisierung dauert zu lange.");
      resolve(null);
    }, WISHLIST_MUTATION_REQUEST_TIMEOUT_MS);
    pendingWishlistMutationRequests.set(requestId, { resolve, timeoutId });
    game.socket.emit(`module.${MODULE_ID}`, {
      type: "wishlistMutationRequest",
      requestId,
      mutationType: type,
      args,
    });
  });
}

async function applyWishlistMutation(type, ...args) {
  if (game.user?.isGM) {
    return applyWishlistMutationAsGm(type, ...args);
  }
  return requestWishlistMutation(type, args);
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

const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_RESULTS = 100;
const SEARCH_RENDER_BATCH_SIZE = 50;

function renderSearchResults(results, listElement) {
  const renderToken = (listElement.data("renderToken") ?? 0) + 1;
  listElement.data("renderToken", renderToken);
  listElement.empty();
  if (!results.length) {
    listElement.append('<li class="placeholder">Keine Ergebnisse.</li>');
    return;
  }

  const buildResultHtml = (result) => {
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
  };

  const renderBatch = (startIndex) => {
    if (listElement.data("renderToken") !== renderToken) {
      return;
    }
    const slice = results.slice(startIndex, startIndex + SEARCH_RENDER_BATCH_SIZE);
    const itemsHtml = slice.map(buildResultHtml).join("");
    listElement.append(itemsHtml);
    const nextIndex = startIndex + SEARCH_RENDER_BATCH_SIZE;
    if (nextIndex < results.length) {
      requestAnimationFrame(() => renderBatch(nextIndex));
    }
  };

  if (results.length <= SEARCH_RENDER_BATCH_SIZE) {
    listElement.append(results.map(buildResultHtml).join(""));
    return;
  }

  renderBatch(0);
}

function updateSearchHint(listElement, message) {
  const dialog = listElement.closest(".pf2e-general-store-dialog");
  const hintElement = dialog.find("[data-search-hint]");
  if (!hintElement.length) {
    return;
  }
  hintElement.text(message ?? "");
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

function renderSearchLoading(listElement) {
  listElement.empty();
  listElement.append('<li class="placeholder">Index wird geladen...</li>');
}

async function updateSearchResults(query, listElement, gmFiltersOverride) {
  const searchTerm = query.trim().toLowerCase();
  if (!searchTerm) {
    renderSearchResults([], listElement);
    resetResultSelection(listElement);
    updateSearchHint(listElement, "");
    return;
  }
  if (searchTerm.length < MIN_SEARCH_LENGTH) {
    renderSearchResults([], listElement);
    resetResultSelection(listElement);
    updateSearchHint(
      listElement,
      `Bitte mindestens ${MIN_SEARCH_LENGTH} Zeichen eingeben.`
    );
    return;
  }

  const gmFilters = gmFiltersOverride ?? getCurrentGmFilters();
  const itemEntriesPromise = getCachedItemIndexEntries();
  if (!ITEM_INDEX_CACHE.has("items")) {
    renderSearchLoading(listElement);
    resetResultSelection(listElement);
    updateSearchHint(listElement, "");
  }
  const itemEntries = await itemEntriesPromise;

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

  const isTruncated = results.length > MAX_SEARCH_RESULTS;
  const limitedResults = isTruncated
    ? results.slice(0, MAX_SEARCH_RESULTS)
    : results;

  renderSearchResults(limitedResults, listElement);
  resetResultSelection(listElement);
  updateSearchHint(
    listElement,
    isTruncated
      ? `Zeige erste ${MAX_SEARCH_RESULTS} Treffer. Bitte Suche weiter eingrenzen.`
      : ""
  );
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

  const dialog = new Dialog(
    {
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
    },
    {
      width: 520,
      height: 420,
    }
  );

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
          <button class="cart-dialog__remove" type="button" aria-label="Item entfernen">
            ×
          </button>
        </li>
      `
    )
    .join("");
}

function buildCartDialogContent({
  actorName,
  actorAvailability,
  partyAvailability,
  items,
  total,
  itemsHtml,
}) {
  const listHtml = itemsHtml ?? buildCartDialogItemsHtml(items);
  return `
    <form class="pf2e-general-store-cart-dialog">
      <ul class="cart-dialog__items">
        ${listHtml}
      </ul>
      <div class="cart-dialog__summary">
        Gesamt: <span data-cart-dialog-total>${formatGold(total)} gp</span>
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
}

async function buildCartItemFromWishlistItem(item) {
  const pack = game.packs.get(item.pack);
  let icon = "icons/svg/item-bag.svg";
  let traits = [];
  let rarity = null;
  let level = null;
  let isLegacy = false;

  if (pack) {
    const document = await pack.getDocument(item.itemId);
    if (document) {
      icon = document.img ?? icon;
      traits = normalizeTraits(document.system?.traits);
      rarity = normalizeRarity(document.system?.traits?.rarity);
      level = normalizeLevel(document.system?.level);
      isLegacy = isLegacyItem(document);
    }
  }

  return {
    itemId: item.itemId,
    pack: item.pack,
    name: item.name,
    icon,
    traits,
    rarity,
    level,
    isLegacy,
    price: item.price,
  };
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
  });
}

async function openShopDialog(actor) {
  const actorName = actor?.name ?? "Unbekannter Actor";
  const actorTokenSrc = actor?.prototypeToken?.texture?.src ?? actor?.img ?? null;
  const { currency: actorCurrency } = getActorCurrency(actor);
  const actorGold = formatCurrencyInGold(actorCurrency);
  const partyActor = getPartyStashActor();
  const { currency: partyCurrency } = getActorCurrency(partyActor);
  const partyGold = partyActor ? formatCurrencyInGold(partyCurrency) : null;
  const content = await renderTemplate(SHOP_DIALOG_TEMPLATE, {
    actorName,
    actorTokenSrc,
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
    const addSelectedItemToWishlist = async () => {
      const selected = html.find(".store-result__button.selected");
      if (!selected.length) {
        ui.notifications.warn("Bitte wähle zuerst ein Item aus.");
        return;
      }
      const name = selected.data("name") ?? "Unbekanntes Item";
      const priceGold = Number(selected.data("price")) || 0;
      const packCollection = selected.data("pack");
      const itemId = selected.data("itemId");
      if (!packCollection || !itemId) {
        ui.notifications.warn("Kein gültiges Item ausgewählt.");
        return;
      }
      const quantity = await openCartQuantityDialog({ name, priceGold });
      if (!Number.isFinite(quantity) || quantity < 1) {
        return;
      }
      const tokenSrc =
        actor?.prototypeToken?.texture?.src ?? actor?.img ?? game.user?.avatar ?? "";
      const player = {
        userId: game.user?.id ?? "",
        name: game.user?.name ?? "Unbekannter Spieler",
        avatar: game.user?.avatar ?? "",
        tokenSrc,
        quantity,
      };
      await applyWishlistMutation(
        "addItem",
        {
          itemId,
          pack: packCollection,
          name,
          price: priceGold,
          quantity,
        },
        player
      );
      ui.notifications.info("Zur Wunschliste hinzugefügt.");
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
      const dialog = new Dialog({
        title: "Einkaufskorb",
        content: buildCartDialogContent({
          actorName,
          actorAvailability,
          partyAvailability,
          items: getCartItemsArray(),
          total: getCartTotal(),
        }),
        buttons: {
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
        default: "checkout",
      });

      dialog.render(true);

      Hooks.once("renderDialog", (app, dialogHtml) => {
        if (app !== dialog) {
          return;
        }
        const listElement = dialogHtml.find(".cart-dialog__items");
        const renderCartDialogList = async () => {
          listElement.html(buildCartDialogItemsHtml(getCartItemsArray()));
          dialogHtml
            .find("[data-cart-dialog-total]")
            .text(`${formatGold(getCartTotal())} gp`);
        };

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
    const openWishlistDialog = async () => {
      const wishlistState = getWishlistState();
      const partyActor = getPartyStashActor();
      const { currency: partyCurrency } = getActorCurrency(partyActor);
      const partyAvailability = partyActor
        ? formatCurrencyInGold(partyCurrency) ?? "Nicht verfügbar"
        : "Nicht verfügbar";
      const currentUserId = game.user?.id ?? "";
      const items = buildWishlistDialogItems(wishlistState, currentUserId);
      const totalValue = `${formatGold(calculateWishlistTotal(wishlistState))} gp`;
      const content = await renderTemplate(WISHLIST_DIALOG_TEMPLATE, {
        items,
        partyGold: partyAvailability,
        totalValue,
      });
      const removeSelectedFromWishlist = async (dialogHtml) => {
        const selections = dialogHtml.find(".wishlist-dialog__select-input:checked");
        if (!selections.length) {
          ui.notifications.warn("Bitte wähle mindestens ein Item aus.");
          return false;
        }
        for (const selection of selections) {
          const key = selection.dataset.itemKey;
          const quantity = Number(selection.dataset.quantity) || 0;
          if (!key || quantity <= 0) {
            continue;
          }
          await applyWishlistMutation(
            "removePlayerFromWishlist",
            key,
            currentUserId,
            quantity
          );
        }
        return true;
      };
      const dialog = new Dialog({
        title: "Wunschliste",
        content,
        buttons: {
          moveToCart: {
            label: "Auswahl in meinen Warenkorb",
            callback: async (dialogHtml) => {
              const selections = dialogHtml.find(
                ".wishlist-dialog__select-input:checked"
              );
              if (!selections.length) {
                ui.notifications.warn("Bitte wähle mindestens ein Item aus.");
                return false;
              }
              for (const selection of selections) {
                const key = selection.dataset.itemKey;
                const quantity = Number(selection.dataset.quantity) || 0;
                if (!key || quantity <= 0) {
                  continue;
                }
                const result = await applyWishlistMutation(
                  "movePlayerToCart",
                  key,
                  currentUserId,
                  quantity
                );
                const moved = result?.moved ?? null;
                if (!moved) {
                  continue;
                }
                const cartItem = await buildCartItemFromWishlistItem(moved);
                const cartKey = `${cartItem.pack}.${cartItem.itemId}`;
                const existing = cartItems.get(cartKey);
                if (existing) {
                  existing.quantity += moved.quantity;
                  cartItems.set(cartKey, existing);
                } else {
                  cartItems.set(cartKey, {
                    ...cartItem,
                    quantity: moved.quantity,
                  });
                }
              }
              updateCartSummary();
              return true;
            },
          },
          close: {
            label: "Schließen",
          },
        },
        default: "moveToCart",
        width: 640,
        height: 520,
      });

      dialog.render(true);

      Hooks.once("renderDialog", (app, dialogHtml) => {
        if (app !== dialog) {
          return;
        }
        dialogHtml.on("click", ".wishlist-dialog__remove", () => {
          void removeSelectedFromWishlist(dialogHtml);
        });
      });
    };

    const searchInput = html.find('input[name="store-search"]');
    const resultsList = html.find(".store-results ul");
    resultsList.data("actor", actor ?? null);
    void getCachedItemIndexEntries();
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
    html.on("click", ".store-wishlist__add", () => {
      void addSelectedItemToWishlist();
    });
    html.on("click", ".store-cart__view", () => {
      void openCartDialog();
    });
    html.on("click", ".store-wishlist__view", () => {
      void openWishlistDialog();
    });

    updateCartSummary();
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
    });
  });
}

function addActorSheetHeaderControl(app, html) {
  const allowPlayerButton = game.settings.get(MODULE_ID, SHOW_STORE_BUTTON_SETTING);
  const canShowButton = game.user?.isGM || (allowPlayerButton && app.actor?.isOwner);
  if (!canShowButton) {
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
  itemIndexBuildPromise = null;
}

export function registerPF2eGeneralStore() {
  Hooks.on("renderActorSheet", addActorSheetHeaderControl);
  Hooks.on("renderActorSheetPF2e", addActorSheetHeaderControl);
  Hooks.on("renderSceneControls", addGmControlsButton);
  Hooks.on("renderSceneNavigation", addGmChatControlButton);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SHOW_STORE_BUTTON_SETTING, {
    name: "General Store: Store-Button für Spieler",
    hint: "Erlaubt Spielern den Store-Button auf ihren eigenen Charakterbögen.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, GM_FILTERS_SETTING, {
    name: "General Store GM Filter",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_GM_FILTERS,
  });
  game.settings.register(MODULE_ID, WISHLIST_SETTING, {
    name: "General Store Wishlist",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_WISHLIST_STATE,
  });
  invalidateCompendiumCaches();
  registerPF2eGeneralStore();
});

Hooks.once("ready", () => {
  currentGmFilters = getCurrentGmFilters();
  currentWishlistState = getWishlistState();
  Hooks.on("updateCompendium", invalidateCompendiumCaches);
  Hooks.on("createCompendium", invalidateCompendiumCaches);
  Hooks.on("deleteCompendium", invalidateCompendiumCaches);
  game.socket?.on(`module.${MODULE_ID}`, (payload) => {
    if (payload?.type === "gmFiltersUpdate") {
      currentGmFilters = normalizeGmFilters(payload.filters ?? {});
      refreshOpenStoreDialogs();
      return;
    }
    if (payload?.type === "wishlistUpdate") {
      currentWishlistState = normalizeWishlistState(payload.state ?? {});
      return;
    }
    if (payload?.type === "wishlistMutationResult") {
      const requestId = payload.requestId;
      if (!requestId || !pendingWishlistMutationRequests.has(requestId)) {
        return;
      }
      const pending = pendingWishlistMutationRequests.get(requestId);
      pendingWishlistMutationRequests.delete(requestId);
      if (pending?.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending?.resolve?.(payload.result ?? null);
      return;
    }
    if (payload?.type === "wishlistMutationRequest") {
      if (!game.user?.isGM) {
        return;
      }
      const requestId = payload.requestId;
      const mutationType = payload.mutationType;
      const args = Array.isArray(payload.args) ? payload.args : [];
      if (!requestId || typeof mutationType !== "string") {
        return;
      }
      void (async () => {
        const result = await applyWishlistMutationAsGm(mutationType, ...args);
        game.socket?.emit(`module.${MODULE_ID}`, {
          type: "wishlistMutationResult",
          requestId,
          result,
        });
      })();
    }
  });
});
