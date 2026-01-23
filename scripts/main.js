const MODULE_ID = "pf2e-general-store";
const SHOP_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/shop-dialog.hbs`;
const PACK_INDEX_CACHE = new Map();

function debounce(callback, delay = 250) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}

function getItemCompendiumPacks() {
  return game.packs.filter((pack) => pack.documentName === "Item");
}

function getPackIndex(pack) {
  if (!PACK_INDEX_CACHE.has(pack.collection)) {
    PACK_INDEX_CACHE.set(
      pack.collection,
      pack.getIndex({
        fields: [
          "img",
          "system.price",
          "system.price.value",
          "system.price.value.gp",
        ],
      })
    );
  }
  return PACK_INDEX_CACHE.get(pack.collection);
}

function getPriceInGold(entry) {
  const priceData = entry.system?.price?.value ?? entry.system?.price;
  if (typeof priceData === "number") {
    return priceData;
  }
  if (typeof priceData?.gp === "number") {
    return priceData.gp;
  }
  if (typeof priceData?.value?.gp === "number") {
    return priceData.value.gp;
  }
  return 0;
}

function formatGold(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function renderSearchResults(results, listElement) {
  listElement.empty();
  if (!results.length) {
    listElement.append('<li class="placeholder">Keine Ergebnisse.</li>');
    return;
  }

  const itemsHtml = results
    .map(
      (result) => `
      <li class="store-result">
        <img class="store-result__icon" src="${result.icon}" alt="" />
        <span class="store-result__name">${result.name}</span>
        <span class="store-result__price">${formatGold(result.priceGold)} gp</span>
      </li>
    `
    )
    .join("");

  listElement.append(itemsHtml);
}

async function updateSearchResults(query, listElement) {
  const searchTerm = query.trim().toLowerCase();
  if (!searchTerm) {
    renderSearchResults([], listElement);
    return;
  }

  const packs = getItemCompendiumPacks();
  const indices = await Promise.all(packs.map((pack) => getPackIndex(pack)));

  const results = indices
    .flatMap((index) => Array.from(index))
    .filter((entry) => entry.name?.toLowerCase().includes(searchTerm))
    .map((entry) => ({
      icon: entry.img ?? "icons/svg/item-bag.svg",
      name: entry.name ?? "",
      priceGold: getPriceInGold(entry),
    }));

  renderSearchResults(results, listElement);
}

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

  Hooks.once("renderDialog", (app, html) => {
    if (app !== dialog) {
      return;
    }

    const searchInput = html.find('input[name="store-search"]');
    const resultsList = html.find(".store-results ul");
    const debouncedSearch = debounce((value) => {
      void updateSearchResults(value, resultsList);
    });

    searchInput.on("input", (event) => {
      debouncedSearch(event.currentTarget.value);
    });

    void updateSearchResults(searchInput.val() ?? "", resultsList);
  });
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
