export const MODULE_ID = "pf2e-general-store";

export const SETTINGS = Object.freeze({
  GM_FILTERS: "gmFilters",
  SHOW_STORE_BUTTON: "showStoreButtonForPlayers",
  WISHLIST: "wishlistState",
  WISHLIST_CLIENT: "wishlistStateClient",
  SHOP_LOGO: "shopLogo",
  STORE_DEFINITIONS: "storeDefinitions",
  ACTIVE_STORE: "activeStoreId",
});

export const FLAGS = Object.freeze({
  ACTIVE_STORE: "activeStoreId",
  SELL_LOOT_ACTOR: "sellLootActorId",
});

export const SOCKET_TYPES = Object.freeze({
  FILTERS_UPDATE: "filters:update",
  STORES_UPDATE: "stores:update",
  ACTIVE_STORE_UPDATE: "store:active",
  WISHLIST_UPDATE: "wishlist:update",
  WISHLIST_ADD: "wishlist:add",
  WISHLIST_REMOVE: "wishlist:remove",
  WISHLIST_REMOVE_PLAYER: "wishlist:remove-player",
  WISHLIST_RESULT: "wishlist:result",
});

export const TEMPLATES = Object.freeze({
  SHOP: `modules/${MODULE_ID}/templates/shop-dialog.hbs`,
  GM_FILTERS: `modules/${MODULE_ID}/templates/gm-filters.hbs`,
  WISHLIST: `modules/${MODULE_ID}/templates/wishlist-dialog.hbs`,
  STORE_MANAGER: `modules/${MODULE_ID}/templates/store-manager.hbs`,
});

export const DEFAULT_GM_FILTERS = Object.freeze({
  traits: [], minLevel: null, maxLevel: null, rarity: null,
});
export const DEFAULT_WISHLIST_STATE = Object.freeze({ items: {} });
