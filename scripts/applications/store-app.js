import { buildWishlistMutationPayload, contributorFromUser, rejectWishlistRequest, validateWishlistRequest } from "../wishlist/socket.js";
import { purchaseItem } from "../pf2e/purchases.js";
import { copperToCoins, normalizePrice } from "../pf2e/currency.js";
import { quoteSale, sellItems } from "../pf2e/sales.js";
import { createSpellConsumableSource, getDefaultSpellConsumableRank, getDefaultSpellConsumableType, getSpellConsumablePrice, getSpellConsumableRanks } from "../pf2e/spell-consumables.js";
import { getItemDescription, getItemIndex } from "../data/compendium-index.js";
import { getActiveStore, getActiveStoreId } from "../data/stores.js";
import { addWishlistItem, moveWishlistItemToCart, moveWishlistPlayerToCart, normalizeWishlistState, removePlayerFromWishlist, removeWishlistQuantity, wishlistTotal } from "../wishlist/model.js";
import { DEFAULT_GM_FILTERS, DEFAULT_WISHLIST_STATE, MODULE_ID, SETTINGS, SOCKET_TYPES, TEMPLATES } from "../constants.js";
import { GeneralStoreApplication, waitForDialog } from "./shared/application.js";
import { GmFiltersApp } from "./gm-filters-app.js";
import { StoreManagerApp } from "./store-manager-app.js";
import { WishlistApp } from "./wishlist-app.js";
import { SellApp } from "./sell-app.js";
import { checkoutCart } from "./store-workflows.js";

let currentGmFilters = { ...DEFAULT_GM_FILTERS };
let currentWishlistState = { ...DEFAULT_WISHLIST_STATE };
let currentPlayerWishlistState = { ...DEFAULT_WISHLIST_STATE };
const pendingWishlistRequests = new Map();
const persistentApps = new Map();

const text = (key) => game.i18n.localize(key);
const gold = (value) => `${Number(value || 0).toLocaleString()} gp`;
const traitsOf = (entry) => Array.isArray(entry?.system?.traits?.value) ? entry.system.traits.value : [];
const levelOf = (entry) => Number(entry?.system?.level?.value ?? entry?.system?.level ?? entry?.system?.rank?.value ?? entry?.system?.rank ?? 0);
const priceCopperOf = (entry) => normalizePrice(entry?.system?.price);
const rarityOf = (entry) => String(entry?.system?.traits?.rarity ?? "").toLowerCase();
const quantityOf = (item) => Math.max(1, Number(item?.system?.quantity ?? 1));
const escape = (value) => foundry.utils.escapeHTML(String(value ?? ""));

function partyActor() {
  return game.actors?.party ?? game.actors?.find?.((actor) => actor.isOfType?.("party")) ?? null;
}

function actorCoins(actor) {
  return actor?.inventory?.coins ?? actor?.system?.currency ?? null;
}

function currencyLabel(actor) {
  const coins = actorCoins(actor);
  return coins?.toString?.() ?? (coins ? gold((Number(coins.gp) || 0) + (Number(coins.sp) || 0) / 10 + (Number(coins.cp) || 0) / 100) : text("PF2EGeneralStore.Common.Unavailable"));
}

function worldWishlist() {
  return normalizeWishlistState(game.settings.get(MODULE_ID, SETTINGS.WISHLIST) ?? currentWishlistState);
}

function playerWishlist() {
  return normalizeWishlistState(game.settings.get(MODULE_ID, SETTINGS.WISHLIST_CLIENT) ?? currentPlayerWishlistState);
}

function wishlist() { return game.user?.isGM ? worldWishlist() : playerWishlist(); }

async function setPlayerWishlist(state) {
  currentPlayerWishlistState = normalizeWishlistState(state);
  await game.settings.set(MODULE_ID, SETTINGS.WISHLIST_CLIENT, currentPlayerWishlistState);
}

