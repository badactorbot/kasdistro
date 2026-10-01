import { and, eq, isNull, ne } from "drizzle-orm";
import * as kron from "@kronsdk/kron-sdk";
import { loadKaspa } from "@kronsdk/kron-sdk/wasm";
import {
  db,
  kasWithdrawalsTable,
  managedLotsTable,
  tradingBotsTable,
  walletUsersTable,
} from "@workspace/db";
import { decryptPrivateKey } from "./user-app-service";

const NODE_URL = "wss://node.kron.technology";
const NETWORK_ID = "mainnet";
const SOMPI_PER_KAS = 100_000_000n;
const MINIMUM_OUTPUT_SOMPI = 20_000_000n;

function parseKasAmount(value: string) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new Error("Enter a valid KAS amount with no more than 8 decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const sompi = BigInt(whole) * SOMPI_PER_KAS + BigInt(fraction.padEnd(8, "0"));
  if (sompi < MINIMUM_OUTPUT_SOMPI) {
    throw new Error("The minimum withdrawal is 0.2 KAS.");
  }
  return sompi;
}

function formatKas(sompi: bigint) {
  const whole = sompi / SOMPI_PER_KAS;
  const fraction = (sompi % SOMPI_PER_KAS).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

type PreparedWithdrawal = {
  action: "withdraw";
  startedAt: string;
  preparedTransaction: string;
  connectedInputIndexes: number[];
  amountSompi: string;
  feeSompi: string;
  remainingSompi: string;
  destinationAddress: string;
};

export async function prepareUserBotKasWithdrawal(
  userId: string,
  input: { mode: "amount" | "max"; amountKas?: string },
) {
  const [[user], [bot]] = await Promise.all([
    db.select().from(walletUsersTable).where(eq(walletUsersTable.id, userId)).limit(1),
    db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1),
  ]);
  if (!user || !bot) throw new Error("Bot wallet was not found.");
  if (bot.status === "running") throw new Error("Stop trading before withdrawing KAS.");
  if (bot.inFlight) {
    const legacy = bot.inFlight as { action?: string; preparedTransaction?: string };
    if (legacy.action === "withdraw" || legacy.action === "withdraw-preparing") {
      await db.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: null,
        updatedAt: new Date(),
      }).where(eq(tradingBotsTable.id, bot.id));
    } else {
      throw new Error("Wait for the current bot operation to finish before withdrawing.");
    }
  }

  const [openLot] = await db.select({ id: managedLotsTable.id })
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.soldAt)))
    .limit(1);
  if (openLot) throw new Error("Sell all managed token positions before withdrawing KAS.");

  const startedAt = new Date();
  const [claim] = await db.update(tradingBotsTable).set({
    inFlight: { action: "withdraw-preparing", startedAt: startedAt.toISOString() },
    stopReason: null,
    updatedAt: startedAt,
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    ne(tradingBotsTable.status, "running"),
    isNull(tradingBotsTable.inFlight),
  )).returning({ id: tradingBotsTable.id });
  if (!claim) throw new Error("The bot state changed. Refresh and try the withdrawal again.");

  const k = await loadKaspa();
  const key = new k.PrivateKey(decryptPrivateKey(bot.encryptedPrivateKey));
  const rpc = new k.RpcClient({ url: NODE_URL, networkId: NETWORK_ID, encoding: k.Encoding.Borsh });

  try {
    await rpc.connect();
    const [{ entries: botEntries }, { entries: connectedEntries }] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [bot.botAddress] }),
      rpc.getUtxosByAddresses({ addresses: [user.walletAddress] }),
    ]);
    if (!botEntries.length) throw new Error("Bot wallet has no spendable KAS.");
    if (!connectedEntries.length) {
      throw new Error("Connected wallet needs spendable KAS to pay the withdrawal network fee.");
    }

    const sortedBotEntries = [...botEntries].sort(
      (a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1),
    );
    const sortedConnectedEntries = [...connectedEntries].sort(
      (a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1),
    );
    const botBalance = sortedBotEntries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
    const requestedAmount = input.mode === "max"
      ? botBalance
      : parseKasAmount(input.amountKas ?? "");
    if (requestedAmount > botBalance) throw new Error("Withdrawal exceeds the bot wallet balance.");
    const botRemaining = botBalance - requestedAmount;
    if (input.mode === "amount" && botRemaining < MINIMUM_OUTPUT_SOMPI) {
      throw new Error("Use Max to withdraw the full balance, or leave at least 0.2 KAS in the bot wallet.");
    }

    const outputs: kron.spend.CovOutput[] = [{
      value: requestedAmount,
      scriptPublicKey: k.payToAddressScript(user.walletAddress),
      role: "withdrawal",
    }];
    if (botRemaining > 0n) {
      outputs.push({
        value: botRemaining,
        scriptPublicKey: k.payToAddressScript(bot.botAddress),
        role: "bot-change",
      });
    }
    const spend: kron.spend.CovenantSpend = {
      kind: "transfer",
      inputs: [],
      outputs,
      economics: {},
    };
    const fundingEntries = [...sortedBotEntries, ...sortedConnectedEntries];
    const connectedInputIndexes = sortedConnectedEntries.map(
      (_, index) => sortedBotEntries.length + index,
    );

    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: user.walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: user.walletAddress,
      networkFee,
    });
    if (assembly.change < MINIMUM_OUTPUT_SOMPI) {
      throw new Error("Connected wallet needs at least the network fee plus 0.2 KAS of spendable change.");
    }

    assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
    for (let index = 0; index < sortedBotEntries.length; index += 1) {
      if (!assembly.transaction.inputs[index]?.signatureScript) {
        throw new Error("Bot wallet could not sign the withdrawal transaction.");
      }
    }
    for (const index of connectedInputIndexes) {
      if (assembly.transaction.inputs[index]?.signatureScript) {
        throw new Error("Bot signer unexpectedly modified a connected-wallet input.");
      }
    }
    const txJsonString = assembly.transaction.serializeToSafeJSON();
    const prepared: PreparedWithdrawal = {
      action: "withdraw",
      startedAt: startedAt.toISOString(),
      preparedTransaction: txJsonString,
      connectedInputIndexes,
      amountSompi: requestedAmount.toString(),
      feeSompi: networkFee.toString(),
      remainingSompi: botRemaining.toString(),
      destinationAddress: user.walletAddress,
    };
    await db.update(tradingBotsTable).set({
      inFlight: prepared,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));

    return {
      txJsonString,
      signInputs: connectedInputIndexes.map((index) => ({ index, sighashType: 1 })),
      destinationAddress: user.walletAddress,
      amountKas: formatKas(requestedAmount),
      feeKas: formatKas(networkFee),
      remainingBalanceKas: formatKas(botRemaining),
    };
  } catch (error) {
    await db.update(tradingBotsTable).set({
      inFlight: null,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));
    throw error;
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}

