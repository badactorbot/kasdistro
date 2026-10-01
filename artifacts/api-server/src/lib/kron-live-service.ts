import * as kron from "@kronsdk/kron-sdk";
import { loadKaspa } from "@kronsdk/kron-sdk/wasm";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.kron.technology";
const INDEXER_URL = "https://idx.kron.technology/v1/kcc20";
const NODE_URL = "wss://node.kron.technology";
const NETWORK_ID = "mainnet";
const LIVE_TEST_KAS = 21;
const SOMPI_PER_KAS = 100_000_000n;
const MAXIMUM_DEBIT_SOMPI = 2_275_000_000n;
const MINIMUM_RESERVE_SOMPI = 2_500_000_000n;
const EXECUTION_CONFIRMATION = "BUY-21-KAS-KDIST-ONCE";
const EXECUTION_LOCK = path.resolve(process.cwd(), ".local/kron-live-buy.executed.json");

export type LiveBotCredentials = {
  privateKey: string;
  tokenId: string;
};

const toBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const toKas = (sompi: bigint) => Number(sompi) / Number(SOMPI_PER_KAS);

async function executionAlreadyCompleted() {
  try {
    await access(EXECUTION_LOCK);
    return true;
  } catch {
    return false;
  }
}

export async function prepareLiveBuy() {
  return runLiveBuy(false, false);
}

export async function validateLiveBuySignature() {
  return runLiveBuy(false, true);
}

export async function executeAutomatedBuy() {
  return runLiveBuy(true, false, true);
}

export async function executeUserAutomatedBuy(credentials: LiveBotCredentials) {
  return runLiveBuy(true, false, true, credentials, false);
}

export async function executeLiveBuy(confirmation: string) {
  if (confirmation !== EXECUTION_CONFIRMATION) {
    throw new Error("Exact live-buy confirmation phrase was not supplied.");
  }
  if (await executionAlreadyCompleted()) {
    throw new Error("The one-trade live-test cap has already been consumed.");
  }
  return runLiveBuy(true, false);
}

