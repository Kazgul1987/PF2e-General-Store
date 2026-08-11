const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** ApplicationV2 base used by every persistent General Store window. */
export class GeneralStoreApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf2e-general-store-application"],
    position: { width: 640, height: 520 },
    window: { resizable: true },
  };

  /** Return the HTMLElement owned by this application across v14 render phases. */
  get rootElement() {
    return this.element instanceof HTMLElement ? this.element : this.element?.[0] ?? null;
  }
}

/**
 * Open a small, transient v14 dialog and await the selected button.
 * Button callbacks receive the dialog-owned form rather than a jQuery wrapper.
 */
export function waitForDialog({ title, content, buttons, default: defaultButton }, options = {}) {
  return DialogV2.wait({
    window: { title },
    content,
    buttons: buttons.map((button) => ({
      ...button,
      default: button.action === defaultButton,
      callback: button.callback
        ? (event, target, dialog) => button.callback(dialog.element?.querySelector("form") ?? null, event, target)
        : undefined,
    })),
    close: () => null,
  }, options);
}

