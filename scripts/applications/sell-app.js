import { GeneralStoreApplication } from "./shared/application.js";
import { MODULE_ID } from "../constants.js";

/** Stateful multi-item sale window; the coordinator remains responsible for sellItems(). */
export class SellApp extends GeneralStoreApplication {
  static DEFAULT_OPTIONS = { ...super.DEFAULT_OPTIONS, id: `${MODULE_ID}-sale`, position: { width: 720, height: 620 }, actions: { sell: SellApp.#sell }, window: { ...super.DEFAULT_OPTIONS.window, title: "PF2EGeneralStore.Sale.Title" } };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/sell-app.hbs` } };
  constructor(options = {}) { super(options); this.viewModel = options.viewModel ?? {}; this.onSell = options.onSell; this.busy = false; }
  async _prepareContext(options) { return { ...(await super._prepareContext(options)), ...this.viewModel, busy: this.busy }; }
  static async #sell() {
    if (this.busy) return;
    this.busy = true;
    try {
      const selections = [...this.rootElement.querySelectorAll("[data-item-id]")].map((row) => ({ id: row.dataset.itemId, quantity: Number(row.querySelector("input")?.value) || 0 })).filter(({ quantity }) => quantity > 0);
      await this.onSell?.(selections);
    } catch (error) { console.error(`[${MODULE_ID}] Sale action failed`, error); ui.notifications.error(game.i18n.localize("PF2EGeneralStore.Errors.SaleFailed")); }
    finally { this.busy = false; }
  }
}
