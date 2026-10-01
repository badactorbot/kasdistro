import { Router } from 'express';
import {
  MassCalculator,
  NetworkId,
  ScriptPublicKey,
  Transaction,
  getConsensusParametersByNetwork,
} from 'kaspa-wasm';

const router = Router();
const SERVICE_FEE_SOMPI = 10_000_000_000n;
const SERVICE_FEE_ADDRESS = 'kaspa:qz6dltvkds80wf8raac504ze4nesgnk72n24jr7krum2m8dq34khvkevr88cc';
// Kaspa mainnet's current minimum relay fee is 100 sompi per compute-mass unit.
// Keep this explicit: MassCalculator.minimumRequiredTransactionRelayFee()
// returns the mass under the installed WASM SDK's current consensus settings,
// while the node enforces the 100 sompi/unit standardness floor.
const MIN_RELAY_FEE_SOMPI_PER_MASS = 100n;
const MAX_COMPUTE_MASS = MassCalculator.maximumStandardTransactionMass();
const MAX_STORAGE_MASS = 500_000;

// ---------------------------------------------------------------------------
// Kaspa bech32 address → P2PK scriptPublicKey (pure JS, no kaspa-wasm needed)
// Kaspa uses standard bech32 charset with an 8-character checksum.
// ---------------------------------------------------------------------------
const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHECKSUM_LEN = 8;

function kaspaAddrToScript(address: string): string {
  const colonIdx = address.indexOf(':');
  if (colonIdx === -1) throw new Error(`Invalid Kaspa address: no prefix separator in "${address}"`);
  const payload = address.slice(colonIdx + 1);
  if (payload.length <= CHECKSUM_LEN) throw new Error(`Address payload too short: "${address}"`);

  // Decode each bech32 character to its 5-bit value, strip checksum
  const quintets: number[] = [];
  for (const c of payload.slice(0, -CHECKSUM_LEN)) {
    const v = BECH32_CHARS.indexOf(c);
    if (v < 0) throw new Error(`Invalid bech32 character "${c}" in address "${address}"`);
    quintets.push(v);
  }

  // Convert 5-bit groups → 8-bit bytes
  let acc = 0, bits = 0;
  const bytes: number[] = [];
  for (const q of quintets) {
    acc = (acc << 5) | q;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }

  // bytes[0] = version, bytes[1..33] = 32-byte Schnorr public key (PubKey v0)
  const version = bytes[0];
  if (version === 0) {
    // P2PK (Schnorr): OP_DATA_32 + pubkey + OP_CHECKSIG
    const pubkeyHex = bytes.slice(1, 33).map(b => b.toString(16).padStart(2, '0')).join('');
    if (pubkeyHex.length !== 64) throw new Error(`Bad pubkey length from address "${address}"`);
    return '20' + pubkeyHex + 'ac';
  } else if (version === 8) {
    // P2PK (ECDSA): OP_DATA_33 + pubkey(33 bytes) + OP_CHECKSIGECDSA
    const pubkeyHex = bytes.slice(1, 34).map(b => b.toString(16).padStart(2, '0')).join('');
    return '21' + pubkeyHex + 'ab';
  } else {
    throw new Error(`Unsupported address version ${version} in "${address}"`);
  }
}

// ---------------------------------------------------------------------------
// Kaspa REST API
// ---------------------------------------------------------------------------
const API_BASE: Record<string, string> = {
  mainnet: 'https://api.kaspa.org',
  testnet: 'https://api-tn11.kaspa.org',
  testnet10: 'https://api-tn10.kaspa.org',
};

// ---------------------------------------------------------------------------
// Fee estimation (Kaspa "mass"-based)
// Transaction mass ≈ 239 base + 642 per input + 365 per output (grams)
// Minimum fee = ceil(mass / 1000) sompi
// ---------------------------------------------------------------------------
function estimateFee(numInputs: number, numOutputs: number): bigint {
  const mass = 239n + BigInt(numInputs) * 642n + BigInt(numOutputs) * 365n;
  return ((mass + 999n) / 1000n) * 1000n; // ceil to nearest 1000 sompi
}

function safeScript(script: string): string {
  return `0000${script}`;
}

