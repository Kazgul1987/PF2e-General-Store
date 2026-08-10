import { MODULE_ID } from "./constants.js";

const prefix = `[${MODULE_ID}]`;
export const log = Object.freeze({
  debug: (...args) => CONFIG?.debug?.hooks && console.debug(prefix, ...args),
  info: (...args) => console.info(prefix, ...args),
  warn: (...args) => console.warn(prefix, ...args),
  error: (...args) => console.error(prefix, ...args),
});
