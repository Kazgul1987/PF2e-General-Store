import { registerSettings } from "./settings.js";
import { invalidateAll, registerCompendiumInvalidationHooks } from "./data/compendium-index.js";
import { registerPF2eGeneralStore } from "./applications/store-app.js";

Hooks.once("init", () => {
  registerSettings();
  invalidateAll();
  registerPF2eGeneralStore();
});

Hooks.once("ready", () => {
  registerCompendiumInvalidationHooks();
});
