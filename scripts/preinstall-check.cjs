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

const userAgent =
  process.env.npm_config_user_agent ??
  process.env.NPM_CONFIG_USER_AGENT ??
  "";
const execPath =
  process.env.npm_execpath ??
  process.env.NPM_EXECPATH ??
  "";
const isPnpm =
  userAgent.startsWith("pnpm/") ||
  path.basename(execPath).toLowerCase().startsWith("pnpm");

if (!isPnpm) {
  console.error("Use pnpm instead");
  process.exit(1);
}
