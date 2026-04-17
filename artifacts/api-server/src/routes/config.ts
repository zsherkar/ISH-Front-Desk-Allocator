import { Router, type IRouter } from "express";
import { getRequestOrigin } from "../lib/security.js";

const router: IRouter = Router();

function normalizeAppUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

router.get("/public-config", (req, res): void => {
  const configuredUrl = process.env.PUBLIC_APP_URL?.trim();
  const publicAppUrl = configuredUrl
    ? normalizeAppUrl(configuredUrl)
    : normalizeAppUrl(getRequestOrigin(req));

  res.json({
    publicAppUrl: publicAppUrl || null,
  });
});

export default router;
