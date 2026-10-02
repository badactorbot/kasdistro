import { Router, type IRouter } from "express";
import {
  GetBotActivityQueryParams,
  GetBotActivityResponse,
  GetBotStateResponse,
  GetMarketSnapshotResponse,
  PrepareLiveBuyResponse,
  RunBotOnceResponse,
  SimulateBotRunBody,
  SimulateBotRunResponse,
  StartBotResponse,
  StopBotResponse,
  UpdateBotConfigBody,
  UpdateBotConfigResponse,
} from "@workspace/api-zod";
import {
  getActivities,
  getBotState,
  getMarketSnapshot,
  runOnce,
  simulateLongRun,
  startBot,
  stopBot,
  updateBotConfig,
} from "../lib/bot-service";
import { prepareLiveBuy } from "../lib/kron-live-service";

const router: IRouter = Router();

router.get("/bot/state", (_req, res) => {
  res.json(GetBotStateResponse.parse(getBotState()));
});

router.patch("/bot/config", (req, res) => {
  const parsed = UpdateBotConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid configuration" });
    return;
  }
  res.json(UpdateBotConfigResponse.parse(updateBotConfig(parsed.data)));
});

router.post("/bot/start", (_req, res) => {
  res.json(StartBotResponse.parse(startBot()));
});

router.post("/bot/stop", (_req, res) => {
  res.json(StopBotResponse.parse(stopBot()));
});

router.post("/bot/run-once", (_req, res) => {
  res.json(RunBotOnceResponse.parse(runOnce()));
});

router.get("/bot/activity", (req, res) => {
  const parsed = GetBotActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return;
  }
  res.json(GetBotActivityResponse.parse(getActivities(parsed.data.limit ?? 12)));
});

router.get("/bot/market", (_req, res) => {
  res.json(GetMarketSnapshotResponse.parse(getMarketSnapshot()));
});

router.post("/bot/simulate", (req, res) => {
  const parsed = SimulateBotRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid simulation input" });
    return;
  }
  res.json(SimulateBotRunResponse.parse(simulateLongRun(parsed.data)));
});

router.post("/bot/live-buy/prepare", async (req, res) => {
  try {
    res.json(PrepareLiveBuyResponse.parse(await prepareLiveBuy()));
  } catch (error) {
    req.log.warn({ err: error }, "Live buy preparation blocked");
    res.status(400).json({
      error: error instanceof Error ? error.message : "Live buy preparation failed",
    });
  }
});

export default router;