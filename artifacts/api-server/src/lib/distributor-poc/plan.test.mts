import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CARRIER_SOMPI, commitment, initialState, minimumKasNeeded, validatePayout,
  type Plan, type Payout, type State,
} from './plan.js';

const id = 'a'.repeat(64);
const plan: Plan = {
  tokenCovenantId: 'b'.repeat(64),
  recipients: Array.from({ length: 5 }, (_, i) => ({
    pubkey: (i + 1).toString(16).repeat(64), amount: BigInt(100 + i),
  })),
  maxFeeSompi: 5_000_000n,
  fundedKasSompi: 300_000_000n,
};

function payout(previous: State, feeSompi = 4_000_000n): Payout {
  const recipients = plan.recipients.slice(previous.cursor, previous.cursor + 3);
  const cursor = previous.cursor + recipients.length;
  const remaining = previous.remainingTokens - recipients.reduce((n, r) => n + r.amount, 0n);
  const final = cursor === plan.recipients.length;
  const tokenOutputs: Payout['tokenOutputs'] = recipients.map(r => ({
    ownerType: 'pubkey', owner: r.pubkey, amount: r.amount, carrierSompi: CARRIER_SOMPI,
  }));
  if (!final) tokenOutputs.push({
    ownerType: 'covenant-id', owner: id, amount: remaining, carrierSompi: CARRIER_SOMPI,
  });
  const kasLeft = previous.remainingKasSompi -
    BigInt(tokenOutputs.length - 1) * CARRIER_SOMPI - feeSompi;
  return {
    cursor: previous.cursor,
    tokenInput: {
      ownerType: 'covenant-id', owner: id,
      amount: previous.remainingTokens, carrierSompi: CARRIER_SOMPI,
    },
    tokenOutputs,
    nextState: final ? null : {
      commitment: previous.commitment, cursor, remainingTokens: remaining,
      remainingKasSompi: kasLeft,
    },
    refundKasSompi: final ? kasLeft : 0n,
    feeSompi,
  };
}

function reject(mutator: (p: Payout) => void, from = initialState(plan)) {
  const candidate = payout(from);
  mutator(candidate);
  assert.throws(() => validatePayout(plan, id, from, candidate));
}

test('complete five-recipient payout in two batches and refund unused KAS', () => {
  const first = initialState(plan);
  assert.equal(first.commitment, commitment(plan));
  const second = validatePayout(plan, id, first, payout(first));
  assert.ok(second);
  assert.equal(second.cursor, 3);
  assert.equal(second.remainingTokens, 103n + 104n);
  assert.equal(validatePayout(plan, id, second, payout(second)), null);
});

test('deposit must cover carriers and capped fees', () => {
  const low = { ...plan, fundedKasSompi: minimumKasNeeded(plan) - 1n };
  assert.throws(() => initialState(low), /Insufficient KAS/);
});

test('recipient substitution, overpayment, wrong order and missing payout all fail', () => {
  reject(p => { p.tokenOutputs[0].owner = 'f'.repeat(64); });
  reject(p => { p.tokenOutputs[0].amount += 1n; });
  reject(p => { [p.tokenOutputs[0], p.tokenOutputs[1]] = [p.tokenOutputs[1], p.tokenOutputs[0]]; });
  reject(p => { p.tokenOutputs.splice(1, 1); });
});

test('token diversion, missing ownership and fake carrier values fail', () => {
  reject(p => { p.tokenOutputs[3].owner = 'f'.repeat(64); });
  reject(p => { p.tokenOutputs[3].amount -= 1n; });
  reject(p => { p.tokenInput.owner = 'f'.repeat(64); });
  reject(p => { p.tokenOutputs[0].carrierSompi = 0n; });
});

test('skipped cursor, state substitution and commitment change fail', () => {
  reject(p => { p.cursor++; });
  reject(p => { p.nextState!.cursor++; });
  reject(p => { p.nextState!.remainingKasSompi -= 1n; });
  reject(p => { p.nextState!.commitment = '0'.repeat(64); });
});

test('excess fees, early refund, and final refund theft fail', () => {
  reject(p => { p.feeSompi = plan.maxFeeSompi + 1n; });
  reject(p => { p.refundKasSompi = 1n; });
  const first = initialState(plan);
  const second = validatePayout(plan, id, first, payout(first))!;
  reject(p => { p.refundKasSompi -= 1n; }, second);
  reject(p => { p.tokenOutputs.push({
    ownerType: 'pubkey', owner: 'f'.repeat(64), amount: 1n, carrierSompi: CARRIER_SOMPI,
  }); }, second);
});