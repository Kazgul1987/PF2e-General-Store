import { GeneralStoreApplication } from "./shared/application.js";
import { MODULE_ID, TEMPLATES } from "../constants.js";

export class GmFiltersApp extends GeneralStoreApplication {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: `${MODULE_ID}-gm-filters`,
    actions: { save: GmFiltersApp.#save, openStore: GmFiltersApp.#openStore, manageStores: GmFiltersApp.#manageStores, wishlist: GmFiltersApp.#wishlist },
    window: { ...super.DEFAULT_OPTIONS.window, title: "PF2EGeneralStore.GM.Title" },
  };
  static PARTS = { main: { template: TEMPLATES.GM_FILTERS } };
  constructor(options = {}) { super(options); Object.assign(this, options.handlers); this.viewModel = options.viewModel ?? {}; }
  async _prepareContext(options) { return { ...(await super._prepareContext(options)), ...this.viewModel }; }
  get form() { return this.rootElement?.querySelector("form") ?? null; }
  static async #save() { await this.save?.(this.form); }
  static async #openStore() { await this.openStore?.(); }
  static async #manageStores() { await this.manageStores?.(); }
  static async #wishlist() { await this.openWishlist?.(); }
}

