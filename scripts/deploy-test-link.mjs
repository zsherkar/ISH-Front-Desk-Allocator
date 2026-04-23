#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  assertProcessHealthy,
  buildProductionArtifacts,
  createSessionLogPaths,
  defaultDatabaseUrl,
  extractTryCloudflareUrl,
  normalizeBaseUrl,
  readTail,
  startLoggedProcess,
  startProductionServer,
  stopProcess,
  verifyLocalApp,
  waitForPublicVerification,
  waitForValue,
} from "./deploy-utils.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node ./scripts/deploy-test-link.mjs [--port 4321] [--survey-token TOKEN] [--skip-build]

Options:
  --port <number>         Local port for the production app. Defaults to 4321.
  --survey-token <token>  Optional survey token to verify on the public tunnel.
  --skip-build            Reuse the current dist output instead of rebuilding first.
  --help                  Show this help output.

Environment variables:
  DATABASE_URL            Database connection string for the production server.
  PUBLIC_APP_URL          If set, /api/public-config will reflect it instead of the tunnel URL.

This command stays running after success so the verified tunnel remains live.
Press Ctrl+C to stop the local server and tunnel.
`);
  process.exit(0);
}

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

const skipBuild = args.includes("--skip-build");
const databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl;
const cloudflaredPath = path.join(process.cwd(), "tools", "cloudflared.exe");

let serverHandle = null;
let tunnelHandle = null;
let shuttingDown = false;
let port = null;
let surveyToken = null;

async function cleanup(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await stopProcess(tunnelHandle);
  await stopProcess(serverHandle);
  process.exit(exitCode);
}

process.on("SIGINT", async () => {
  console.log("\nStopping verified test link...");
  await cleanup(0);
});

process.on("SIGTERM", async () => {
  console.log("\nStopping verified test link...");
  await cleanup(0);
});

try {
  port = getArgValue("--port") ?? process.env.PORT ?? "4321";
  surveyToken = getArgValue("--survey-token") ?? process.env.SURVEY_TOKEN ?? null;

  if (!skipBuild) {
    console.log("Building production frontend and API...");
    buildProductionArtifacts();
  } else {
    console.log("Skipping build step and reusing the current dist output.");
  }

  const { logDir, serverLog, tunnelLog } = await createSessionLogPaths(port);
  console.log(`Starting production server on port ${port}...`);
  serverHandle = startProductionServer({
    databaseUrl,
    logFile: serverLog,
    port,
  });

  await verifyLocalApp({
    port,
    serverHandle,
  });
  console.log("Local production app passed /api/healthz and /admin/login checks.");

  const localBaseUrl = `http://127.0.0.1:${port}`;
  let publicBaseUrl = null;

  console.log("Starting Cloudflare quick tunnel...");
  tunnelHandle = startLoggedProcess(
    cloudflaredPath,
    [
      "tunnel",
      "--ha-connections",
      "1",
      "--no-autoupdate",
      "--protocol",
      "quic",
      "--url",
      localBaseUrl,
    ],
    { logFile: tunnelLog },
  );

  const removeTunnelListener = tunnelHandle.onOutput((text) => {
    const discoveredUrl = extractTryCloudflareUrl(text);
    if (discoveredUrl && !publicBaseUrl) {
      publicBaseUrl = normalizeBaseUrl(discoveredUrl);
    }
  });

  publicBaseUrl = await waitForValue(
    async () => publicBaseUrl,
    {
      timeoutMs: 20_000,
      intervalMs: 250,
      failureMessage: "Cloudflare tunnel did not publish a trycloudflare URL within 20 seconds.",
      onTick: async () => {
        assertProcessHealthy(tunnelHandle, "Cloudflare tunnel");
      },
    },
  );
  removeTunnelListener();

  console.log(`Tunnel URL discovered: ${publicBaseUrl}`);
  const verification = await waitForPublicVerification({
    publicBaseUrl,
    surveyToken,
    tunnelHandle,
  });

  console.log("");
  console.log(`Verified public test link: ${publicBaseUrl}`);
  console.log(`Verified routes: ${publicBaseUrl}/api/healthz, ${publicBaseUrl}/admin/login, ${publicBaseUrl}/api/public-config`);
  if (surveyToken) {
    console.log(
      `Verified survey route: ${publicBaseUrl}/respond/${surveyToken} (shell ${verification.surveyPageStatus}, api ${verification.surveyApiStatus})`,
    );
  } else {
    console.log("Survey route verification skipped. Pass --survey-token <token> when you want that check too.");
  }

  if (process.env.PUBLIC_APP_URL && verification.publicAppUrl !== normalizeBaseUrl(process.env.PUBLIC_APP_URL)) {
    console.log(
      `Warning: /api/public-config is reporting ${verification.publicAppUrl}. The admin desk may copy that URL instead of the tunnel host.`,
    );
  }

  console.log(`Logs: ${logDir}`);
  console.log("Press Ctrl+C to stop the tunnel and local production server.");

  const winner = await Promise.race([
    serverHandle.exitPromise.then(() => "server"),
    tunnelHandle.exitPromise.then(() => "tunnel"),
  ]);

  throw new Error(
    winner === "server"
      ? "The local production server exited unexpectedly."
      : "The Cloudflare tunnel exited unexpectedly.",
  );
} catch (error) {
  const serverTail = serverHandle?.logFile
    ? await readTail(serverHandle.logFile)
    : "";
  const tunnelTail = tunnelHandle?.logFile
    ? await readTail(tunnelHandle.logFile)
    : "";

  console.error(`Deploy test link failed: ${error.message}`);
  if (serverHandle?.logFile) {
    console.error(`Server log: ${serverHandle.logFile}`);
  }
  if (tunnelHandle?.logFile) {
    console.error(`Tunnel log: ${tunnelHandle.logFile}`);
  }
  if (serverTail) {
    console.error(`\nRecent server log output:\n${serverTail}`);
  }
  if (tunnelTail) {
    console.error(`\nRecent tunnel log output:\n${tunnelTail}`);
  }

  await stopProcess(tunnelHandle);
  await stopProcess(serverHandle);
  process.exit(1);
}
