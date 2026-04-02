#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  const filePath = path.join(cwd, lockfile);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

const ua = process.env.npm_config_user_agent ?? "";
if (!ua.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
