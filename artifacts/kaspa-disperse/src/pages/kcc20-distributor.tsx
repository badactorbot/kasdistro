import { useState, useRef, useMemo, useEffect } from 'react';
import { Search, Loader2, AlertCircle, Fingerprint, Coins, CheckCircle2, Layers } from 'lucide-react';
import { Link } from 'wouter';
import { kaspaApiBase } from '@/lib/dispenser/api';


type HolderImportResult = {
  protocol: string;
  identifier: string;
  ticker?: string | null;
  addresses: string[];
  imported: number;
  hasMore?: boolean;
  validationStatus?: string;
  source?: string;
};

type HolderIndexingStatus = {
  indexing: true;
  status: string;
  processedOperations: number;
  totalOperations?: number;
  retryAfterMs?: number;
  message?: string;
  expectedHolders?: number;
};

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
    return (err as any).message;
  }
  return fallback;
}

function GridBackground() {
  return (
    <div className="fixed inset-0 z-[-1] pointer-events-none cyber-grid flex items-center justify-center">
      {/* Central glow */}
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary/10 rounded-[100%] blur-[120px] pointer-events-none mix-blend-screen"></div>
    </div>
  );
}

export default function Kcc20Distributor() {
  const [covenantId, setCovenantId] = useState('');
  const [tokenTicker, setTokenTicker] = useState('');
  const [totalAmount, setTotalAmount] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [indexingStatus, setIndexingStatus] = useState<HolderIndexingStatus | null>(null);
  const [importResult, setImportResult] = useState<HolderImportResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Prevent stale data: clear state if covenant ID changes
  useEffect(() => {
    abortRef.current?.abort();
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setImportResult(null);
    setTokenTicker('');
    setIndexingStatus(null);
    setError('');
    setLoading(false);
  }, [covenantId]);

  const handleImportAndPreview = async () => {
    const cid = covenantId.trim();

    abortRef.current?.abort();
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setError('');
    setImportResult(null);
    setIndexingStatus(null);

    if (!cid || cid.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cid)) {
      setError('Please enter a valid 64-character hex KCC-20 Token ID.');
      return;
    }
    setLoading(true);
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const endpoint = `${kaspaApiBase()}/api/kron/token-holders/${encodeURIComponent(cid)}`;
      while (true) {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: abortController.signal,
          });
        } catch (cause) {
          if (abortController.signal.aborted) throw cause;
          throw new Error(
            `Could not reach the holder API at ${new URL(endpoint, window.location.origin).origin}. Check your connection and try again.`,
          );
        }
        const bodyText = await response.text();
        let body: (HolderImportResult & { error?: unknown }) | HolderIndexingStatus;
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw new Error(`Holder service returned an invalid response (HTTP ${response.status}).`);
        }

        if (response.status === 202 && 'indexing' in body && body.indexing) {
          setIndexingStatus(body);
          if (body.status === 'failed') {
            throw new Error(errorMessage((body as any).error || body.message, 'Holder indexing failed.'));
          }
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, body.retryAfterMs ?? 2000);
            timerRef.current = timer;
            const onAbort = () => {
              window.clearTimeout(timer);
              reject(new DOMException('Holder import was cancelled.', 'AbortError'));
            };
            abortController.signal.addEventListener('abort', onAbort, { once: true });
          });
          continue;
        }

        if (!response.ok) {
          throw new Error(errorMessage((body as any).error || (body as any).message, `Failed to load holders (HTTP ${response.status})`));
        }

        const successBody = body as HolderImportResult;
        if (successBody.protocol !== 'KCC-20' || successBody.identifier?.toLowerCase() !== cid.toLowerCase() ||
          successBody.hasMore !== false || !Array.isArray(successBody.addresses) ||
          successBody.imported !== successBody.addresses.length ||
          successBody.addresses.some(address => typeof address !== 'string' || !address.startsWith('kaspa:')) ||
          new Set(successBody.addresses).size !== successBody.addresses.length) {
          throw new Error('Holder service did not return a complete, reconciled KCC-20 wallet list.');
        }

        if (abortController.signal.aborted) return;
        setIndexingStatus(null);
        setTokenTicker(
          typeof successBody.ticker === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(successBody.ticker)
            ? successBody.ticker.toUpperCase()
            : '',
        );
        setImportResult(successBody);
        break; // Stop polling on success
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(errorMessage(err, 'Failed to import holders.'));
      }
    } finally {
      if (abortRef.current === abortController) {
        setLoading(false);
      }
    }
  };

  const allocations = useMemo(() => {
    if (!importResult) return null;
    const amountStr = totalAmount.trim();

    if (!amountStr) return null;
    if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
      return { type: 'error' as const, message: 'Enter a positive whole-number total amount.' };
    }
    if (!/^[a-zA-Z0-9]{1,32}$/.test(tokenTicker.trim())) {
      return { type: 'error' as const, message: 'Enter a valid token ticker before previewing allocations.' };
    }

    let amount: bigint;
    try {
      amount = BigInt(amountStr);
    } catch {
      return null;
    }

    const addresses = importResult.addresses;
    const count = BigInt(addresses.length);

    if (count === 0n) {
      return { type: 'error' as const, message: 'No eligible holder addresses found.' };
    }

    if (amount < count) {
      return { type: 'error' as const, message: 'Total amount cannot give every wallet a positive amount.' };
    }

    const baseAmount = amount / count;
    let remainder = amount % count;

    const results = addresses.map((addr) => {
      let allocated = baseAmount;
      if (remainder > 0n) {
        allocated += 1n;
        remainder--;
      }
      return { address: addr, amount: allocated };
    });

    return { type: 'success' as const, data: results, baseAmount };
  }, [importResult, totalAmount, tokenTicker]);

  return (
    <div className="min-h-screen flex flex-col relative z-10 selection:bg-primary/30 selection:text-white">
      <GridBackground />

      <nav aria-label="Distribution type" className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-7">
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-primary/20 bg-[#050c18]/90 p-1">
          <Link
            href="/distro"
            data-testid="link-kas-distribution"
            className="rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            KAS DISTRO
          </Link>
          <span aria-current="page" className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[#02050a]">
            KCC20 DISTRO
          </span>
        </div>
      </nav>

      {/* MAIN */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex flex-col gap-8 flex-1">

        {/* TOP — Input Form */}
        <section className="w-full">
          <div className="glass-panel p-1 rounded-2xl relative overflow-hidden group transition-all duration-500 border-2 border-primary shadow-[0_0_24px_rgba(11,213,188,0.24)]">
            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none blur-xl"></div>

            <div className="bg-[#050c18]/90 rounded-[14px] p-5 relative z-10 flex flex-col gap-5">

               <div className="border-b border-white/5 pb-5 text-center">
                  <h1 className="text-xl font-semibold text-white tracking-wide flex items-center justify-center gap-3">
                    <Fingerprint className="h-5 w-5 text-primary" />
                    KCC20 Token Distro App
                  </h1>
                  <p className="mt-2 text-[11px] text-white/50 leading-relaxed max-w-3xl mx-auto">
                    Import a token community by its KCC-20 Token ID, and perform an even distribution of tokens. This tool computes a deterministic remainder allocation over the actual holder set.
                  </p>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                 <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] items-end">
                    <div>
                       <label htmlFor="input-covenant-id" className="text-[10px] font-semibold tracking-wide text-white/90 flex items-center gap-2 uppercase mb-1.5">
                         KCC-20 Token ID
                       </label>
                       <input
                         id="input-covenant-id"
                         data-testid="input-covenant-id"
                         value={covenantId}
                         onChange={(e) => setCovenantId(e.target.value)}
                         placeholder="KCC-20 Token ID (64 characters)"
                         className="w-full h-10 min-w-0 rounded-lg border border-white/10 bg-[#02050a] px-3 font-mono text-xs text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                       />
                    </div>

                    <div>
                       <label htmlFor="input-token-ticker" className="text-[10px] font-semibold tracking-wide text-white/90 flex items-center gap-2 uppercase mb-1.5">
                         Token Being Sent
                       </label>
                       <input
                         id="input-token-ticker"
                         data-testid="input-token-ticker"
                         value={tokenTicker}
                         onChange={(e) => setTokenTicker(e.target.value)}
                          placeholder="Auto-fills from token ID"
                         className="w-full h-10 min-w-0 rounded-lg border border-white/10 bg-[#02050a] px-3 font-mono text-xs text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40 uppercase"
                       />
                    </div>

                    <div>
                       <label htmlFor="input-total-amount" className="text-[10px] font-semibold tracking-wide text-white/90 flex items-center gap-2 uppercase mb-1.5">
                         Total Amount
                       </label>
                       <input
                         id="input-total-amount"
                         data-testid="input-total-amount"
                         value={totalAmount}
                         onChange={(e) => setTotalAmount(e.target.value)}
                         type="text"
                         inputMode="numeric"
                         pattern="[0-9]*"
                          placeholder="Enter total whole tokens"
                         className="w-full h-10 min-w-0 rounded-lg border border-white/10 bg-[#02050a] px-3 font-mono text-xs text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                       />
                    </div>

                    <button
                      onClick={handleImportAndPreview}
                      disabled={loading}
                      data-testid="button-import-preview"
                      className="h-10 w-full md:w-auto px-6 flex items-center justify-center gap-2 rounded-lg bg-primary text-xs font-bold uppercase tracking-wider text-[#02050a] transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      {loading ? 'Importing holders...' : 'Import holders'}
                    </button>
                 </div>

                  {importResult && (
                    <div role="status" data-testid="status-holder-import" className="mt-3 text-xs text-primary">
                      Imported {importResult.imported.toLocaleString()} holder addresses.
                      {importResult.ticker
                        ? ` ${importResult.ticker.toUpperCase()} was filled in automatically. Enter a total amount to preview allocations.`
                        : ' A ticker was not available for this token ID; enter the token ticker manually before previewing allocations.'}
                    </div>
                  )}

                 {error && (
                  <div role="alert" data-testid="status-import-error" className="mt-4 flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                 )}

                 {indexingStatus && (
                  <div
                    className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-3 text-xs text-white/70"
                    role="status"
                    data-testid="status-indexing"
                    aria-live="polite"
                  >
                    <div className="flex items-center gap-2 text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="font-semibold">
                        {indexingStatus.status === 'queued' ? 'Queued for complete indexing' : 'Indexing complete holder history'}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      Processed {indexingStatus.processedOperations.toLocaleString()} operations
                      {indexingStatus.totalOperations
                        ? ` of ${indexingStatus.totalOperations.toLocaleString()}`
                        : ''}
                      {indexingStatus.expectedHolders
                        ? ` · ${indexingStatus.expectedHolders.toLocaleString()} holders expected`
                        : ''}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{
                          width: indexingStatus.totalOperations
                            ? `${Math.min(100, (indexingStatus.processedOperations / indexingStatus.totalOperations) * 100)}%`
                            : '12%',
                        }}
                      />
                    </div>
                    <div className="mt-1.5 text-[10px] text-white/40">
                      No partial addresses are loaded until indexing finishes and the holder count reconciles.
                    </div>
                  </div>
                 )}
              </div>
            </div>
          </div>
        </section>

        {/* BOTTOM — Summary + Table */}
        <section className="w-full">
          <div className="glass-panel p-1 rounded-2xl relative border-2 border-primary shadow-[0_0_24px_rgba(11,213,188,0.24)]">
            <div className="bg-[#050c18]/90 rounded-[14px] p-6 flex flex-col relative z-10 space-y-6">

              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wide flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Allocation Preview
                </h2>
                <span className="text-[10px] font-bold text-primary/80 uppercase tracking-wider bg-primary/10 px-2 py-1 rounded">Read-Only</span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-black/40 border border-white/5 p-5 shadow-inner relative overflow-hidden group">
                  <div className="absolute top-1/2 -translate-y-1/2 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Layers className="h-12 w-12 text-white" />
                  </div>
                  <div className="text-[10px] font-semibold text-white/40 tracking-widest uppercase mb-1">Recipients</div>
                  <div className="text-2xl font-black text-white font-mono" data-testid="text-total-recipients">
                    {importResult ? importResult.addresses.length.toLocaleString() : '0'}
                  </div>
                </div>
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-5 shadow-inner relative overflow-hidden group">
                  <div className="absolute top-1/2 -translate-y-1/2 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Coins className="h-12 w-12 text-primary" />
                  </div>
                  <div className="text-[10px] font-semibold text-primary/60 tracking-widest uppercase mb-1">Total {tokenTicker ? tokenTicker.toUpperCase() : 'Tokens'}</div>
                  <div className="text-2xl font-black text-primary font-mono tracking-tight" data-testid="text-total-tokens">
                    {allocations?.type === 'success' ? totalAmount : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-black/40 border border-white/5 p-5 shadow-inner relative overflow-hidden group">
                  <div className="absolute top-1/2 -translate-y-1/2 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Coins className="h-12 w-12 text-white" />
                  </div>
                  <div className="text-[10px] font-semibold text-white/40 tracking-widest uppercase mb-1">Base Allocation</div>
                  <div className="text-2xl font-black text-white font-mono" data-testid="text-base-allocation">
                    {allocations?.type === 'success' ? allocations.baseAmount.toString() : '0'}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="min-h-[240px] flex flex-col bg-[#02050a] rounded-xl border border-white/5 overflow-hidden relative">
                {allocations?.type === 'error' ? (
                  <div className="flex-1 flex items-center justify-center p-6 text-center" data-testid="status-allocation-error">
                    <p className="text-xs text-destructive/80 font-mono">{allocations.message}</p>
                  </div>
                ) : allocations?.type === 'success' ? (
                  <div className="h-[400px] overflow-auto custom-scrollbar" data-testid="container-allocations" tabIndex={0} aria-label="Scrollable allocation recipients">
                    <table className="w-full text-left text-[11px] whitespace-nowrap">
                      <thead className="sticky top-0 bg-[#02050a]/95 backdrop-blur-sm border-b border-white/10 z-10">
                        <tr className="h-10 text-white/40 uppercase tracking-wider font-semibold">
                          <th className="pl-6 font-medium w-16">#</th>
                          <th className="px-4 font-medium">Wallet Address</th>
                          <th className="pr-6 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-white/70">
                        {allocations.data.map((row, idx) => (
                          <tr key={row.address} className="h-9 hover:bg-white/[0.02] transition-colors">
                            <td className="pl-6 text-white/30">{idx + 1}</td>
                            <td className="px-4 font-mono text-white/70" data-testid={`text-address-${idx}`}>
                              {row.address}
                            </td>
                            <td className="pr-6 text-right text-primary font-medium font-mono" data-testid={`text-amount-${idx}`}>
                              {row.amount.toString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center opacity-50">
                    <Coins className="h-10 w-10 text-white/20 mb-3" />
                    <p className="text-xs text-white/40 uppercase tracking-widest font-semibold mb-1">No Allocations</p>
                    <p className="text-[10px] text-white/30 max-w-[250px] leading-relaxed">Import a community and enter a total amount to preview deterministic dispersal.</p>
                  </div>
                )}
              </div>

            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