function parseKasAmount(value: unknown): bigint {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) throw new Error(`Invalid KAS amount "${text}"`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}

function calculateP2pkMass(inputCount: number, outputScripts: string[]): number {
  const cp = (getConsensusParametersByNetwork as any)(new NetworkId('mainnet'));
  const calculator = new MassCalculator(cp);
  const inputScript = new ScriptPublicKey(0, '20' + '00'.repeat(32) + 'ac');
  const inputs = Array.from({ length: inputCount }, (_, index) => ({
    previousOutpoint: { transactionId: '0'.repeat(64), index },
    signatureScript: '00'.repeat(66),
    sequence: 0n,
    sigOpCount: 1,
    utxoEntry: {
      amount: 1_000_000n,
      scriptPublicKey: inputScript,
      blockDaaScore: 1n,
      isCoinbase: false,
    },
  }));
  const outputs = outputScripts.map(script => ({
    value: 1_000_000n,
    scriptPublicKey: new ScriptPublicKey(0, script),
  }));
  return Number(calculator.blankTransactionMass())
    + Number(calculator.calcMassForInputs(inputs))
    + Number(calculator.calcMassForOutputs(outputs));
}

async function calculateConsensusMass(
  inputs: Array<{ transactionId: string; index: number }>,
  outputs: Array<{ value: bigint; script: string }>,
): Promise<{ mass: number; computeMass: number; storageMass: number }> {
  const upstream = await fetch(`${API_BASE.mainnet}/transactions/mass`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'kasdistro/1.0',
    },
    body: JSON.stringify({
      version: 0,
      inputs: inputs.map(input => ({
        previousOutpoint: {
          transactionId: input.transactionId,
          index: input.index,
        },
        // The transaction is unsigned at build time, but KasWare adds a
        // 66-byte Schnorr signature script before broadcast. Consensus compute
        // mass must model the signed transaction or the relay fee is short by
        // exactly 66 mass units per input.
        signatureScript: '00'.repeat(66),
        sequence: 0,
        sigOpCount: 1,
      })),
      outputs: outputs.map(output => ({
        amount: output.value.toString(),
        scriptPublicKey: {
          version: 0,
          scriptPublicKey: output.script,
        },
      })),
      lockTime: 0,
      subnetworkId: '0000000000000000000000000000000000000000',
    }),
  });
  const data: any = await upstream.json();
  if (!upstream.ok) {
    throw new Error(data?.detail || data?.error || `Kaspa mass calculation failed (${upstream.status}).`);
  }
  const mass = Number(data?.mass);
  const computeMass = Number(data?.compute_mass);
  const storageMass = Number(data?.storage_mass);
  if (![mass, computeMass, storageMass].every(Number.isFinite)) {
    throw new Error('Kaspa mass calculation returned an invalid response.');
  }
  return { mass, computeMass, storageMass };
}