export async function submitUserBotKasWithdrawal(userId: string, signedTransaction: string) {
  const [[user], [bot]] = await Promise.all([
    db.select().from(walletUsersTable).where(eq(walletUsersTable.id, userId)).limit(1),
    db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1),
  ]);
  if (!user || !bot) throw new Error("Bot wallet was not found.");
  const prepared = bot.inFlight as PreparedWithdrawal | null;
  if (
    !prepared ||
    prepared.action !== "withdraw" ||
    prepared.destinationAddress !== user.walletAddress ||
    !prepared.preparedTransaction
  ) {
    throw new Error("No prepared withdrawal is awaiting this wallet signature.");
  }

  let expectedJson: any;
  let signedJson: any;
  try {
    expectedJson = JSON.parse(prepared.preparedTransaction);
    signedJson = JSON.parse(signedTransaction);
  } catch {
    throw new Error("KasWare returned an unreadable signed transaction.");
  }
  for (const index of prepared.connectedInputIndexes) {
    const signature = signedJson?.inputs?.[index]?.signatureScript;
    if (typeof signature !== "string" || !signature) {
      throw new Error("KasWare did not sign every connected-wallet fee input.");
    }
    signedJson.inputs[index].signatureScript = expectedJson.inputs[index].signatureScript;
  }
  if (JSON.stringify(signedJson) !== JSON.stringify(expectedJson)) {
    throw new Error("Signed transaction changed fields other than the approved fee-input signatures.");
  }

  const k = await loadKaspa();
  const transaction = k.Transaction.deserializeFromSafeJSON(signedTransaction);
  const rpc = new k.RpcClient({ url: NODE_URL, networkId: NETWORK_ID, encoding: k.Encoding.Borsh });
  let submissionAttempted = false;
  try {
    await rpc.connect();
    submissionAttempted = true;
    const result = await rpc.submitTransaction({
      transaction,
      allowOrphan: false,
    });

    await db.transaction(async (tx) => {
      await tx.insert(kasWithdrawalsTable).values({
        botId: bot.id,
        userId,
        transactionId: result.transactionId,
        destinationAddress: user.walletAddress,
        amountSompi: BigInt(prepared.amountSompi),
        feeSompi: BigInt(prepared.feeSompi),
      });
      await tx.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: null,
        updatedAt: new Date(),
      }).where(eq(tradingBotsTable.id, bot.id));
    });

    return {
      transactionId: result.transactionId,
      destinationAddress: user.walletAddress,
      amountKas: formatKas(BigInt(prepared.amountSompi)),
      feeKas: formatKas(BigInt(prepared.feeSompi)),
      remainingBalanceKas: formatKas(BigInt(prepared.remainingSompi)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const definitivelyRejected = /rejected transaction|failed to verify|malformed signature/i.test(message);
    if (!submissionAttempted || definitivelyRejected) {
      await db.update(tradingBotsTable).set({
        inFlight: null,
        updatedAt: new Date(),
      }).where(eq(tradingBotsTable.id, bot.id));
    } else {
      await db.update(tradingBotsTable).set({
        stopReason: "Withdrawal submission is awaiting reconciliation. Do not retry.",
        updatedAt: new Date(),
      }).where(eq(tradingBotsTable.id, bot.id));
    }
    throw error;
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}