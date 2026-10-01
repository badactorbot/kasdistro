import { Router, type IRouter } from "express";
import {
  CreateWalletChallengeBody,
  GetUserBotDashboardResponse,
  SetupUserBotBody,
  SetupUserBotResponse,
  StartUserBotResponse,
  StopUserBotResponse,
  VerifyWalletChallengeBody,
  VerifyWalletChallengeResponse,
  VerifyBotActivationBody,
  VerifyBotActivationResponse,
  CreateWalletChallengeResponse,
  ChangeUserBotCovenantBody,
  ChangeUserBotCovenantResponse,
  PrepareUserBotKasWithdrawalBody,
  PrepareUserBotKasWithdrawalResponse,
  SubmitUserBotKasWithdrawalBody,
  SubmitUserBotKasWithdrawalResponse,
} from "@workspace/api-zod";
import {
  changeUserBotCovenant,
  createWalletChallenge,
  getGuestDashboard,
  getUserDashboard,
  readSessionToken,
  sessionCookieName,
  setUserBotRunning,
  setupUserBot,
  verifyActivation,
  verifyWalletChallenge,
} from "../lib/user-app-service";
import {
  prepareUserBotKasWithdrawal,
  submitUserBotKasWithdrawal,
} from "../lib/bot-withdrawal-service";

const router: IRouter = Router();
const cookie = (req: any) => req.cookies?.[sessionCookieName()] as string | undefined;
const userId = (req: any) => {
  const id = readSessionToken(cookie(req));
  if (!id) throw new Error("Connect and verify your wallet first.");
  return id;
};
const handler = (fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
  try {
    await fn(req, res);
  } catch (error) {
    req.log.warn({ err: error }, "User bot request blocked");
    res.status(400).json({ error: error instanceof Error ? error.message : "Request failed" });
  }
};

router.post("/app/auth/challenge", handler(async (req, res) => {
  const input = CreateWalletChallengeBody.parse(req.body);
  res.json(CreateWalletChallengeResponse.parse(await createWalletChallenge(input.walletAddress, input.publicKey)));
}));

router.post("/app/auth/verify", handler(async (req, res) => {
  const input = VerifyWalletChallengeBody.parse(req.body);
  const result = await verifyWalletChallenge(input);
  res.cookie(sessionCookieName(), result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60_000,
  });
  res.json(VerifyWalletChallengeResponse.parse(await getUserDashboard(result.userId)));
}));

router.post("/app/auth/logout", (req, res) => {
  res.clearCookie(sessionCookieName());
  res.status(204).end();
});

router.get("/app/dashboard", handler(async (req, res) => {
  const id = readSessionToken(cookie(req));
  res.json(GetUserBotDashboardResponse.parse(
    id ? await getUserDashboard(id) : getGuestDashboard(),
  ));
}));

router.post("/app/bot/setup", handler(async (req, res) => {
  const input = SetupUserBotBody.parse(req.body);
  res.json(SetupUserBotResponse.parse(await setupUserBot(userId(req), input.tokenId)));
}));

router.post("/app/bot/activation/verify", handler(async (req, res) => {
  const input = VerifyBotActivationBody.parse(req.body);
  res.json(VerifyBotActivationResponse.parse(await verifyActivation(userId(req), input.transactionId)));
}));

router.post("/app/bot/covenant/change", handler(async (req, res) => {
  const input = ChangeUserBotCovenantBody.parse(req.body);
  res.json(ChangeUserBotCovenantResponse.parse(await changeUserBotCovenant(userId(req), input.tokenId)));
}));

router.post("/app/bot/start", handler(async (req, res) => {
  res.json(StartUserBotResponse.parse(await setUserBotRunning(userId(req), true)));
}));

router.post("/app/bot/stop", handler(async (req, res) => {
  res.json(StopUserBotResponse.parse(await setUserBotRunning(userId(req), false)));
}));

router.post("/app/bot/withdraw", handler(async (req, res) => {
  const input = PrepareUserBotKasWithdrawalBody.parse(req.body);
  res.json(PrepareUserBotKasWithdrawalResponse.parse(
    await prepareUserBotKasWithdrawal(userId(req), input),
  ));
}));

router.post("/app/bot/withdraw/submit", handler(async (req, res) => {
  const input = SubmitUserBotKasWithdrawalBody.parse(req.body);
  res.json(SubmitUserBotKasWithdrawalResponse.parse(
    await submitUserBotKasWithdrawal(userId(req), input.signedTransaction),
  ));
}));

export default router;