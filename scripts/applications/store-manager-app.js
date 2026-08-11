import { getSceneStore, getStoreDefinitions, setSceneStore, setStoreDefinitions } from "../data/stores.js";
import { MODULE_ID, TEMPLATES } from "../constants.js";
import { GeneralStoreApplication } from "./shared/application.js";

export class StoreManagerApp extends GeneralStoreApplication {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS, id: `${MODULE_ID}-manager`,
    position: { width: 820, height: 650 },
    actions: { addStore: StoreManagerApp.#addStore, deleteStore: StoreManagerApp.#deleteStore, save: StoreManagerApp.#save },
    window: { ...super.DEFAULT_OPTIONS.window, title: "PF2EGeneralStore.Stores.Title" },
  };
  static PARTS = { main: { template: TEMPLATES.STORE_MANAGER } };
  constructor(options = {}) { super(options); this.drafts = []; }
  async _prepareContext(options) {
    const definitions = getStoreDefinitions();
    const activeId = getSceneStore();
    const stores = [...Object.values(definitions), ...this.drafts].map((store) => ({ ...store, ...store.filters, traitsInput: store.filters?.traits?.join(", ") ?? "", isActive: store.id === activeId, isNpc: store.kind === "npc", [`is${store.filters?.rarity?.[0]?.toUpperCase()}${store.filters?.rarity?.slice(1)}`]: true }));
    return { ...(await super._prepareContext(options)), stores, activeId, hasScene: Boolean(canvas?.scene) };
  }
  static #addStore() { this.drafts.push({ id: foundry.utils.randomID(), name: "", kind: "settlement", filters: { minLevel: 0, maxLevel: 20, rarity: null, traits: [] } }); this.render(); }
  static #deleteStore(event, target) { const id = target.closest("[data-store-id]")?.dataset.storeId; this.drafts = this.drafts.filter((store) => store.id !== id); target.closest("tr")?.remove(); }
  static async #save() {
    if (!game.user?.isGM) return ui.notifications.error(game.i18n.localize("PF2EGeneralStore.Errors.GMOnly"));
    const definitions = {};
    for (const row of this.rootElement.querySelectorAll("[data-store-id]")) {
      const value = (selector) => row.querySelector(selector)?.value ?? "";
      const id = row.dataset.storeId;
      definitions[id] = { id, name: value(".store-manager__name"), kind: value(".store-manager__kind"), filters: { minLevel: value(".store-manager__min"), maxLevel: value(".store-manager__max"), rarity: value(".store-manager__rarity"), traits: value(".store-manager__traits").split(",").map((v) => v.trim()).filter(Boolean) } };
    }
    await setStoreDefinitions(definitions);
    await setSceneStore(canvas?.scene, this.rootElement.querySelector('[name="active-store"]')?.value ?? "");
    ui.notifications.info(game.i18n.localize("PF2EGeneralStore.Stores.Saved"));
    await this.render();
  }
}

