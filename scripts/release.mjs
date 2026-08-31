#!/usr/bin/env node
/**
 * Tag and push the manifest version. Updates README install links first.
 *
 *   npm run release
 *   npm run release -- --dry-run
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyReadmeVersion,
  readManifestVersion,
} from "./readme-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function hasTag(ref) {
  try {
    git(["rev-parse", "-q", "--verify", `refs/tags/${ref}`]);
    return true;
  } catch {
    return false;
  }
}

function remoteHasTag(ref) {
  const out = git(["ls-remote", "--tags", "origin", `refs/tags/${ref}`]);
  return out.length > 0;
}

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run") };
}

const { dryRun } = parseArgs(process.argv.slice(2));
const version = readManifestVersion(root);
const tag = `v${version}`;

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  throw new Error(`Release from main (currently ${branch})`);
}

const dirty = git(["status", "--porcelain"]);
if (dirty) {
  throw new Error("Working tree is not clean");
}

if (hasTag(tag)) {
  throw new Error(`Tag ${tag} already exists locally`);
}
if (remoteHasTag(tag)) {
  throw new Error(`Tag ${tag} already exists on origin`);
}

console.log(`Version ${version} (from extension/manifest.json)`);
if (dryRun) {
  console.log("Dry run: would test, sync README, commit if needed, tag, and push.");
  process.exit(0);
}

execFileSync("npm", ["test"], { cwd: root, stdio: "inherit" });

const readmeChanged = applyReadmeVersion(root, version);
if (readmeChanged) {
  execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "inherit" });
  execFileSync(
    "git",
    [
      "commit",
      "-m",
      `Point README install links at ${version}.`,
    ],
    { cwd: root, stdio: "inherit" },
  );
}

execFileSync("git", ["tag", tag], { cwd: root, stdio: "inherit" });
execFileSync("git", ["push", "origin", "HEAD"], { cwd: root, stdio: "inherit" });
execFileSync("git", ["push", "origin", tag], { cwd: root, stdio: "inherit" });
console.log(`Pushed ${tag}. GitHub Actions will pack the zip and create the Release.`);
