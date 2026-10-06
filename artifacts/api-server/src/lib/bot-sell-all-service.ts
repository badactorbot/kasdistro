import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { db, managedLotsTable, tradingBotsTable } from "@workspace/db";
import {
  executeUserAutomatedSell,
  RetryableTradeStateError,
  TradeSubmissionAttemptedError,
} from "./kron-live-service";
import { decryptPrivateKey } from "./user-app-service";
import { reconcileStaleInFlight } from "./interrupted-trade-service";
import { logger } from "./logger";

/** Concurrent requests only block while a sell-all is actively heartbeating. */
const ACTIVE_SELL_ALL_MS = 2 * 60_000;
/** Wait between successful lot sells so the curve/sequencer can settle. */
const BETWEEN_LOTS_MS = 15_000;
/** Backoff when the curve reports busy / transient reject. */
const RETRY_WAIT_MS = 20_000;
/** Overall deadline for one Sell All request (covers several lots + retries). */
const SELL_ALL_DEADLINE_MS = 25 * 60_000;
/** Max attempts per individual lot before giving up that lot. */
const MAX_ATTEMPTS_PER_LOT = 12;

type SellAllInFlight = {
  action: "sell-all";
  startedAt: string;
  heartbeatAt: string;
  currentLotId?: string;
  soldCount?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function countOpenLots(botId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)));
  return Number(row?.value ?? 0);
}

async function nextOpenLot(botId: string) {
  const [lot] = await db
    .select()
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)))
    .orderBy(asc(managedLotsTable.createdAt))
    .limit(1);
  return lot ?? null;
}

/** RPC rejections that did not land on-chain — safe to retry or clear the lock. */
function isDefinitiveSubmissionRejection(message: string) {
  return /orphan|is an orphan|rejected transaction|double.?spend|already spent|insufficient funds|utxo.*not found|no longer spendable/i
    .test(message);
}

function isRetryableFailure(error: unknown, message: string) {
  if (error instanceof RetryableTradeStateError) return true;
  // Orphans / race after a prior sell often clear after a short wait.
  return /orphan|is an orphan|curve is busy|in-flight sequenced|no longer spendable/i.test(message);
}

async function clearSellAllMarker(botId: string, marker: unknown) {
  await db.update(tradingBotsTable).set({
    inFlight: null,
    stopReason: null,
    updatedAt: new Date(),
  }).where(and(
    eq(tradingBotsTable.id, botId),
    eq(tradingBotsTable.inFlight, marker),
  ));
}

async function heartbeat(
  botId: string,
  base: SellAllInFlight,
  patch: Partial<SellAllInFlight> = {},
) {
  const next: SellAllInFlight = {
    ...base,
    ...patch,
    heartbeatAt: new Date().toISOString(),
  };
  await db.update(tradingBotsTable).set({
    inFlight: next,
    updatedAt: new Date(),
  }).where(eq(tradingBotsTable.id, botId));
  return next;
}

