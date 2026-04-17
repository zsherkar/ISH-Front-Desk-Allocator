import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import authRouter from "./auth";
import surveysRouter from "./surveys";
import allocationsRouter from "./allocations";
import respondRouter from "./respond";
import respondentsRouter from "./respondents";
import { requireAdmin } from "../lib/adminAuth.js";
import { requireSameOriginForBrowser } from "../lib/security.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(authRouter);
router.use(respondRouter);
router.use(respondentsRouter);
router.use(requireAdmin, requireSameOriginForBrowser, surveysRouter);
router.use(requireAdmin, requireSameOriginForBrowser, allocationsRouter);

export default router;
