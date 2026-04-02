#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function hasDocker() {
  const probe = spawnSync("docker", ["--version"], { stdio: "ignore", shell: true });
  return probe.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (hasDocker()) {
  console.log("Docker detected. Running containerized deployment smoke test...");
  run("docker", ["compose", "up", "--build", "-d"]);

  let ok = false;
  for (let i = 0; i < 60; i += 1) {
    const probe = spawnSync(
      "node",
      [
        "-e",
        "fetch('http://127.0.0.1:3000/api/healthz').then(r=>r.text()).then(t=>process.exit(t.includes('\"status\":\"ok\"')?0:1)).catch(()=>process.exit(1));",
      ],
      { stdio: "ignore", shell: true },
    );
    if (probe.status === 0) {
      ok = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }

  run("docker", ["compose", "down", "-v"]);

  if (!ok) {
    console.error("Containerized deployment smoke check failed.");
    process.exit(1);
  }

  console.log("Containerized deployment smoke checks passed.");
} else {
  console.log("Docker not available. Falling back to local production smoke deployment test.");
  run("node", ["./scripts/smoke-deploy-local.mjs"]);
}
