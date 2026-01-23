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
          "system.level",
          "system.price",
          "system.publication",
          "system.remaster",
          "system.source",
          "system.traits",
          "flags.pf2e.legacy",
          "type",
        ],
      })
    );
  }
  return PACK_INDEX_CACHE.get(pack.collection);
}

function isEquipmentEntry(entry) {
  return entry?.type === "equipment";
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

function normalizeTraits(traitsData) {
  if (!traitsData) {
    return [];
  }
  if (Array.isArray(traitsData)) {
    return traitsData.filter((trait) => typeof trait === "string" && trait.trim());
  }
  if (Array.isArray(traitsData?.value)) {
    return traitsData.value.filter(
      (trait) => typeof trait === "string" && trait.trim()
    );
  }
  return [];
}

function normalizeLevel(levelData) {
  const levelValue = levelData?.value ?? levelData;
  return Number.isFinite(levelValue) ? levelValue : null;
}

function isLegacyItem(entry) {
  const legacyFlag = entry?.flags?.pf2e?.legacy;
  if (legacyFlag === true) {
    return true;
  }

  const remasterFlag = entry?.system?.publication?.remaster ?? entry?.system?.remaster;
  if (remasterFlag === true) {
    return false;
  }
  if (remasterFlag === false) {
    return true;
  }

  const source = entry?.system?.publication?.title ?? entry?.system?.source?.value ?? "";
  if (typeof source === "string" && source.toLowerCase().includes("legacy")) {
    return true;
  }

  return false;
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
          <span class="store-result__details">
            <span class="store-result__name">${result.name}</span>
            <span class="store-result__level">Level ${result.level ?? "–"}</span>
            ${result.isLegacy ? '<span class="store-result__legacy">Legacy</span>' : ""}
            ${
              result.traits?.length
                ? `<span class="store-result__traits">${result.traits
                    .map((trait) => `<span class="store-result__trait">${trait}</span>`)
                    .join("")}</span>`
                : ""
            }
          </span>
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
    .filter(({ entry }) => isEquipmentEntry(entry))
    .filter(({ entry }) => entry.name?.toLowerCase().includes(searchTerm))
    .map(({ entry, pack }) => ({
      icon: entry.img ?? "icons/svg/item-bag.svg",
      name: entry.name ?? "",
      priceGold: getPriceInGold(entry),
      traits: normalizeTraits(entry.system?.traits),
      level: normalizeLevel(entry.system?.level),
      isLegacy: isLegacyItem(entry),
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

function getCurrencyInCopper(currency = {}) {
  const pp = Number(currency.pp) || 0;
  const gp = Number(currency.gp) || 0;
  const sp = Number(currency.sp) || 0;
  const cp = Number(currency.cp) || 0;
  return pp * 1000 + gp * 100 + sp * 10 + cp;
}

function hasCurrencyValues(currency) {
  if (!currency || typeof currency !== "object") {
    return false;
  }
  if (typeof CoinsPF2e !== "undefined" && currency instanceof CoinsPF2e) {
    return true;
  }
  return ["pp", "gp", "sp", "cp"].some(
    (key) => key in currency || Number.isFinite(currency[key])
  );
}

function getActorCurrency(actor) {
  const directCurrency = actor?.system?.currency;
  if (hasCurrencyValues(directCurrency)) {
    return { currency: directCurrency, path: "system.currency" };
  }
  if (hasCurrencyValues(directCurrency?.value)) {
    return { currency: directCurrency.value, path: "system.currency.value" };
  }
  const partyCurrency = actor?.system?.party?.currency;
  if (hasCurrencyValues(partyCurrency)) {
    return { currency: partyCurrency, path: "system.party.currency" };
  }
  return { currency: null, path: null };
}

function splitCopper(totalCopper) {
  const remaining = Math.max(0, Math.floor(totalCopper));
  const pp = Math.floor(remaining / 1000);
  const gp = Math.floor((remaining % 1000) / 100);
  const sp = Math.floor((remaining % 100) / 10);
  const cp = remaining % 10;
  return { pp, gp, sp, cp };
}

function formatCurrencyDisplay(currency) {
  if (!currency) {
    return null;
  }
  const totalCopper = getCurrencyInCopper(currency);
  const { pp, gp, sp, cp } = splitCopper(totalCopper);
  const parts = [];
  if (pp) {
    parts.push(`${pp} pp`);
  }
  if (gp) {
    parts.push(`${gp} gp`);
  }
  if (sp) {
    parts.push(`${sp} sp`);
  }
  if (cp || parts.length === 0) {
    parts.push(`${cp} cp`);
  }
  return parts.join(" ");
}

function getPartyStashActor() {
  if (game.party) {
    return game.party;
  }
  if (game.actors?.party) {
    return game.actors.party;
  }
  return game.actors?.find((actor) => actor.type === "party") ?? null;
}

async function deductCurrency(actor, costGold) {
  const costCopper = Math.round(costGold * 100);
  const { currency, path } = getActorCurrency(actor);
  if (!currency || !path) {
    const actorName = actor?.name ?? "Unbekannter Actor";
    const message =
      `Kein unterstützter Currency-Pfad gefunden für ${actorName}. ` +
      "Erwartet: system.currency, system.currency.value oder system.party.currency.";
    ui.notifications.warn(message);
    console.warn(message, actor);
    return { ok: false, reason: "missing-path" };
  }
  const availableCopper = getCurrencyInCopper(currency);
  if (availableCopper < costCopper) {
    return { ok: false, reason: "insufficient-funds" };
  }
  const updatedCurrency = splitCopper(availableCopper - costCopper);
  await actor.update({ [path]: updatedCurrency });
  return { ok: true };
}

async function handlePurchase({ actor, packCollection, itemId, name, priceGold, quantity, useActor, useParty }) {
  if (!actor) {
    ui.notifications.error("Kein gültiger Actor ausgewählt.");
    return;
  }

  const pack = game.packs.get(packCollection);
  if (!pack) {
    ui.notifications.error("Compendium nicht gefunden.");
    return;
  }

  const item = await pack.getDocument(itemId);
  if (!item) {
    ui.notifications.error("Item konnte nicht geladen werden.");
    return;
  }

  const totalPrice = priceGold * quantity;
  let paymentActor = null;

  if (useActor) {
    paymentActor = actor;
  } else if (useParty) {
    paymentActor = getPartyStashActor();
    if (!paymentActor) {
      ui.notifications.error("Kein Party-Stash gefunden.");
      return;
    }
  }

  const paymentResult = await deductCurrency(paymentActor, totalPrice);
  if (!paymentResult.ok) {
    if (paymentResult.reason === "insufficient-funds") {
      ui.notifications.warn("Nicht genug Gold für den Kauf.");
    }
    return;
  }

  const itemData = item.toObject();
  delete itemData._id;
  itemData.system = itemData.system ?? {};
  itemData.system.quantity = quantity;
  await actor.createEmbeddedDocuments("Item", [itemData]);
  ui.notifications.info(`${name} wurde gekauft.`);
}

function openPurchaseDialog({ actor, packCollection, itemId, name, priceGold }) {
  const { currency: actorCurrency } = getActorCurrency(actor);
  const actorCurrencyDisplay = formatCurrencyDisplay(actorCurrency);
  const partyActor = getPartyStashActor();
  const { currency: partyCurrency } = getActorCurrency(partyActor);
  const partyCurrencyDisplay = partyActor ? formatCurrencyDisplay(partyCurrency) : null;
  const partyAvailability = partyActor
    ? partyCurrencyDisplay ?? "Nicht verfügbar"
    : "Nicht verfügbar";
  const actorAvailability = actorCurrencyDisplay ?? "Nicht verfügbar";
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
          <span class="store-option__row">
            <input type="checkbox" name="payment-actor" />
            <span>Gold vom Actor</span>
          </span>
          <span class="store-option__availability">Verfügbar: ${actorAvailability}</span>
        </label>
        <label class="store-option">
          <span class="store-option__row">
            <input type="checkbox" name="payment-party" />
            <span>Party-Stash</span>
          </span>
          <span class="store-option__availability">Verfügbar: ${partyAvailability}</span>
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

          if (useActor && useParty) {
            ui.notifications.warn("Bitte wähle genau eine Zahlungsquelle aus.");
            return false;
          }

          void handlePurchase({
            actor,
            packCollection,
            itemId,
            name,
            priceGold,
            quantity,
            useActor,
            useParty,
          });

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
    const packCollection = target.data("pack");
    const itemId = target.data("itemId");
    openPurchaseDialog({ actor: resultsList.data("actor"), packCollection, itemId, name, priceGold });
  });
}

async function openShopDialog(actor) {
  const content = await renderTemplate(SHOP_DIALOG_TEMPLATE, {});

  const dialog = new Dialog(
    {
      title: "General Store",
      content,
      buttons: {
        close: {
          label: "Schließen",
        },
      },
      default: "close",
    },
    {
      width: 720,
      height: 650,
      resizable: true,
    }
  );

  dialog.render(true);

  Hooks.once("renderDialog", (app, html) => {
    if (app !== dialog) {
      return;
    }

    const searchInput = html.find('input[name="store-search"]');
    const resultsList = html.find(".store-results ul");
    resultsList.data("actor", actor ?? null);
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
    openShopDialog(app.actor ?? null);
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
