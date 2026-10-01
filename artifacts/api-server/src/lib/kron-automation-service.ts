import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeAutomatedBuy, executeAutomatedSell } from "./kron-live-service";
import { logger } from "./logger";

const STATE_PATH = path.resolve(process.cwd(), ".local/kron-automation-state.json");
const TRADE_INTERVAL_MS = 6 * 60_000;
const RETRY_MS = 10 * 60_000;

type ManagedLot = {
  transactionId: string;
  index: number;
  amount: string;
  costKas: number;
};
type AutomationState = {
  version: number;
  armed: boolean;
  phase: "buying" | "selling";
  completedBuys: number;
  completedSells: number;
  totalTrades: number;
  lastTradeAt: string | null;
  nextRunAt: string | null;
  inFlight: { action: "buy" | "sell"; startedAt: string } | null;
  stopReason: string | null;
  managedLots: ManagedLot[];
};

let running = false;

async function readState(): Promise<AutomationState> {
  return JSON.parse(await readFile(STATE_PATH, "utf8")) as AutomationState;
}

async function writeState(state: AutomationState) {
  const temporary = `${STATE_PATH}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, STATE_PATH);
}

export async function getAutomationState() {
  return readState();
}

export async function armAutomation() {
  const state = await readState();
  if (state.inFlight) throw new Error("Ambiguous in-flight trade must be reconciled first.");
  const earliest = state.lastTradeAt
    ? new Date(state.lastTradeAt).getTime() + TRADE_INTERVAL_MS
    : Date.now() + 60_000;
  state.armed = true;
  state.stopReason = null;
  state.nextRunAt = new Date(Math.max(earliest, Date.now() + 60_000)).toISOString();
  await writeState(state);
  return state;
}

export async function disarmAutomation(reason = "Automation manually disarmed.") {
  const state = await readState();
  state.armed = false;
  state.nextRunAt = null;
  state.stopReason = reason;
  await writeState(state);
  return state;
}

async function tick() {
  if (running) return;
  const state = await readState();
  if (
    !state.armed ||
    state.inFlight ||
    !state.nextRunAt ||
    new Date(state.nextRunAt).getTime() > Date.now()
  ) return;

  running = true;
  const action = state.phase === "buying" ? "buy" : "sell";
  state.inFlight = { action, startedAt: new Date().toISOString() };
  await writeState(state);
  let submitted = false;
  try {
    if (action === "buy") {
      const result = await executeAutomatedBuy();
      submitted = true;
      if (!result.transactionId) throw new Error("Buy submission returned no transaction ID.");
      state.managedLots.push({
        transactionId: result.transactionId,
        index: 2,
        amount: String(result.tokenOut),
        costKas: result.maximumDebitKas,
      });
      state.completedBuys += 1;
      if (state.completedBuys >= 5) {
        state.phase = "selling";
        state.completedSells = 0;
      }
    } else {
      const lot = state.managedLots[0];
      if (!lot) throw new Error("No managed KDIST lot is available to sell.");
      await executeAutomatedSell(lot);
      submitted = true;
      state.managedLots.shift();
      state.completedSells += 1;
      if (state.completedSells >= 5) {
        state.phase = "buying";
        state.completedBuys = 0;
        state.completedSells = 0;
      }
    }
    state.totalTrades += 1;
    state.lastTradeAt = new Date().toISOString();
    state.nextRunAt = new Date(Date.now() + TRADE_INTERVAL_MS).toISOString();
    state.inFlight = null;
    state.stopReason = null;
    await writeState(state);
    logger.info({ action, totalTrades: state.totalTrades }, "Automated Kron trade accepted");
  } catch (error) {
    logger.error({ err: error, action, submitted }, "Automated Kron trade failed");
    if (submitted) {
      // Persisted inFlight state intentionally blocks all future trades until reconciliation.
      return;
    }
    state.inFlight = null;
    const message = error instanceof Error ? error.message : "Unknown automation error";
    if (/insufficient funding|no spendable KAS/i.test(message)) {
      state.armed = false;
      state.nextRunAt = null;
      state.stopReason = `Stopped: ${message}`;
    } else {
      state.nextRunAt = new Date(Date.now() + RETRY_MS).toISOString();
      state.stopReason = `Retry delayed: ${message}`;
    }
    await writeState(state);
  } finally {
    running = false;
  }
}

export function startAutomationScheduler() {
  const timer = setInterval(() => void tick().catch((error) => {
    logger.error({ err: error }, "Automation scheduler tick failed");
  }), 15_000);
  timer.unref();
  logger.info("Kron automation scheduler loaded (state-controlled)");
}