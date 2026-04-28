import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  keyPrefix: string;
  windowMs: number;
  max: number;
  message: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitEntry>();

function cleanupExpiredRateLimitEntries(now: number) {
  for (const [key, entry] of rateLimitBuckets.entries()) {
    if (entry.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getClientIdentifier(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function getRequestOrigin(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (req.secure ? "https" : "http");
  const host = req.get("host");
  return host ? `${protocol}://${host}` : "";
}

export function createRateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    cleanupExpiredRateLimitEntries(now);

    const key = `${options.keyPrefix}:${getClientIdentifier(req)}`;
    const existing = rateLimitBuckets.get(key);

    if (!existing || existing.resetAt <= now) {
      rateLimitBuckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      next();
      return;
    }

    existing.count += 1;

    if (existing.count > options.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: options.message });
      return;
    }

    next();
  };
}

export function applySecurityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.set("Origin-Agent-Cluster", "?1");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-DNS-Prefetch-Control", "off");
  res.set("X-Frame-Options", "DENY");
  res.set("X-Permitted-Cross-Domain-Policies", "none");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.set("Cross-Origin-Opener-Policy", "same-origin");
  res.set("Cross-Origin-Resource-Policy", "same-origin");

  if (process.env.NODE_ENV === "production") {
    res.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
      ].join("; "),
    );

    if (req.secure || req.header("x-forwarded-proto") === "https") {
      res.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  }

  next();
}

export function requireSameOriginForBrowser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.header("origin");
  const expectedOrigin = getRequestOrigin(req);
  const fetchSite = req.header("sec-fetch-site");

  if (origin && expectedOrigin && origin !== expectedOrigin) {
    res.status(403).json({ error: "Cross-origin request blocked." });
    return;
  }

  if (
    !origin &&
    fetchSite &&
    !["same-origin", "same-site", "none"].includes(fetchSite)
  ) {
    res.status(403).json({ error: "Cross-site browser request blocked." });
    return;
  }

  next();
}
