import { GeneralStoreApplication } from "./shared/application.js";
import { MODULE_ID, TEMPLATES } from "../constants.js";

/** Persistent wishlist view. Mutations are supplied by the UI coordinator. */
export class WishlistApp extends GeneralStoreApplication {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: `${MODULE_ID}-wishlist`,
    classes: [...super.DEFAULT_OPTIONS.classes, "pf2e-general-store-wishlist-window"],
    actions: {
      moveToCart: WishlistApp.#moveToCart,
      removeSelected: WishlistApp.#removeSelected,
    },
    window: { ...super.DEFAULT_OPTIONS.window, title: "PF2EGeneralStore.Wishlist.Title" },
  };

  static PARTS = { main: { template: TEMPLATES.WISHLIST } };
  static #instance;

  constructor(options = {}) {
    super(options);
    this.viewModel = options.viewModel ?? {};
    this.owner = options.owner;
    this.onMoveToCart = options.onMoveToCart;
    this.onRemoveSelected = options.onRemoveSelected;
    WishlistApp.#instance = this;
  }

  static getOpenInstance() { return this.#instance?.rendered ? this.#instance : null; }
  async _prepareContext(options) { return { ...(await super._prepareContext(options)), ...this.viewModel }; }
  async close(options) { if (WishlistApp.#instance === this) WishlistApp.#instance = undefined; return super.close(options); }

  get selections() {
    return [...(this.rootElement?.querySelectorAll(".wishlist-dialog__select-input:checked") ?? [])]
      .map((input) => ({ key: input.dataset.itemKey, quantity: Number(input.dataset.quantity) || 0 }))
      .filter(({ key, quantity }) => key && quantity > 0);
  }

  static async #moveToCart() {
    if (!this.owner?.addWishlistItem) return ui.notifications.warn(game.i18n.localize("PF2EGeneralStore.Errors.CartUnavailable"));
    await this.onMoveToCart?.(this.selections);
  }
  static async #removeSelected() { await this.onRemoveSelected?.(this.selections); }
}