router.post('/build-pskt', async (req, res) => {
  try {
    const { senderAddress, recipients, excludedOutpoints = [] } = req.body as {
      senderAddress: string;
      recipients: Array<{ address: string; amount: string | number }>;
      excludedOutpoints?: Array<{ transactionId: string; index: number }>;
    };
    if (!senderAddress?.startsWith('kaspa:') || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'A mainnet sender and at least one recipient are required.' });
    }

    const normalizedRecipients = recipients.map(recipient => {
      if (!recipient.address?.startsWith('kaspa:')) throw new Error('All recipients must be mainnet kaspa: addresses.');
      return {
        address: recipient.address,
        sompi: parseKasAmount(recipient.amount),
        script: kaspaAddrToScript(recipient.address),
      };
    });
    const paymentSompi = normalizedRecipients.reduce((sum, recipient) => sum + recipient.sompi, 0n);
    const senderScript = kaspaAddrToScript(senderAddress);
    const serviceScript = kaspaAddrToScript(SERVICE_FEE_ADDRESS);

    const [utxoResponse, transactionResponse] = await Promise.all([
      fetch(`${API_BASE.mainnet}/addresses/${senderAddress}/utxos`),
      fetch(`${API_BASE.mainnet}/addresses/${senderAddress}/full-transactions?limit=100&offset=0&resolve_previous_outpoints=no`),
    ]);
    if (!utxoResponse.ok) throw new Error(`UTXO lookup failed (${utxoResponse.status}).`);
    const rawUtxos = await utxoResponse.json() as any[];
    const mempoolSpent = new Set<string>();
    const explicitlyExcluded = new Set(
      excludedOutpoints.map(outpoint => `${outpoint.transactionId}:${outpoint.index}`),
    );
    if (transactionResponse.ok) {
      for (const transaction of await transactionResponse.json() as any[]) {
        if (transaction.is_accepted === false) {
          for (const input of transaction.inputs ?? []) {
            mempoolSpent.add(`${input.previous_outpoint_hash}:${input.previous_outpoint_index}`);
          }
        }
      }
    }
    const utxos = rawUtxos.map(utxo => ({
      transactionId: String(utxo.outpoint.transactionId),
      index: Number(utxo.outpoint.index),
      amount: BigInt(utxo.utxoEntry.amount),
      script: String(utxo.utxoEntry.scriptPublicKey.scriptPublicKey),
      blockDaaScore: String(utxo.utxoEntry.blockDaaScore),
      isCoinbase: Boolean(utxo.utxoEntry.isCoinbase),
    })).filter(utxo =>
      !mempoolSpent.has(`${utxo.transactionId}:${utxo.index}`)
      && !explicitlyExcluded.has(`${utxo.transactionId}:${utxo.index}`)
      && utxo.script === senderScript,
    )
      .sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0);
    if (!utxos.length) {
      return res.status(400).json({
        error: 'No spendable UTXOs owned by the connected sender address are available.',
      });
    }

    const selected: typeof utxos = [];
    let selectedTotal = 0n;
    let computeMass = 0;
    let storageMass = 0;
    let mass = 0;
    let networkFee = 0n;
    const baseScripts = [...normalizedRecipients.map(recipient => recipient.script), serviceScript];
    for (const utxo of utxos) {
      selected.push(utxo);
      selectedTotal += utxo.amount;
      computeMass = calculateP2pkMass(selected.length, [...baseScripts, senderScript]);
      networkFee = BigInt(computeMass) * MIN_RELAY_FEE_SOMPI_PER_MASS;
      if (selectedTotal >= paymentSompi + SERVICE_FEE_SOMPI + networkFee) break;
    }
    if (computeMass > MAX_COMPUTE_MASS) {
      return res.status(400).json({
        code: 'MASS_LIMIT_EXCEEDED',
        error: `This dispersal exceeds Kaspa's compute-mass limit (${computeMass.toLocaleString()} / ${MAX_COMPUTE_MASS.toLocaleString()}). Reduce the recipient count.`,
        mass: computeMass,
        computeMass,
        storageMass: null,
        maximumMass: MAX_COMPUTE_MASS,
        maximumComputeMass: MAX_COMPUTE_MASS,
        maximumStorageMass: MAX_STORAGE_MASS,
      });
    }
    let change = selectedTotal - paymentSompi - SERVICE_FEE_SOMPI - networkFee;
    if (change < 0n) {
      return res.status(400).json({
        error: `Insufficient funds. Need ${(paymentSompi + SERVICE_FEE_SOMPI + networkFee).toString()} sompi.`,
      });
    }

    let outputSpecs: Array<{ value: bigint; script: string }> = [];
    let massFeeSatisfied = false;
    for (let iteration = 0; iteration < utxos.length + 12; iteration += 1) {
      change = selectedTotal - paymentSompi - SERVICE_FEE_SOMPI - networkFee;
      if (change < 0n) {
        return res.status(400).json({
          error: `Insufficient funds. Need ${(paymentSompi + SERVICE_FEE_SOMPI + networkFee).toString()} sompi.`,
        });
      }
      let absorbedDust = false;
      if (change > 0n && MassCalculator.isStandardOutputAmountDust(change)) {
        networkFee += change;
        change = 0n;
        absorbedDust = true;
      }
      outputSpecs = [
        ...normalizedRecipients.map(recipient => ({ value: recipient.sompi, script: recipient.script })),
        { value: SERVICE_FEE_SOMPI, script: serviceScript },
        ...(change > 0n ? [{ value: change, script: senderScript }] : []),
      ];
      computeMass = calculateP2pkMass(selected.length, outputSpecs.map(output => output.script));
      const consensusMass = await calculateConsensusMass(selected, outputSpecs);
      mass = consensusMass.mass;
      storageMass = consensusMass.storageMass;
      computeMass = consensusMass.computeMass;

      if (
        storageMass > MAX_STORAGE_MASS
        && computeMass <= MAX_COMPUTE_MASS
        && selected.length < utxos.length
      ) {
        const nextUtxo = utxos[selected.length];
        selected.push(nextUtxo);
        selectedTotal += nextUtxo.amount;
        continue;
      }

      if (computeMass > MAX_COMPUTE_MASS || storageMass > MAX_STORAGE_MASS) {
        const exceeded = storageMass > MAX_STORAGE_MASS ? 'storage' : 'compute';
        const measured = exceeded === 'storage' ? storageMass : computeMass;
        const maximum = exceeded === 'storage' ? MAX_STORAGE_MASS : MAX_COMPUTE_MASS;
        return res.status(400).json({
          code: 'MASS_LIMIT_EXCEEDED',
          error: `This dispersal exceeds Kaspa's ${exceeded}-mass limit (${measured.toLocaleString()} / ${maximum.toLocaleString()}). Reduce the recipient count.`,
          mass,
          computeMass,
          storageMass,
          maximumMass: maximum,
          maximumComputeMass: MAX_COMPUTE_MASS,
          maximumStorageMass: MAX_STORAGE_MASS,
        });
      }

      const minimumFee = BigInt(mass) * MIN_RELAY_FEE_SOMPI_PER_MASS;
      if (networkFee === minimumFee || (absorbedDust && networkFee >= minimumFee)) {
        massFeeSatisfied = true;
        break;
      }
      networkFee = minimumFee;
    }
    if (!massFeeSatisfied) {
      throw new Error('Kaspa mass-based fee calculation did not converge.');
    }

    const inputs = selected.map(utxo => ({
      transactionId: utxo.transactionId,
      index: utxo.index,
      sequence: '0',
      sigOpCount: 1,
      signatureScript: '',
      utxo: {
        address: senderAddress,
        amount: utxo.amount.toString(),
        scriptPublicKey: safeScript(utxo.script),
        blockDaaScore: utxo.blockDaaScore,
        isCoinbase: utxo.isCoinbase,
      },
    }));
    const outputs = outputSpecs.map(output => ({
      value: output.value.toString(),
      scriptPublicKey: safeScript(output.script),
    }));
    const transaction = new Transaction({
      version: 0,
      inputs: selected.map(utxo => ({
        previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index },
        signatureScript: '',
        sequence: 0n,
        sigOpCount: 1,
        utxoEntry: {
          amount: utxo.amount,
          scriptPublicKey: new ScriptPublicKey(0, utxo.script),
          blockDaaScore: BigInt(utxo.blockDaaScore),
          isCoinbase: utxo.isCoinbase,
        },
      })),
      outputs: outputs.map(output => ({
        value: BigInt(output.value),
        scriptPublicKey: new ScriptPublicKey(0, output.scriptPublicKey.slice(4)),
      })),
      lockTime: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      gas: 0n,
      payload: '',
    });
    const transactionId = transaction.finalize().toString();
    transaction.free();
    const txJsonString = JSON.stringify({
      id: transactionId,
      version: 0,
      inputs,
      outputs,
      subnetworkId: '0000000000000000000000000000000000000000',
      lockTime: '0',
      gas: '0',
      mass: String(mass),
      payload: '',
    });

    return res.json({
      txJsonString,
      inputIndicesToSign: inputs.map((_, index) => index),
      recipientTotalSompi: paymentSompi.toString(),
      serviceFeeSompi: SERVICE_FEE_SOMPI.toString(),
      networkFeeSompi: networkFee.toString(),
      grandTotalSompi: (paymentSompi + SERVICE_FEE_SOMPI + networkFee).toString(),
      mass,
      computeMass,
      storageMass,
      maximumMass: storageMass >= computeMass ? MAX_STORAGE_MASS : MAX_COMPUTE_MASS,
      maximumComputeMass: MAX_COMPUTE_MASS,
      maximumStorageMass: MAX_STORAGE_MASS,
      inputOutpoints: selected.map(utxo => ({
        transactionId: utxo.transactionId,
        index: utxo.index,
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Transaction build failed.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/kaspa/build-tx
// Body: { senderAddress, recipients: [{address, amount}], networkId? }
// Returns: { pendingTxs: [{ id, txJson, paymentAmount, feeAmount }] }
//
// txJson is the SignableTransaction JSON that KasWare.signKaspaTransaction()
// expects — identical to what kaspa-wasm's SignableTransaction.toJSON() produces.
// ---------------------------------------------------------------------------
router.post('/build-tx', async (req, res) => {
  try {
    const {
      senderAddress,
      recipients,
      networkId = 'mainnet',
    } = req.body as {
      senderAddress: string;
      recipients: { address: string; amount: number }[];
      networkId?: string;
    };

    if (!senderAddress || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'senderAddress and recipients are required' });
    }

    const apiBase = API_BASE[networkId] ?? API_BASE.mainnet;

    // ── 1. Fetch UTXOs + mempool-spent outpoints in parallel ─────────────
    const [utxoRes, txRes] = await Promise.all([
      fetch(`${apiBase}/addresses/${senderAddress}/utxos`),
      fetch(`${apiBase}/addresses/${senderAddress}/full-transactions?limit=100&offset=0&resolve_previous_outpoints=no`),
    ]);

    if (!utxoRes.ok) {
      throw new Error(`UTXO fetch failed (${utxoRes.status}): ${await utxoRes.text()}`);
    }
    const rawUtxos = await utxoRes.json() as any[];
    if (!rawUtxos.length) {
      return res.status(400).json({ error: 'No UTXOs found for sender address' });
    }

    // Build a set of outpoints already being spent in unconfirmed mempool txs
    const mempoolSpent = new Set<string>();
    if (txRes.ok) {
      const recentTxs = await txRes.json() as any[];
      for (const tx of recentTxs) {
        if (tx.is_accepted === false) {
          for (const inp of (tx.inputs ?? [])) {
            // index comes back as a string from this endpoint
            mempoolSpent.add(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index}`);
          }
        }
      }
    }

    // Normalize UTXOs, excluding any the mempool is already spending
    const utxos = rawUtxos
      .map(u => ({
        transactionId: u.outpoint.transactionId as string,
        index: u.outpoint.index as number,
        amount: BigInt(u.utxoEntry.amount),
        // REST API stores script under scriptPublicKey.scriptPublicKey (hex)
        script: u.utxoEntry.scriptPublicKey.scriptPublicKey as string,
        blockDaaScore: Number(u.utxoEntry.blockDaaScore),
        isCoinbase: u.utxoEntry.isCoinbase as boolean,
      }))
      .filter(u => !mempoolSpent.has(`${u.transactionId}:${u.index}`));

    if (!utxos.length) {
      return res.status(400).json({ error: 'No spendable UTXOs — all funds are pending in the mempool. Wait for your last transaction to confirm.' });
    }

    // Sort largest first for greedy selection
    utxos.sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));

    // ── 2. UTXO selection ─────────────────────────────────────────────────
    const totalPaymentSompi = recipients.reduce(
      (sum, r) => sum + BigInt(Math.round(r.amount * 1e8)),
      0n,
    );
    const numOutputs = recipients.length + 1; // +1 for change

    const selected: typeof utxos = [];
    let selectedTotal = 0n;

    for (const utxo of utxos) {
      selected.push(utxo);
      selectedTotal += utxo.amount;
    const fee = estimateFee(selected.length, numOutputs);
      if (selectedTotal >= totalPaymentSompi + fee) break;
    }

    const fee = estimateFee(selected.length, numOutputs);
    const changeAmount = selectedTotal - totalPaymentSompi - fee;

    if (changeAmount < 0n) {
      return res.status(400).json({
        error: `Insufficient funds. Need ${totalPaymentSompi + fee} sompi, have ${selectedTotal} sompi.`,
      });
    }

    // ── 3. Build script for sender (change output) ────────────────────────
    const senderScript = kaspaAddrToScript(senderAddress);

    // ── 4. Build inputs array (SignableTransaction format) ────────────────
    const inputs = selected.map(u => ({
      previousOutpoint: { transactionId: u.transactionId, index: u.index },
      signatureScript: '',
      sequence: 0,
      sigOpCount: 1,
      utxo: {
        address: senderAddress,
        amount: Number(u.amount), // sompi as number (safe up to ~9×10^15)
        scriptPublicKey: { version: 0, script: u.script },
        blockDaaScore: u.blockDaaScore,
        isCoinbase: u.isCoinbase,
      },
    }));

    // ── 5. Build outputs array ────────────────────────────────────────────
    const outputs: Array<{ amount: number; scriptPublicKey: { version: number; script: string } }> =
      recipients.map(r => ({
        amount: Math.round(r.amount * 1e8),
        scriptPublicKey: { version: 0, script: kaspaAddrToScript(r.address) },
      }));

    if (changeAmount > 0n) {
      outputs.push({
        amount: Number(changeAmount),
        scriptPublicKey: { version: 0, script: senderScript },
      });
    }

    // ── 6. Assemble SignableTransaction JSON ──────────────────────────────
    const txJson = JSON.stringify({
      version: 0,
      inputs,
      outputs,
      lockTime: 0,
      subnetworkId: '0000000000000000000000000000000000000000',
      gas: 0,
      payload: '',
    });

    return res.json({
      pendingTxs: [
        {
          id: 'pending',
          txJson,
          paymentAmount: totalPaymentSompi.toString(),
          feeAmount: fee.toString(),
        },
      ],
    });
  } catch (err: any) {
    const msg: string = err?.message ?? 'Transaction build failed';
    return res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/kaspa/push-tx
// Body: { signedTxJson: string, networkId?: string }
//
// Accepts the signed transaction JSON returned by KasWare.signKaspaTransaction()
// and broadcasts it to the Kaspa network via the public REST API.
// This is the fallback for wallets that expose signKaspaTransaction but not pushTx.
// ---------------------------------------------------------------------------
router.post('/push-tx', async (req, res) => {
  try {
    const { signedTxJson, networkId = 'mainnet' } = req.body as {
      signedTxJson: string;
      networkId?: string;
    };

    if (!signedTxJson) {
      return res.status(400).json({ error: 'signedTxJson is required' });
    }

    const apiBase = API_BASE[networkId] ?? API_BASE.mainnet;

    // Parse the SignableTransaction JSON from the wallet
    const rawStr = typeof signedTxJson === 'string' ? signedTxJson : JSON.stringify(signedTxJson);
    console.log('[push-tx] received JSON length:', rawStr.length, '| first 300:', rawStr.slice(0, 300));
    const tx = JSON.parse(rawStr);

    // Handle wrapped format: some wallet versions return { transaction: { inputs, outputs, ... } }
    // instead of the flat kaspa-wasm serializeToSafeJSON format.
    const txData: any = Array.isArray(tx.inputs) ? tx : (tx.transaction ?? tx);

    // Log the exact field names present in the signed transaction (helps diagnose wallet format issues)
    const topKeys = Object.keys(tx);
    const inputCount = Array.isArray(txData.inputs) ? txData.inputs.length : '?';
    console.log('[push-tx] top-level keys:', topKeys, '| resolved inputs:', inputCount);
    if (Array.isArray(txData.inputs)) {
      txData.inputs.forEach((inp: any, i: number) => {
        const op = inp.previousOutpoint ?? inp.previous_outpoint ?? inp.outpoint;
        const opKeys = op ? Object.keys(op) : [];
        console.log(`[push-tx] input[${i}] keys:`, Object.keys(inp), '| outpoint keys:', opKeys, '| txId:', op?.transactionId ?? op?.transaction_id ?? op?.txId ?? '<missing>');
      });
    }

    // Helper: resolve previousOutpoint from a signed input, handling both
    // camelCase (kaspa-wasm serializeToSafeJSON) and snake_case variants that
    // different wallet versions may emit.
    const resolveOutpoint = (inp: any) => {
      const op = inp.previousOutpoint ?? inp.previous_outpoint ?? inp.outpoint ?? {};
      const txId: string =
        op.transactionId ?? op.transaction_id ?? op.transactionId ?? op.txId ?? op.txid ?? '';
      const idx: number = Number(op.index ?? op.outputIndex ?? 0);
      return { transactionId: txId, index: idx };
    };

    // Map to Kaspa REST API SubmitTransactionRequest format.
    // Handles two source formats:
    //   - signKaspaTransaction format: outputs have "amount" (number)
    //   - signPskt / kaspa-wasm format: outputs have "value" (BigInt string)
    // Both: scriptPublicKey uses "script" key; REST API expects "scriptPublicKey".
    const submitTx = {
      version: txData.version ?? tx.version ?? 0,
      inputs: (txData.inputs ?? tx.inputs ?? []).map((inp: any) => ({
        previousOutpoint: resolveOutpoint(inp),
        signatureScript: inp.signatureScript ?? '',
        sequence: Number(inp.sequence ?? 0),
        sigOpCount: inp.sigOpCount ?? 1,
      })),
      outputs: (txData.outputs ?? tx.outputs ?? []).map((out: any) => ({
        // "amount" (signKaspaTransaction) or "value" (kaspa-wasm/signPskt) — accept both
        amount: Number(out.amount ?? out.value ?? 0),
        scriptPublicKey: {
          version: out.scriptPublicKey?.version ?? 0,
          // Our build-tx uses 'script'; REST API expects 'scriptPublicKey'
          scriptPublicKey: out.scriptPublicKey?.scriptPublicKey ?? out.scriptPublicKey?.script ?? '',
        },
      })),
      lockTime: Number(txData.lockTime ?? tx.lockTime ?? 0),
      subnetworkId: txData.subnetworkId ?? tx.subnetworkId ?? '0000000000000000000000000000000000000000',
    };

    // Validate: every input must have a non-empty transactionId before we submit
    const badInput = submitTx.inputs.findIndex((i: { previousOutpoint: { transactionId: string } }) => !i.previousOutpoint.transactionId);
    if (badInput !== -1) {
      // Log the raw signed input so we can see what field names the wallet used
      const rawInp = (tx.inputs ?? [])[badInput];
      console.error('[push-tx] input %d missing transactionId; raw keys:', badInput, Object.keys(rawInp ?? {}));
      console.error('[push-tx] raw previousOutpoint keys:', Object.keys(rawInp?.previousOutpoint ?? rawInp?.previous_outpoint ?? rawInp?.outpoint ?? {}));
      throw new Error(
        `Signed transaction input ${badInput} is missing transactionId — wallet returned unexpected format. ` +
        `Raw outpoint keys: ${Object.keys(rawInp?.previousOutpoint ?? rawInp?.previous_outpoint ?? rawInp?.outpoint ?? {}).join(', ')}`,
      );
    }

    // Log the exact payload we send to Kaspa so we can diagnose format issues
    const submitPayload = { transaction: submitTx, allowOrphan: false };
    console.log('[push-tx] submitting to Kaspa. inputs:', JSON.stringify(
      submitTx.inputs.map((i: any) => ({
        previousOutpoint: i.previousOutpoint,
        signatureScriptLen: i.signatureScript?.length ?? 0,
        sigOpCount: i.sigOpCount,
        sequence: i.sequence,
      }))
    ));

    const submitRes = await fetch(`${apiBase}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitPayload),
    });

    const submitBody = await submitRes.json() as any;

    if (!submitRes.ok) {
      // Log what we submitted to help debug format issues
      console.error('[push-tx] Kaspa API rejected. First input outpoint:', submitTx.inputs[0]?.previousOutpoint);
      throw new Error(submitBody?.detail ?? submitBody?.error ?? `Kaspa node rejected transaction (${submitRes.status})`);
    }

    return res.json({
      txId: submitBody.transactionId ?? submitBody.txId ?? '',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Broadcast failed' });
  }
});

export default router;