async function runLiveBuy(
  submit: boolean,
  signOnly: boolean,
  automation = false,
  credentials?: LiveBotCredentials,
  enforceMinimumOutput = true,
) {
  const privateKey = credentials?.privateKey.trim() ?? process.env.KASPA_BOT_PRIVATE_KEY?.trim();
  const tokenId = (credentials?.tokenId ?? process.env.KRON_TOKEN_ID)?.trim().toLowerCase();
  if (!privateKey) throw new Error("Dedicated bot wallet secret is not configured.");
  if (!tokenId) throw new Error("KRON token ID is not configured.");

  const k = await loadKaspa();
  let key: any;
  try {
    key = new k.PrivateKey(privateKey);
  } catch {
    throw new Error("The configured bot wallet private key is invalid.");
  }

  const publicKey = key.toPublicKey();
  const walletAddress = publicKey.toAddress(k.NetworkType.Mainnet).toString();
  const buyerPubkey = toBytes(publicKey.toXOnlyPublicKey().toString());
  const registry = new kron.client.RegistryClient(API_URL);
  const indexer = new kron.client.IndexerClient(INDEXER_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === tokenId,
  );
  if (!entry || !entry.extensions.chainVerified || entry.network !== NETWORK_ID) {
    throw new Error("Configured token is not a chain-verified Kron mainnet token.");
  }
  if (!entry.extensions.curveCovenantId || !entry.extensions.curveParams) {
    throw new Error("Configured token has no active Kron curve.");
  }

  const tokenResponse = await indexer.token(entry.symbol.toLowerCase());
  const token = (Array.isArray(tokenResponse) ? tokenResponse[0] : tokenResponse) as any;
  if (!token || token.graduated || !token.cpState) {
    throw new Error("This guarded preview currently supports pre-graduation curve buys only.");
  }

  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  const tokenCovid = toBytes(entry.covenantId);
  const curveCovid = toBytes(entry.extensions.curveCovenantId);
  const sequence = await new kron.client.SequencerClient(
    "https://seq.kron.technology",
  ).curveHead(entry.extensions.curveCovenantId);
  if (submit && sequence.ok && sequence.head) {
    throw new Error("The curve has an in-flight sequenced trade; rebuild after it settles.");
  }
  const tokenReserve = BigInt(token.cpState.tokenReserve);
  const state = { graduated: false, tokenCovid, tokenReserve };
  const inventoryState = kron.kcc20.covenantIdOwned(curveCovid, tokenReserve, false);
  const curveAddress = kron.curveCp.cpAddress(k, templates.curve, state, NETWORK_ID);
  const inventoryAddress = kron.kcc20.kcc20Address(
    k,
    templates.token,
    inventoryState,
    NETWORK_ID,
  );

  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [
      { entries: curveEntries },
      { entries: inventoryEntries },
      { entries: walletEntries },
      tokenBalanceResponse,
    ] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [curveAddress] }),
      rpc.getUtxosByAddresses({ addresses: [inventoryAddress] }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
      indexer.balance(entry.symbol.toLowerCase(), walletAddress),
    ]);
    if (curveEntries.length !== 1 || inventoryEntries.length !== 1) {
      throw new Error("Live curve state is ambiguous; refusing to prepare a transaction.");
    }
    if (!walletEntries.length) throw new Error("Bot wallet has no spendable KAS UTXOs.");

    const curveParams = entry.extensions.curveParams;
    const quoteState = {
      realKas: BigInt(token.cpState.realKas),
      tokenReserve,
      vKas: BigInt(curveParams.vKas),
      graduationKas: BigInt(curveParams.graduationKas),
      creatorFeeBps: BigInt(curveParams.creatorFeeBps),
      platformFeeBps: BigInt(curveParams.platformFeeBps),
      devFundBps: BigInt(curveParams.devFundBps ?? 0),
    };
    const quote = kron.curve.quoteCpBuy(
      quoteState,
      BigInt(LIVE_TEST_KAS) * SOMPI_PER_KAS,
    );
    if (!quote?.tokenOut) throw new Error("Kron returned no executable 21 KAS buy quote.");

    const fundingEntries = [...walletEntries]
      .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    const curveEntry = curveEntries[0];
    const inventoryEntry = inventoryEntries[0];
    const spend = kron.curveCp.buildCpBuy(
      k,
      templates.curve,
      templates.token,
      {
        transactionId: curveEntry.outpoint.transactionId,
        index: curveEntry.outpoint.index,
        realKas: BigInt(curveEntry.amount),
        state,
      },
      {
        transactionId: inventoryEntry.outpoint.transactionId,
        index: inventoryEntry.outpoint.index,
        value: BigInt(inventoryEntry.amount),
        amount: tokenReserve,
      },
      curveCovid,
      buyerPubkey,
      quote.kasIn,
      quote.tokenOut,
      [],
      2,
    );
    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });

    const fundingTotal = fundingEntries.reduce(
      (sum, item) => sum + BigInt(item.amount),
      0n,
    );
    const walletBalance = walletEntries.reduce(
      (sum, item) => sum + BigInt(item.amount),
      0n,
    );
    const maximumDebit = fundingTotal - assembly.change;
    const recipientDust = maximumDebit - quote.total - networkFee;
    if (maximumDebit > MAXIMUM_DEBIT_SOMPI) {
      throw new Error(
        `Maximum debit ${toKas(maximumDebit)} KAS exceeds the approved 22.75 KAS cap.`,
      );
    }
    if (!automation && walletBalance - maximumDebit < MINIMUM_RESERVE_SOMPI) {
      throw new Error("Trade would breach the 25 KAS wallet reserve.");
    }
    if (enforceMinimumOutput && quote.tokenOut < 8n) {
      throw new Error("Quote fell below the approved minimum output of 8 KDIST.");
    }
    const rawTokenBalance = Array.isArray(tokenBalanceResponse)
      ? tokenBalanceResponse[0]?.balance
      : (tokenBalanceResponse as any)?.balance;

    let transactionId: string | undefined;
    let fundingSignatureScriptBytes: number[] | undefined;
    if (submit || signOnly) {
      const inputsBefore = assembly.transaction.inputs;
      const covenantScripts = inputsBefore
        .slice(0, assembly.fundingInputIndexes[0])
        .map((input: any) => input.signatureScript);
      assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
      const inputsAfter = assembly.transaction.inputs;
      covenantScripts.forEach((script: string, index: number) => {
        if (inputsAfter[index].signatureScript !== script) {
          throw new Error("Native signer modified a covenant input; refusing submission.");
        }
      });
      fundingSignatureScriptBytes = assembly.fundingInputIndexes.map((index) => {
        const script = inputsAfter[index].signatureScript;
        if (!script || typeof script !== "string" || script.length % 2 !== 0) {
          throw new Error("Native signer produced an invalid funding signature script.");
        }
        return script.length / 2;
      });
    }
    if (submit && !automation) {
      await mkdir(path.dirname(EXECUTION_LOCK), { recursive: true });
      await writeFile(
        EXECUTION_LOCK,
        JSON.stringify({ status: "pending", createdAt: new Date().toISOString() }),
        { flag: "wx" },
      );
      try {
        const result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
        transactionId = result.transactionId;
        await writeFile(
          EXECUTION_LOCK,
          JSON.stringify({
            status: "submitted",
            transactionId,
            submittedAt: new Date().toISOString(),
            tokenId: entry.covenantId,
            tradeKas: LIVE_TEST_KAS,
            maximumDebitKas: toKas(maximumDebit),
          }),
        );
      } catch (error) {
        await unlink(EXECUTION_LOCK).catch(() => undefined);
        throw error;
      }
    } else if (submit) {
      const result = await rpc.submitTransaction({
        transaction: assembly.transaction,
        allowOrphan: false,
      });
      transactionId = result.transactionId;
    }

    return {
      tokenId: entry.covenantId,
      symbol: entry.symbol,
      tokenName: entry.name,
      walletAddress,
      walletKasBalance: toKas(walletBalance),
      walletTokenBalance: Number(rawTokenBalance ?? 0),
      tradeKas: LIVE_TEST_KAS,
      tokenOut: Number(quote.tokenOut),
      kronFeeKas: toKas(quote.fee),
      networkFeeKas: toKas(networkFee),
      recipientDustKas: toKas(recipientDust),
      maximumDebitKas: toKas(maximumDebit),
      transactionBuilt: true,
      signed: submit || signOnly,
      submitted: submit,
      transactionId,
      fundingSignatureScriptBytes,
      preparedAt: new Date().toISOString(),
      warnings: [
        "This preview is state-dependent and must be rebuilt immediately before execution.",
        submit
          ? "The one-time live-test cap is now permanently consumed."
          : "No transaction was signed or submitted.",
        "Live execution is available only from the private server command line.",
      ],
    };
  } finally {
    await rpc.disconnect();
    key = undefined;
  }
}

