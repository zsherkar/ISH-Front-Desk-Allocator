import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "fd_admin_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

type ConfiguredAdmin = {
  email: string;
  name: string;
  passwordHash: string;
};

type SessionPayload = {
  email: string;
  exp: number;
};

type AdminConfigResult =
  | { admins: ConfiguredAdmin[]; error: null }
  | { admins: ConfiguredAdmin[]; error: string };

let cachedAdminUsersJson: string | null = null;
let cachedAdminConfig: AdminConfigResult | null = null;

function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  return secret ? secret : null;
}

function shouldUseSecureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseAdminUsers(): ConfiguredAdmin[] {
  const raw = process.env.ADMIN_USERS_JSON?.trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ADMIN_USERS_JSON must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("ADMIN_USERS_JSON must be a JSON array.");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`ADMIN_USERS_JSON entry ${index + 1} must be an object.`);
    }

    const email = typeof entry.email === "string" ? normalizeEmail(entry.email) : "";
    const name =
      typeof entry.name === "string" && entry.name.trim() !== ""
        ? entry.name.trim()
        : email;
    const passwordHash =
      typeof entry.passwordHash === "string" ? entry.passwordHash.trim() : "";

    if (!email || !passwordHash) {
      throw new Error(
        `ADMIN_USERS_JSON entry ${index + 1} must include email and passwordHash.`,
      );
    }

    return { email, name, passwordHash };
  });
}

function getAdminConfig(): AdminConfigResult {
  const raw = process.env.ADMIN_USERS_JSON?.trim() ?? "";

  if (cachedAdminConfig && cachedAdminUsersJson === raw) {
    return cachedAdminConfig;
  }

  cachedAdminUsersJson = raw;

  if (!raw) {
    cachedAdminConfig = { admins: [], error: null };
    return cachedAdminConfig;
  }

  try {
    cachedAdminConfig = {
      admins: parseAdminUsers(),
      error: null,
    };
    return cachedAdminConfig;
  } catch (error) {
    cachedAdminConfig = {
      admins: [],
      error: error instanceof Error ? error.message : String(error),
    };
    return cachedAdminConfig;
  }
}

export function isAdminAuthConfigured(): boolean {
  const { admins, error } = getAdminConfig();
  return Boolean(getSessionSecret()) && !error && admins.length > 0;
}

export function getAdminAuthConfigurationError(): string | null {
  if (!getSessionSecret()) {
    return "SESSION_SECRET must be configured for admin authentication.";
  }

  const { admins, error } = getAdminConfig();
  if (error) return error;
  if (admins.length === 0) {
    return "ADMIN_USERS_JSON must include at least one admin user.";
  }

  return null;
}

function getConfiguredAdminByEmail(email: string): ConfiguredAdmin | null {
  const normalizedEmail = normalizeEmail(email);
  const { admins } = getAdminConfig();
  return admins.find((admin) => admin.email === normalizedEmail) ?? null;
}

function sign(value: string): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured for admin authentication.");
  }
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function encodeSession(payload: SessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function decodeSession(token: string): SessionPayload | null {
  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SessionPayload;

    if (
      !payload ||
      typeof payload.email !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now()
    ) {
      return null;
    }

    return {
      email: normalizeEmail(payload.email),
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function hashAdminPassword(password: string): string {
  const normalizedPassword = password.trim();
  if (normalizedPassword.length < 8) {
    throw new Error("Admin passwords must be at least 8 characters long.");
  }

  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyAdminPassword(password: string, passwordHash: string): boolean {
  const [algorithm, salt, storedHash] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const computedHash = crypto
    .scryptSync(password, salt, 64)
    .toString("base64url");

  const storedBuffer = Buffer.from(storedHash, "utf8");
  const computedBuffer = Buffer.from(computedHash, "utf8");

  return (
    storedBuffer.length === computedBuffer.length &&
    crypto.timingSafeEqual(storedBuffer, computedBuffer)
  );
}

export function authenticateAdmin(email: string, password: string) {
  const admin = getConfiguredAdminByEmail(email);
  if (!admin) return null;
  if (!verifyAdminPassword(password, admin.passwordHash)) return null;
  return { email: admin.email, name: admin.name };
}

export function setAdminSessionCookie(res: Response, email: string): void {
  res.cookie(
    COOKIE_NAME,
    encodeSession({
      email: normalizeEmail(email),
      exp: Date.now() + SESSION_DURATION_MS,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      maxAge: SESSION_DURATION_MS,
      path: "/",
    },
  );
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
  });
}

export function getAuthenticatedAdmin(req: Request) {
  if (!isAdminAuthConfigured()) return null;

  const token =
    typeof req.cookies?.[COOKIE_NAME] === "string" ? req.cookies[COOKIE_NAME] : null;
  if (!token) return null;

  const payload = decodeSession(token);
  if (!payload) return null;

  const admin = getConfiguredAdminByEmail(payload.email);
  if (!admin) return null;

  return {
    email: admin.email,
    name: admin.name,
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const configurationError = getAdminAuthConfigurationError();
  if (configurationError) {
    res.status(503).json({
      error: configurationError,
    });
    return;
  }

  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(401).json({ error: "Admin login required." });
    return;
  }

  next();
}
