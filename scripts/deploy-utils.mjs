#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import process from "node:process";

export const defaultDatabaseUrl =
  "postgresql://fd_admin:fd_password_change_me@127.0.0.1:5432/fd_allocator";

const htmlDoctype = "<!doctype html>";
const publicDnsResolver = new Resolver();
publicDnsResolver.setServers(["1.1.1.1", "8.8.8.8"]);

export function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

export function getPnpmCommand() {
  return "pnpm";
}

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw new Error(
      `Failed to start "${command} ${args.join(" ")}": ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${command} ${args.join(" ")}) with exit code ${result.status ?? "unknown"}.`,
    );
  }
}

export function buildProductionArtifacts() {
  const pnpm = getPnpmCommand();
  runChecked(pnpm, ["--filter", "@workspace/shift-scheduler", "run", "build"]);
  runChecked(pnpm, ["--filter", "@workspace/api-server", "run", "build"]);
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithSystemResolver(url, { timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { "cache-control": "no-cache" },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveHostWithPublicDns(hostname) {
  try {
    const ipv4 = await publicDnsResolver.resolve4(hostname);
    if (ipv4.length > 0) {
      return { address: ipv4[0], family: 4 };
    }
  } catch {}

  try {
    const ipv6 = await publicDnsResolver.resolve6(hostname);
    if (ipv6.length > 0) {
      return { address: ipv6[0], family: 6 };
    }
  } catch {}

  return null;
}

async function fetchWithResolvedIp(url, { timeoutMs = 5_000 } = {}) {
  const parsedUrl = new URL(url);
  const resolvedHost = await resolveHostWithPublicDns(parsedUrl.hostname);
  if (!resolvedHost) {
    return null;
  }

  const transport = parsedUrl.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const request = transport.request(
      {
        family: resolvedHost.family,
        headers: {
          "cache-control": "no-cache",
          host: parsedUrl.host,
        },
        hostname: resolvedHost.address,
        method: "GET",
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        servername: parsedUrl.hostname,
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
            status: response.statusCode ?? 0,
            text: chunks.join(""),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Request timed out."));
    });
    request.on("error", () => resolve(null));
    request.end();
  });
}

export async function fetchText(url, { timeoutMs = 5_000 } = {}) {
  const directResponse = await fetchWithSystemResolver(url, { timeoutMs });
  if (directResponse) {
    return directResponse;
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost") {
    return null;
  }

  return fetchWithResolvedIp(url, { timeoutMs });
}

export async function ensureLogDir() {
  const logDir = path.join(process.cwd(), "artifacts", "deploy-link");
  await mkdir(logDir, { recursive: true });
  return logDir;
}

export async function createSessionLogPaths(port) {
  const logDir = await ensureLogDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    logDir,
    serverLog: path.join(logDir, `server-${port}-${stamp}.log`),
    tunnelLog: path.join(logDir, `cloudflared-${port}-${stamp}.log`),
  };
}

export function startLoggedProcess(command, args, { env, logFile, cwd } = {}) {
  const logStream = createWriteStream(logFile, { flags: "a" });
  const outputListeners = new Set();
  let startupError = null;
  let exitResult = null;
  let settled = false;
  const child = spawn(command, args, {
    cwd: cwd ?? process.cwd(),
    env: { ...process.env, ...env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const writeChunk = (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    for (const listener of outputListeners) {
      listener(text);
    }
  };

  child.stdout?.on("data", writeChunk);
  child.stderr?.on("data", writeChunk);

  const closeLogStream = () => {
    if (!logStream.destroyed) {
      logStream.end();
    }
  };

  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      startupError = error;
      if (!settled) {
        settled = true;
        logStream.write(`[process-error] ${error.stack ?? error.message}\n`);
        closeLogStream();
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      exitResult = { code, signal };
      if (!settled) {
        settled = true;
        closeLogStream();
        resolve(exitResult);
      }
    });
  });

  return {
    child,
    exitPromise,
    logFile,
    get startupError() {
      return startupError;
    },
    get exitResult() {
      return exitResult;
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
  };
}

export function startProductionServer({ port, databaseUrl, logFile }) {
  return startLoggedProcess(process.execPath, ["artifacts/api-server/dist/index.cjs"], {
    env: {
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      PORT: String(port),
    },
    logFile,
  });
}

function formatProcessFailure(processHandle, label) {
  if (processHandle.startupError) {
    return `${label} failed to start: ${processHandle.startupError.message}`;
  }

  if (processHandle.exitResult) {
    const { code, signal } = processHandle.exitResult;
    if (typeof code === "number") {
      return `${label} exited with code ${code}.`;
    }

    if (signal) {
      return `${label} exited due to signal ${signal}.`;
    }
  }

  if (processHandle.child.exitCode !== null) {
    return `${label} exited with code ${processHandle.child.exitCode}.`;
  }

  return null;
}

export function assertProcessHealthy(processHandle, label) {
  const failure = formatProcessFailure(processHandle, label);
  if (failure) {
    throw new Error(failure);
  }
}

export async function stopProcess(processHandle) {
  if (!processHandle) {
    return;
  }

  const { child, exitPromise } = processHandle;
  if (child.exitCode === null && !child.killed) {
    child.kill();
  }

  await Promise.race([exitPromise.catch(() => undefined), sleep(5_000)]);
}

export async function readTail(logFile, maxChars = 4_000) {
  try {
    const contents = await readFile(logFile, "utf8");
    return contents.slice(-maxChars);
  } catch {
    return "";
  }
}

export async function waitForValue(getValue, { timeoutMs, intervalMs = 250, onTick, failureMessage }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (onTick) {
      await onTick();
    }

    const value = await getValue();
    if (value) {
      return value;
    }

    await sleep(intervalMs);
  }

  throw new Error(failureMessage);
}

