const KASPLEX_API = 'https://api.kasplex.org/v1';
const KCC20_API = 'https://kcc20.info';
const KRON_API = 'https://api.kron.technology';
const KRON_INDEXER_API = 'https://idx.kron.technology/v1/kcc20';
const HOLDER_PAGE_LIMIT = 1000;
const KASPA_BURN_ADDRESS =
  'kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx9awp4e';
const UPSTREAM_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'kasdistro/1.0',
};

export type HolderLookupResult = {
  status: number;
  body: Record<string, unknown>;
};

function isEligibleHolderAddress(address: unknown): address is string {
  return (
    typeof address === 'string' &&
    address.startsWith('kaspa:') &&
    address !== KASPA_BURN_ADDRESS
  );
}

function upstreamErrorMessage(data: any, fallback: string): string {
  const error = data?.detail ?? data?.error ?? data?.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  if (typeof error?.code === 'string' && error.code.trim()) return error.code;
  return fallback;
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>): HolderLookupResult {
  return { status, body: { error, ...extra } };
}

async function fetchJson(url: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: UPSTREAM_HEADERS,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error(`Indexer request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKronRegistryToken(tokenId: string): Promise<{ tick: string } | null> {
  const { ok, data } = await fetchJson(`${KRON_API}/api/registry/tokens`, 15000);
  if (!ok) throw new Error('KRON token registry lookup failed.');
  const token = (Array.isArray(data?.tokens) ? data.tokens : []).find((entry: any) =>
    [entry?.covenantId, entry?.cp?.tokenCovid, entry?.native?.tokenCovid].some(
      (value) => typeof value === 'string' && value.toLowerCase() === tokenId,
    ),
  );
  return typeof token?.tick === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(token.tick)
    ? { tick: token.tick.toUpperCase() }
    : null;
}

async function fetchKronHolderAddresses(tokenId: string) {
  const registryToken = await fetchKronRegistryToken(tokenId);
  if (!registryToken) return null;

  const ticker = registryToken.tick;
  const encodedTicker = encodeURIComponent(ticker);
  const pageSize = 50;
  const holderRows: any[] = [];
  const seenAddresses = new Set<string>();
  let reportedHolderCount: number | null = null;
  let exhausted = false;

  for (let offset = 0; offset < 50000; offset += pageSize) {
    const { ok, data: holdersData, status } = await fetchJson(
      `${KRON_INDEXER_API}/token/${encodedTicker}/holders?limit=${pageSize}&offset=${offset}`,
    );
    if (!ok) {
      throw new Error(upstreamErrorMessage(holdersData, `KRON holder lookup failed for ${ticker} (HTTP ${status}).`));
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

  const { ok: tokenOk, data: tokenData } = await fetchJson(`${KRON_INDEXER_API}/token/${encodedTicker}`);
  if (!tokenOk) {
    throw new Error(upstreamErrorMessage(tokenData, `KRON token lookup failed for ${ticker}.`));
  }

  const tokenRow = Array.isArray(tokenData?.result) ? tokenData.result[0] : tokenData?.result;
  const expectedHolderCount = Number(tokenRow?.holderTotal);
  const ordinaryHolders = holderRows.filter((holder) => !holder.address.startsWith('covenant:'));
  if (
    !Number.isSafeInteger(expectedHolderCount) ||
    expectedHolderCount < 0 ||
    (reportedHolderCount !== null && reportedHolderCount !== expectedHolderCount) ||
    ordinaryHolders.length !== expectedHolderCount
  ) {
    throw new Error(
      `KRON reports ${expectedHolderCount.toLocaleString()} holders for ${ticker}, but its indexer returned ${ordinaryHolders.length.toLocaleString()} ordinary holders. Import was stopped to prevent a partial distribution.`,
    );
  }

  const eligible = holderRows.filter((holder: any) => isEligibleHolderAddress(holder?.address));
  if (eligible.some((holder: any) => !/^[1-9][0-9]*$/.test(String(holder?.balance ?? '')))) {
    throw new Error(`KRON returned an invalid holder balance for ${ticker}.`);
  }

  return {
    ticker,
    addresses: [...new Set(eligible.map((holder: any) => holder.address))],
    balances: eligible.map((holder: any) => ({ address: holder.address, balance: String(holder.balance) })),
    holderRecords: holderRows.length,
    excludedCovenantHolders: holderRows.filter(
      (holder: any) => typeof holder?.address === 'string' && holder.address.startsWith('covenant:'),
    ).length,
    excludedBurnAddresses: holderRows.filter((holder: any) => holder?.address === KASPA_BURN_ADDRESS).length,
    graduated: tokenRow?.graduated === true,
  };
}

async function lookupKcc20Holders(tokenId: string): Promise<HolderLookupResult> {
  const addressSet = new Set<string>();
  const balanceRows = new Map<string, string>();
  const seenCursors = new Set<string>();
  let cursor = '';
  let validationStatus: string | null = null;
  let sourceDaa: string | null = null;
  let excludedBurnAddresses = 0;

  const kronResult = async (): Promise<HolderLookupResult | null> => {
    const kronHolders = await fetchKronHolderAddresses(tokenId);
    if (!kronHolders) return null;
    return {
      status: 200,
      body: {
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
      },
    };
  };

  const kronPromise = kronResult().catch(() => null);

  do {
    const query = new URLSearchParams({ limit: String(HOLDER_PAGE_LIMIT) });
    if (cursor) query.set('after_owner', cursor);
    let upstream: { ok: boolean; status: number; data: any };
    try {
      upstream = await fetchJson(`${KCC20_API}/v1/tokens/${tokenId}/holders?${query}`, 8000);
    } catch {
      const fallback = await kronPromise;
      if (fallback) return fallback;
      return jsonError(502, 'KCC-20 holder indexer is unreachable.');
    }

    if (!upstream.ok) {
      const upstreamCode = upstream.data?.error?.code;
      if (upstream.status === 404 && (upstreamCode === 'not_found' || !upstreamCode)) {
        const fallback = await kronPromise;
        if (fallback) return fallback;
        return jsonError(404, 'No KCC-20 token was found for that 64-character ID.');
      }
      const fallback = await kronPromise;
      if (fallback) return fallback;
      return jsonError(
        upstream.status,
        upstreamErrorMessage(upstream.data, 'KCC-20 holder lookup failed.'),
      );
    }

    const data = upstream.data;
    const pageStatus = String(data?.validation?.status ?? '').toLowerCase();
    if (!['valid', 'validated', 'complete', 'template_verified', 'verified'].includes(pageStatus)) {
      return jsonError(
        409,
        `KCC-20 indexer validation status is "${pageStatus || 'missing'}". Holder import was stopped.`,
      );
    }
    const pageDaa = data?.validation?.source_daa;
    if (pageDaa == null || (sourceDaa !== null && String(pageDaa) !== sourceDaa)) {
      throw new Error('Holder snapshot changed during pagination; import stopped.');
    }
    validationStatus = pageStatus;
    sourceDaa = String(pageDaa);
    if (!Array.isArray(data?.holders)) throw new Error('Holder service returned an invalid page.');

    for (const holder of data.holders) {
      if (holder?.address === KASPA_BURN_ADDRESS) excludedBurnAddresses += 1;
      if (isEligibleHolderAddress(holder?.address)) {
        if (
          !/^[1-9][0-9]*$/.test(String(holder.balance ?? '')) ||
          balanceRows.has(holder.address)
        ) {
          throw new Error('Holder balances are invalid or repeated; import stopped.');
        }
        addressSet.add(holder.address);
        balanceRows.set(holder.address, String(holder.balance));
      }
    }

    const nextCursor = typeof data?.next_cursor === 'string' ? data.next_cursor : '';
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor) || nextCursor === cursor) {
      throw new Error('Holder pagination repeated; import stopped.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  const addresses = [...addressSet];
  let ticker: string | null = null;
  try {
    const metadata = await fetchJson(`${KCC20_API}/v1/tokens/${tokenId}`, 15000);
    if (
      metadata.ok &&
      metadata.data?.token_id?.toLowerCase() === tokenId &&
      typeof metadata.data.ticker === 'string' &&
      /^[a-zA-Z0-9]{1,32}$/.test(metadata.data.ticker)
    ) {
      ticker = metadata.data.ticker.toUpperCase();
    }
  } catch {
    // Ticker is optional for a valid KAS distribution list.
  }

  return {
    status: 200,
    body: {
      protocol: 'KCC-20',
      identifier: tokenId,
      ticker,
      addresses,
      balances: addresses.map((address) => ({ address, balance: balanceRows.get(address)! })),
      imported: addresses.length,
      hasMore: false,
      validationStatus,
      sourceDaa,
      excludedBurnAddresses,
      source: 'KCC-20 indexer',
    },
  };
}

async function replayKrc20Oplist(ticker: string, expectedHolders: number): Promise<{
  addresses: string[];
  excludedBurnAddresses: number;
}> {
  const balances = new Map<string, bigint>();
  let cursor: string | null = null;
  const pageSize = 50;
  const maxPages = 400;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${KASPLEX_API}/krc20/oplist`);
    url.searchParams.set('tick', ticker);
    url.searchParams.set('limit', String(pageSize));
    if (cursor) url.searchParams.set('next', cursor);
    const { ok, data, status } = await fetchJson(url.toString());
    if (!ok || data?.message !== 'successful' || !Array.isArray(data?.result)) {
      throw new Error(data?.message || `Kasplex operation history returned HTTP ${status}.`);
    }

    for (const operation of data.result) {
      if (String(operation?.txAccept) !== '1' || String(operation?.opAccept) !== '1') continue;
      let amount: bigint;
      try {
        amount = BigInt(operation?.amt ?? '0');
      } catch {
        throw new Error(`Kasplex returned an invalid amount for ${ticker}.`);
      }
      if (amount < 0n) throw new Error(`Kasplex returned a negative amount for ${ticker}.`);
      const add = (address: unknown, delta: bigint) => {
        if (typeof address !== 'string' || !address.startsWith('kaspa:')) return;
        balances.set(address, (balances.get(address) ?? 0n) + delta);
      };
      if (operation.op === 'mint') add(operation.to, amount);
      else if (operation.op === 'transfer' || operation.op === 'send') {
        add(operation.from, -amount);
        add(operation.to, amount);
      } else if (operation.op === 'burn') add(operation.from, -amount);
    }

    const next = typeof data.next === 'string' && data.next ? data.next : null;
    if (next === cursor) throw new Error(`Kasplex returned a repeated cursor for ${ticker}.`);
    cursor = next;
    if (!cursor || data.result.length === 0) break;
  }

  if (cursor) {
    throw new Error(`KRC-20 history for ${ticker} is too large to import without a dedicated indexer.`);
  }

  const positive = [...balances.entries()].filter(([, amount]) => amount > 0n);
  const excludedBurnAddresses = positive.filter(([address]) => address === KASPA_BURN_ADDRESS).length;
  const addresses = positive.map(([address]) => address).filter(isEligibleHolderAddress);
  if (positive.length !== expectedHolders) {
    throw new Error(
      `Kasplex reports ${expectedHolders.toLocaleString()} holders, but replay resolved ${positive.length.toLocaleString()}.`,
    );
  }
  return { addresses, excludedBurnAddresses };
}

