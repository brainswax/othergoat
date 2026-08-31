#!/usr/bin/env node
/** Keep README install links and tag examples on a given version. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readManifestVersion(repoRoot = root) {
  const raw = readFileSync(join(repoRoot, "extension/manifest.json"), "utf8");
  const version = JSON.parse(raw).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid manifest version: ${version}`);
  }
  return version;
}

export function syncReadmeText(text, version) {
  let next = text;
  next = next.replace(
    /Until this is on the Chrome Web Store, install \*\*\d+\.\d+\.\d+\*\*/,
    `Until this is on the Chrome Web Store, install **${version}**`,
  );
  next = next.replace(
    /Download Other Goats Records \d+\.\d+\.\d+/g,
    `Download Other Goats Records ${version}`,
  );
  next = next.replace(
    /\(\[\d+\.\d+\.\d+ release\]/g,
    `([${version} release]`,
  );
  next = next.replace(
    /other-goats-records-\d+\.\d+\.\d+/g,
    `other-goats-records-${version}`,
  );
  next = next.replace(
    /\/releases\/download\/v\d+\.\d+\.\d+\//g,
    `/releases/download/v${version}/`,
  );
  next = next.replace(
    /\/releases\/tag\/v\d+\.\d+\.\d+/g,
    `/releases/tag/v${version}`,
  );
  next = next.replace(/git tag v\d+\.\d+\.\d+/g, `git tag v${version}`);
  next = next.replace(
    /git push origin v\d+\.\d+\.\d+/g,
    `git push origin v${version}`,
  );
  return next;
}

export function applyReadmeVersion(repoRoot = root, version = readManifestVersion(repoRoot)) {
  const path = join(repoRoot, "README.md");
  const before = readFileSync(path, "utf8");
  const after = syncReadmeText(before, version);
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
}

function parseArgs(argv) {
  let check = false;
  let version;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--version") {
      version = argv[i + 1];
      i += 1;
    }
  }
  return { check, version };
}

const invoked =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const { check, version: cliVersion } = parseArgs(process.argv.slice(2));
  const version = cliVersion || readManifestVersion(root);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
  const path = join(root, "README.md");
  const before = readFileSync(path, "utf8");
  const after = syncReadmeText(before, version);
  if (check) {
    if (after !== before) {
      console.error(`README install links do not match ${version}`);
      process.exit(1);
    }
    console.log(`README matches ${version}`);
    process.exit(0);
  }
  if (after !== before) writeFileSync(path, after);
  console.log(after === before ? `README already at ${version}` : `README → ${version}`);
}
