import { and, eq } from "drizzle-orm";
import { db, tradingBotsTable } from "@workspace/db";
import { logger } from "./logger";

const STALE_IN_FLIGHT_MS = 10 * 60_000;
const KASPA_REST_API = "https://api.kaspa.org";

type AddressTransaction = {
  transaction_id?: string;
  block_time?: number;
  is_accepted?: boolean;
  inputs?: Array<{ previous_outpoint_address?: string }>;
};

export async function reconcileStaleInFlight(bot: typeof tradingBotsTable.$inferSelect) {
  const marker = bot.inFlight;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
  const startedAtValue = "startedAt" in marker ? marker.startedAt : undefined;
  if (typeof startedAtValue !== "string") return false;

  const startedAt = new Date(startedAtValue);
  if (!Number.isFinite(startedAt.getTime()) || Date.now() - startedAt.getTime() < STALE_IN_FLIGHT_MS) {
    return false;
  }

  const after = startedAt.getTime() - 60_000;
  let before: number | undefined;
  let outgoing: AddressTransaction | undefined;
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(
      `/addresses/${encodeURIComponent(bot.botAddress)}/full-transactions-page`,
      KASPA_REST_API,
    );
    url.searchParams.set("limit", "500");
    // Kaspa rejects requests with both cursors. Start with the lower bound,
    // then page backward until we have passed that same bound.
    if (before === undefined) url.searchParams.set("after", String(after));
    else url.searchParams.set("before", String(before));
    url.searchParams.set("resolve_previous_outpoints", "light");

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`Kaspa history lookup failed with HTTP ${response.status}.`);
    }
    const transactions = await response.json() as AddressTransaction[];
    if (!Array.isArray(transactions) || transactions.some((tx) =>
      !Number.isFinite(tx.block_time) || !Array.isArray(tx.inputs) || typeof tx.is_accepted !== "boolean"
    )) {
      throw new Error("Kaspa history response is incomplete; reconciliation cannot proceed.");
    }
    outgoing = transactions.find((transaction) =>
      transaction.is_accepted === true &&
      typeof transaction.block_time === "number" &&
      transaction.block_time >= startedAt.getTime() &&
      transaction.inputs?.some((input) => input.previous_outpoint_address === bot.botAddress),
    );
    if (outgoing) break;
    if (transactions.length === 0 || Math.min(...transactions.map((tx) => tx.block_time!)) <= after) break;

    const nextBefore = response.headers.get("x-next-page-before");
    if (!nextBefore) {
      throw new Error("Kaspa history pagination ended before the reconciliation window was covered.");
    }
    const parsedNextBefore = Number(nextBefore);
    if (
      !Number.isFinite(parsedNextBefore) ||
      parsedNextBefore <= after ||
      (before !== undefined && parsedNextBefore >= before)
    ) {
      throw new Error("Kaspa history pagination returned an invalid cursor.");
    }
    before = parsedNextBefore;
    if (page === 99) {
      throw new Error("Kaspa history is too large to reconcile safely.");
    }
  }

  if (outgoing) {
    await db.update(tradingBotsTable).set({
      status: "paused",
      nextRunAt: null,
      stopReason: `Safety pause: transaction ${outgoing.transaction_id ?? "unknown"} reached the chain during an interrupted trade and requires reconciliation.`,
      updatedAt: new Date(),
    }).where(and(
      eq(tradingBotsTable.id, bot.id),
      eq(tradingBotsTable.inFlight, marker),
    ));
    logger.error(
      { botId: bot.id, transactionId: outgoing.transaction_id },
      "Interrupted user trade reached the chain; manual reconciliation required",
    );
    return false;
  }

  const cleared = await db.update(tradingBotsTable).set({
    inFlight: null,
    nextRunAt: bot.status === "running" ? new Date() : null,
    stopReason: null,
    updatedAt: new Date(),
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    eq(tradingBotsTable.inFlight, marker),
  )).returning({ id: tradingBotsTable.id });
  if (!cleared.length) return false;
  logger.warn({ botId: bot.id }, "Cleared stale user trade after confirming no outgoing chain transaction");
  return true;
}