import { logger } from "./logger";

type BotMode = "dry-run" | "live";
type BotStatus = "stopped" | "running" | "paused";
type BotPhase = "buying" | "selling";
type ActivityAction = "buy" | "sell" | "system" | "safety";
type ActivityStatus = "simulated" | "completed" | "blocked" | "info";

export interface BotConfig {
  tokenId: string;
  buyCount: number;
  sellCount: number;
  tradesPerHour: number;
  orderSizeKas: number;
  maxSlippagePercent: number;
  maxDailyLossKas: number;
  minKasReserve: number;
  mode: BotMode;
  timeZone: string;
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  action: ActivityAction;
  status: ActivityStatus;
  detail: string;
  amountKas: number;
}

const config: BotConfig = {
  tokenId: process.env.KRON_TOKEN_ID ?? "KCC20_TOKEN_ID_REQUIRED",
  buyCount: 5,
  sellCount: 5,
  tradesPerHour: 10,
  orderSizeKas: 21,
  maxSlippagePercent: 1,
  maxDailyLossKas: 0,
  minKasReserve: 0,
  mode: "dry-run",
  timeZone: "America/Los_Angeles",
};

const state = {
  status: "stopped" as BotStatus,
  phase: "buying" as BotPhase,
  completedBuys: 0,
  completedSells: 0,
  totalTradesToday: 0,
  hourlyTradeCount: 0,
  nextRunAt: null as string | null,
  lastRunAt: null as string | null,
  hourBucket: new Date().getUTCHours(),
};

const activities: ActivityEntry[] = [
  {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action: "safety",
    status: "info",
    detail: "Dry-run mode is active. No transactions will be signed or broadcast.",
    amountKas: 0,
  },
  {
    id: crypto.randomUUID(),
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    action: "system",
    status: "info",
    detail: "Strategy loaded: 5 buys followed by 5 sells.",
    amountKas: 0,
  },
];

let timer: NodeJS.Timeout | null = null;

function addActivity(
  action: ActivityAction,
  status: ActivityStatus,
  detail: string,
  amountKas = 0,
): ActivityEntry {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    status,
    detail,
    amountKas,
  };
  activities.unshift(entry);
  activities.splice(50);
  return entry;
}

function resetHourlyCountIfNeeded() {
  const currentHour = new Date().getUTCHours();
  if (currentHour !== state.hourBucket) {
    state.hourBucket = currentHour;
    state.hourlyTradeCount = 0;
  }
}

function intervalMs() {
  return Math.max(30_000, Math.round(3_600_000 / config.tradesPerHour));
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  if (state.status !== "running") {
    state.nextRunAt = null;
    timer = null;
    return;
  }

  const delay = intervalMs();
  state.nextRunAt = new Date(Date.now() + delay).toISOString();
  timer = setTimeout(() => {
    try {
      runOnce();
    } catch (error) {
      logger.error({ err: error }, "Scheduled bot step failed");
      state.status = "paused";
      addActivity(
        "safety",
        "blocked",
        "The scheduler paused after an unexpected error.",
      );
    } finally {
      scheduleNext();
    }
  }, delay);
  timer.unref();
}

export function getBotState() {
  resetHourlyCountIfNeeded();
  const tokenConfigured = config.tokenId !== "KCC20_TOKEN_ID_REQUIRED";
  const canTrade = config.mode === "dry-run";
  return {
    status: state.status,
    mode: config.mode,
    phase: state.phase,
    completedBuys: state.completedBuys,
    completedSells: state.completedSells,
    totalTradesToday: state.totalTradesToday,
    hourlyTradeCount: state.hourlyTradeCount,
    hourlyTradeLimit: config.tradesPerHour,
    nextRunAt: state.nextRunAt,
    lastRunAt: state.lastRunAt,
    config: { ...config },
    wallet: {
      connected: false,
      address: "Signer not configured",
      kasBalance: 0,
      tokenBalance: 0,
    },
    safety: {
      canTrade,
      reason: canTrade
        ? tokenConfigured
          ? "Dry-run simulation is ready."
          : "Dry-run ready. Add the target KCC20 token ID before live setup."
        : "Live execution is locked until a dedicated wallet signer is configured.",
      killSwitchArmed: state.status !== "running",
      dailyLossKas: 0,
    },
  };
}

export function updateBotConfig(next: BotConfig) {
  Object.assign(config, next);
  if (state.status === "running") scheduleNext();
  addActivity(
    "system",
    "info",
    `Strategy updated to ${config.buyCount} buys / ${config.sellCount} sells at ${config.tradesPerHour} trades per hour.`,
  );
  return getBotState();
}

export function startBot() {
  if (config.mode === "live") {
    state.status = "paused";
    addActivity(
      "safety",
      "blocked",
      "Live start blocked: configure a dedicated wallet signer first.",
    );
    return getBotState();
  }

  state.status = "running";
  addActivity("system", "info", "Dry-run scheduler started.");
  scheduleNext();
  return getBotState();
}

export function stopBot() {
  state.status = "stopped";
  scheduleNext();
  addActivity("system", "info", "Scheduler stopped. No future steps are queued.");
  return getBotState();
}

