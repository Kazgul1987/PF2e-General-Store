const MODULE_ID = "pf2e-general-store";
const SHOP_DIALOG_TEMPLATE = `modules/${MODULE_ID}/templates/shop-dialog.hbs`;
const PACK_INDEX_CACHE = new Map();
const ITEM_DESCRIPTION_CACHE = new Map();
const TOOLTIP_DELAY = 250;

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

async function getItemDescription(packCollection, itemId) {
  const cacheKey = `${packCollection}.${itemId}`;
  if (ITEM_DESCRIPTION_CACHE.has(cacheKey)) {
    return ITEM_DESCRIPTION_CACHE.get(cacheKey);
  }

  const pack = game.packs.get(packCollection);
  if (!pack) {
    return "<em>Beschreibung nicht verfügbar.</em>";
  }

  const item = await pack.getDocument(itemId);
  const description =
    item?.system?.description?.value ??
    item?.system?.description ??
    "<em>Keine Beschreibung verfügbar.</em>";
  const enriched = await TextEditor.enrichHTML(description, { async: true });
  const html = enriched || "<em>Keine Beschreibung verfügbar.</em>";
  ITEM_DESCRIPTION_CACHE.set(cacheKey, html);
  return html;
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
        <button
          class="store-result__button"
          type="button"
          data-pack="${result.pack}"
          data-item-id="${result.itemId}"
          data-name="${result.name}"
          data-price="${result.priceGold}"
        >
          <img class="store-result__icon" src="${result.icon}" alt="" />
          <span class="store-result__name">${result.name}</span>
          <span class="store-result__price">${formatGold(result.priceGold)} gp</span>
        </button>
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
    .flatMap((index, indexPosition) =>
      Array.from(index).map((entry) => ({
        entry,
        pack: packs[indexPosition],
      }))
    )
    .filter(({ entry }) => entry.name?.toLowerCase().includes(searchTerm))
    .map(({ entry, pack }) => ({
      icon: entry.img ?? "icons/svg/item-bag.svg",
      name: entry.name ?? "",
      priceGold: getPriceInGold(entry),
      pack: pack.collection,
      itemId: entry._id,
    }));

  renderSearchResults(results, listElement);
}

function positionTooltip(tooltip, event) {
  const offset = 16;
  tooltip.css({
    left: event.pageX + offset,
    top: event.pageY + offset,
  });
}

function openPurchaseDialog({ name, priceGold }) {
  const content = `
    <form class="pf2e-general-store-purchase">
      <p class="purchase-title">${name}</p>
      <p class="purchase-price">${formatGold(priceGold)} gp</p>
      <div class="form-group">
        <label for="pf2e-general-store-quantity">Menge</label>
        <input id="pf2e-general-store-quantity" type="number" name="quantity" min="1" value="1" />
      </div>
      <fieldset class="form-group">
        <legend>Zahlungsquelle</legend>
        <label class="store-option">
          <input type="checkbox" name="payment-actor" />
          <span>Gold vom Actor</span>
        </label>
        <label class="store-option">
          <input type="checkbox" name="payment-party" />
          <span>Party-Stash</span>
        </label>
      </fieldset>
    </form>
  `;

  const dialog = new Dialog({
    title: "Kauf bestätigen",
    content,
    buttons: {
      buy: {
        label: "Kaufen",
        callback: (html) => {
          const form = html[0]?.querySelector("form");
          if (!form) {
            return false;
          }
          const quantity = Number(form.elements.quantity?.value);
          const useActor = form.elements["payment-actor"]?.checked ?? false;
          const useParty = form.elements["payment-party"]?.checked ?? false;

          if (!Number.isFinite(quantity) || quantity < 1) {
            ui.notifications.warn("Bitte gib eine gültige Menge an.");
            return false;
          }

          if (!useActor && !useParty) {
            ui.notifications.warn("Bitte wähle eine Zahlungsquelle aus.");
            return false;
          }

          return true;
        },
      },
      close: {
        label: "Abbrechen",
      },
    },
    default: "buy",
  });

  dialog.render(true);
}

function setupResultInteractions(resultsList) {
  const tooltip = $('<div class="pf2e-general-store-tooltip" role="tooltip"></div>')
    .appendTo(document.body)
    .hide();
  let activeKey = null;
  let tooltipTimeout = null;

  const showTooltip = async (event, target) => {
    const pack = target.data("pack");
    const itemId = target.data("itemId");
    if (!pack || !itemId) {
      return;
    }
    const cacheKey = `${pack}.${itemId}`;
    activeKey = cacheKey;
    tooltip.html('<span class="tooltip-loading">Lade Beschreibung...</span>');
    tooltip.show();
    positionTooltip(tooltip, event);
    const description = await getItemDescription(pack, itemId);
    if (activeKey !== cacheKey) {
      return;
    }
    tooltip.html(`<div class="tooltip-content">${description}</div>`);
    positionTooltip(tooltip, event);
  };

  resultsList.on("mouseenter", ".store-result__button", (event) => {
    const target = $(event.currentTarget);
    tooltipTimeout = setTimeout(() => {
      void showTooltip(event, target);
    }, TOOLTIP_DELAY);
  });

  resultsList.on("mousemove", ".store-result__button", (event) => {
    if (!tooltip.is(":visible")) {
      return;
    }
    positionTooltip(tooltip, event);
  });

  resultsList.on("mouseleave", ".store-result__button", () => {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    activeKey = null;
    tooltip.hide();
  });

  resultsList.on("click", ".store-result__button", (event) => {
    const target = $(event.currentTarget);
    const name = target.data("name") ?? "Unbekanntes Item";
    const priceGold = Number(target.data("price")) || 0;
    openPurchaseDialog({ name, priceGold });
  });
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

    setupResultInteractions(resultsList);

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
