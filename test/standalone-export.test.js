import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set([".git", "node_modules", "dist"]);
const skipExt = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);
const banned = new RegExp(["goat", "smith"].join(""), "i");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (!skipExt.has(extname(name).toLowerCase())) acc.push(path);
  }
  return acc;
}

describe("standalone export", () => {
  it("does not name a downstream product anywhere in the tree", () => {
    const hits = [];
    for (const path of walk(root)) {
      const text = readFileSync(path, "utf8");
      if (text.includes("\0")) continue;
      const file = relative(root, path);
      for (const [i, line] of text.split(/\r?\n/).entries()) {
        if (banned.test(line)) hits.push(`${file}:${i + 1}`);
      }
    }
    assert.equal(hits.length, 0, hits.join("\n"));
  });
});
