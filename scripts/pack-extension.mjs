#!/usr/bin/env node
/** Zip extension/ for testers: dist/other-goats-records-{version}.zip */

import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  readFileSync(join(root, "extension/manifest.json"), "utf8"),
).version;
const dist = join(root, "dist");
const folderName = `other-goats-records-${version}`;
const staged = join(dist, folderName);
const zipName = `${folderName}.zip`;
const zipPath = join(dist, zipName);

rmSync(staged, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "extension"), staged, {
  recursive: true,
  filter: (src) => !src.endsWith(".DS_Store") && !src.endsWith("render.py"),
});
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-q", zipName, folderName], {
  cwd: dist,
  stdio: "inherit",
});
console.log(zipPath);
