#!/usr/bin/env node
/** Copy tracked .githooks/* into .git/hooks (no git config). */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, ".githooks");
const dest = join(root, ".git", "hooks");
if (!existsSync(join(root, ".git")) || !existsSync(src)) process.exit(0);
mkdirSync(dest, { recursive: true });
for (const name of readdirSync(src)) {
  if (name.startsWith(".")) continue;
  const to = join(dest, name);
  copyFileSync(join(src, name), to);
  chmodSync(to, 0o755);
}