async function setWorldWishlist(state) {
  currentWishlistState = normalizeWishlistState(state);
  await game.settings.set(MODULE_ID, SETTINGS.WISHLIST, currentWishlistState);
  game.socket?.emit(`module.${MODULE_ID}`, { type: SOCKET_TYPES.WISHLIST_UPDATE, state: currentWishlistState, total: wishlistTotal(currentWishlistState) });
}

async function mutateWishlist(type, ...args) {
  const mutation = { addItem: addWishlistItem, moveToCart: moveWishlistItemToCart, movePlayerToCart: moveWishlistPlayerToCart, removePlayerFromWishlist, removeQuantity: removeWishlistQuantity }[type];
  if (!mutation) return null;
  const result = mutation(wishlist(), ...args);
  await (game.user?.isGM ? setWorldWishlist(result.state) : setPlayerWishlist(result.state));
  return result;
}

function requestGmMutation(type, args) {
  const requestId = foundry.utils.randomID();
  const payload = buildWishlistMutationPayload(type, args, { requestId, userId: game.user.id });
  if (!payload) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { pendingWishlistRequests.delete(requestId); resolve(null); }, 5000);
    pendingWishlistRequests.set(requestId, { resolve, timeout });
    game.socket.emit(`module.${MODULE_ID}`, payload);
  });
}

function wishlistRows(state, userId) {
  return Object.entries(normalizeWishlistState(state).items).map(([key, item]) => {
    const own = item.players?.find((player) => player.userId === userId);
    return { key, name: item.name, quantity: item.quantity, totalLabel: gold(item.price * item.quantity), canSelect: game.user.isGM || Boolean(own?.quantity), selectQuantity: game.user.isGM ? item.quantity : own?.quantity, players: (item.players ?? []).map((player) => ({ ...player, avatarSrc: player.tokenSrc || player.avatar })) };
  });
}

async function openWishlist(owner) {
  const app = WishlistApp.getOpenInstance() ?? new WishlistApp();
  app.owner = owner;
  const refresh = () => {
    const state = wishlist();
    const available = partyActor() ? currencyLabel(partyActor()) : text("PF2EGeneralStore.Common.Unavailable");
    app.viewModel = { items: wishlistRows(state, game.user.id), partyGold: available, totalValue: gold(wishlistTotal(state)), remainingValue: available, canMoveToCart: Boolean(app.owner) };
  };
  refresh();
  app.onRemoveSelected = async (selections) => {
    for (const selection of selections) {
      if (game.user.isGM) await mutateWishlist("removeQuantity", selection.key, selection.quantity);
      else {
        await mutateWishlist("removePlayerFromWishlist", selection.key, game.user.id, selection.quantity);
        void requestGmMutation("removePlayerFromWishlist", [selection.key, game.user.id, selection.quantity]);
      }
    }
    refresh(); await app.render();
  };
  app.onMoveToCart = async (selections) => {
    if (!app.owner?.addWishlistItem) return ui.notifications.warn(text("PF2EGeneralStore.Errors.CartUnavailable"));
    for (const selection of selections) {
      const moved = game.user.isGM
        ? await mutateWishlist("moveToCart", selection.key, selection.quantity)
        : await mutateWishlist("movePlayerToCart", selection.key, game.user.id, selection.quantity);
      if (!moved?.moved) continue;
      await app.owner.addWishlistItem(moved.moved);
      if (!game.user.isGM) {
        let response = null;
        try { response = await requestGmMutation("removePlayerFromWishlist", [selection.key, game.user.id, moved.moved.quantity]); } catch (error) { console.error(error); }
        if (!response) ui.notifications.error(text("PF2EGeneralStore.Errors.WishlistCartSyncFailed"));
      }
    }
    refresh(); await app.render(); app.owner?.render();
  };
  return app.render({ force: true });
}

