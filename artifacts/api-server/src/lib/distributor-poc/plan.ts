/**
 * OFF-CHAIN SPECIFICATION ONLY.
 *
 * This module models the rules the SilverScript covenant must enforce.
 * Passing these checks in JavaScript does not secure on-chain funds.
 * Do not use this module to authorize or broadcast a deposit.
 */
import { createHash } from 'node:crypto';

export const CARRIER_SOMPI = 50_000_000n;
export const MAX_RECIPIENTS_PER_TX = 3;
const HEX32 = /^[0-9a-f]{64}$/;

export type Recipient = { pubkey: string; amount: bigint };
export type Plan = {
  tokenCovenantId: string;
  recipients: Recipient[];
  maxFeeSompi: bigint;
  fundedKasSompi: bigint;
};
export type State = {
  commitment: string;
  cursor: number;
  remainingTokens: bigint;
  remainingKasSompi: bigint;
};
export type TokenOutput = {
  ownerType: 'pubkey' | 'covenant-id';
  owner: string;
  amount: bigint;
  carrierSompi: bigint;
};
export type Payout = {
  cursor: number;
  tokenInput: { ownerType: 'covenant-id'; owner: string; amount: bigint; carrierSompi: bigint };
  tokenOutputs: TokenOutput[];
  nextState: State | null;
  refundKasSompi: bigint;
  feeSompi: bigint;
};

function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

export function commitment(plan: Plan): string {
  assert(HEX32.test(plan.tokenCovenantId), 'Token covenant ID must be 32-byte lowercase hex');
  assert(plan.recipients.length > 0, 'At least one recipient is required');
  assert(plan.maxFeeSompi >= 0n && plan.fundedKasSompi >= 0n, 'KAS amounts cannot be negative');
  for (const recipient of plan.recipients) {
    assert(HEX32.test(recipient.pubkey), 'Recipient must be a 32-byte x-only pubkey');
    assert(recipient.amount > 0n, 'Recipient token amount must be positive');
  }
  // Domain separation and explicit lengths avoid ambiguous off-chain commitments.
  const data = JSON.stringify([
    'kasdistro-distributor-poc-v1',
    plan.tokenCovenantId,
    plan.recipients.map(r => [r.pubkey, r.amount.toString()]),
    plan.maxFeeSompi.toString(),
    plan.fundedKasSompi.toString(),
  ]);
  return createHash('sha256').update(data).digest('hex');
}

export function initialState(plan: Plan): State {
  const id = commitment(plan);
  const total = plan.recipients.reduce((sum, r) => sum + r.amount, 0n);
  assert(plan.fundedKasSompi >= minimumKasNeeded(plan), 'Insufficient KAS for carriers and capped fees');
  return { commitment: id, cursor: 0, remainingTokens: total, remainingKasSompi: plan.fundedKasSompi };
}

export function batchCount(plan: Plan): number {
  return Math.ceil(plan.recipients.length / MAX_RECIPIENTS_PER_TX);
}

export function minimumKasNeeded(plan: Plan): bigint {
  // One incoming token carrier (0.5 KAS) is already in the token UTXO.
  // Intermediate change carriers are reused as the next batch's input.
  const carrierTopUp = BigInt(plan.recipients.length - 1) * CARRIER_SOMPI;
  return carrierTopUp + BigInt(batchCount(plan)) * plan.maxFeeSompi;
}

/**
 * Validate a proposed payout against the immutable plan and previous state.
 * This is an executable design for the on-chain checks, NOT a covenant VM.
 */
export function validatePayout(
  plan: Plan,
  distributorId: string,
  previous: State,
  payout: Payout,
): State | null {
  assert(HEX32.test(distributorId), 'Distributor covenant ID must be 32-byte lowercase hex');
  assert(previous.commitment === commitment(plan), 'Plan commitment mismatch');
  assert(Number.isSafeInteger(previous.cursor) && previous.cursor >= 0 &&
    previous.cursor < plan.recipients.length, 'Invalid cursor');
  assert(payout.cursor === previous.cursor, 'Skipped or repeated recipients');
  assert(payout.tokenInput.ownerType === 'covenant-id' &&
    payout.tokenInput.owner === distributorId, 'Token input not owned by distributor');
  assert(payout.tokenInput.amount === previous.remainingTokens &&
    payout.tokenInput.carrierSompi === CARRIER_SOMPI, 'Token input does not match state');

  const count = Math.min(MAX_RECIPIENTS_PER_TX, plan.recipients.length - previous.cursor);
  const nextCursor = previous.cursor + count;
  const final = nextCursor === plan.recipients.length;
  assert(payout.tokenOutputs.length === count + (final ? 0 : 1), 'Wrong number of token outputs');
  let paid = 0n;
  for (let i = 0; i < count; i++) {
    const expected = plan.recipients[previous.cursor + i];
    const actual = payout.tokenOutputs[i];
    assert(actual.ownerType === 'pubkey' && actual.owner === expected.pubkey &&
      actual.amount === expected.amount && actual.carrierSompi === CARRIER_SOMPI,
    `Recipient ${previous.cursor + i} does not match plan`);
    paid += actual.amount;
  }
  const remaining = previous.remainingTokens - paid;
  assert(remaining >= 0n, 'Token balance underflow');
  if (final) {
    assert(remaining === 0n && payout.nextState === null, 'Final batch must exhaust tokens');
  } else {
    const change = payout.tokenOutputs[count];
    assert(change.ownerType === 'covenant-id' && change.owner === distributorId &&
      change.amount === remaining && change.carrierSompi === CARRIER_SOMPI,
    'Token change must remain under distributor control');
  }
  assert(payout.feeSompi >= 0n && payout.feeSompi <= plan.maxFeeSompi,
    'Payout fee exceeds signed cap');
  const carrierTopUp = BigInt(payout.tokenOutputs.length - 1) * CARRIER_SOMPI;
  const kasLeft = previous.remainingKasSompi - carrierTopUp - payout.feeSompi;
  assert(kasLeft >= 0n, 'KAS pool exhausted');
  if (final) {
    assert(payout.refundKasSompi === kasLeft, 'Unspent KAS must be refunded');
    return null;
  }
  const expectedState: State = {
    commitment: previous.commitment,
    cursor: nextCursor,
    remainingTokens: remaining,
    remainingKasSompi: kasLeft,
  };
  assert(payout.refundKasSompi === 0n, 'No early KAS refund');
  assert(payout.nextState !== null &&
    payout.nextState.commitment === expectedState.commitment &&
    payout.nextState.cursor === expectedState.cursor &&
    payout.nextState.remainingTokens === expectedState.remainingTokens &&
    payout.nextState.remainingKasSompi === expectedState.remainingKasSompi,
  'Distributor successor state mismatch');
  return expectedState;
}