import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as kron from "@kronsdk/kron-sdk";
import { loadKaspa } from "@kronsdk/kron-sdk/wasm";
import {
  db,
  activationPaymentsTable,
  managedLotsTable,
  tradingBotsTable,
  walletUsersTable,
} from "@workspace/db";

export const ACTIVATION_ADDRESS =
  "kaspa:qz6dltvkds80wf8raac504ze4nesgnk72n24jr7krum2m8dq34khvkevr88cc";
const ACTIVATION_SOMPI = 10_000_000_000n;
const MINIMUM_BOT_FUNDING_SOMPI = 2_275_000_000n;
const SESSION_COOKIE = "kron_wallet_session";
const API_URL = "https://api.kron.technology";
const INDEXER_URL = "https://idx.kron.technology/v1/kcc20";
const NODE_URL = "wss://node.kron.technology";

const challenges = new Map<string, {
  address: string;
  publicKey: string;
  message: string;
  expiresAt: number;
}>();

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not configured.");
  return value;
}

function encryptionKey() {
  return createHash("sha256").update(secret()).digest();
}

export function encryptPrivateKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptPrivateKey(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored signer is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function createSessionToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
  })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSessionToken(token?: string) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    userId: string;
    expiresAt: number;
  };
  return data.expiresAt > Date.now() ? data.userId : null;
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function fixedStrategy() {
  return {
    orderSizeKas: 21,
    buyCount: 5,
    sellCount: 5,
    tradesPerHour: 10,
    activationFeeKas: 100,
    activationAddress: ACTIVATION_ADDRESS,
  };
}

export function getGuestDashboard() {
  return {
    authenticated: false,
    walletAddress: "",
    strategy: fixedStrategy(),
    bot: null,
  };
}

