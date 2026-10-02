/**
 * Integration test: KCC-20 PSKT structure validation
 *
 * Calls the real `/api/kron/build-kcc20-transfer` endpoint against a known
 * KRON holder, then validates every field of the generated transaction JSON
 * against the kaspa-wasm Transaction.serializeToSafeJSON() schema that
 * KasWare's signPskt expects.
 *
 * Run with:  pnpm --filter @workspace/api-server run test:pskt
 */

import assert from 'node:assert/strict';
import { blake2b } from '@noble/hashes/blake2.js';

// ── Known-good KRON holder for testing (public on-chain data) ────────────────
const SENDER    = 'kaspa:qpelx02sd6m9c5umux9e7lav35z5lqxmc5z8dva898868z260r5xkprppw6k0';
const RECIPIENT = 'kaspa:qr3v84f384hvfrh09uaae70ww2u03qn2rruq7dm8hz9gw7a3klaxj9p0clfz7';
const API_BASE  = process.env.API_URL ?? 'http://localhost:' + (process.env.PORT ?? '3001');

const COVENANT_OUTPUT_SOMPI = 50_000_000n; // 0.5 KAS — fixed value for every covenant UTXO

// ── Re-derive P2SH SPK from redeemScript for cross-check ────────────────────
function blake2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}
function expectedP2shScript(redeemScriptHex: string): string {
  const redeem = Buffer.from(redeemScriptHex, 'hex');
  const hash = blake2b256(redeem);
  const out = new Uint8Array(35);
  out[0] = 0xaa; out[1] = 0x20; out.set(hash, 2); out[34] = 0x87;
  return Buffer.from(out).toString('hex');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function assertField(obj: any, key: string, type: string, label: string) {
  assert.ok(key in obj, `${label}: missing field "${key}"`);
  assert.equal(typeof obj[key], type, `${label}.${key} must be ${type}, got ${typeof obj[key]}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  KCC-20 PSKT format integration test                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 1. Call the endpoint ──────────────────────────────────────────────────
  console.log('1. Building KCC-20 transfer transaction…');
  const buildRes = await fetch(`${API_BASE}/api/kron/build-kcc20-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderAddress: SENDER,
      recipients: [{ address: RECIPIENT, amount: '10' }],
      tick: 'KRON',
    }),
  });
  const body = await buildRes.json() as any;
  assert.ok(buildRes.ok, `Endpoint returned ${buildRes.status}: ${body?.error ?? JSON.stringify(body)}`);
  console.log('   ✓ HTTP 200');

  // ── 2. Top-level response fields ─────────────────────────────────────────
  console.log('2. Checking top-level response fields…');
  assert.ok(typeof body.txJsonString === 'string', 'txJsonString must be a string');
  assert.ok(Array.isArray(body.inputIndicesToSign), 'inputIndicesToSign must be an array');
  assert.ok(typeof body.fee === 'string', 'fee must be a string');
  assert.ok(BigInt(body.fee) > 0n, `fee must be positive, got ${body.fee}`);
  assert.equal(body.totalAmount, '10', 'totalAmount must equal sum of recipient amounts');
  console.log('   ✓ fee =', body.fee, '  totalAmount =', body.totalAmount);

  // ── 3. Parse txJsonString ─────────────────────────────────────────────────
  console.log('3. Parsing txJsonString (kaspa-wasm serializeToSafeJSON schema)…');
  const tx = JSON.parse(body.txJsonString);

  // Transaction-level fields (all string except version)
  assert.equal(typeof tx.version, 'number', 'version must be number');
  assert.equal(tx.version, 0, 'version must be 0');
  assert.equal(typeof tx.lockTime, 'string', 'lockTime must be string');
  assert.equal(tx.lockTime, '0', 'lockTime must be "0"');
  assert.equal(typeof tx.gas, 'string', 'gas must be string');
  assert.equal(tx.gas, '0', 'gas must be "0"');
  assert.equal(tx.subnetworkId, '0000000000000000000000000000000000000000', 'subnetworkId must be 40 hex zeros');
  assert.equal(typeof tx.payload, 'string', 'payload must be string');
  console.log('   ✓ transaction-level fields correct');

  // ── 4. Input schema ───────────────────────────────────────────────────────
  console.log('4. Validating input schema…');
  assert.ok(Array.isArray(tx.inputs) && tx.inputs.length > 0, 'inputs must be non-empty array');
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const label = `input[${i}]`;

    // previousOutpoint
    assert.ok(inp.previousOutpoint, `${label}: missing previousOutpoint`);
    assert.equal(typeof inp.previousOutpoint.transactionId, 'string', `${label}.previousOutpoint.transactionId must be string`);
    assert.ok(/^[0-9a-f]{64}$/.test(inp.previousOutpoint.transactionId), `${label}.previousOutpoint.transactionId must be 64-char hex`);
    assert.equal(typeof inp.previousOutpoint.index, 'number', `${label}.previousOutpoint.index must be number`);

    assertField(inp, 'signatureScript', 'string', label);
    assert.equal(typeof inp.sequence, 'string', `${label}.sequence must be string (not number)`);
    assert.equal(inp.sequence, '0', `${label}.sequence must be "0"`);
    assert.equal(typeof inp.sigOpCount, 'number', `${label}.sigOpCount must be number`);

    // utxoEntry (required for sighash computation)
    assert.ok(inp.utxoEntry, `${label}: missing utxoEntry`);
    assert.equal(typeof inp.utxoEntry.amount, 'string', `${label}.utxoEntry.amount must be string`);
    assert.ok(BigInt(inp.utxoEntry.amount) > 0n, `${label}.utxoEntry.amount must be positive`);
    assert.ok(inp.utxoEntry.scriptPublicKey, `${label}: missing utxoEntry.scriptPublicKey`);
    assert.equal(typeof inp.utxoEntry.scriptPublicKey.script, 'string', `${label}.utxoEntry.scriptPublicKey.script must be string`);
    assert.equal(typeof inp.utxoEntry.scriptPublicKey.version, 'number', `${label}.utxoEntry.scriptPublicKey.version must be number`);
    assert.equal(typeof inp.utxoEntry.blockDaaScore, 'string', `${label}.utxoEntry.blockDaaScore must be string`);
    assert.ok(BigInt(inp.utxoEntry.blockDaaScore) > 0n, `${label}.utxoEntry.blockDaaScore must be > 0 (came from real chain data)`);
    assert.equal(typeof inp.utxoEntry.isCoinbase, 'boolean', `${label}.utxoEntry.isCoinbase must be boolean`);
  }
  console.log('   ✓ all', tx.inputs.length, 'inputs pass schema check');

  // ── 5. Covenant input extra checks ───────────────────────────────────────
  console.log('5. Validating covenant inputs (P2SH + redeemScript)…');
  const covenantInputs = tx.inputs.filter((inp: any) => inp.redeemScript);
  assert.ok(covenantInputs.length > 0, 'must have at least one covenant input with redeemScript');
  for (const inp of covenantInputs) {
    const label = `covenant input ${inp.previousOutpoint.transactionId.slice(0, 12)}:${inp.previousOutpoint.index}`;
    assert.equal(typeof inp.redeemScript, 'string', `${label}: redeemScript must be string`);
    assert.ok(inp.redeemScript.length > 0, `${label}: redeemScript must not be empty`);
    // SPK must match blake2b256(redeemScript) → P2SH format
    const derivedSpk = expectedP2shScript(inp.redeemScript);
    assert.equal(
      inp.utxoEntry.scriptPublicKey.script.toLowerCase(),
      derivedSpk,
      `${label}: utxoEntry.scriptPublicKey must equal blake2b256(redeemScript) P2SH`,
    );
    // Covenant UTXO on-chain value is FIXED at 0.5 KAS
    assert.equal(
      BigInt(inp.utxoEntry.amount),
      COVENANT_OUTPUT_SOMPI,
      `${label}: utxoEntry.amount must be ${COVENANT_OUTPUT_SOMPI} (0.5 KAS fixed covenant value, not token amount)`,
    );
    console.log(`   ✓ ${label}: SPK verified, amount = ${inp.utxoEntry.amount} sompi`);
  }

  // ── 6. Output schema ──────────────────────────────────────────────────────
  console.log('6. Validating output schema…');
  assert.ok(Array.isArray(tx.outputs) && tx.outputs.length > 0, 'outputs must be non-empty array');
  for (let i = 0; i < tx.outputs.length; i++) {
    const out = tx.outputs[i];
    const label = `output[${i}]`;
    assert.equal(typeof out.value, 'string', `${label}.value must be string (not "amount")`);
    assert.ok(BigInt(out.value) > 0n, `${label}.value must be positive`);
    assert.ok(out.scriptPublicKey, `${label}: missing scriptPublicKey`);
    assert.equal(typeof out.scriptPublicKey.script, 'string', `${label}.scriptPublicKey.script must be string`);
    assert.equal(typeof out.scriptPublicKey.version, 'number', `${label}.scriptPublicKey.version must be number`);
  }
  // Every P2SH output must carry exactly 0.5 KAS
  const p2shOutputs = tx.outputs.filter((o: any) => o.scriptPublicKey.script.startsWith('aa20'));
  for (const out of p2shOutputs) {
    assert.equal(
      BigInt(out.value),
      COVENANT_OUTPUT_SOMPI,
      `P2SH output must carry exactly ${COVENANT_OUTPUT_SOMPI} sompi (0.5 KAS fixed covenant value)`,
    );
  }
  console.log('   ✓ all', tx.outputs.length, 'outputs pass schema check;', p2shOutputs.length, 'P2SH outputs carry 0.5 KAS each');

  // ── 7. Fee conservation (inSum − outSum = returned fee) ───────────────────
  console.log('7. Verifying fee conservation…');
  const inSum  = tx.inputs.reduce((s: bigint, i: any) => s + BigInt(i.utxoEntry.amount), 0n);
  const outSum = tx.outputs.reduce((s: bigint, o: any) => s + BigInt(o.value), 0n);
  const impliedFee = inSum - outSum;
  const returnedFee = BigInt(body.fee);
  assert.equal(impliedFee, returnedFee,
    `implied fee (inSum − outSum = ${impliedFee}) must equal returned fee (${returnedFee})`);
  assert.ok(impliedFee > 0n, `fee must be positive`);
  console.log(`   ✓ inSum ${inSum} − outSum ${outSum} = fee ${impliedFee} ✓`);

  // ── 8. inputIndicesToSign coverage ───────────────────────────────────────
  console.log('8. Verifying inputIndicesToSign…');
  const indices = body.inputIndicesToSign as number[];
  assert.equal(indices.length, tx.inputs.length,
    `inputIndicesToSign must cover all ${tx.inputs.length} inputs`);
  for (let i = 0; i < tx.inputs.length; i++) {
    assert.ok(indices.includes(i), `inputIndicesToSign must include index ${i}`);
  }
  console.log('   ✓ all', indices.length, 'inputs marked for signing');

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n✅ ALL ASSERTIONS PASSED — PSKT format is kaspa-wasm compatible');
  console.log('   (signPskt-compatible field names, types, covenant values, and fee accounting verified)');
}

main().catch((err) => { console.error('\n❌ TEST FAILED:', err.message); process.exit(1); });