async function lookupKrc20Holders(ticker: string): Promise<HolderLookupResult> {
  const { ok, status, data } = await fetchJson(
    `${KASPLEX_API}/krc20/token/${encodeURIComponent(ticker)}`,
  );
  if (!ok || data?.message !== 'successful') {
    return jsonError(ok ? 404 : status, data?.message || data?.error || 'KRC-20 holder lookup failed.');
  }

  const token = Array.isArray(data?.result) ? data.result[0] : null;
  if (!token || !['deployed', 'finished'].includes(token.state)) {
    return jsonError(404, `KRC-20 token "${ticker}" was not found.`);
  }

  const holderRows = Array.isArray(token?.holder) ? token.holder : [];
  const positiveHolderRows = holderRows.filter((holder: any) => {
    try {
      return BigInt(holder?.amount ?? '0') > 0n;
    } catch {
      return false;
    }
  });
  const addresses = [
    ...new Set(positiveHolderRows.map((holder: any) => holder.address).filter(isEligibleHolderAddress)),
  ];
  const total = Number(token?.holderTotal ?? addresses.length);
  const excludedBurnAddresses = holderRows.filter(
    (holder: any) => holder?.address === KASPA_BURN_ADDRESS,
  ).length;
  const providerIsPartial = Number.isFinite(total) && total > positiveHolderRows.length;

  let snapshot = { addresses, excludedBurnAddresses };
  if (providerIsPartial) {
    snapshot = await replayKrc20Oplist(ticker, total);
  }

  if (Number.isFinite(total) && snapshot.addresses.length + snapshot.excludedBurnAddresses !== total) {
    return jsonError(
      409,
      `Complete holder index for ${ticker} resolved ${snapshot.addresses.length.toLocaleString()} eligible addresses and ${snapshot.excludedBurnAddresses.toLocaleString()} burn holders, but Kasplex reports ${total.toLocaleString()}. Import was stopped.`,
      { indexing: false, totalHolders: total },
    );
  }

  return {
    status: 200,
    body: {
      protocol: 'KRC-20',
      identifier: ticker,
      addresses: snapshot.addresses,
      imported: snapshot.addresses.length,
      hasMore: false,
      totalHolders: Number.isFinite(total) ? total : null,
      excludedBurnAddresses: snapshot.excludedBurnAddresses,
      source: providerIsPartial ? 'Kasplex oplist replay' : 'Kasplex',
    },
  };
}

export async function lookupTokenHolders(rawIdentifier: string): Promise<HolderLookupResult> {
  const identifier = rawIdentifier.trim().replace(/[;,.\s]+$/g, '');
  const isKcc20 = /^[0-9a-fA-F]{64}$/.test(identifier);
  const isKrc20 = /^[a-zA-Z0-9]{1,32}$/.test(identifier);

  if (!isKcc20 && !isKrc20) {
    const isEvmContract = /^0x[0-9a-fA-F]{40}$/.test(identifier);
    return jsonError(
      400,
      isEvmContract
        ? 'This is an EVM contract address, not a Kaspa L1 KRC-20 ticker. Enter the token ticker shown by Kasplex, such as NACHO.'
        : 'Enter a KRC-20 ticker or a 64-character KCC-20 token ID.',
    );
  }

  try {
    if (isKcc20) return await lookupKcc20Holders(identifier.toLowerCase());
    return await lookupKrc20Holders(identifier.toUpperCase());
  } catch (error: any) {
    return jsonError(502, 'Token holder indexer is currently unavailable.', {
      detail: error?.message ?? String(error),
    });
  }
}
