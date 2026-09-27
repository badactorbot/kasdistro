import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kaspaRouter from "./kaspa";
import kronRouter from "./kron";

const router: IRouter = Router();

router.use(healthRouter);
router.use('/kaspa', kaspaRouter);
router.use('/kron', kronRouter);

export default router;