export async function sellAllUserBotManagedPositions(userId: string) {
  let [bot] = await db.select().from(tradingBotsTable)
    .where(eq(tradingBotsTable.userId, userId))
    .limit(1);
  if (!bot) throw new Error("Bot wallet was not found.");
  const tokenId = bot.tokenId;
  if (!tokenId) throw new Error("Bot has no configured token to sell.");
  if (bot.status === "running") {
    throw new Error("Stop trading before selling remaining managed positions.");
  }

  if (bot.inFlight) {
    const marker = bot.inFlight as { action?: string; startedAt?: string; heartbeatAt?: string };
    if (marker.action === "sell-all") {
      const beat = typeof marker.heartbeatAt === "string"
        ? Date.parse(marker.heartbeatAt)
        : typeof marker.startedAt === "string"
          ? Date.parse(marker.startedAt)
          : Number.NaN;
      const ageMs = Number.isFinite(beat) ? Date.now() - beat : Number.POSITIVE_INFINITY;
      const activelyRunning = ageMs < ACTIVE_SELL_ALL_MS && !bot.stopReason;
      if (activelyRunning) {
        throw new Error("A sell-all operation is already in progress. Wait a moment and try again.");
      }
      await clearSellAllMarker(bot.id, bot.inFlight);
      logger.warn({ botId: bot.id, ageMs, stopReason: bot.stopReason }, "Cleared stalled sell-all marker for retry");
      [bot] = await db.select().from(tradingBotsTable)
        .where(eq(tradingBotsTable.id, bot.id))
        .limit(1);
      if (!bot) throw new Error("Bot wallet was not found.");
      if (bot.inFlight) {
        throw new Error("The bot operation changed. Refresh and try sell all again.");
      }
    } else {
      await reconcileStaleInFlight(bot);
      [bot] = await db.select().from(tradingBotsTable)
        .where(eq(tradingBotsTable.id, bot.id))
        .limit(1);
      if (!bot || bot.inFlight) {
        throw new Error("The interrupted trade requires reconciliation before selling positions.");
      }
    }
  }

  const initialOpen = await countOpenLots(bot.id);
  if (initialOpen === 0) {
    return {
      soldCount: 0,
      remainingOpenLots: 0,
      sellTransactionIds: [] as string[],
      complete: true,
      message: "No open managed token positions to sell.",
    };
  }

  const startedAt = new Date();
  let inFlight: SellAllInFlight = {
    action: "sell-all",
    startedAt: startedAt.toISOString(),
    heartbeatAt: startedAt.toISOString(),
    soldCount: 0,
  };
  const [claim] = await db.update(tradingBotsTable).set({
    inFlight,
    stopReason: null,
    updatedAt: startedAt,
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    ne(tradingBotsTable.status, "running"),
    isNull(tradingBotsTable.inFlight),
  )).returning({ id: tradingBotsTable.id });
  if (!claim) throw new Error("The bot state changed. Refresh and try sell all again.");

  const credentials = {
    privateKey: decryptPrivateKey(bot.encryptedPrivateKey),
    tokenId,
  };
  const sellTransactionIds: string[] = [];
  let soldCount = 0;
  const initialTotalTrades = bot.totalTrades;
  const deadline = Date.now() + SELL_ALL_DEADLINE_MS;

  try {
    while (Date.now() < deadline) {
      const remaining = await countOpenLots(bot.id);
      if (remaining === 0) break;

      const lot = await nextOpenLot(bot.id);
      if (!lot) break;

      inFlight = await heartbeat(bot.id, inFlight, {
        currentLotId: lot.id,
        soldCount,
      });

      let lotSold = false;
      let lastMessage = "Unknown sell failure";

      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_LOT && Date.now() < deadline; attempt += 1) {
        inFlight = await heartbeat(bot.id, inFlight, {
          currentLotId: lot.id,
          soldCount,
        });

        let submissionAttempted = false;
        try {
          const result = await executeUserAutomatedSell({
            transactionId: lot.buyTransactionId,
            index: lot.outputIndex,
            amount: lot.tokenAmount.toString(),
          }, credentials);
          submissionAttempted = true;
          if (!result.transactionId) {
            throw new Error("Sell submission returned no transaction ID.");
          }

          await db.transaction(async (tx) => {
            await tx.update(managedLotsTable).set({
              sellTransactionId: result.transactionId,
              soldAt: new Date(),
            }).where(eq(managedLotsTable.id, lot.id));
            await tx.update(tradingBotsTable).set({
              totalTrades: initialTotalTrades + soldCount + 1,
              lastTradeAt: new Date(),
              stopReason: null,
              updatedAt: new Date(),
            }).where(eq(tradingBotsTable.id, bot.id));
          });

          sellTransactionIds.push(result.transactionId);
          soldCount += 1;
          lotSold = true;
          logger.info({
            botId: bot.id,
            lotId: lot.id,
            transactionId: result.transactionId,
            soldCount,
            remainingAfter: remaining - 1,
          }, "Sell-all lot sold");
          break;
        } catch (error) {
          submissionAttempted ||= error instanceof TradeSubmissionAttemptedError;
          lastMessage = error instanceof Error ? error.message : "Unknown sell failure";
          const definitiveReject = submissionAttempted && isDefinitiveSubmissionRejection(lastMessage);
          const retryable = isRetryableFailure(error, lastMessage)
            || (submissionAttempted && definitiveReject);

          if (submissionAttempted && !definitiveReject) {
            // Truly uncertain outcome — keep lock for reconciliation; do not continue.
            await db.update(tradingBotsTable).set({
              status: "paused",
              nextRunAt: null,
              stopReason: `Sell-all paused after uncertain submission: ${lastMessage}`,
              inFlight,
              updatedAt: new Date(),
            }).where(eq(tradingBotsTable.id, bot.id));
            throw new Error(
              `Sold ${soldCount} of ${initialOpen} position(s); a later sell may have been submitted and needs reconciliation. ${lastMessage}`,
            );
          }

          if (retryable && attempt < MAX_ATTEMPTS_PER_LOT && Date.now() + RETRY_WAIT_MS < deadline) {
            logger.warn({
              botId: bot.id,
              lotId: lot.id,
              attempt,
              err: lastMessage,
            }, "Sell-all retrying lot after transient failure");
            inFlight = await heartbeat(bot.id, inFlight, { soldCount });
            await sleep(RETRY_WAIT_MS);
            continue;
          }

          const remainingOpenLots = await countOpenLots(bot.id);
          await db.update(tradingBotsTable).set({
            inFlight: null,
            stopReason: soldCount > 0
              ? `Sell-all stopped after ${soldCount} of ${initialOpen} sale(s): ${lastMessage}`
              : `Sell-all failed: ${lastMessage}`,
            phase: remainingOpenLots === 0 ? "buying" : "selling",
            completedBuys: remainingOpenLots === 0 ? 0 : bot.completedBuys,
            completedSells: remainingOpenLots === 0 ? 0 : bot.completedSells,
            updatedAt: new Date(),
          }).where(eq(tradingBotsTable.id, bot.id));
          throw new Error(
            `Sold ${soldCount} of ${initialOpen} position(s), then failed: ${lastMessage}`
              + (remainingOpenLots > 0 ? ` ${remainingOpenLots} remain — retry Sell all.` : ""),
          );
        }
      }

      if (!lotSold) {
        const remainingOpenLots = await countOpenLots(bot.id);
        await db.update(tradingBotsTable).set({
          inFlight: null,
          stopReason: `Sell-all timed out after ${soldCount} of ${initialOpen} sale(s).`,
          phase: remainingOpenLots === 0 ? "buying" : "selling",
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
        throw new Error(
          `Sold ${soldCount} of ${initialOpen} position(s), then timed out. ${remainingOpenLots} remain — retry Sell all.`,
        );
      }

      // More lots left: wait for sequencer/curve before the next sell.
      if (await countOpenLots(bot.id) > 0) {
        inFlight = await heartbeat(bot.id, inFlight, { soldCount });
        await sleep(BETWEEN_LOTS_MS);
      }
    }

    const remainingOpenLots = await countOpenLots(bot.id);
    if (remainingOpenLots > 0) {
      await db.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: `Sell-all reached time limit after ${soldCount} of ${initialOpen} sale(s).`,
        phase: "selling",
        updatedAt: new Date(),
      }).where(eq(tradingBotsTable.id, bot.id));
      throw new Error(
        `Sold ${soldCount} of ${initialOpen} position(s) before the time limit. ${remainingOpenLots} remain — retry Sell all.`,
      );
    }

    await db.update(tradingBotsTable).set({
      phase: "buying",
      completedBuys: 0,
      completedSells: 0,
      nextRunAt: null,
      inFlight: null,
      stopReason: null,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));

    return {
      soldCount,
      remainingOpenLots: 0,
      sellTransactionIds,
      complete: true,
      message: `Sold all ${soldCount} managed position(s). You can withdraw KAS now.`,
    };
  } catch (error) {
    throw error;
  }
}
