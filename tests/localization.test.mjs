import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => entry.name !== "tests" && entry.name !== "reference" && entry.name !== ".git").map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : /\.(?:js|mjs|hbs)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("every active module localization key exists in both flat dictionaries", async () => {
  const files = await sourceFiles(".");
  const keys = new Set();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/["'](PF2EGeneralStore\.[A-Za-z0-9.]+)["']/g)) keys.add(match[1]);
  }
  const dictionaries = await Promise.all(["de", "en"].map(async (lang) => JSON.parse(await readFile(`lang/${lang}.json`, "utf8"))));
  for (const [index, dictionary] of dictionaries.entries()) {
    assert.equal(Object.values(dictionary).some((value) => value && typeof value === "object"), false, `${["de", "en"][index]} must be flat`);
    assert.deepEqual([...keys].filter((key) => !(key in dictionary)), [], `${["de", "en"][index]} missing keys`);
  }
  assert.ok(keys.size > 0);
});