async function choose({ title, content, confirm = "PF2EGeneralStore.Common.Select" }) {
  return waitForDialog({ title, content, buttons: [
    { action: "confirm", label: text(confirm), callback: (form) => form ? new FormData(form) : null },
    { action: "cancel", label: text("PF2EGeneralStore.Common.Cancel"), callback: () => null },
  ], default: "confirm" });
}

async function chooseQuantity(name, price) {
  const data = await choose({ title: text("PF2EGeneralStore.Cart.QuantityTitle"), content: `<form class="pf2e-general-store-cart"><p><strong>${escape(name)}</strong> — ${gold(price)}</p><label>${text("PF2EGeneralStore.Common.Quantity")} <input name="quantity" type="number" min="1" value="1"></label></form>` });
  const quantity = Number(data?.get("quantity"));
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

async function chooseSpellConsumable(spell) {
  const types = Object.keys(CONFIG.PF2E?.spellcastingItems ?? {});
  const defaultType = getDefaultSpellConsumableType() ?? types[0];
  const options = types.map((type) => `<option value="${escape(type)}" ${type === defaultType ? "selected" : ""}>${escape(type)}</option>`).join("");
  const ranks = getSpellConsumableRanks(defaultType);
  const rank = getDefaultSpellConsumableRank(spell, defaultType);
  const rankOptions = ranks.map((value) => `<option value="${value}" ${value === rank ? "selected" : ""}>${value}</option>`).join("");
  const data = await choose({ title: text("PF2EGeneralStore.Spell.Title"), content: `<form><label>${text("PF2EGeneralStore.Spell.Type")}<select name="type">${options}</select></label><label>${text("PF2EGeneralStore.Spell.Rank")}<select name="rank">${rankOptions}</select></label></form>` });
  if (!data) return null;
  return { type: data.get("type"), rank: Number(data.get("rank")) };
}

export class StoreApp extends GeneralStoreApplication {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS, id: `${MODULE_ID}-store`, classes: [...super.DEFAULT_OPTIONS.classes, "pf2e-general-store-app"],
    position: { width: 1200, height: 650 }, window: { ...super.DEFAULT_OPTIONS.window, title: "PF2EGeneralStore.Store.Title" },
    actions: { selectResult: StoreApp.#selectResult, addCart: StoreApp.#addCart, addWishlist: StoreApp.#addWishlist, viewWishlist: StoreApp.#viewWishlist, checkout: StoreApp.#checkout, removeCart: StoreApp.#removeCart, sell: StoreApp.#sell, loadMore: StoreApp.#loadMore, logo: StoreApp.#logo },
  };
  static PARTS = { main: { template: TEMPLATES.SHOP } };
  static #instance;

  constructor(actor, options = {}) {
    super(options); this.actor = actor; this.viewState = { searchTerm: "", showSpells: false, showItems: false, itemType: "", sortAlpha: false, limit: 100, selected: null, description: null, cart: new Map(), results: [] }; StoreApp.#instance = this;
  }
  static open(actor) {
    const existing = this.#instance?.rendered ? this.#instance : null;
    if (existing) { if (actor) existing.actor = actor; return existing.render({ force: true }); }
    return new this(actor).render({ force: true });
  }
  static refresh() { if (this.#instance?.rendered) void this.#instance.search(); }
  static getOpenInstance() { return this.#instance?.rendered ? this.#instance : null; }
  async close(options) { if (StoreApp.#instance === this) StoreApp.#instance = undefined; return super.close(options); }

  async _prepareContext(options) {
    const systemLogo = game.system?.logo ?? game.system?.data?.logo;
    const cart = [...this.viewState.cart.entries()].map(([key, item]) => ({ key, ...item, totalLabel: gold(this.itemPriceCopper(item) * item.quantity / 100) }));
    const results = this.viewState.results.slice(0, this.viewState.limit);
    return { ...(await super._prepareContext(options)), actorName: this.actor?.name, actorTokenSrc: this.actor?.prototypeToken?.texture?.src ?? this.actor?.img, actorGold: currencyLabel(this.actor), partyGold: currencyLabel(partyActor()), logoSrc: game.settings.get(MODULE_ID, SETTINGS.SHOP_LOGO) || systemLogo, logoAlt: game.system?.title, activeStoreLabel: getActiveStore()?.name ?? text("PF2EGeneralStore.Store.Unnamed"), isGM: game.user.isGM, ...this.viewState, results, hasMore: results.length < this.viewState.results.length, cart, cartTotal: gold(cart.reduce((sum, item) => sum + this.itemPriceCopper(item) * item.quantity, 0) / 100) };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.rootElement;
    root.querySelector('[name="store-search"]')?.addEventListener("input", (event) => { this.viewState.searchTerm = event.target.value; clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => void this.search(), 200); });
    root.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("change", () => { this.viewState.showSpells = root.querySelector('[name="filter-spell"]').checked; this.viewState.showItems = root.querySelector('[name="filter-item"]').checked; this.viewState.itemType = root.querySelector('[name="filter-item-type"]').value; this.viewState.sortAlpha = root.querySelector('[name="filter-sort-alpha"]').checked; this.viewState.limit = 100; void this.search(); }));
    if (!this.viewState.results.length) void this.search();
  }
  async search() {
    const term = this.viewState.searchTerm.trim().toLowerCase();
    const filters = getActiveStore()?.filters ?? currentGmFilters;
    const showItems = this.viewState.showItems || !this.viewState.showSpells;
    const showSpells = this.viewState.showSpells || !this.viewState.showItems;
    const [items, spells] = await Promise.all([showItems ? getItemIndex() : [], showSpells ? getItemIndex({ spells: true }) : []]);
    const matches = ({ entry }) => {
      const level = levelOf(entry); const rarity = rarityOf(entry); const traits = traitsOf(entry).map((v) => v.toLowerCase());
      return (!term || entry.name?.toLowerCase().includes(term)) && (!this.viewState.itemType || entry.type === this.viewState.itemType) && (filters?.minLevel == null || level >= filters.minLevel) && (filters?.maxLevel == null || level <= filters.maxLevel) && (!filters?.rarity || rarity === filters.rarity) && !(filters?.traits ?? []).some((trait) => !traits.includes(trait));
    };
    this.viewState.results = [...items.filter(matches), ...spells.filter(matches)].map(({ entry, pack }) => { const priceCopper = priceCopperOf(entry); return { itemId: entry._id, pack: pack.collection, entryType: entry.type === "spell" ? "spell" : "item", name: entry.name, icon: entry.img, price: priceCopper / 100, priceCopper, level: levelOf(entry), rarity: rarityOf(entry), traits: traitsOf(entry), totalLabel: gold(priceCopper / 100) }; });
    if (this.viewState.sortAlpha) this.viewState.results.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    await this.render();
  }
  itemPriceCopper(item) { return item.entryType === "spell" ? (getSpellConsumablePrice(item.consumableType, item.rank) * 100 || item.priceCopper || normalizePrice(item.price)) : item.priceCopper; }
  async addWishlistItem(item) { const key = `${item.pack}.${item.itemId}`; const existing = this.viewState.cart.get(key); this.viewState.cart.set(key, { ...item, priceCopper: Number.isSafeInteger(item.priceCopper) ? item.priceCopper : normalizePrice(item.price), quantity: (existing?.quantity ?? 0) + item.quantity }); }
  static async #selectResult(event, target) { this.viewState.selected = this.viewState.results.find((item) => item.itemId === target.dataset.itemId && item.pack === target.dataset.pack); this.viewState.description = await getItemDescription(this.viewState.selected.pack, this.viewState.selected.itemId); await this.render(); }
  static async #addCart() { const item = this.viewState.selected; if (!item) return ui.notifications.warn(text("PF2EGeneralStore.Errors.SelectItem")); const quantity = await chooseQuantity(item.name, item.price); if (!quantity) return; let details = {}; if (item.entryType === "spell") { const spell = await game.packs.get(item.pack)?.getDocument(item.itemId); const selection = spell && await chooseSpellConsumable(spell); if (!selection) return; details = await createSpellConsumableSource(spell, selection) ?? {}; } const key = item.entryType === "spell" ? `${item.pack}.${item.itemId}.${details.consumableType}.${details.rank}` : `${item.pack}.${item.itemId}`; const existing = this.viewState.cart.get(key); this.viewState.cart.set(key, { ...item, ...details, quantity: (existing?.quantity ?? 0) + quantity }); await this.render(); }
  static async #addWishlist() { const item = this.viewState.selected; if (!item) return ui.notifications.warn(text("PF2EGeneralStore.Errors.SelectItem")); const quantity = await chooseQuantity(item.name, item.price); if (!quantity) return; const player = { userId: game.user.id, name: this.actor?.name ?? game.user.name, avatar: game.user.avatar, tokenSrc: this.actor?.prototypeToken?.texture?.src, quantity }; await mutateWishlist("addItem", { itemId: item.itemId, pack: item.pack, name: item.name, entryType: item.entryType, price: item.price, quantity }, player); if (!game.user.isGM) void requestGmMutation("addItem", [{ itemId: item.itemId, pack: item.pack, name: item.name, entryType: item.entryType, price: item.price, quantity }, player]); }
  static #viewWishlist() { return openWishlist(this); }
  static #removeCart(event, target) { this.viewState.cart.delete(target.closest("[data-cart-key]")?.dataset.cartKey); this.render(); }
  static #loadMore() { this.viewState.limit += 100; this.render(); }
  static async #checkout() { const paymentActor = this.rootElement.querySelector('[name="payment-source"]:checked')?.value === "party" ? partyActor() : this.actor; const result = await checkoutCart(this.viewState.cart, (item) => purchaseItem({ buyer: this.actor, paymentActor, packId: item.pack, itemId: item.itemId, quantity: item.quantity, expectedPriceCopper: this.itemPriceCopper(item), storeId: getActiveStoreId(), purchaseSource: item.consumableSource })); if (!result.ok) { await this.render(); return ui.notifications.warn(text("PF2EGeneralStore.Errors.PurchaseFailed")); } ui.notifications.info(text("PF2EGeneralStore.Store.CartPurchased")); await this.render(); }
  static #sell() { return openSale(this.actor); }
  static async #logo(event) { if (!game.user.isGM) return; if (event.shiftKey) { await game.settings.set(MODULE_ID, SETTINGS.SHOP_LOGO, ""); return this.render(); } const Picker = globalThis.FilePicker ?? foundry.applications.apps.FilePicker; new Picker({ type: "image", current: game.settings.get(MODULE_ID, SETTINGS.SHOP_LOGO), callback: async (path) => { await game.settings.set(MODULE_ID, SETTINGS.SHOP_LOGO, path); this.render(); } }).render({ force: true }); }
}

async function confirmSale(sourceActor, selections) {
  const payoutCopper = quoteSale({ sourceActor, selections, store: getActiveStore() });
  const payout = new game.pf2e.Coins(copperToCoins(payoutCopper));
  const result = await waitForDialog({ title: text("PF2EGeneralStore.Sale.ConfirmTitle"), content: `<p>${game.i18n.format("PF2EGeneralStore.Sale.ConfirmMessage", { count: selections.length, amount: escape(payout.toString()) })}</p>`, buttons: [{ action: "yes", label: text("PF2EGeneralStore.Sale.Confirm"), callback: () => true }, { action: "no", label: text("PF2EGeneralStore.Common.Cancel"), callback: () => false }], default: "yes" });
  return result ? { payout } : null;
}

async function showSellApp(sourceActor, payoutActor) {
  const inventory = sourceActor?.inventory?.contents ?? [];
  if (!inventory.length) return ui.notifications.info(text("PF2EGeneralStore.Sale.Empty"));
  const app = new SellApp({ viewModel: { sourceName: sourceActor.name, payoutName: payoutActor.name, items: inventory.map((item) => ({ id: item.id, name: item.name, quantity: quantityOf(item) })), total: "—" }, onQuote: (raw) => new game.pf2e.Coins(copperToCoins(quoteSale({ sourceActor, selections: raw.map(({ id, quantity }) => ({ itemId: id, quantity })), store: getActiveStore() }))).toString(), onSell: async (raw) => {
    const selections = raw.map(({ id, quantity }) => ({ itemId: id, quantity })); const confirmation = await confirmSale(sourceActor, selections); if (!confirmation) return;
    await sellItems({ sourceActor, payoutActor, selections, store: getActiveStore() }); ui.notifications.info(game.i18n.format("PF2EGeneralStore.Sale.Complete", { amount: confirmation.payout.toString() })); await app.close();
  } });
  return app.render({ force: true });
}

async function openSale(actor) {
  if (!actor?.isOwner) return ui.notifications.warn(text("PF2EGeneralStore.Errors.Permission"));
  const party = partyActor();
  const data = await choose({ title: text("PF2EGeneralStore.Sale.SourceTitle"), content: `<form><label><input type="radio" name="source" value="actor" checked>${escape(actor.name)}</label>${party ? `<label><input type="radio" name="source" value="party">${escape(party.name)}</label>` : ""}${game.user.isGM ? `<label><input type="radio" name="source" value="loot">${text("PF2EGeneralStore.Sale.LootActor")}</label>` : ""}</form>` });
  const source = data?.get("source"); if (!source) return;
  if (source === "party") return showSellApp(party, party);
  if (source === "loot") { const actors = game.actors.contents.filter((entry) => entry.isOfType?.("loot")); const selection = await choose({ title: text("PF2EGeneralStore.Sale.LootActor"), content: `<form><select name="actor">${actors.map((entry) => `<option value="${entry.id}">${escape(entry.name)}</option>`).join("")}</select></form>` }); const loot = game.actors.get(selection?.get("actor")); if (loot && party) return showSellApp(loot, party); return; }
  return showSellApp(actor, actor);
}

function singleton(App, options) {
  let app = persistentApps.get(App);
  if (!app?.rendered) { app = new App(options); persistentApps.set(App, app); }
  return app.render({ force: true });
}
function openStoreManager() { if (!game.user.isGM) return; return singleton(StoreManagerApp); }
function openGmMenu() {
  if (!game.user.isGM) return;
  const filters = currentGmFilters;
  const options = { viewModel: { traitsInput: (filters.traits ?? []).join(", "), minLevel: filters.minLevel, maxLevel: filters.maxLevel, rarityOptions: ["", "common", "uncommon", "rare", "unique"].map((value) => ({ value, label: value || "—", selected: value === filters.rarity })) }, handlers: { manageStores: openStoreManager, openWishlist: () => openWishlist(), openStore: () => StoreApp.open(defaultActor()), save: async (form) => { const data = new FormData(form); currentGmFilters = { traits: String(data.get("gm-traits") ?? "").split(",").map((v) => v.trim()).filter(Boolean), minLevel: Number(data.get("min-level")) || null, maxLevel: Number(data.get("max-level")) || null, rarity: data.get("rarity") || null }; await game.settings.set(MODULE_ID, SETTINGS.GM_FILTERS, currentGmFilters); StoreApp.refresh(); } } };
  const existing = persistentApps.get(GmFiltersApp);
  if (existing?.rendered) { existing.viewModel = options.viewModel; Object.assign(existing, options.handlers); return existing.render({ force: true }); }
  return singleton(GmFiltersApp, options);
}
function defaultActor() { return canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null; }
function openDefaultStore(actor = defaultActor()) { if (!actor) return ui.notifications.warn(text("PF2EGeneralStore.Errors.SelectActor")); return StoreApp.open(actor); }

function addActorButton(app, buttons) {
  if (!(game.user.isGM || (game.settings.get(MODULE_ID, SETTINGS.SHOW_STORE_BUTTON) && app.actor?.isOwner))) return;
  buttons.unshift({ class: "pf2e-general-store-btn", icon: "fas fa-store", label: "PF2EGeneralStore.Store.Title", onclick: () => openDefaultStore(app.actor) });
}
function addSceneControls(controls) {
  const visible = game.user.isGM || game.settings.get(MODULE_ID, SETTINGS.SHOW_STORE_BUTTON);
  const tools = { store: { name: "store", title: "PF2EGeneralStore.Store.Title", icon: "fas fa-store", order: 0, button: true, onChange: () => openDefaultStore() } };
  if (game.user.isGM) Object.assign(tools, { filters: { name: "filters", title: "PF2EGeneralStore.GM.Title", icon: "fas fa-filter", order: 10, button: true, onChange: openGmMenu }, stores: { name: "stores", title: "PF2EGeneralStore.Stores.Title", icon: "fas fa-city", order: 20, button: true, onChange: openStoreManager } });
  controls[MODULE_ID] = { name: MODULE_ID, title: "PF2EGeneralStore.Store.Title", icon: "fas fa-store", order: 100, tools, visible };
}

export function registerPF2eGeneralStore() {
  Hooks.on("getActorSheetHeaderButtons", addActorButton);
  Hooks.on("getSceneControlButtons", addSceneControls);
}

Hooks.once("ready", () => {
  currentGmFilters = game.settings.get(MODULE_ID, SETTINGS.GM_FILTERS) ?? DEFAULT_GM_FILTERS;
  currentWishlistState = worldWishlist(); currentPlayerWishlistState = playerWishlist();
  game.socket?.on(`module.${MODULE_ID}`, async (payload) => {
    if (payload?.type === SOCKET_TYPES.FILTERS_UPDATE || payload?.type === "gmFiltersUpdate") { currentGmFilters = payload.filters; return StoreApp.refresh(); }
    if ([SOCKET_TYPES.STORES_UPDATE, SOCKET_TYPES.ACTIVE_STORE_UPDATE, "stores:update", "store:active"].includes(payload?.type)) return StoreApp.refresh();
    if (payload?.type === SOCKET_TYPES.WISHLIST_UPDATE) { currentWishlistState = normalizeWishlistState(payload.state); if (!game.user.isGM) await setPlayerWishlist(currentWishlistState); const app = WishlistApp.getOpenInstance(); if (app) void openWishlist(StoreApp.getOpenInstance()); return; }
    if (payload?.type === SOCKET_TYPES.WISHLIST_RESULT) { const pending = pendingWishlistRequests.get(payload.requestId); if (pending) { clearTimeout(pending.timeout); pendingWishlistRequests.delete(payload.requestId); pending.resolve(payload.result); } return; }
    if (!game.user.isGM || ![SOCKET_TYPES.WISHLIST_ADD, SOCKET_TYPES.WISHLIST_REMOVE_OWN].includes(payload?.type)) return;
    const validated = await validateWishlistRequest(payload); if (!validated) return rejectWishlistRequest(payload);
    let result;
    if (validated.type === SOCKET_TYPES.WISHLIST_ADD) { const item = validated.item; result = await mutateWishlist("addItem", { itemId: item.id, pack: validated.pack.collection, name: item.name, entryType: item.type === "spell" ? "spell" : "item", price: priceCopperOf(item) / 100, quantity: validated.quantity }, { ...contributorFromUser(validated.user), quantity: validated.quantity }); }
    else result = await mutateWishlist("removePlayerFromWishlist", validated.itemKey, validated.user.id, validated.quantity);
    game.socket.emit(`module.${MODULE_ID}`, { type: SOCKET_TYPES.WISHLIST_RESULT, requestId: validated.requestId, result });
  });
});
