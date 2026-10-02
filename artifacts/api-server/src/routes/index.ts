import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kaspaRouter from "./kaspa";
import kronRouter from "./kron";
import botRouter from "./bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use('/kaspa', kaspaRouter);
router.use('/kron', kronRouter);
router.use(botRouter);

if (process.env.DATABASE_URL) {
  const { default: userAppRouter } = await import("./user-app");
  router.use(userAppRouter);
}

export default router;