export function runOnce() {
  resetHourlyCountIfNeeded();

  if (config.mode === "live") {
    const activity = addActivity(
      "safety",
      "blocked",
      "Live order blocked: no wallet signer is configured.",
    );
    return {
      action: "none" as const,
      status: "blocked" as const,
      message: activity.detail,
      state: getBotState(),
      activity,
    };
  }

  if (state.hourlyTradeCount >= config.tradesPerHour) {
    const activity = addActivity(
      "safety",
      "blocked",
      "Hourly trade limit reached. The next step will wait for the next hour.",
    );
    return {
      action: "none" as const,
      status: "blocked" as const,
      message: activity.detail,
      state: getBotState(),
      activity,
    };
  }

  const action = state.phase === "buying" ? "buy" : "sell";
  if (action === "buy") {
    state.completedBuys += 1;
    if (state.completedBuys >= config.buyCount) {
      state.phase = "selling";
      state.completedSells = 0;
    }
  } else {
    state.completedSells += 1;
    if (state.completedSells >= config.sellCount) {
      state.phase = "buying";
      state.completedBuys = 0;
    }
  }

  state.totalTradesToday += 1;
  state.hourlyTradeCount += 1;
  state.lastRunAt = new Date().toISOString();
  const activity = addActivity(
    action,
    "simulated",
    `${action === "buy" ? "Buy" : "Sell"} step simulated. No transaction was signed or broadcast.`,
    config.orderSizeKas,
  );

  return {
    action,
    status: "simulated" as const,
    message: activity.detail,
    state: getBotState(),
    activity,
  };
}

export function getActivities(limit: number) {
  return activities.slice(0, limit);
}

export function getMarketSnapshot() {
  return {
    tokenId: config.tokenId,
    symbol:
      config.tokenId === "KCC20_TOKEN_ID_REQUIRED" ? "KCC20" : config.tokenId,
    priceKas: 0,
    priceUsd: 0,
    liquidityKas: 0,
    change24hPercent: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function simulateLongRun(input: {
  startingKas: number;
  hours: number;
  tradeFeePercent: number;
}) {
  const maxTrades = Math.floor(input.hours * config.tradesPerHour);
  const cycleLength = config.buyCount + config.sellCount;
  let balance = input.startingKas;
  let tokenUnits = 0;
  let buys = 0;
  let sells = 0;
  let trades = 0;
  let tradeFees = 0;
  let buyNotional = 0;
  let sellProceeds = 0;
  let stoppedReason:
    | "hours-completed"
    | "insufficient-kas"
    | "no-token-inventory" = "hours-completed";

  while (trades < maxTrades) {
    const positionInCycle = trades % cycleLength;
    const isBuy = positionInCycle < config.buyCount;
    const tradeFee = config.orderSizeKas * (input.tradeFeePercent / 100);

    if (isBuy) {
      const requiredKas = config.orderSizeKas + tradeFee;
      if (balance + Number.EPSILON < requiredKas) {
        stoppedReason = "insufficient-kas";
        break;
      }

      balance -= requiredKas;
      tokenUnits += config.orderSizeKas;
      buys += 1;
      buyNotional += config.orderSizeKas;
    } else {
      if (tokenUnits + Number.EPSILON < config.orderSizeKas) {
        stoppedReason = "no-token-inventory";
        break;
      }
      balance += config.orderSizeKas - tradeFee;
      tokenUnits -= config.orderSizeKas;
      sells += 1;
      sellProceeds += config.orderSizeKas;
    }

    trades += 1;
    tradeFees += tradeFee;
  }

  const round = (value: number) => Number(value.toFixed(8));
  const endingPortfolioKas = balance + tokenUnits;
  return {
    startingKas: round(input.startingKas),
    endingKas: round(Math.max(0, balance)),
    endingPortfolioKas: round(endingPortfolioKas),
    netChangeKas: round(endingPortfolioKas - input.startingKas),
    hoursRequested: input.hours,
    hoursCompleted: round(trades / config.tradesPerHour),
    tradesCompleted: trades,
    buysCompleted: buys,
    sellsCompleted: sells,
    completedCycles: Math.floor(trades / cycleLength),
    tradeFeesPaidKas: round(tradeFees),
    buyNotionalKas: round(buyNotional),
    sellProceedsKas: round(sellProceeds),
    endingTokenUnits: round(tokenUnits),
    stoppedReason,
    assumptions: [
      `The current ${config.buyCount}-buy/${config.sellCount}-sell cycle and ${config.tradesPerHour} trades-per-hour setting are used.`,
      `Kron charges ${input.tradeFeePercent}% of the ${config.orderSizeKas} KAS notional on every buy and sell.`,
      `Each buy spends ${config.orderSizeKas} KAS plus its percentage fee.`,
      `Each sell returns ${config.orderSizeKas} KAS minus its percentage fee.`,
      "Token price is held constant at 1 KAS per simulated token unit; market movement, slippage, network gas, and price impact are excluded.",
    ],
  };
}