export async function executeAutomatedSell(lot: {
  transactionId: string;
  index: number;
  amount: string;
}) {
  return runAutomatedSell(lot, true);
}

export async function executeUserAutomatedSell(
  lot: { transactionId: string; index: number; amount: string },
  credentials: LiveBotCredentials,
) {
  return runAutomatedSell(lot, true, credentials);
}

export async function validateAutomatedSell(lot: {
  transactionId: string;
  index: number;
  amount: string;
}) {
  return runAutomatedSell(lot, false);
}

async function runAutomatedSell(lot: {
  transactionId: string;
  index: number;
  amount: string;
}, submit: boolean, credentials?: LiveBotCredentials) {
  const privateKey = credentials?.privateKey.trim() ?? process.env.KASPA_BOT_PRIVATE_KEY?.trim();
  const tokenId = (credentials?.tokenId ?? process.env.KRON_TOKEN_ID)?.trim().toLowerCase();
  if (!privateKey || !tokenId) throw new Error("Live wallet or token configuration is missing.");

  const k = await loadKaspa();
  const key = new k.PrivateKey(privateKey);
  const publicKey = key.toPublicKey();
  const walletAddress = publicKey.toAddress(k.NetworkType.Mainnet).toString();
  const traderPubkey = toBytes(publicKey.toXOnlyPublicKey().toString());
  const registry = new kron.client.RegistryClient(API_URL);
  const indexer = new kron.client.IndexerClient(INDEXER_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === tokenId,
  );
  if (!entry?.extensions.curveCovenantId || !entry.extensions.curveParams) {
    throw new Error("Configured token has no active Kron curve.");
  }
  const tokenResponse = await indexer.token(entry.symbol.toLowerCase());
  const token = (Array.isArray(tokenResponse) ? tokenResponse[0] : tokenResponse) as any;
  if (!token?.cpState || token.graduated) throw new Error("KDIST is no longer on its curve.");

  const sequence = await new kron.client.SequencerClient(
    "https://seq.kron.technology",
  ).curveHead(entry.extensions.curveCovenantId);
  if (sequence.ok && sequence.head) {
    throw new Error("The curve is busy with an in-flight sequenced trade.");
  }

  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  const tokenCovid = toBytes(entry.covenantId);
  const curveCovid = toBytes(entry.extensions.curveCovenantId);
  const tokenReserve = BigInt(token.cpState.tokenReserve);
  const state = { graduated: false, tokenCovid, tokenReserve };
  const inventoryState = kron.kcc20.covenantIdOwned(curveCovid, tokenReserve, false);
  const curveAddress = kron.curveCp.cpAddress(k, templates.curve, state, NETWORK_ID);
  const inventoryAddress = kron.kcc20.kcc20Address(
    k,
    templates.token,
    inventoryState,
    NETWORK_ID,
  );
  const owned = await indexer.tokenUtxos(entry.symbol.toLowerCase(), walletAddress);
  const ownedLot = owned.find(
    (item) =>
      item.outpoint.transactionId === lot.transactionId &&
      item.outpoint.index === lot.index &&
      item.amount === lot.amount,
  );
  if (!ownedLot) throw new Error("Managed KDIST lot is no longer spendable.");
  const decoded = kron.kcc20.decodeKcc20Redeem(toBytes(ownedLot.redeemScriptHex));
  const sellerAddress = kron.kcc20.kcc20Address(
    k,
    decoded.template,
    decoded.state,
    NETWORK_ID,
  );

  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [
      { entries: curveEntries },
      { entries: inventoryEntries },
      { entries: sellerEntries },
      { entries: walletEntries },
    ] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [curveAddress] }),
      rpc.getUtxosByAddresses({ addresses: [inventoryAddress] }),
      rpc.getUtxosByAddresses({ addresses: [sellerAddress] }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
    ]);
    if (curveEntries.length !== 1 || inventoryEntries.length !== 1) {
      throw new Error("Live curve state is ambiguous.");
    }
    const sellerEntry = sellerEntries.find(
      (item) =>
        item.outpoint.transactionId === lot.transactionId &&
        item.outpoint.index === lot.index,
    );
    if (!sellerEntry || !walletEntries.length) throw new Error("Required sell UTXO is missing.");

    const p = entry.extensions.curveParams;
    const quote = kron.curve.quoteCpSell(
      {
        realKas: BigInt(token.cpState.realKas),
        tokenReserve,
        vKas: BigInt(p.vKas),
        graduationKas: BigInt(p.graduationKas),
        creatorFeeBps: BigInt(p.creatorFeeBps),
        platformFeeBps: BigInt(p.platformFeeBps),
        devFundBps: BigInt(p.devFundBps ?? 0),
      },
      BigInt(lot.amount),
    );
    if (!quote?.net || quote.net <= 0n) throw new Error("Managed lot has no positive sell quote.");

    const fundingEntries = [...walletEntries]
      .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    const curveEntry = curveEntries[0];
    const inventoryEntry = inventoryEntries[0];
    const spend = kron.curveCp.buildCpSell(
      k,
      templates.curve,
      templates.token,
      {
        transactionId: curveEntry.outpoint.transactionId,
        index: curveEntry.outpoint.index,
        realKas: BigInt(curveEntry.amount),
        state,
      },
      [{
        transactionId: lot.transactionId,
        index: lot.index,
        value: BigInt(sellerEntry.amount),
        state: decoded.state,
      }],
      {
        transactionId: inventoryEntry.outpoint.transactionId,
        index: inventoryEntry.outpoint.index,
        value: BigInt(inventoryEntry.amount),
        amount: tokenReserve,
      },
      curveCovid,
      traderPubkey,
      BigInt(lot.amount),
      quote.kasOut,
      3,
    );
    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });
    const fundingTotal = BigInt(fundingEntries[0].amount);
    const netCredit = assembly.change - fundingTotal;
    if (netCredit <= 0n) throw new Error("Assembled sell does not produce a positive KAS credit.");

    const covenantScripts = assembly.transaction.inputs
      .slice(0, assembly.fundingInputIndexes[0])
      .map((input: any) => input.signatureScript);
    assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
    covenantScripts.forEach((script: string, index: number) => {
      if (assembly.transaction.inputs[index].signatureScript !== script) {
        throw new Error("Signer modified a covenant input.");
      }
    });
    const result = submit
      ? await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        })
      : null;
    return {
      transactionId: result?.transactionId,
      tokenIn: Number(lot.amount),
      grossKas: toKas(quote.kasOut),
      kronFeeKas: toKas(quote.fee),
      networkFeeKas: toKas(networkFee),
      netCreditKas: toKas(netCredit),
      signed: true,
      submitted: submit,
    };
  } finally {
    await rpc.disconnect();
  }
}