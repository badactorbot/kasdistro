import { Router } from 'express';
import { blake2b } from '@noble/hashes/blake2.js';
import { estimateTransactionFee } from '../lib/kcc20-fee.js';
import {
  getCompletedKrc20Snapshot,
  startKrc20Index,
  BURN_ADDRESS as KRC20_BURN_ADDRESS,
} from '../lib/krc20-indexer.js';

const router = Router();

const KRON_IDX   = 'https://idx.kron.technology';
const KASPA_API  = 'https://api.kaspa.org';
const KASPLEX_API = 'https://api.kasplex.org/v1';
const KCC20_API = 'https://kcc20.info';
const KRON_API = 'https://api.kron.technology';
const KRON_INDEXER_API = 'https://idx.kron.technology/v1/kcc20';
const HOLDER_PAGE_LIMIT = 1000;
const KASPA_BURN_ADDRESS = 'kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx9awp4e';

// The KAS distributor keeps its token-holder lookup, but no token payout bot.
router.use(['/kcc20/*path', '/build-kcc20-transfer'], (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
function isEligibleHolderAddress(address: unknown): address is string {
  return typeof address === 'string'
    && address.startsWith('kaspa:')
    && address !== KASPA_BURN_ADDRESS;
}

function upstreamErrorMessage(data: any, fallback: string): string {
  const error = data?.detail ?? data?.error ?? data?.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  if (typeof error?.code === 'string' && error.code.trim()) return error.code;
  return fallback;
}

async function fetchKronRegistryToken(tokenId: string): Promise<{ tick: string } | null> {
  const response = await fetch(`${KRON_API}/api/registry/tokens`, {
    headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('KRON token registry lookup failed.');
  const data: any = await response.json();
  const token = (Array.isArray(data?.tokens) ? data.tokens : []).find((entry: any) =>
    [entry?.covenantId, entry?.cp?.tokenCovid, entry?.native?.tokenCovid]
      .some(value => typeof value === 'string' && value.toLowerCase() === tokenId));
  return typeof token?.tick === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(token.tick)
    ? { tick: token.tick.toUpperCase() }
    : null;
}

async function fetchKronHolderAddresses(tokenId: string) {
  const registryToken = await fetchKronRegistryToken(tokenId);
  if (!registryToken) return null;

  const ticker = registryToken.tick;
  const encodedTicker = encodeURIComponent(ticker);
  // KRON defaults to 50 holders per response. Exhaust the paginated list
  // before building a recipient set; a single successful page is not a snapshot.
  const pageSize = 50;
  const holderRows: any[] = [];
  const seenAddresses = new Set<string>();
  let reportedHolderCount: number | null = null;
  let exhausted = false;
  for (let offset = 0; offset < 50000; offset += pageSize) {
    const holdersResponse = await fetch(
      `${KRON_INDEXER_API}/token/${encodedTicker}/holders?limit=${pageSize}&offset=${offset}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' } },
    );
    const holdersData: any = await holdersResponse.json();
    if (!holdersResponse.ok) {
      throw new Error(upstreamErrorMessage(holdersData, `KRON holder lookup failed for ${ticker}.`));
    }
    if (!Array.isArray(holdersData?.result)) {
      throw new Error(`KRON returned an invalid holder page for ${ticker}.`);
    }
    const pageCount = Number(holdersData.holderTotal);
    if (Number.isSafeInteger(pageCount) && pageCount >= 0) {
      if (reportedHolderCount !== null && reportedHolderCount !== pageCount) {
        throw new Error(`KRON holder count changed while importing ${ticker}. Please retry.`);
      }
      reportedHolderCount = pageCount;
    }
    for (const holder of holdersData.result) {
      if (typeof holder?.address !== 'string' || seenAddresses.has(holder.address)) {
        throw new Error(`KRON returned duplicate or invalid holder records for ${ticker}. Please retry.`);
      }
      seenAddresses.add(holder.address);
      holderRows.push(holder);
    }
    if (holdersData.result.length < pageSize) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) throw new Error(`KRON holder list for ${ticker} exceeded the import limit.`);

  const tokenResponse = await fetch(`${KRON_INDEXER_API}/token/${encodedTicker}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' },
  });
  const tokenData: any = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(upstreamErrorMessage(tokenData, `KRON token lookup failed for ${ticker}.`));
  }

  const tokenRow = Array.isArray(tokenData?.result) ? tokenData.result[0] : tokenData?.result;
  const expectedHolderCount = Number(tokenRow?.holderTotal);
  const ordinaryHolders = holderRows.filter(holder => !holder.address.startsWith('covenant:'));
  if (!Number.isSafeInteger(expectedHolderCount) || expectedHolderCount < 0 ||
    (reportedHolderCount !== null && reportedHolderCount !== expectedHolderCount) ||
    ordinaryHolders.length !== expectedHolderCount) {
    throw new Error(
      `KRON reports ${expectedHolderCount.toLocaleString()} holders for ${ticker}, but its indexer returned ${ordinaryHolders.length.toLocaleString()} ordinary holders. Import was stopped to prevent a partial distribution.`,
    );
  }

  const eligible = holderRows.filter((holder: any) => isEligibleHolderAddress(holder?.address));
  if (eligible.some((holder: any) => !/^[1-9][0-9]*$/.test(String(holder?.balance ?? '')))) {
    throw new Error(`KRON returned an invalid holder balance for ${ticker}.`);
  }
  const addresses = [...new Set(eligible.map((holder: any) => holder.address))];
  const excludedCovenantHolders = holderRows.filter(
    (holder: any) => typeof holder?.address === 'string' && holder.address.startsWith('covenant:'),
  ).length;
  const excludedBurnAddresses = holderRows.filter(
    (holder: any) => holder?.address === KASPA_BURN_ADDRESS,
  ).length;

  return {
    ticker,
    addresses,
    balances: eligible.map((holder: any) => ({ address: holder.address, balance: String(holder.balance) })),
    holderRecords: holderRows.length,
    excludedCovenantHolders,
    excludedBurnAddresses,
    graduated: tokenRow?.graduated === true,
  };
}

// ── Bech32 helpers (same charset as kaspa.ts) ────────────────────────────────
const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHECKSUM_LEN = 8;

/** Decode a Kaspa bech32 address → 32-byte x-only public key. */
function addrToPubkey(address: string): Uint8Array {
  const colonIdx = address.indexOf(':');
  if (colonIdx === -1) throw new Error(`Invalid address (no colon): ${address}`);
  const payload = address.slice(colonIdx + 1);
  if (payload.length <= CHECKSUM_LEN) throw new Error(`Address payload too short: ${address}`);

  const quintets: number[] = [];
  for (const c of payload.slice(0, -CHECKSUM_LEN)) {
    const v = BECH32_CHARS.indexOf(c);
    if (v < 0) throw new Error(`Invalid bech32 character "${c}" in address "${address}"`);
    quintets.push(v);
  }

  let acc = 0, bits = 0;
  const bytes: number[] = [];
  for (const q of quintets) {
    acc = (acc << 5) | q;
    bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  // bytes[0] = version byte (0 = PubKey), bytes[1..32] = 32-byte Schnorr pubkey
  if (bytes.length < 33) throw new Error(`Address decode too short for: ${address}`);
  return new Uint8Array(bytes.slice(1, 33));
}

// ── KCC-20 covenant helpers ───────────────────────────────────────────────────

/**
 * Compute blake2b-256 (32-byte output variant) of data.
 * Kaspa uses this for P2SH script hashing.
 */
function blake2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

/**
 * Build a Kaspa P2SH scriptPublicKey from a redeemScript.
 * Format: 0xaa(OP_BLAKE2B) 0x20(push32) <blake2b256(redeemScript)> 0x87(OP_EQUAL)
 */
function p2shScript(redeemScript: Uint8Array): string {
  const hash = blake2b256(redeemScript);
  const out = new Uint8Array(35);
  out[0] = 0xaa;   // OP_BLAKE2B (Kaspa-specific opcode)
  out[1] = 0x20;   // OP_DATA_32
  out.set(hash, 2);
  out[34] = 0x87;  // OP_EQUAL
  return Buffer.from(out).toString('hex');
}

/**
 * Derive a new KRON redeemScript for a given recipient pubkey and token amount.
 *
 * KRON state (stateStart = 0, stateLen = 46 bytes):
 *   [0]      = 0x20  (OP_DATA_32 — marks pubkey push)
 *   [1..32]  = 32-byte owner pubkey
 *   [33]     = 0x01  (OP_DATA_1 — marks type push)
 *   [34]     = type byte
 *   [35]     = 0x08  (OP_DATA_8 — marks amount push)
 *   [36..43] = amount as little-endian uint64
 *   [44]     = 0x01  (OP_DATA_1 — marks isMinter push)
 *   [45]     = isMinter byte
 *   [46..]   = 2387-byte covenant body (identical for all KRON UTXOs of same version)
 */
function materializeScript(template: Uint8Array, recipientPubkey: Uint8Array, amount: bigint): Uint8Array {
  const s = new Uint8Array(template);
  const e = 0; // stateStart

  // Validate expected structure so we fail fast if layout ever changes
  if (s[e] !== 0x20 || s[e + 33] !== 0x01 || s[e + 35] !== 0x08 || s[e + 44] !== 0x01) {
    throw new Error(`Unexpected KCC-20 state layout — header bytes don't match expected KRON format`);
  }

  // Replace owner pubkey (bytes 1..32)
  s.set(recipientPubkey, e + 1);

  // Replace amount (bytes 36..43, little-endian uint64)
  let v = amount;
  for (let i = 0; i < 8; i++) { s[e + 36 + i] = Number(v & 0xffn); v >>= 8n; }

  return s;
}

// ── Bech32 ENCODING (for deriving P2SH addresses) ────────────────────────────
// Kaspa cashaddr-style checksum polymod (verified round-trip against real addresses).
function bech32Polymod(values: number[]): bigint {
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    if (c0 & 0x01n) c ^= 0x98f2bc8e61n;
    if (c0 & 0x02n) c ^= 0x79b76d99e2n;
    if (c0 & 0x04n) c ^= 0xf33e5fb3c4n;
    if (c0 & 0x08n) c ^= 0xae2eabe2a8n;
    if (c0 & 0x10n) c ^= 0x1e4f43e470n;
  }
  return c ^ 1n;
}

function to5bit(bytes: number[] | Uint8Array): number[] {
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

/** Encode a Kaspa address from version byte + hash. Version 8 = ScriptHash (P2SH). */
function encodeKaspaAddress(version: number, hash: Uint8Array, prefix = 'kaspa'): string {
  const data5 = to5bit([version, ...hash]);
  const prefix5 = [...prefix].map((c) => c.charCodeAt(0) & 0x1f);
  const cs = bech32Polymod([...prefix5, 0, ...data5, 0, 0, 0, 0, 0, 0, 0, 0]);
  let s = '';
  for (const d of data5) s += BECH32_CHARS[d];
  for (let i = 0; i < 8; i++) s += BECH32_CHARS[Number((cs >> BigInt(5 * (7 - i))) & 31n)];
  return `${prefix}:${s}`;
}

// ── Fee constant ──────────────────────────────────────────────────────────────

// Every KRON covenant UTXO carries a fixed 0.5 KAS regardless of token amount
// (the token amount lives in the redeemScript state, not in the output value).
// Verified against on-chain data: all holder UTXOs = 50,000,000 sompi.
const COVENANT_OUTPUT_SOMPI = 50_000_000n; // 0.5 KAS

// estimateTransactionFee is imported from ../lib/kcc20-fee.js

// ── Routes ───────────────────────────────────────────────────────────────────

// Read-only token identity lookup for outgoing distribution previews.
router.get('/token-info/:tokenId', async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.tokenId) ? req.params.tokenId[0] : req.params.tokenId;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    res.status(400).json({ error: 'Enter a 64-character KCC-20 token ID.' });
    return;
  }
  const tokenId = raw.toLowerCase();
  try {
    const response = await fetch(`${KCC20_API}/v1/tokens/${tokenId}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const metadata: any = await response.json();
      if (metadata?.token_id?.toLowerCase() !== tokenId ||
        typeof metadata?.ticker !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(metadata.ticker)) {
        res.status(502).json({ error: 'Token service returned mismatched or incomplete token identity.' });
        return;
      }
      res.json({ protocol: 'KCC-20', identifier: tokenId, ticker: metadata.ticker.toUpperCase() });
      return;
    }
    if (response.status !== 404) {
      res.status(502).json({ error: 'KCC-20 token lookup is unavailable. Try again later.' });
      return;
    }
    const kronToken = await fetchKronRegistryToken(tokenId);
    if (!kronToken) {
      res.status(404).json({ error: 'Outgoing KCC-20 token ID was not found.' });
      return;
    }
    res.json({ protocol: 'KCC-20', identifier: tokenId, ticker: kronToken.tick });
  } catch (error) {
    req.log.warn({ error }, 'Outgoing token lookup failed');
    res.status(502).json({ error: 'Could not verify outgoing token ID. Try again later.' });
  }
});

// Resolve current token holders into ordinary Kaspa recipient addresses.
// A 64-hex identifier is treated as a KCC-20 token ID; all other valid
// identifiers are treated as KRC-20 tickers.
router.get('/token-holders/:identifier', async (req, res) => {
  const identifier = req.params.identifier.trim();
  const isKcc20 = /^[0-9a-fA-F]{64}$/.test(identifier);
  const isKrc20 = /^[a-zA-Z0-9]{1,32}$/.test(identifier);

  if (!isKcc20 && !isKrc20) {
    const isEvmContract = /^0x[0-9a-fA-F]{40}$/.test(identifier);
    res.status(400).json({
      error: isEvmContract
        ? 'This is an EVM contract address, not a Kaspa L1 KRC-20 ticker. Enter the token ticker shown by Kasplex, such as NACHO.'
        : 'Enter a KRC-20 ticker or a 64-character KCC-20 token ID.',
    });
    return;
  }

  try {
    if (isKcc20) {
      const tokenId = identifier.toLowerCase();
      const addressSet = new Set<string>();
      const balanceRows = new Map<string, string>();
      const seenCursors = new Set<string>();
      let cursor = '';
      let validationStatus: string | null = null;
      let sourceDaa: string | null = null;
      let excludedBurnAddresses = 0;

      do {
        const query = new URLSearchParams({ limit: String(HOLDER_PAGE_LIMIT) });
        if (cursor) query.set('after_owner', cursor);
        const upstream = await fetch(
          `${KCC20_API}/v1/tokens/${tokenId}/holders?${query}`,
          { headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' } },
        );
        const data: any = await upstream.json();

        if (!upstream.ok) {
          const upstreamCode = data?.error?.code;
          if (upstream.status === 404 && upstreamCode === 'not_found') {
            const kronHolders = await fetchKronHolderAddresses(tokenId);
            if (kronHolders) {
              res.json({
                protocol: 'KCC-20',
                identifier: tokenId,
                ticker: kronHolders.ticker,
                addresses: kronHolders.addresses,
                balances: kronHolders.balances,
                imported: kronHolders.addresses.length,
                hasMore: false,
                validationStatus: 'chain_verified',
                source: 'KRON indexer',
                holderRecords: kronHolders.holderRecords,
                excludedCovenantHolders: kronHolders.excludedCovenantHolders,
                excludedBurnAddresses: kronHolders.excludedBurnAddresses,
                graduated: kronHolders.graduated,
              });
              return;
            }
          }
          res.status(upstream.status).json({
            error: upstreamErrorMessage(data, 'KCC-20 holder lookup failed.'),
          });
          return;
        }

        const pageStatus = String(data?.validation?.status ?? '').toLowerCase();
        if (!['valid', 'validated', 'complete', 'template_verified', 'verified'].includes(pageStatus)) {
          res.status(409).json({
            error: `KCC-20 indexer validation status is "${pageStatus || 'missing'}". Holder import was stopped.`,
          });
          return;
        }
        const pageDaa = data?.validation?.source_daa;
        if (pageDaa == null || (sourceDaa !== null && String(pageDaa) !== sourceDaa)) {
          throw new Error('Holder snapshot changed during pagination; import stopped.');
        }
        validationStatus = pageStatus;
        sourceDaa = String(pageDaa);

        if (!Array.isArray(data?.holders)) throw new Error('Holder service returned an invalid page.');
        for (const holder of data.holders) {
          if (holder?.address === KASPA_BURN_ADDRESS) {
            excludedBurnAddresses += 1;
          }
          if (isEligibleHolderAddress(holder?.address)) {
            if (!/^[1-9][0-9]*$/.test(String(holder.balance ?? '')) ||
                balanceRows.has(holder.address)) throw new Error('Holder balances are invalid or repeated; import stopped.');
            addressSet.add(holder.address);
            balanceRows.set(holder.address, String(holder.balance));
          }
        }

        const nextCursor = typeof data?.next_cursor === 'string' ? data.next_cursor : '';
        if (!nextCursor) break;
        if (seenCursors.has(nextCursor) || nextCursor === cursor) throw new Error('Holder pagination repeated; import stopped.');
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } while (cursor);

      const addresses = [...addressSet];
      // Holder pagination contains addresses but no token identity. Resolve the
      // ticker from metadata for clients that distribute the imported token.
      // A metadata outage must not make the existing KAS holder import fail.
      let ticker: string | null = null;
      try {
        const metadataResponse = await fetch(`${KCC20_API}/v1/tokens/${tokenId}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        if (metadataResponse.ok) {
          const metadata: any = await metadataResponse.json();
          if (
            metadata?.token_id?.toLowerCase() === tokenId
            && typeof metadata.ticker === 'string'
            && /^[a-zA-Z0-9]{1,32}$/.test(metadata.ticker)
          ) {
            ticker = metadata.ticker.toUpperCase();
          }
        }
      } catch (error) {
        req.log.warn({ error }, 'KCC-20 token ticker lookup unavailable');
      }

      res.json({
        protocol: 'KCC-20',
        identifier: tokenId,
        ticker,
        addresses,
        balances: addresses.map(address => ({ address, balance: balanceRows.get(address)! })),
        imported: addresses.length,
        hasMore: false,
        validationStatus,
        sourceDaa,
        excludedBurnAddresses,
      });
      return;
    }

    const ticker = identifier.toUpperCase();
    const upstream = await fetch(
      `${KASPLEX_API}/krc20/token/${encodeURIComponent(ticker)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'kasdistro/1.0' } },
    );
    const data: any = await upstream.json();

    if (!upstream.ok || data?.message !== 'successful') {
      res.status(upstream.ok ? 404 : upstream.status).json({
        error: data?.message || data?.error || 'KRC-20 holder lookup failed.',
      });
      return;
    }

    const token = Array.isArray(data?.result) ? data.result[0] : null;
    if (!token || !['deployed', 'finished'].includes(token.state)) {
      res.status(404).json({ error: `KRC-20 token "${ticker}" was not found.` });
      return;
    }
    const holderRows = Array.isArray(token?.holder) ? token.holder : [];
    const positiveHolderRows = holderRows.filter((holder: any) => {
      try {
        return BigInt(holder?.amount ?? '0') > 0n;
      } catch {
        return false;
      }
    });
    const addresses = [...new Set(
      positiveHolderRows
        .map((holder: any) => holder.address)
        .filter(isEligibleHolderAddress),
    )];
    const total = Number(token?.holderTotal ?? addresses.length);

    const providerIsPartial = Number.isFinite(total) && total > positiveHolderRows.length;
    let snapshot = {
      addresses,
      excludedBurnAddresses: holderRows.filter(
        (holder: any) => holder?.address === KASPA_BURN_ADDRESS || holder?.address === KRC20_BURN_ADDRESS,
      ).length,
    };

    if (providerIsPartial) {
      let job;
      try {
        job = await startKrc20Index(ticker, total);
      } catch (error: any) {
        res.status(502).json({
          error: 'Complete KRC-20 holder indexing is unavailable.',
          detail: error?.message,
        });
        return;
      }
      if (job.status === 'failed') {
        res.status(502).json({
          error: `Complete KRC-20 holder indexing failed for ${ticker}.`,
          detail: job.last_error,
        });
        return;
      }
      if (job.status !== 'completed') {
        res.status(202).json({
          protocol: 'KRC-20',
          identifier: ticker,
          error: `Kasplex exposes only its top ${addresses.length.toLocaleString()} of ${total.toLocaleString()} holders. Complete holder indexing is in progress; no partial addresses were imported.`,
          indexing: true,
          providerLimited: true,
          totalHolders: total,
          expectedHolders: total,
          retryAfterMs: 2000,
          processedOperations: job.processed_operations,
          status: job.status,
        });
        return;
      }
      snapshot = await getCompletedKrc20Snapshot(ticker);
    }

    const completeAddresses = snapshot.addresses;
    const excludedBurnAddresses = snapshot.excludedBurnAddresses;
    if (Number.isFinite(total) && completeAddresses.length + excludedBurnAddresses !== total) {
      res.status(409).json({
        error: `Complete holder index for ${ticker} resolved ${completeAddresses.length.toLocaleString()} eligible addresses and ${excludedBurnAddresses.toLocaleString()} burn holders, but Kasplex reports ${total.toLocaleString()}. Import was stopped.`,
        indexing: true,
        totalHolders: total,
      });
      return;
    }
    res.json({
      protocol: 'KRC-20',
      identifier: ticker,
      addresses: completeAddresses,
      imported: completeAddresses.length,
      hasMore: false,
      totalHolders: Number.isFinite(total) ? total : null,
      excludedBurnAddresses,
    });
  } catch (err: any) {
    res.status(502).json({
      error: 'Token holder indexer is currently unavailable.',
      detail: err?.message,
    });
  }
});

// Proxy for Kasplex KRC-20 indexer — api.kasplex.org blocks direct browser
// requests (CORS / rate-limit → 403). All Kasplex calls must go through here.
router.get('/kasplex/*path', async (req, res) => {
  const subpath = Array.isArray(req.params.path)
    ? req.params.path.join('/')
    : (req.params as any).path as string;
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  try {
    const upstream_res = await fetch(`${KASPLEX_API}/${subpath}${qs}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'kaspa-disperse/1.0' },
    });
    const body = await upstream_res.text();
    res.status(upstream_res.status).set('Content-Type', 'application/json').send(body);
  } catch (err: any) {
    res.status(502).json({ error: `Kasplex proxy error: ${err?.message}` });
  }
});

