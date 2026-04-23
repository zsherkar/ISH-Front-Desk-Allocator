#!/usr/bin/env node
import {
  buildProductionArtifacts,
  createSessionLogPaths,
  defaultDatabaseUrl,
  readTail,
  startProductionServer,
  stopProcess,
  verifyLocalApp,
} from "./deploy-utils.mjs";

const port = process.env.PORT ?? "4310";
const databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl;

let serverHandle = null;

try {
  console.log("Building production frontend and API...");
  buildProductionArtifacts();

  const { serverLog } = await createSessionLogPaths(port);
  console.log(`Starting production server on port ${port} for smoke checks...`);
  serverHandle = startProductionServer({
    databaseUrl,
    logFile: serverLog,
    port,
  });

  await verifyLocalApp({
    port,
    serverHandle,
  });

  await stopProcess(serverHandle);
  serverHandle = null;
  console.log("Smoke deploy checks passed.");
} catch (error) {
  if (serverHandle) {
    await stopProcess(serverHandle);
  }

  const logHint =
    serverHandle?.logFile
      ? `\nRecent server log output:\n${await readTail(serverHandle.logFile)}`
      : "";

  console.error(`Smoke deploy checks failed: ${error.message}${logHint}`);
  process.exit(1);
}
