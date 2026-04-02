#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

const port = process.env.PORT ?? "4310";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://fd_admin:fd_password_change_me@127.0.0.1:5432/fd_allocator";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrl(url) {
  try {
    const response = await fetch(url);
    return response.ok ? response.text() : null;
  } catch {
    return null;
  }
}

console.log("Building production frontend and API...");
run("pnpm", ["--filter", "@workspace/shift-scheduler", "run", "build"]);
run("pnpm", ["--filter", "@workspace/api-server", "run", "build"]);

console.log(`Starting production server on port ${port} for smoke checks...`);
const server = spawn("node", ["artifacts/api-server/dist/index.cjs"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    DATABASE_URL: databaseUrl,
  },
});

const cleanup = () => {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(1);
});

let healthBody = null;
for (let i = 0; i < 40; i += 1) {
  healthBody = await checkUrl(`http://127.0.0.1:${port}/api/healthz`);
  if (healthBody?.includes('"status":"ok"')) break;
  await wait(250);
}

if (!healthBody?.includes('"status":"ok"')) {
  cleanup();
  console.error("Smoke check failed: /api/healthz did not return ok.");
  process.exit(1);
}

const rootHtml = await checkUrl(`http://127.0.0.1:${port}/`);
if (!rootHtml?.toLowerCase().includes("<!doctype html>")) {
  cleanup();
  console.error("Smoke check failed: root page did not return HTML.");
  process.exit(1);
}

cleanup();
console.log("Smoke deploy checks passed.");
