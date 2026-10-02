/** Read-only testnet-10 inspection. Never signs, builds, or broadcasts a tx. */
import { blake2b } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';

const indexer = 'https://idx.krontest.xyz/v1/kcc20';
const registry = 'https://api.krontest.xyz';
const node = 'https://api-tn10.kaspa.org';
const hex32 = /^[0-9a-f]{64}$/;

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Read-only testnet API ${new URL(url).host} returned ${response.status}`);
  return response.json();
}

export async function inspectTestnetToken(address: string, ticker: string) {
if (!/^kaspatest:[a-z0-9]{50,110}$/.test(address ?? '') ||
  !/^[a-zA-Z0-9]{1,24}$/.test(ticker ?? '')) {
  throw new Error('Provide a public kaspatest: wallet address and an exact KRON test-token ticker');
}
const [tokens, details, holdings] = await Promise.all([
  getJson(`${registry}/api/registry/tokens`),
  getJson(`${indexer}/token/${encodeURIComponent(ticker)}`),
  getJson(`${indexer}/token/${encodeURIComponent(ticker)}/address/${encodeURIComponent(address)}/utxos`),
]);
const token = (tokens.tokens ?? []).find((t: any) => t.tick?.toLowerCase() === ticker.toLowerCase());
if (!token) throw new Error('Ticker not found in the KRON testnet registry');
const tokenId: string = token.cp?.tokenCovid ?? token.native?.tokenCovid;
if (!hex32.test(tokenId)) throw new Error('Registry did not provide a valid token covenant ID');
const info = details.result?.[0];
if (info?.covenantId !== tokenId || info.tick?.toLowerCase() !== ticker.toLowerCase()) {
  throw new Error('Indexer token info disagrees with registry');
}
const utxos = holdings.result;
if (!Array.isArray(utxos) || utxos.length === 0) throw new Error('No token UTXOs at this address');

let templateHash: string | undefined;
let balance = 0n;
const seen = new Set<string>();
for (const utxo of utxos) {
  const redeemHex: string = utxo.redeemScriptHex;
  if (typeof redeemHex !== 'string' || !/^[0-9a-f]+$/.test(redeemHex) || redeemHex.length < 92) {
    throw new Error('Indexer did not provide a usable redeem script');
  }
  const redeem = Buffer.from(redeemHex, 'hex');
  // Four fields, encoded as 0x20 <owner:32>, 0x01 <mode:1>,
  // 0x08 <amount:8LE>, 0x01 <isMinter:1>.
  if (redeem[0] !== 0x20 || redeem[33] !== 0x01 || redeem[35] !== 0x08 ||
    redeem[44] !== 0x01 || redeem[45] !== 0 || redeem[34] !== 3) {
    throw new Error('Unexpected KRON state layout or owner type; do not fund prototype');
  }
  const amount = redeem.readBigUInt64LE(36);
  if (amount !== BigInt(utxo.amount) || amount <= 0n) throw new Error('Token state amount disagrees with indexer');
  if (utxo.ownerAddress !== address) throw new Error('Indexer UTXO owner disagrees with wallet');
  const expectedSpk = `aa20${Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex')}87`;
  if (utxo.scriptPublicKey !== expectedSpk) throw new Error('Redeem script does not match indexed P2SH script');
  // SilverScript template_hash = BLAKE3(i64LE(prefix length) || prefix ||
  // i64LE(suffix length) || suffix). State starts at byte 0 and spans 46 bytes.
  const suffix = redeem.subarray(46);
  const prefixLen = Buffer.alloc(8);
  const suffixLen = Buffer.alloc(8);
  suffixLen.writeBigInt64LE(BigInt(suffix.length));
  const currentHash = Buffer.from(blake3(Buffer.concat([prefixLen, suffixLen, suffix]))).toString('hex');
  if (templateHash && templateHash !== currentHash) throw new Error('Wallet UTXOs use different token templates');
  templateHash = currentHash;

  const txId: string = utxo.outpoint?.transactionId;
  const index: number = utxo.outpoint?.index;
  if (!hex32.test(txId) || !Number.isSafeInteger(index) || index < 0) throw new Error('Invalid token outpoint');
  const outpoint = `${txId}:${index}`;
  if (seen.has(outpoint)) throw new Error('Duplicate token UTXO');
  seen.add(outpoint);
  const tx = await getJson(`${node}/transactions/${txId}`);
  const output = tx.outputs?.[index];
  if (output?.script_public_key !== expectedSpk || output?.covenant_id !== tokenId ||
    output?.amount !== 50_000_000 || !output?.script_public_key_address) {
    throw new Error('Token output does not match testnet chain, covenant ID or 0.5-KAS carrier');
  }
  const unspent = await getJson(`${node}/addresses/${encodeURIComponent(output.script_public_key_address)}/utxos`);
  if (!Array.isArray(unspent) || !unspent.some((row: any) =>
    row.outpoint?.transactionId === txId && row.outpoint?.index === index &&
    BigInt(row.utxoEntry?.amount ?? -1) === 50_000_000n)) {
    throw new Error('Indexed token UTXO is not confirmed unspent on testnet');
  }
  balance += amount;
}
return {
  network: 'testnet-10',
  ticker: info.tick,
  tokenCovenantId: tokenId,
  tokenDecimals: info.dec,
  utxoCount: utxos.length,
  balanceUnits: balance.toString(),
  ownerMode: 3,
  tokenCarrierSompi: '50000000',
  stateStart: 0,
  stateLength: 46,
  templatePrefixLength: 0,
  templateSuffixLength: Buffer.from(utxos[0].redeemScriptHex, 'hex').length - 46,
  tokenTemplateHash: templateHash,
};
}