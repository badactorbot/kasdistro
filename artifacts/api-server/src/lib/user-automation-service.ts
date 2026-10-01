import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db, managedLotsTable, tradingBotsTable } from "@workspace/db";
import {
  executeUserAutomatedBuy,
  executeUserAutomatedSell,
} from "./kron-live-service";
import { decryptPrivateKey } from "./user-app-service";
import { logger } from "./logger";

const TRADE_INTERVAL_MS = 6 * 60_000;
const STALE_IN_FLIGHT_MS = 10 * 60_000;
const KASPA_REST_API = "https://api.kaspa.org";
let schedulerBusy = false;

type AddressTransaction = {
  transaction_id?: string;
  block_time?: number;
  is_accepted?: boolean;
  inputs?: Array<{ previous_outpoint_address?: string }>;
};

async function reconcileStaleInFlight(bot: typeof tradingBotsTable.$inferSelect) {
  const marker = bot.inFlight;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return;
  const startedAtValue = "startedAt" in marker ? marker.startedAt : undefined;
  if (typeof startedAtValue !== "string") return;

  const startedAt = new Date(startedAtValue);
  if (!Number.isFinite(startedAt.getTime()) || Date.now() - startedAt.getTime() < STALE_IN_FLIGHT_MS) {
    return;
  }

  const url = new URL(
    `/addresses/${encodeURIComponent(bot.botAddress)}/full-transactions-page`,
    KASPA_REST_API,
  );
  url.searchParams.set("limit", "100");
  url.searchParams.set("after", String(startedAt.getTime() - 60_000));
  url.searchParams.set("resolve_previous_outpoints", "light");

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Kaspa history lookup failed with HTTP ${response.status}.`);
  }
  const transactions = await response.json() as AddressTransaction[];
  const outgoing = transactions.find((transaction) =>
    transaction.is_accepted === true &&
    typeof transaction.block_time === "number" &&
    transaction.block_time >= startedAt.getTime() &&
    transaction.inputs?.some((input) => input.previous_outpoint_address === bot.botAddress),
  );

  if (outgoing) {
    await db.update(tradingBotsTable).set({
      status: "paused",
      nextRunAt: null,
      stopReason: `Safety pause: transaction ${outgoing.transaction_id ?? "unknown"} reached the chain during an interrupted trade and requires reconciliation.`,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));
    logger.error(
      { botId: bot.id, transactionId: outgoing.transaction_id },
      "Interrupted user trade reached the chain; manual reconciliation required",
    );
    return;
  }

  await db.update(tradingBotsTable).set({
    inFlight: null,
    nextRunAt: new Date(),
    stopReason: null,
    updatedAt: new Date(),
  }).where(eq(tradingBotsTable.id, bot.id));
  logger.warn({ botId: bot.id }, "Cleared stale user trade after confirming no outgoing chain transaction");
}

async function runBot(bot: typeof tradingBotsTable.$inferSelect) {
  if (!bot.tokenId) return;
  const action = bot.phase === "buying" ? "buy" : "sell";
  const startedAt = new Date();
  await db.update(tradingBotsTable).set({
    inFlight: { action, startedAt: startedAt.toISOString() },
    stopReason: null,
    updatedAt: startedAt,
  }).where(and(eq(tradingBotsTable.id, bot.id), isNull(tradingBotsTable.inFlight)));

  try {
    const credentials = {
      privateKey: decryptPrivateKey(bot.encryptedPrivateKey),
      tokenId: bot.tokenId,
    };
    if (action === "buy") {
      const result = await executeUserAutomatedBuy(credentials);
      if (!result.transactionId) throw new Error("Buy submission returned no transaction ID.");
      await db.transaction(async (tx) => {
        await tx.insert(managedLotsTable).values({
          botId: bot.id,
          buyTransactionId: result.transactionId!,
          outputIndex: 2,
          tokenAmount: BigInt(result.tokenOut),
          costSompi: BigInt(Math.round(result.maximumDebitKas * 100_000_000)),
          tokenId: bot.tokenId,
          tokenSymbol: bot.tokenSymbol,
        });
        const completedBuys = bot.completedBuys + 1;
        await tx.update(tradingBotsTable).set({
          phase: completedBuys >= 5 ? "selling" : "buying",
          completedBuys,
          completedSells: completedBuys >= 5 ? 0 : bot.completedSells,
          totalTrades: bot.totalTrades + 1,
          lastTradeAt: new Date(),
          nextRunAt: new Date(Date.now() + TRADE_INTERVAL_MS),
          inFlight: null,
          stopReason: null,
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
      });
    } else {
      const [lot] = await db
        .select()
        .from(managedLotsTable)
        .where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.soldAt)))
        .orderBy(asc(managedLotsTable.createdAt))
        .limit(1);
      if (!lot) throw new Error("No managed token lot is available to sell.");
      const result = await executeUserAutomatedSell({
        transactionId: lot.buyTransactionId,
        index: lot.outputIndex,
        amount: lot.tokenAmount.toString(),
      }, credentials);
      if (!result.transactionId) throw new Error("Sell submission returned no transaction ID.");
      await db.transaction(async (tx) => {
        await tx.update(managedLotsTable).set({
          sellTransactionId: result.transactionId,
          soldAt: new Date(),
        }).where(eq(managedLotsTable.id, lot.id));
        const completedSells = bot.completedSells + 1;
        const cycleComplete = completedSells >= 5;
        await tx.update(tradingBotsTable).set({
          phase: cycleComplete ? "buying" : "selling",
          completedBuys: cycleComplete ? 0 : bot.completedBuys,
          completedSells: cycleComplete ? 0 : completedSells,
          totalTrades: bot.totalTrades + 1,
          lastTradeAt: new Date(),
          nextRunAt: new Date(Date.now() + TRADE_INTERVAL_MS),
          inFlight: null,
          stopReason: null,
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
      });
    }
    logger.info({ botId: bot.id, action }, "User Kron trade accepted");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation failure";
    await db.update(tradingBotsTable).set({
      status: "paused",
      nextRunAt: null,
      stopReason: `Safety pause: ${message}`,
      // Retain inFlight as a fail-closed marker until an operator reconciles the outpoint.
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));
    logger.error({ err: error, botId: bot.id, action }, "User Kron bot paused");
  }
}

async function tick() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const interruptedBots = await db
      .select()
      .from(tradingBotsTable)
      .where(and(
        eq(tradingBotsTable.status, "running"),
        isNotNull(tradingBotsTable.inFlight),
      ))
      .limit(10);
    for (const bot of interruptedBots) {
      await reconcileStaleInFlight(bot).catch((error) => {
        logger.error({ err: error, botId: bot.id }, "Failed to reconcile interrupted user trade");
      });
    }

    const bots = await db
      .select()
      .from(tradingBotsTable)
      .where(and(
        eq(tradingBotsTable.status, "running"),
        isNull(tradingBotsTable.inFlight),
        lte(tradingBotsTable.nextRunAt, new Date()),
      ))
      .limit(10);
    for (const bot of bots) await runBot(bot);
  } finally {
    schedulerBusy = false;
  }
}

export function startUserAutomationScheduler() {
  const timer = setInterval(() => void tick().catch((error) => {
    logger.error({ err: error }, "User automation scheduler tick failed");
  }), 15_000);
  timer.unref();
  logger.info("Database-backed user automation scheduler loaded");
}