import { GeneralStoreApplication } from "./shared/application.js";
import { MODULE_ID } from "../constants.js";

/** Stateful multi-item sale window; the coordinator remains responsible for sellItems(). */
export class SellApp extends GeneralStoreApplication {
  static DEFAULT_OPTIONS = { ...super.DEFAULT_OPTIONS, id: `${MODULE_ID}-sale`, position: { width: 720, height: 620 }, actions: { sell: SellApp.#sell }, window: { ...super.DEFAULT_OPTIONS.window, title: "PF2EGeneralStore.Sale.Title" } };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/sell-app.hbs` } };
  constructor(options = {}) { super(options); this.viewModel = options.viewModel ?? {}; this.onSell = options.onSell; this.onQuote = options.onQuote; this.busy = false; }
  async _prepareContext(options) { return { ...(await super._prepareContext(options)), ...this.viewModel, busy: this.busy }; }
  _onRender(context, options) {
    super._onRender(context, options);
    const update = () => { const output = this.rootElement.querySelector("[data-sale-total]"); if (output) output.textContent = this.onQuote?.(this.selections) ?? "—"; };
    this.rootElement.querySelectorAll("[data-select-item], [data-quantity]").forEach((input) => input.addEventListener("change", update));
    update();
  }
  get selections() { return [...this.rootElement.querySelectorAll("[data-item-id]")].filter((row) => row.querySelector("[data-select-item]")?.checked).map((row) => ({ id: row.dataset.itemId, quantity: Number(row.querySelector("[data-quantity]")?.value) || 0 })).filter(({ quantity }) => quantity > 0); }
  static async #sell() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.onSell?.(this.selections);
    } catch (error) { console.error(`[${MODULE_ID}] Sale action failed`, error); ui.notifications.error(game.i18n.localize("PF2EGeneralStore.Errors.SaleFailed")); }
    finally { this.busy = false; }
  }
}
