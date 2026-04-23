import { Router, type IRouter } from "express";
import {
  authenticateAdmin,
  clearAdminSessionCookie,
  getAdminAuthPublicError,
  getAuthenticatedAdmin,
  setAdminSessionCookie,
} from "../lib/adminAuth.js";
import { createRateLimit, requireSameOriginForBrowser } from "../lib/security.js";

const router: IRouter = Router();
const loginRateLimit = createRateLimit({
  keyPrefix: "admin-login",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
});

router.get("/auth/session", (req, res): void => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");

  const configurationError = getAdminAuthPublicError();
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

  res.json({
    authenticated: true,
    admin,
  });
});

router.post("/auth/login", requireSameOriginForBrowser, loginRateLimit, (req, res): void => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");

  const configurationError = getAdminAuthPublicError();
  if (configurationError) {
    res.status(503).json({
      error: configurationError,
    });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!hasValidEmail || password.length === 0) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const admin = authenticateAdmin(email, password);
  if (!admin) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  setAdminSessionCookie(res, admin.email);
  res.json({
    authenticated: true,
    admin,
  });
});

router.post("/auth/logout", requireSameOriginForBrowser, (_req, res): void => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  clearAdminSessionCookie(res);
  res.sendStatus(204);
});

export default router;
