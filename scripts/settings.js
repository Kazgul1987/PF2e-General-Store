import { DEFAULT_GM_FILTERS, DEFAULT_WISHLIST_STATE, MODULE_ID, SETTINGS } from "./constants.js";

export function registerSettings() {
  const definitions = [
    [SETTINGS.SHOW_STORE_BUTTON, { name: "PF2EGeneralStore.Settings.ShowButton.Name", hint: "PF2EGeneralStore.Settings.ShowButton.Hint", scope: "world", config: true, type: Boolean, default: false }],
    [SETTINGS.GM_FILTERS, { name: "PF2EGeneralStore.Settings.Filters", scope: "world", config: false, type: Object, default: DEFAULT_GM_FILTERS }],
    [SETTINGS.WISHLIST, { name: "PF2EGeneralStore.Settings.Wishlist", scope: "world", config: false, type: Object, default: DEFAULT_WISHLIST_STATE }],
    [SETTINGS.WISHLIST_CLIENT, { name: "PF2EGeneralStore.Settings.PlayerWishlist", scope: "client", config: false, type: Object, default: DEFAULT_WISHLIST_STATE }],
    [SETTINGS.SHOP_LOGO, { name: "PF2EGeneralStore.Settings.Logo", scope: "world", config: false, type: String, default: "" }],
    [SETTINGS.STORE_DEFINITIONS, { name: "PF2EGeneralStore.Settings.Stores", scope: "world", config: false, type: Object, default: {} }],
    [SETTINGS.ACTIVE_STORE, { name: "PF2EGeneralStore.Settings.ActiveStore", scope: "world", config: false, type: String, default: "" }],
  ];
  for (const [key, data] of definitions) game.settings.register(MODULE_ID, key, data);
}
