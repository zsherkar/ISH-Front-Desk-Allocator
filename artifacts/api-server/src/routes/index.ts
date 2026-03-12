import { Router, type IRouter } from "express";
import healthRouter from "./health";
import surveysRouter from "./surveys";
import allocationsRouter from "./allocations";
import respondRouter from "./respond";
import respondentsRouter from "./respondents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(surveysRouter);
router.use(allocationsRouter);
router.use(respondRouter);
router.use(respondentsRouter);

export default router;