// Proxy for Kron KCC-20 indexer — CORS on idx.kron.technology is locked
// to kron.technology only, so the browser cannot call it directly.
router.get('/kcc20/address/:address/tokenlist', async (req, res) => {
  const { address } = req.params;
  try {
    const upstream = await fetch(
      `${KRON_IDX}/v1/kcc20/address/${encodeURIComponent(address)}/tokenlist`,
    );
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: 'Failed to reach Kron indexer', detail: err?.message });
  }
});

// Proxy for KCC-20 UTXO list (browser can't hit Kron indexer directly due to CORS)
router.get('/kcc20/token/:tick/address/:address/utxos', async (req, res) => {
  const { tick, address } = req.params;
  try {
    const upstream = await fetch(
      `${KRON_IDX}/v1/kcc20/token/${encodeURIComponent(tick)}/address/${encodeURIComponent(address)}/utxos`,
    );
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: 'Failed to reach Kron indexer', detail: err?.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/kron/build-kcc20-transfer
//
// Builds a KCC-20 (covenant-based) token transfer in the flat Safe JSON
// format accepted by KasWare's Transaction.deserializeFromSafeJSON().
//
// Body:
//   senderAddress  – kaspa:q... address of the sender
//   recipients     – [{ address: "kaspa:q...", amount: "200" }, ...]
//                    amount is in raw KCC-20 units (dec=0 for KRON → integer)
//   tick           – token ticker, e.g. "KRON"
//
// Response:
//   txJsonString        – serialized transaction JSON for signPskt
//   inputIndicesToSign  – array of input indices the user must sign
//   fee                 – KAS fee in sompi (string)
//   totalAmount         – total token units sent (string)
// ---------------------------------------------------------------------------
router.post('/build-kcc20-transfer', async (req, res) => {
  try {
    const { senderAddress, recipients, tick, excludedOutpoints = [] } = req.body as {
      senderAddress: string;
      recipients: Array<{ address: string; amount: string }>;
      tick: string;
      excludedOutpoints?: Array<{ transactionId: string; index: number }>;
    };

    if (!senderAddress || !Array.isArray(recipients) || !recipients.length || !tick) {
      return res.status(400).json({ error: 'senderAddress, recipients, and tick are required' });
    }
    // Two recipients leave room for both token and KAS change within the
    // covenant's four-output ceiling.
    if (recipients.length > 2 || !/^[a-zA-Z0-9]{1,32}$/.test(tick) ||
      recipients.some(r => !r || !/^kaspa:[a-z0-9]+$/.test(r.address) ||
        !/^[1-9]\d*$/.test(r.amount) || BigInt(r.amount) > 18446744073709551615n) ||
      !Array.isArray(excludedOutpoints) || excludedOutpoints.some(o =>
        !o || !/^[a-fA-F0-9]{64}$/.test(o.transactionId) || !Number.isSafeInteger(o.index) || o.index < 0)) {
      return res.status(400).json({ error: 'Invalid KCC-20 transfer: use up to 2 mainnet recipients with positive whole-token amounts.' });
    }
    const excluded = new Set(excludedOutpoints.map(o => `${o.transactionId.toLowerCase()}:${o.index}`));
    const available = (u: any) => !excluded.has(
      `${String(u.outpoint?.transactionId ?? u.transactionId ?? '').toLowerCase()}:${Number(u.outpoint?.index ?? u.index ?? 0)}`,
    );

    // ── 1. Fetch KCC-20 UTXOs for sender ──────────────────────────────────
    const kronResp = await fetch(
      `${KRON_IDX}/v1/kcc20/token/${encodeURIComponent(tick)}/address/${encodeURIComponent(senderAddress)}/utxos`,
    );
    if (!kronResp.ok) {
      return res.status(502).json({ error: `Kron indexer returned ${kronResp.status} for UTXO list` });
    }
    const kronData = await kronResp.json() as any;
    const kcc20Utxos: any[] = (Array.isArray(kronData.result) ? kronData.result : (Array.isArray(kronData) ? kronData : [])).filter(available);

    if (kcc20Utxos.length === 0) {
      return res.status(400).json({ error: `No ${tick} UTXOs found for ${senderAddress}` });
    }

    // ── 2. Calculate total token amount needed ────────────────────────────
    const totalNeeded = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);

    // ── 3. Select KCC-20 UTXOs (FIFO) ────────────────────────────────────
    const selectedKron: any[] = [];
    let selectedTotal = 0n;
    for (const u of kcc20Utxos) {
      selectedKron.push(u);
      selectedTotal += BigInt(u.amount ?? u.utxoEntry?.amount ?? 0);
      if (selectedTotal >= totalNeeded) break;
    }
    if (selectedTotal < totalNeeded) {
      return res.status(400).json({
        error: `Insufficient ${tick} balance (have ${selectedTotal}, need ${totalNeeded})`,
      });
    }

    // ── 4. Get template redeemScript from first UTXO ─────────────────────
    const templateHex: string = kcc20Utxos[0].redeemScriptHex ?? kcc20Utxos[0].script ?? '';
    if (!templateHex) {
      return res.status(502).json({ error: 'Kron indexer did not return redeemScriptHex for UTXO' });
    }
    const template = Buffer.from(templateHex, 'hex');

    // ── 4b. Fetch authoritative on-chain UTXO entries for covenant inputs ─
    // The Kron indexer's `amount` is the TOKEN amount; the actual on-chain
    // output value is fixed at 0.5 KAS. We need the real sompi amount and
    // blockDaaScore for a correct sighash, so query the Kaspa API via the
    // covenant's derived P2SH address.
    const covenantEntries = await Promise.all(
      selectedKron.map(async (u) => {
        const redeemHex: string = u.redeemScriptHex ?? u.script ?? '';
        if (!redeemHex) throw new Error('Kron indexer did not return redeemScriptHex for a selected UTXO');
        const redeem = Buffer.from(redeemHex, 'hex');
        const p2shAddr = encodeKaspaAddress(8, blake2b256(redeem));
        const r = await fetch(`${KASPA_API}/addresses/${encodeURIComponent(p2shAddr)}/utxos`);
        if (!r.ok) throw new Error(`Kaspa API returned ${r.status} for covenant UTXO lookup`);
        const list = await r.json() as any[];
        const txId: string = u.outpoint?.transactionId ?? u.transactionId ?? '';
        const idx: number = u.outpoint?.index ?? 0;
        const match = (Array.isArray(list) ? list : []).find(
          (x: any) => x.outpoint?.transactionId === txId && Number(x.outpoint?.index) === idx,
        );
        if (!match) {
          throw new Error(`Covenant UTXO ${txId.slice(0, 12)}…:${idx} not found on-chain (may be spent or not yet indexed)`);
        }
        const spkRaw = match.utxoEntry?.scriptPublicKey;
        return {
          txId,
          index: idx,
          redeemScriptHex: redeemHex,
          amountSompi: BigInt(match.utxoEntry?.amount ?? 0),
          scriptPublicKeyHex: typeof spkRaw === 'string' ? spkRaw : (spkRaw?.scriptPublicKey ?? spkRaw?.script ?? ''),
          blockDaaScore: String(match.utxoEntry?.blockDaaScore ?? '0'),
          isCoinbase: Boolean(match.utxoEntry?.isCoinbase ?? false),
        };
      }),
    );
    const covenantInSompi = covenantEntries.reduce((s, e) => s + e.amountSompi, 0n);

    // ── 5. Fetch sender's KAS UTXOs (for fee payment) ─────────────────────
    const kasResp = await fetch(
      `${KASPA_API}/addresses/${encodeURIComponent(senderAddress)}/utxos`,
    );
    if (!kasResp.ok) {
      return res.status(502).json({ error: `Kaspa API returned ${kasResp.status} for KAS UTXOs` });
    }
    const kasUtxos = await kasResp.json() as any[];

    // Prefer a single UTXO large enough for the fee (simplest transaction).
    // If none qualifies, combine the largest UTXOs until we have enough.
    const sortedKas = kasUtxos.filter(available).sort((a, b) => {
      const diff = BigInt(b.utxoEntry?.amount ?? 0) - BigInt(a.utxoEntry?.amount ?? 0);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    // ── 6. Determine required KAS (dynamic fee) ───────────────────────────
    // Every covenant output must carry 0.5 KAS. Covenant inputs contribute
    // their own 0.5 KAS each, so the sender's KAS UTXOs must cover:
    //   fee + (covenant outputs × 0.5 KAS) − (covenant inputs' sompi)
    //
    // The fee depends on the number of inputs, which depends on the fee — so
    // we iterate: start with zero KAS inputs, select UTXOs to cover the
    // requirement, recompute fee with actual count, repeat. Converges in ≤ 3
    // passes for typical dispersals; MAX_PASSES is a safety cap.
    const changeAmount = selectedTotal - totalNeeded;
    const numCovenantOutputs = recipients.length + (changeAmount > 0n ? 1 : 0);
    const covenantOutSompi = BigInt(numCovenantOutputs) * COVENANT_OUTPUT_SOMPI;

    // redeemScript length is constant for all KRON UTXOs of the same version.
    const redeemScriptLen = template.length;

    let feeUtxos: any[] = [];
    let feeTotal = 0n;
    let dynamicFee = 0n;
    // Best estimate of the KAS-change output value for storage-mass calculation.
    // Starts at COVENANT_OUTPUT_SOMPI (0.5 KAS); refined each pass so KIP-0009
    // storage mass reflects the real output value rather than a fixed placeholder.
    let changeEst = COVENANT_OUTPUT_SOMPI;
    // Sticky fold flag: once we decide the change output cannot pay its own
    // incremental relay cost (or the inputs cannot fund the with-change tx),
    // we permanently switch to the output-less path.
    let omitChange = false;

    /** Helper: select KAS UTXOs to meet a sompi requirement. */
    function selectKasUtxos(required: bigint): { utxos: any[]; total: bigint } {
      if (required <= 0n) return { utxos: [], total: 0n };
      const single = sortedKas.find((u: any) => BigInt(u.utxoEntry?.amount ?? 0) >= required);
      if (single) return { utxos: [single], total: BigInt(single.utxoEntry?.amount ?? 0) };
      let utxos: any[] = [], total = 0n;
      for (const u of sortedKas) {
        utxos.push(u);
        total += BigInt(u.utxoEntry?.amount ?? 0);
        if (total >= required) break;
      }
      return { utxos, total };
    }

    // Iterate until UTXO count, fold decision, and change estimate are stable.
    const MAX_PASSES = 30;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const prevCount              = feeUtxos.length;
      const prevChangeEst          = changeEst;
      const prevOmitChange: boolean = omitChange;

      const kasInputValuesEst = feeUtxos.map((u: any) => BigInt(u.utxoEntry?.amount ?? 0));

      // Estimate fee for the current candidate (with or without change output).
      const outputValuesEst: bigint[] = [
        ...Array<bigint>(numCovenantOutputs).fill(COVENANT_OUTPUT_SOMPI),
        ...(!omitChange && changeEst > 0n ? [changeEst] : []),
      ];
      dynamicFee = estimateTransactionFee(
        covenantEntries.length, redeemScriptLen, kasInputValuesEst, outputValuesEst,
      );

      const requiredKas = dynamicFee + covenantOutSompi - covenantInSompi;

      if (requiredKas <= 0n) {
        // Covenant inputs carry enough KAS to fund the fee and all outputs —
        // no extra KAS UTXOs needed.
        feeUtxos = [];
        feeTotal = 0n;
      } else {
        // Try to select KAS UTXOs for the current path.
        ({ utxos: feeUtxos, total: feeTotal } = selectKasUtxos(requiredKas));

        if (feeTotal < requiredKas) {
          if (omitChange) {
            // Already on the no-change path — genuine insufficiency.
            return res.status(400).json({
              error: `Insufficient KAS — need ≥${Number(requiredKas) / 1e8} KAS (fee + 0.5 KAS per covenant output), have ${Number(feeTotal) / 1e8} KAS`,
            });
          }
          // With-change path cannot be funded. Try the no-change path: the
          // change output's relay cost is avoided, reducing the requirement.
          const feeNC = estimateTransactionFee(
            covenantEntries.length, redeemScriptLen, kasInputValuesEst,
            Array<bigint>(numCovenantOutputs).fill(COVENANT_OUTPUT_SOMPI),
          );
          const requiredNC = feeNC + covenantOutSompi - covenantInSompi;
          const sel = selectKasUtxos(requiredNC > 0n ? requiredNC : 0n);
          if (sel.total >= (requiredNC > 0n ? requiredNC : 0n)) {
            // No-change path is viable — switch permanently.
            omitChange = true;
            changeEst  = 0n;
            dynamicFee = feeNC;
            feeUtxos   = sel.utxos;
            feeTotal   = sel.total;
          } else {
            return res.status(400).json({
              error: `Insufficient KAS — need ≥${Number(requiredKas) / 1e8} KAS (fee + 0.5 KAS per covenant output), have ${Number(feeTotal) / 1e8} KAS`,
            });
          }
        }
      }

      // Determine the updated change estimate and check the dynamic fold condition.
      if (!omitChange) {
        const rawChange = feeTotal + covenantInSompi - covenantOutSompi - dynamicFee;
        if (rawChange <= 0n) {
          omitChange = true;
          changeEst  = 0n;
        } else {
          // Check whether the change output can cover its own incremental relay
          // cost.  If not, fold it into the fee permanently.
          const kasInputsForFold = feeUtxos.map((u: any) => BigInt(u.utxoEntry?.amount ?? 0));
          const feeNC = estimateTransactionFee(
            covenantEntries.length, redeemScriptLen, kasInputsForFold,
            Array<bigint>(numCovenantOutputs).fill(COVENANT_OUTPUT_SOMPI),
          );
          const incrementalFee = dynamicFee > feeNC ? dynamicFee - feeNC : 0n;
          if (rawChange <= incrementalFee) {
            omitChange = true;
            changeEst  = 0n;
          } else {
            changeEst = rawChange;
          }
        }
      }

      // Converge when UTXO count, fold decision, and change estimate are stable.
      if (feeUtxos.length === prevCount && omitChange === prevOmitChange && changeEst === prevChangeEst) break;
    }

    // ── Mandatory post-loop fixed-point verification ───────────────────────
    // Recompute the fee for the final input/output counts and change estimate.
    // The loop may exit at MAX_PASSES with a stale dynamicFee; this ensures
    // the verified fee is always consistent with the selected UTXOs.
    {
      const kasInputValuesFinal = feeUtxos.map((u: any) => BigInt(u.utxoEntry?.amount ?? 0));
      const outputValuesFinal: bigint[] = [
        ...Array<bigint>(numCovenantOutputs).fill(COVENANT_OUTPUT_SOMPI),
        ...(!omitChange && changeEst > 0n ? [changeEst] : []),
      ];
      dynamicFee = estimateTransactionFee(
        covenantEntries.length, redeemScriptLen, kasInputValuesFinal, outputValuesFinal,
      );
      const requiredFinal = dynamicFee + covenantOutSompi - covenantInSompi;
      if (requiredFinal > 0n && feeTotal < requiredFinal) {
        // Last resort: try the no-change path.
        if (!omitChange) {
          const feeNCFinal = estimateTransactionFee(
            covenantEntries.length, redeemScriptLen, kasInputValuesFinal,
            Array<bigint>(numCovenantOutputs).fill(COVENANT_OUTPUT_SOMPI),
          );
          const reqNCFinal = feeNCFinal + covenantOutSompi - covenantInSompi;
          if (reqNCFinal <= 0n || feeTotal >= reqNCFinal) {
            omitChange = true;
            dynamicFee = feeNCFinal;
          } else {
            return res.status(400).json({
              error: `Insufficient KAS — need ≥${Number(requiredFinal) / 1e8} KAS (fee + 0.5 KAS per covenant output), have ${Number(feeTotal) / 1e8} KAS`,
            });
          }
        } else {
          return res.status(400).json({
            error: `Insufficient KAS — need ≥${Number(requiredFinal) / 1e8} KAS (fee + 0.5 KAS per covenant output), have ${Number(feeTotal) / 1e8} KAS`,
          });
        }
      }
    }

    // ── 7. Build recipient redeemScripts and P2SH scriptPublicKeys ────────
    const senderPubkey = addrToPubkey(senderAddress);

    const recipientOutputs = recipients.map(({ address, amount }) => {
      const pubkey = addrToPubkey(address);
      const redeem = materializeScript(template, pubkey, BigInt(amount));
      return {
        redeemScriptHex: Buffer.from(redeem).toString('hex'),
        scriptPublicKeyHex: p2shScript(redeem),
        amount: BigInt(amount),
      };
    });

    // ── 8. KRON change back to sender ─────────────────────────────────────
    let kronChangeOutput: { redeemScriptHex: string; scriptPublicKeyHex: string; amount: bigint } | null = null;
    if (changeAmount > 0n) {
      const changeRedeem = materializeScript(template, senderPubkey, changeAmount);
      kronChangeOutput = {
        redeemScriptHex: Buffer.from(changeRedeem).toString('hex'),
        scriptPublicKeyHex: p2shScript(changeRedeem),
        amount: changeAmount,
      };
    }

    // ── 9. KAS change back to sender ──────────────────────────────────────
    const senderP2pkScript = '20' + Buffer.from(senderPubkey).toString('hex') + 'ac';
    // The fold decision was made inside the iteration loop (omitChange flag).
    // When omitChange is true the change output is suppressed; all surplus
    // beyond the covenant outputs is donated to miners as fee.
    let kasChange: bigint;
    let effectiveFee: bigint;
    if (omitChange) {
      kasChange    = 0n;
      effectiveFee = feeTotal + covenantInSompi - covenantOutSompi; // total surplus
    } else {
      kasChange    = feeTotal + covenantInSompi - covenantOutSompi - dynamicFee;
      effectiveFee = dynamicFee;
    }

    // ── 10. Assemble transaction details ───────────────────────────────────
    const inputs: any[] = [];

    // KRON covenant inputs — include redeemScript so the wallet can sign P2SH.
    // utxoEntry uses the AUTHORITATIVE on-chain values (real sompi amount +
    // blockDaaScore) fetched in step 4b — not the indexer's token amounts.
    for (const e of covenantEntries) {
      inputs.push({
        previousOutpoint: { transactionId: e.txId, index: e.index },
        signatureScript: '',
        sequence: '0',
        sigOpCount: 1,
        utxoEntry: {
          amount: String(e.amountSompi),
          scriptPublicKey: { version: 0, script: e.scriptPublicKeyHex },
          blockDaaScore: e.blockDaaScore,
          isCoinbase: e.isCoinbase,
        },
        redeemScript: e.redeemScriptHex,
      });
    }

    // KAS fee inputs (regular P2PK — no redeemScript; may be multiple)
    for (const fu of feeUtxos) {
      const kasSpk = fu.utxoEntry?.scriptPublicKey;
      inputs.push({
        previousOutpoint: {
          transactionId: fu.outpoint?.transactionId ?? fu.transactionId ?? '',
          index: fu.outpoint?.index ?? fu.index ?? 0,
        },
        signatureScript: '',
        sequence: '0',
        sigOpCount: 1,
        utxoEntry: {
          amount: String(fu.utxoEntry?.amount ?? 0),
          scriptPublicKey: typeof kasSpk === 'string'
            ? { version: 0, script: kasSpk }
            : { version: kasSpk?.version ?? 0, script: kasSpk?.scriptPublicKey ?? kasSpk?.script ?? '' },
          blockDaaScore: String(fu.utxoEntry?.blockDaaScore ?? 0),
          isCoinbase: fu.utxoEntry?.isCoinbase ?? false,
        },
      });
    }

    // Every covenant output carries a fixed 0.5 KAS — the KRON token amount
    // is encoded in the redeemScript state, NOT in the output value.
    const outputs: any[] = [
      // Recipient KRON covenant outputs
      ...recipientOutputs.map((o) => ({
        value: String(COVENANT_OUTPUT_SOMPI),
        scriptPublicKey: { version: 0, script: o.scriptPublicKeyHex },
      })),
    ];

    // KRON change output (if any)
    if (kronChangeOutput) {
      outputs.push({
        value: String(COVENANT_OUTPUT_SOMPI),
        scriptPublicKey: { version: 0, script: kronChangeOutput.scriptPublicKeyHex },
      });
    }

    // KAS change output (always include to return KAS minus fee)
    if (kasChange > 0n) {
      outputs.push({
        value: String(kasChange),
        scriptPublicKey: { version: 0, script: senderP2pkScript },
      });
    }

    const txJson = {
      version: 0,
      inputs,
      outputs,
      lockTime: '0',
      subnetworkId: '0000000000000000000000000000000000000000',
      gas: '0',
      payload: '',
    };

    // All inputs need to be signed
    const inputIndicesToSign = inputs.map((_, i) => i);

    // KasWare's Safe JSON is not the nested RPC format above. Its inputs
    // contain transactionId/index/utxo at the top level, and SPKs are a
    // version-prefixed hex string rather than { version, script } objects.
    // Passing RPC-style previousOutpoint makes signPskt reject the JSON with
    // "missing field transactionId" before it even opens a signing dialog.
    const walletTx = {
      ...txJson,
      inputs: inputs.map(input => ({
        transactionId: input.previousOutpoint.transactionId,
        index: input.previousOutpoint.index,
        sequence: input.sequence,
        sigOpCount: input.sigOpCount,
        signatureScript: input.signatureScript,
        utxo: {
          address: input.redeemScript
            ? encodeKaspaAddress(8, blake2b256(Buffer.from(input.redeemScript, 'hex')))
            : senderAddress,
          amount: input.utxoEntry.amount,
          scriptPublicKey: input.utxoEntry.scriptPublicKey.version.toString(16).padStart(4, '0')
            + input.utxoEntry.scriptPublicKey.script,
          blockDaaScore: input.utxoEntry.blockDaaScore,
          isCoinbase: input.utxoEntry.isCoinbase,
        },
      })),
      outputs: outputs.map(output => ({
        value: output.value,
        scriptPublicKey: output.scriptPublicKey.version.toString(16).padStart(4, '0')
          + output.scriptPublicKey.script,
      })),
    };

    return res.json({
      txJsonString: JSON.stringify(walletTx),
      inputIndicesToSign,
      fee: String(effectiveFee),
      totalAmount: String(totalNeeded),
      inputOutpoints: inputs.map(i => i.previousOutpoint),
    });
  } catch (err: any) {
    console.error('[kron] build-kcc20-transfer error:', err);
    return res.status(500).json({ error: err?.message ?? 'KCC-20 transfer build failed' });
  }
});

export default router;
