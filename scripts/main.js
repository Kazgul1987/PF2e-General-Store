const MODULE_ID = "pf2e-general-store";
const SHOP_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/shop-dialog.hbs`;

async function openShopDialog() {
  const content = await renderTemplate(SHOP_DIALOG_TEMPLATE, {});

  const dialog = new Dialog({
    title: "General Store",
    content,
    buttons: {
      close: {
        label: "Schließen",
      },
    },
    default: "close",
  });

  dialog.render(true);
}

function addActorSheetHeaderControl(app, html) {
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
    openShopDialog();
  });

  header.find(".window-title").after(button);
}

export function registerPF2eGeneralStore() {
  Hooks.on("renderActorSheet", addActorSheetHeaderControl);
  Hooks.on("renderActorSheetPF2e", addActorSheetHeaderControl);
}

Hooks.once("init", () => {
  registerPF2eGeneralStore();
});