function isHtmlDocument(response) {
  return (
    response?.ok &&
    response.text.toLowerCase().includes(htmlDoctype)
  );
}

export async function verifyLocalApp({ port, serverHandle, timeoutMs = 10_000 }) {
  const baseUrl = `http://127.0.0.1:${port}`;

  await waitForValue(
    async () => {
      const health = await fetchText(`${baseUrl}/api/healthz`);
      if (health?.ok && health.text.includes('"status":"ok"')) {
        return health;
      }
      return null;
    },
    {
      timeoutMs,
      failureMessage: "Local server never returned a healthy /api/healthz response.",
      onTick: async () => {
        assertProcessHealthy(serverHandle, "Local server");
      },
    },
  );

  const root = await fetchText(`${baseUrl}/`);
  if (!isHtmlDocument(root)) {
    throw new Error("Local server did not return HTML for /.");
  }

  const admin = await fetchText(`${baseUrl}/admin/login`);
  if (!isHtmlDocument(admin)) {
    throw new Error("Local server did not return HTML for /admin/login.");
  }

  return { baseUrl };
}

export function extractTryCloudflareUrl(text) {
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0] : null;
}

export async function verifyPublicAppOnce({
  publicBaseUrl,
  surveyToken,
  expectMirroredPublicAppUrl,
}) {
  const baseUrl = normalizeBaseUrl(publicBaseUrl);
  const health = await fetchText(`${baseUrl}/api/healthz`);
  if (!health?.ok || !health.text.includes('"status":"ok"')) {
    throw new Error("Public /api/healthz is not healthy yet.");
  }

  const admin = await fetchText(`${baseUrl}/admin/login`);
  if (!isHtmlDocument(admin)) {
    throw new Error("Public /admin/login did not return the app shell.");
  }

  const config = await fetchText(`${baseUrl}/api/public-config`);
  if (!config?.ok) {
    throw new Error("Public /api/public-config did not return successfully.");
  }

  let publicConfig;
  try {
    publicConfig = JSON.parse(config.text);
  } catch {
    throw new Error("Public /api/public-config returned invalid JSON.");
  }

  if (
    expectMirroredPublicAppUrl &&
    publicConfig.publicAppUrl !== baseUrl
  ) {
    throw new Error(
      `Expected /api/public-config to report ${baseUrl}, received ${publicConfig.publicAppUrl ?? "null"}.`,
    );
  }

  let surveyPageStatus = null;
  let surveyApiStatus = null;
  if (surveyToken) {
    const surveyPage = await fetchText(`${baseUrl}/respond/${surveyToken}`);
    if (!isHtmlDocument(surveyPage)) {
      throw new Error(
        `Public /respond/${surveyToken} did not return the app shell.`,
      );
    }
    surveyPageStatus = surveyPage.status;

    const surveyApi = await fetchText(`${baseUrl}/api/respond/${surveyToken}`);
    if (!surveyApi || ![200, 410].includes(surveyApi.status)) {
      throw new Error(
        `Public /api/respond/${surveyToken} did not return an expected status (wanted 200 or 410).`,
      );
    }
    surveyApiStatus = surveyApi.status;
  }

  return {
    publicAppUrl: publicConfig.publicAppUrl ?? null,
    surveyApiStatus,
    surveyPageStatus,
  };
}

export async function waitForPublicVerification({
  publicBaseUrl,
  surveyToken,
  tunnelHandle,
  timeoutMs = 30_000,
}) {
  const expectMirroredPublicAppUrl = !process.env.PUBLIC_APP_URL;
  let lastError = null;

  return waitForValue(
    async () => {
      try {
        return await verifyPublicAppOnce({
          expectMirroredPublicAppUrl,
          publicBaseUrl,
          surveyToken,
        });
      } catch (error) {
        lastError = error;
        return null;
      }
    },
    {
      timeoutMs,
      intervalMs: 1_000,
      failureMessage:
        lastError?.message ??
        "Public tunnel never passed verification.",
      onTick: async () => {
        assertProcessHealthy(tunnelHandle, "Cloudflare tunnel");
      },
    },
  );
}