export async function createWalletChallenge(address: string, publicKey: string) {
  const k = await loadKaspa();
  const derived = new k.PublicKey(publicKey).toAddress(k.NetworkType.Mainnet).toString();
  if (derived !== address || !address.startsWith("kaspa:")) {
    throw new Error("Public key does not match the supplied Kaspa mainnet address.");
  }
  const challengeId = randomUUID();
  const expiresAt = Date.now() + 5 * 60_000;
  const message = [
    "Kron Bot wallet verification",
    `Address: ${address}`,
    `Challenge: ${randomBytes(24).toString("hex")}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    "This signature does not authorize a transaction.",
  ].join("\n");
  challenges.set(challengeId, { address, publicKey, message, expiresAt });
  return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyWalletChallenge(input: {
  challengeId: string;
  walletAddress: string;
  publicKey: string;
  signature: string;
}) {
  const challenge = challenges.get(input.challengeId);
  challenges.delete(input.challengeId);
  if (
    !challenge ||
    challenge.expiresAt < Date.now() ||
    challenge.address !== input.walletAddress ||
    challenge.publicKey !== input.publicKey
  ) throw new Error("Wallet challenge is invalid or expired.");
  const k = await loadKaspa();
  const signature = /^[a-fA-F0-9]+$/.test(input.signature)
    ? input.signature
    : Buffer.from(input.signature, "base64").toString("hex");
  if (!k.verifyMessage({
    message: challenge.message,
    signature,
    publicKey: input.publicKey,
  })) throw new Error("Wallet signature could not be verified.");

  const [user] = await db
    .insert(walletUsersTable)
    .values({ walletAddress: input.walletAddress, publicKey: input.publicKey })
    .onConflictDoUpdate({
      target: walletUsersTable.walletAddress,
      set: { publicKey: input.publicKey, updatedAt: new Date() },
    })
    .returning();
  if (!user) throw new Error("Could not create wallet account.");
  return { userId: user.id, token: createSessionToken(user.id) };
}

export async function getUserDashboard(userId: string) {
  const [user] = await db.select().from(walletUsersTable).where(eq(walletUsersTable.id, userId)).limit(1);
  if (!user) throw new Error("Wallet session is no longer valid.");
  const [bot] = await db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1);
  const lots = bot
    ? await db.select().from(managedLotsTable)
        .where(eq(managedLotsTable.botId, bot.id))
        .orderBy(desc(managedLotsTable.createdAt))
        .limit(50)
    : [];
  const tradeHistory = lots
    .flatMap((lot) => [
      ...(lot.sellTransactionId && lot.soldAt ? [{
        action: "sell" as const,
        transactionId: lot.sellTransactionId,
        executedAt: lot.soldAt.toISOString(),
        tokenAmount: lot.tokenAmount.toString(),
        tokenId: lot.tokenId,
        tokenSymbol: lot.tokenSymbol,
      }] : []),
      {
        action: "buy" as const,
        transactionId: lot.buyTransactionId,
        executedAt: lot.createdAt.toISOString(),
        tokenAmount: lot.tokenAmount.toString(),
        tokenId: lot.tokenId,
        tokenSymbol: lot.tokenSymbol,
      },
    ])
    .sort((a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt));
  let botKasBalance = 0;
  let managedTokenAmount = "0";
  if (bot) {
    const k = await loadKaspa();
    const rpc = new k.RpcClient({ url: NODE_URL, networkId: "mainnet", encoding: k.Encoding.Borsh });
    const indexer = new kron.client.IndexerClient(INDEXER_URL);
    await rpc.connect();
    try {
      const [{ entries }, tokenBalanceResponse] = await Promise.all([
        rpc.getUtxosByAddresses({ addresses: [bot.botAddress] }),
        bot.tokenSymbol
          ? indexer.balance(bot.tokenSymbol.toLowerCase(), bot.botAddress)
          : Promise.resolve([]),
      ]);
      botKasBalance = entries.reduce((sum, entry) => sum + Number(entry.amount) / 100_000_000, 0);
      const tokenBalanceData: unknown = tokenBalanceResponse;
      const rawTokenBalance = Array.isArray(tokenBalanceData)
        ? (tokenBalanceData[0] as { balance?: string | number } | undefined)?.balance
        : (tokenBalanceData as { balance?: string | number } | null)?.balance;
      managedTokenAmount = rawTokenBalance == null ? "0" : String(rawTokenBalance);
    } finally {
      await rpc.disconnect();
    }
  }
  return {
    authenticated: true,
    walletAddress: user.walletAddress,
    strategy: fixedStrategy(),
    bot: bot ? {
      id: bot.id,
      botAddress: bot.botAddress,
      tokenId: bot.tokenId,
      tokenSymbol: bot.tokenSymbol,
      configurationVersion: bot.configurationVersion,
      activationPaid: Boolean(bot.activationVerifiedAt),
      activationTxId: bot.activationTxId,
      status: bot.status,
      phase: bot.phase,
      completedBuys: bot.completedBuys,
      completedSells: bot.completedSells,
      totalTrades: bot.totalTrades,
      nextRunAt: bot.nextRunAt?.toISOString() ?? null,
      lastTradeAt: bot.lastTradeAt?.toISOString() ?? null,
      stopReason: bot.stopReason,
      managedTokenAmount,
      botKasBalance,
      tradeHistory,
    } : null,
  };
}

export async function setupUserBot(userId: string, tokenId: string) {
  const normalized = tokenId.toLowerCase();
  const registry = new kron.client.RegistryClient(API_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === normalized,
  );
  if (!entry?.extensions.chainVerified || entry.network !== "mainnet") {
    throw new Error("Token must be a chain-verified Kron mainnet KCC20 token.");
  }
  const [existing] = await db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1);
  if (existing) {
    if (existing.tokenId !== normalized) {
      throw new Error("Use Change Covenant to update an existing bot configuration.");
    }
  } else {
    const k = await loadKaspa();
    let key: any;
    do {
      try {
        key = new k.PrivateKey(randomBytes(32).toString("hex"));
      } catch {
        key = null;
      }
    } while (!key);
    await db.insert(tradingBotsTable).values({
      userId,
      botAddress: key.toAddress(k.NetworkType.Mainnet).toString(),
      encryptedPrivateKey: encryptPrivateKey(key.toString()),
      tokenId: normalized,
      tokenSymbol: entry.symbol,
    });
  }
  return getUserDashboard(userId);
}

export async function verifyActivation(userId: string, transactionId: string) {
  const normalizedTransactionId = transactionId.toLowerCase();
  const [usedPayment] = await db.select({ id: activationPaymentsTable.id })
    .from(activationPaymentsTable)
    .where(eq(activationPaymentsTable.transactionId, normalizedTransactionId))
    .limit(1);
  if (usedPayment) throw new Error("This activation transaction has already been used.");

  const k = await loadKaspa();
  const rpc = new k.RpcClient({ url: NODE_URL, networkId: "mainnet", encoding: k.Encoding.Borsh });
  await rpc.connect();
  try {
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [ACTIVATION_ADDRESS] });
    const payment = entries.find(
      (entry) =>
        entry.outpoint.transactionId === normalizedTransactionId &&
        BigInt(entry.amount) >= ACTIVATION_SOMPI,
    );
    if (!payment) throw new Error("Confirmed 100 KAS activation payment was not found.");
  } finally {
    await rpc.disconnect();
  }
  const [bot] = await db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1);
  if (!bot?.tokenId) throw new Error("Set up the bot before verifying activation.");
  const verifiedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(activationPaymentsTable).values({
      botId: bot.id,
      userId,
      configurationVersion: bot.configurationVersion,
      tokenId: bot.tokenId!,
      transactionId: normalizedTransactionId,
      verifiedAt,
    });
    await tx.update(tradingBotsTable).set({
      activationTxId: normalizedTransactionId,
      activationVerifiedAt: verifiedAt,
      status: "ready",
      updatedAt: verifiedAt,
    }).where(eq(tradingBotsTable.id, bot.id));
  });
  return getUserDashboard(userId);
}

export async function changeUserBotCovenant(userId: string, tokenId: string) {
  const normalized = tokenId.toLowerCase();
  const [bot] = await db.select().from(tradingBotsTable)
    .where(eq(tradingBotsTable.userId, userId))
    .limit(1);
  if (!bot?.tokenId) throw new Error("Set up the bot before changing its covenant.");
  if (bot.tokenId === normalized) throw new Error("Enter a different covenant ID.");
  if (bot.status === "running") throw new Error("Stop the bot before changing its covenant.");
  if (bot.inFlight) throw new Error("Wait for the current trade to finish before changing the covenant.");

  const [openLot] = await db.select({ id: managedLotsTable.id })
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.soldAt)))
    .limit(1);
  if (openLot) throw new Error("All managed positions must be sold before changing the covenant.");

  const registry = new kron.client.RegistryClient(API_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === normalized,
  );
  if (!entry?.extensions.chainVerified || entry.network !== "mainnet") {
    throw new Error("Token must be a chain-verified Kron mainnet KCC20 token.");
  }

  await db.transaction(async (tx) => {
    if (bot.activationTxId && bot.activationVerifiedAt) {
      await tx.insert(activationPaymentsTable).values({
        botId: bot.id,
        userId,
        configurationVersion: bot.configurationVersion,
        tokenId: bot.tokenId!,
        transactionId: bot.activationTxId,
        verifiedAt: bot.activationVerifiedAt,
      }).onConflictDoNothing();
    }
    await tx.update(managedLotsTable).set({
      tokenId: bot.tokenId,
      tokenSymbol: bot.tokenSymbol,
    }).where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.tokenId)));
    await tx.update(tradingBotsTable).set({
      tokenId: normalized,
      tokenSymbol: entry.symbol,
      configurationVersion: bot.configurationVersion + 1,
      activationTxId: null,
      activationVerifiedAt: null,
      status: "setup",
      phase: "buying",
      completedBuys: 0,
      completedSells: 0,
      nextRunAt: null,
      inFlight: null,
      stopReason: null,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));
  });
  return getUserDashboard(userId);
}

export async function setUserBotRunning(userId: string, running: boolean) {
  const [bot] = await db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1);
  if (!bot?.activationVerifiedAt || !bot.tokenId) throw new Error("Complete setup and activation first.");
  if (running) {
    const k = await loadKaspa();
    const rpc = new k.RpcClient({ url: NODE_URL, networkId: "mainnet", encoding: k.Encoding.Borsh });
    await rpc.connect();
    try {
      const { entries } = await rpc.getUtxosByAddresses({ addresses: [bot.botAddress] });
      const balance = entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
      if (balance < MINIMUM_BOT_FUNDING_SOMPI) {
        throw new Error("Fund the bot wallet with at least 22.75 KAS before starting.");
      }
    } finally {
      await rpc.disconnect();
    }
  }
  const update = db.update(tradingBotsTable).set({
    status: running ? "running" : "stopped",
    nextRunAt: running ? new Date(Date.now() + 60_000) : null,
    stopReason: running ? null : "Stopped by user.",
    updatedAt: new Date(),
  });
  const updated = running
    ? await update.where(and(eq(tradingBotsTable.id, bot.id), isNull(tradingBotsTable.inFlight)))
        .returning({ id: tradingBotsTable.id })
    : await update.where(eq(tradingBotsTable.id, bot.id)).returning({ id: tradingBotsTable.id });
  if (!updated.length) throw new Error("Another bot operation is in progress. Wait before starting.");
  return getUserDashboard(userId);
}