import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import path from "path";
import router from "./routes";
import { applySecurityHeaders } from "./lib/security.js";

const app: Express = express();

app.disable("x-powered-by");
app.set(
  "trust proxy",
  process.env.TRUST_PROXY === "false"
    ? false
    : process.env.NODE_ENV === "production",
);

app.use(applySecurityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(process.cwd(), "artifacts/shift-scheduler/dist/public");
  app.use(express.static(clientDist));
  app.get("/*splat", (_req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

export default app;
