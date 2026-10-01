import { useState, useEffect, useRef } from 'react';
import {
  Wallet, Send, CheckCircle2, AlertCircle, X,
  ExternalLink, Loader2, Layers, Zap, Fingerprint, Search
} from 'lucide-react';
import { kaspaApiBase } from '@/lib/dispenser/api';
import { extractWalletAddresses, waitForWalletProvider } from '@/lib/dispenser/wallets';
import { LandingLayout } from '@/components/dispenser/landing-layout';

// ── Wallets ───────────────────────────────────────────────────────────────────
const KASPA_WALLETS = [
  {
    id: 'kasware',
    name: 'KasWare Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension',
    getProvider: () => typeof window !== 'undefined' ? (window as any).kasware : null,
    downloadUrl: 'https://chromewebstore.google.com/detail/kasware-wallet/hklhheigdmpoolooomdihmhlpjjdbklf',
  },
  {
    id: 'kastle',
    name: 'Kastle Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension',
    getProvider: () => typeof window !== 'undefined' ? (window as any).kastle : null,
    downloadUrl: 'https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego',
  },
  {
    id: 'nightly',
    name: 'Nightly Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension',
    getProvider: () => typeof window !== 'undefined' ? (window as any).nightly?.kaspa : null,
    downloadUrl: 'https://nightly.app/',
  },
  {
    id: 'bitget',
    name: 'Bitget Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension',
    getProvider: () => typeof window !== 'undefined'
      ? ((window as any).bitgetWallet?.kaspa || (window as any).bitget?.kaspa)
      : null,
    downloadUrl: 'https://web3.bitget.com/',
  },
  {
    id: 'kaspium',
    name: 'Kaspium Mobile',
    icon: '/kaspa-mark.svg',
    type: 'mobile',
    getProvider: null,
    downloadUrl: 'https://kaspium.io/',
  },
];

const SERVICE_FEE_KAS = 100;
const SERVICE_FEE_ADDRESS = 'kaspa:qz6dltvkds80wf8raac504ze4nesgnk72n24jr7krum2m8dq34khvkevr88cc';
const NEXT_BATCH_RETRY_DELAY_MS = 2500;
const NEXT_BATCH_MAX_RETRIES = 24;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Recipient {
  address: string;
  amount: number; // KAS
}

interface TransferStatus {
  status: 'pending' | 'signing' | 'sent' | 'failed';
  txId: string;
  error?: string;
}

interface WalletAccount {
  address: string;
  walletId: string;
  walletName: string;
  provider: any;
}

interface TransactionReview {
  txJsonString: string;
  inputIndicesToSign: number[];
  recipientTotalSompi: string;
  serviceFeeSompi: string;
  networkFeeSompi: string;
  grandTotalSompi: string;
  mass: number;
  maximumMass: number;
  computeMass?: number;
  storageMass?: number;
  maximumComputeMass?: number;
  maximumStorageMass?: number;
  inputOutpoints: Array<{ transactionId: string; index: number }>;
}

interface BatchReview extends TransactionReview {
  batchNumber: number;
  batchCount: number;
  recipientStart: number;
  recipientCount: number;
}

interface HolderImportResult {
  protocol: 'KRC-20' | 'KCC-20';
  identifier: string;
  addresses: string[];
  imported: number;
  hasMore: boolean;
  totalHolders?: number | null;
  validationStatus?: string | null;
  sourceDaa?: string | null;
  ticker?: string;
  source?: string;
  excludedCovenantHolders?: number;
  excludedBurnAddresses?: number;
}

interface HolderIndexingStatus {
  protocol: 'KRC-20';
  identifier: string;
  indexing: true;
  status: 'queued' | 'indexing' | 'failed';
  processedOperations: number;
  totalOperations?: number | null;
  expectedHolders?: number | null;
  retryAfterMs?: number;
  message?: string;
  error?: string;
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (
    value
    && typeof value === 'object'
    && 'message' in value
    && typeof value.message === 'string'
    && value.message.trim()
  ) {
    return value.message;
  }
  return fallback;
}

function GridBackground() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none cyber-grid flex items-center justify-center">
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary/10 rounded-[100%] blur-[120px] pointer-events-none mix-blend-screen"></div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DistroApp() {
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [walletLoading, setWalletLoading] = useState<string | null>(null);
  const [walletError, setWalletError] = useState('');
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});

  const [rawInput, setRawInput] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<TransferStatus[]>([]);
  const [serviceFeeStatus, setServiceFeeStatus] = useState<TransferStatus>({ status: 'pending', txId: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [review, setReview] = useState<BatchReview | null>(null);
  const [transactionError, setTransactionError] = useState('');
  const [completedTxIds, setCompletedTxIds] = useState<string[]>([]);
  const [tokenIdentifier, setTokenIdentifier] = useState('');
  const [kasPerHolder, setKasPerHolder] = useState('');
  const [holderImportLoading, setHolderImportLoading] = useState(false);
  const [holderImportError, setHolderImportError] = useState('');
  const [holderImportResult, setHolderImportResult] = useState<HolderImportResult | null>(null);
  const [holderIndexingStatus, setHolderIndexingStatus] = useState<HolderIndexingStatus | null>(null);

  const holderImportAbortRef = useRef<AbortController | null>(null);
  const holderImportTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    holderImportAbortRef.current?.abort();
    if (holderImportTimerRef.current !== null) window.clearTimeout(holderImportTimerRef.current);
  }, []);

  // Detect installed wallets
  useEffect(() => {
    const check = () => {
      const map: Record<string, boolean> = {};
      KASPA_WALLETS.forEach((w) => {
        if (w.type === 'extension' && w.getProvider) map[w.id] = !!w.getProvider();
      });
      setInstalledMap(map);
    };
    check();
    const t = setTimeout(check, 600);
    return () => clearTimeout(t);
  }, [isWalletModalOpen]);

  // ── Parse input ──────────────────────────────────────────────────────────
  const handleParseInput = (text: string) => {
    setRawInput(text);
    const parsed: Recipient[] = [];
    const errors: string[] = [];

    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split(/[\s,=]+/);
      if (parts.length >= 2) {
        const address = parts[0].trim();
        const amount = parseFloat(parts[1].trim());
        const validAddr = address.startsWith('kaspa:') || address.startsWith('kaspatest:');
        if (!validAddr) errors.push(`Line ${i + 1}: Invalid address`);
        else if (isNaN(amount) || amount <= 0) errors.push(`Line ${i + 1}: Invalid amount`);
        else parsed.push({ address, amount });
      } else if (trimmed.length > 0) {
        errors.push(`Line ${i + 1}: Could not parse`);
      }
    });

    setRecipients(parsed);
    setParseErrors(errors);
    setStatuses(parsed.map(() => ({ status: 'pending', txId: '' })));
    setServiceFeeStatus({ status: 'pending', txId: '' });
    setReview(null);
    setTransactionError('');
    setCompletedTxIds([]);
  };

  const handleImportTokenHolders = async () => {
    const identifier = tokenIdentifier.trim();
    const amount = Number(kasPerHolder);
    holderImportAbortRef.current?.abort();
    if (holderImportTimerRef.current !== null) {
      window.clearTimeout(holderImportTimerRef.current);
      holderImportTimerRef.current = null;
    }
    setHolderImportError('');
    setHolderImportResult(null);
    setHolderIndexingStatus(null);

    if (!identifier) {
      setHolderImportError('Enter a KRC-20 ticker or KCC-20 token ID.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setHolderImportError('Enter a valid KAS amount per holder.');
      return;
    }

    setHolderImportLoading(true);
    const abortController = new AbortController();
    holderImportAbortRef.current = abortController;
    try {
      const endpoint = `${kaspaApiBase()}/api/kron/token-holders/${encodeURIComponent(identifier)}`;
      while (true) {
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: abortController.signal,
        });
        const bodyText = await response.text();
        let body: (HolderImportResult & { error?: unknown }) | HolderIndexingStatus;
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw new Error(`Holder service returned an invalid response (HTTP ${response.status}).`);
        }
        if (response.status === 202 && 'indexing' in body && body.indexing) {
          setHolderIndexingStatus(body);
          if (body.status === 'failed') {
            throw new Error(errorMessage(body.error || body.message, 'Holder indexing failed.'));
          }
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, body.retryAfterMs ?? 2000);
            holderImportTimerRef.current = timer;
            const onAbort = () => {
              window.clearTimeout(timer);
              reject(new DOMException('Holder import was cancelled.', 'AbortError'));
            };
            abortController.signal.addEventListener('abort', onAbort, { once: true });
          });
          holderImportTimerRef.current = null;
          continue;
        }
        if (!response.ok) throw new Error(errorMessage(body.error, 'Could not load token holders.'));
        const completed = body as HolderImportResult;
        if (!completed.addresses?.length) throw new Error('No eligible Kaspa holder addresses were found.');
        handleParseInput(completed.addresses.map(address => `${address} ${kasPerHolder}`).join('\n'));
        setHolderImportResult(completed);
        setHolderIndexingStatus(null);
        break;
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') setHolderImportError(err?.message || 'Could not load token holders.');
    } finally {
      if (holderImportAbortRef.current === abortController) {
        holderImportAbortRef.current = null;
        setHolderImportLoading(false);
      }
    }
  };

  // ── Connect wallet ───────────────────────────────────────────────────────
  const handleConnectWallet = async (wallet: typeof KASPA_WALLETS[0]) => {
    setWalletError('');
    setWalletLoading(wallet.id);
    try {
      if (wallet.type === 'extension') {
        const provider = wallet.getProvider
          ? await waitForWalletProvider(wallet.getProvider)
          : null;
        if (!provider) {
          throw new Error(
            `${wallet.name} is not available in this tab. Install the extension, unlock it, then try again.`,
          );
        }
        let result: unknown;
        if (typeof provider.requestAccounts === 'function') result = await provider.requestAccounts();
        else if (typeof provider.connect === 'function') result = await provider.connect();
        else if (typeof provider.getAccounts === 'function') result = await provider.getAccounts();
        else throw new Error(`${wallet.name} does not expose a connect method.`);
        const addresses = extractWalletAddresses(result);
        if (!addresses.length) throw new Error('No account returned from wallet.');
        setAccount({ address: addresses[0], walletId: wallet.id, walletName: wallet.name, provider });
        setIsWalletModalOpen(false);
      } else {
        window.open(wallet.downloadUrl, '_blank');
      }
    } catch (err: any) {
      setWalletError(err?.message || (typeof err === 'string' ? err : 'Failed to connect.'));
    } finally {
      setWalletLoading(null);
    }
  };

  // ── Execute ──────────────────────────────────────────────────────────────
  const buildDispersalReview = async (
    batchRecipients: Recipient[],
    excludedOutpoints: Array<{ transactionId: string; index: number }> = [],
  ) => {
    const apiBase = kaspaApiBase();
    const endpoint = `${apiBase}/api/kaspa/build-pskt`;

    const request = () => fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify({
        senderAddress: account?.address,
        recipients: batchRecipients,
        excludedOutpoints,
      }),
    });

    let response = await request();
    let responseText = await response.text();

    // A deployed proxy can occasionally close a successful response before its
    // body reaches the browser. Retrying is safe because this endpoint only
    // prepares an unsigned transaction and does not spend or broadcast funds.
    if (response.ok && responseText.trim() === '') {
      response = await request();
      responseText = await response.text();
    }

    if (responseText.trim() === '') {
      throw new Error(
        `Transaction service returned an empty response (HTTP ${response.status}). Check that the hosted API is public and try again.`,
      );
    }

    let body: any;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Transaction service returned an invalid response (HTTP ${response.status}). Please try again.`,
      );
    }

    if (!response.ok) {
      const error = new Error(body?.error || `Could not prepare transaction (HTTP ${response.status}).`);
      (error as Error & { code?: string }).code = body?.code;
      throw error;
    }

    return body;
  };

  const buildLargestSafeReview = async (
    recipientStart: number,
    excludedOutpoints: Array<{ transactionId: string; index: number }> = [],
  ) => {
    const remainingCount = recipients.length - recipientStart;
    if (remainingCount <= 0) throw new Error('No unsent recipients remain.');

    const buildCount = (count: number) => buildDispersalReview(
      recipients.slice(recipientStart, recipientStart + count),
      excludedOutpoints,
    );

    try {
      const nextReview = await buildCount(remainingCount);
      return { review: nextReview, recipientCount: remainingCount };
    } catch (err) {
      if ((err as Error & { code?: string })?.code !== 'MASS_LIMIT_EXCEEDED') throw err;
    }

    let low = 1;
    let high = remainingCount - 1;
    let best: { review: TransactionReview; recipientCount: number } | null = null;

    while (low <= high) {
      const candidateCount = Math.floor((low + high) / 2);
      try {
        const nextReview = await buildCount(candidateCount);
        best = { review: nextReview, recipientCount: candidateCount };
        low = candidateCount + 1;
      } catch (err) {
        if ((err as Error & { code?: string })?.code !== 'MASS_LIMIT_EXCEEDED') throw err;
        high = candidateCount - 1;
      }
    }

    if (!best) {
      throw new Error('Even one recipient exceeds the Kaspa transaction mass limit with the wallet’s current UTXOs.');
    }
    return best;
  };

  const handlePrepareReview = async () => {
    if (!account) { setIsWalletModalOpen(true); return; }
    if (recipients.length === 0) return;
    const provider = account.provider;
    if (account.walletId !== 'kasware' || typeof provider?.signPskt !== 'function' || typeof provider?.pushTx !== 'function') {
      setTransactionError('Single-approval dispersals currently require KasWare Wallet.');
      return;
    }
    setIsProcessing(true);
    setTransactionError('');
    try {
      const firstUnsent = statuses.findIndex(status => status.status !== 'sent');
      const recipientStart = firstUnsent === -1 ? 0 : firstUnsent;
      const { review: nextReview, recipientCount } = await buildLargestSafeReview(recipientStart);
      setReview({
        ...nextReview,
        batchNumber: statuses.filter(status => status.status === 'sent').length > 0
          ? completedTxIds.length + 1
          : 1,
        batchCount: completedTxIds.length + Math.ceil((recipients.length - recipientStart) / recipientCount),
        recipientStart,
        recipientCount,
      });
    } catch (err: any) {
      setTransactionError(err?.message ?? 'Could not prepare transaction.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignAndBroadcast = async () => {
    if (!account || !review) return;
    setIsProcessing(true);
    setTransactionError('');
    try {
      if (typeof account.provider?.getAccounts === 'function') {
        const liveAccounts = await account.provider.getAccounts();
        const liveAddress = typeof liveAccounts?.[0] === 'string'
          ? liveAccounts[0]
          : liveAccounts?.[0]?.address;
        if (!liveAddress || liveAddress !== account.address) {
          throw new Error(
            'The active KasWare account changed after this transaction was prepared. Reconnect the wallet and prepare a new review before signing.',
          );
        }
      }
      let currentReview = review;
      let recipientStart = review.recipientStart;
      let lastTxId = '';
      const excludedOutpoints = [...review.inputOutpoints];

      while (recipientStart < recipients.length) {
        const recipientCount = currentReview.recipientCount;
        setReview(currentReview);
        setStatuses(previous => previous.map((status, index) =>
          index >= recipientStart && index < recipientStart + recipientCount
            ? { status: 'signing', txId: '' }
            : status,
        ));
        setServiceFeeStatus({ status: 'signing', txId: '' });

        const signed = await account.provider.signPskt({
          txJsonString: currentReview.txJsonString,
          options: {
            signInputs: currentReview.inputIndicesToSign.map(index => ({ index, sighashType: 1 })),
          },
        });
        const signedJson = typeof signed === 'string' ? signed : signed?.txJsonString;
        if (!signedJson) throw new Error('KasWare did not return a signed transaction.');
        const pushed = await account.provider.pushTx(signedJson);
        lastTxId = typeof pushed === 'string'
          ? (() => { try { return JSON.parse(pushed)?.id ?? pushed; } catch { return pushed; } })()
          : (pushed?.id ?? pushed?.txId ?? '');
        if (!lastTxId) {
          throw new Error('KasWare submitted the transaction but did not return a transaction ID.');
        }
        setCompletedTxIds(previous => (
          previous.includes(lastTxId) ? previous : [...previous, lastTxId]
        ));
        setStatuses(previous => previous.map((status, index) =>
          index >= recipientStart && index < recipientStart + recipientCount
            ? { status: 'sent', txId: lastTxId }
            : status,
        ));

        recipientStart += recipientCount;
        if (recipientStart >= recipients.length) break;

        let nextBatch: { review: TransactionReview; recipientCount: number } | null = null;
        let lastError: any = null;
        for (let attempt = 0; attempt < NEXT_BATCH_MAX_RETRIES; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, NEXT_BATCH_RETRY_DELAY_MS));
          try {
            nextBatch = await buildLargestSafeReview(recipientStart, excludedOutpoints);
            break;
          } catch (err) {
            lastError = err;
          }
        }
        if (!nextBatch) {
          throw new Error(
            `Batch ${currentReview.batchNumber + 1} could not be prepared after waiting for the previous transaction. ${lastError?.message ?? ''}`.trim(),
          );
        }
        const { review: nextReview, recipientCount: nextRecipientCount } = nextBatch;
        excludedOutpoints.push(...nextReview.inputOutpoints);
        const nextBatchNumber = currentReview.batchNumber + 1;
        currentReview = {
          ...nextReview,
          batchNumber: nextBatchNumber,
          batchCount: nextBatchNumber - 1 + Math.ceil((recipients.length - recipientStart) / nextRecipientCount),
          recipientStart,
          recipientCount: nextRecipientCount,
        };
      }

      setServiceFeeStatus({ status: 'sent', txId: lastTxId });
      setReview(null);
    } catch (err: any) {
      const message = err?.message ?? 'Transaction was rejected.';
      setStatuses(previous => previous.map(status =>
        status.status === 'signing'
          ? { status: 'failed', txId: '', error: message }
          : status,
      ));
      setServiceFeeStatus({ status: 'failed', txId: '', error: message });
      setTransactionError(message);
      setReview(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const totalKas = recipients.reduce((s, r) => s + r.amount, 0);
  const sentCount = statuses.filter(s => s.status === 'sent').length;
  const failedCount = statuses.filter(s => s.status === 'failed').length;
  const pendingCount = statuses.filter(s => s.status === 'pending').length;
  const signingIdx = statuses.findIndex(s => s.status === 'signing');
  const isFeeSigning = serviceFeeStatus.status === 'signing';
  const sompiToKas = (sompi: string) => (Number(sompi) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 });

  // ── Render ───────────────────────────────────────────────────────────────
  const tool = (
    <div className="relative min-h-[min(92dvh,1100px)] overflow-hidden rounded-2xl bg-[#030914] flex flex-col z-10 selection:bg-primary/30 selection:text-white">
      <GridBackground />

       <nav aria-label="Distribution type" className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-7">
         <div className="inline-flex flex-wrap gap-1 rounded-xl border border-primary/20 bg-[#050c18]/90 p-1">
           <span aria-current="page" className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[#02050a]">
             KAS DISTRO
           </span>
           <a
             href="/kcc20"
             data-testid="link-kcc20-distribution"
             className="rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white/65 transition hover:bg-white/10 hover:text-white"
           >
             KCC20 DISTRO
           </a>
         </div>
       </nav>

       {/* MAIN */}
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-10 grid lg:grid-cols-12 gap-8 flex-1 items-stretch">

        {/* LEFT — Input */}
        <section className="lg:col-span-8 h-full">
          <div className="glass-panel h-full p-1 rounded-2xl relative overflow-hidden group transition-all duration-500 border-2 border-primary shadow-[0_0_24px_rgba(11,213,188,0.24)]">
            {/* Ambient hover glow */}
            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none blur-xl"></div>
            
            <div className="bg-[#050c18]/90 rounded-[14px] p-6 h-full flex flex-col relative z-10">
              <div className="flex items-center mb-6">
                <label className="text-sm font-semibold tracking-wide text-white/90 flex items-center gap-2 uppercase">
                  <Fingerprint className="h-4 w-4 text-primary" />
                   Dynamic Mass-Safe Batching
                </label>
              </div>

              <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-primary">
                  <Search className="h-3.5 w-3.5" />
                  Import Token Holders
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                  <input
                    value={tokenIdentifier}
                    onChange={(event) => setTokenIdentifier(event.target.value)}
                    placeholder="KCC-20 Token ID"
                    className="min-w-0 rounded-lg border border-white/10 bg-[#02050a] px-3 py-2.5 font-mono text-xs text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <input
                    value={kasPerHolder}
                    onChange={(event) => setKasPerHolder(event.target.value)}
                    inputMode="decimal"
                    placeholder="KAS each"
                    aria-label="KAS per holder"
                    className="min-w-0 rounded-lg border border-white/10 bg-[#02050a] px-3 py-2.5 font-mono text-xs text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    onClick={handleImportTokenHolders}
                    disabled={holderImportLoading}
                    className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#02050a] transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {holderImportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    {holderImportLoading ? 'Loading' : 'Import'}
                  </button>
                </div>
                <div className="mt-2 text-[10px] leading-relaxed text-white/35">
                  Kaspa L1 KRC-20 uses its ticker, not a 0x contract address. KCC-20 uses the 64-character token ID. Complete holder lists are imported only when the indexer exposes every holder.
                </div>
                {holderIndexingStatus && (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-white/70" role="status" aria-live="polite">
                    <div className="flex items-center gap-2 text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="font-semibold">
                        {holderIndexingStatus.status === 'queued' ? 'Queued for complete indexing' : 'Indexing complete holder history'}
                      </span>
                    </div>
                    <div className="mt-1">
                      Processed {holderIndexingStatus.processedOperations.toLocaleString()} operations
                      {holderIndexingStatus.totalOperations ? ` of ${holderIndexingStatus.totalOperations.toLocaleString()}` : ''}
                      {holderIndexingStatus.expectedHolders ? ` · ${holderIndexingStatus.expectedHolders.toLocaleString()} holders expected` : ''}
                    </div>
                  </div>
                )}
                {holderImportError && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{holderImportError}</span>
                  </div>
                )}
                {holderImportResult && (
                  <div className="mt-3 text-xs text-primary">
                    Imported {holderImportResult.imported} {holderImportResult.protocol} holder addresses
                    {holderImportResult.ticker ? ` for ${holderImportResult.ticker}` : ''}
                    {holderImportResult.excludedCovenantHolders
                      ? ` (${holderImportResult.excludedCovenantHolders} covenant-owned balance excluded)`
                      : ''}
                    {holderImportResult.excludedBurnAddresses
                      ? ` (${holderImportResult.excludedBurnAddresses} burn address excluded)`
                      : ''}
                    .
                  </div>
                )}
              </div>

              <textarea
                rows={12}
                value={rawInput}
                onChange={(e) => handleParseInput(e.target.value)}
                placeholder={`Example:\nkaspa:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx 0000`}
                className="w-full flex-1 rounded-xl bg-[#02050a] border border-white/5 p-5 font-mono text-sm text-primary/80 placeholder:text-primary/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition resize-none custom-scrollbar shadow-inner"
              />

              <div className="text-xs text-white/40 flex justify-between mt-4 uppercase tracking-widest font-mono">
                <span>FMT: ADDR AMT</span>
                <span>MAX MASS LIMITS APPLY</span>
              </div>

              {parseErrors.length > 0 && (
                <div className="mt-4 rounded-xl bg-destructive/10 border border-destructive/20 p-4 space-y-1.5 text-xs text-destructive/90 backdrop-blur-sm">
                  <div className="font-bold flex items-center gap-1.5 tracking-wide">
                    <AlertCircle className="h-4 w-4" /> PARSE ERRORS ({parseErrors.length})
                  </div>
                  <ul className="list-disc list-inside space-y-1 opacity-80 max-h-24 overflow-y-auto font-mono text-[11px] custom-scrollbar pl-1">
                    {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT — Summary + Actions */}
        <section className="lg:col-span-4 h-full">
          <div className="glass-panel h-full p-1 rounded-2xl relative border-2 border-primary shadow-[0_0_24px_rgba(11,213,188,0.24)]">
            <div className="bg-[#050c18]/90 rounded-[14px] p-6 h-full flex flex-col relative z-10 space-y-6">
              
              {/* Wallet Connection Status */}
              <div className="flex items-center justify-center pb-6 border-b border-white/5">
                {account ? (
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs font-bold text-primary">{account.walletName}</div>
                      <div className="text-[10px] text-white/50 font-mono tracking-wider">
                        {account.address.slice(0, 10)}…{account.address.slice(-6)}
                      </div>
                    </div>
                    <button
                      onClick={() => setAccount(null)}
                      className="p-2 bg-white/5 hover:bg-destructive/20 text-white/50 hover:text-destructive rounded-lg transition-colors group"
                      title="Disconnect"
                    >
                      <X className="h-4 w-4 group-hover:scale-110 transition-transform" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsWalletModalOpen(true)}
                    className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-[#02050a] font-bold text-xs px-4 py-2 rounded-lg transition-all glow-primary glow-primary-hover uppercase tracking-wider"
                  >
                    <Wallet className="h-3.5 w-3.5" /> Connect Wallet
                  </button>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-black/40 border border-white/5 p-4 shadow-inner relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Layers className="h-10 w-10 text-white" />
                  </div>
                  <div className="text-xs font-semibold text-white/40 tracking-widest uppercase mb-1">Recipients</div>
                  <div className="text-2xl font-black text-white font-mono">{recipients.length}</div>
                </div>
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 shadow-inner relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Zap className="h-10 w-10 text-primary" />
                  </div>
                  <div className="text-xs font-semibold text-primary/60 tracking-widest uppercase mb-1">Total Amount</div>
                  <div className="text-2xl font-black text-primary font-mono tracking-tight">
                    {totalKas.toLocaleString(undefined, { maximumFractionDigits: 8 })} <span className="text-xs tracking-normal">KAS</span>
                  </div>
                </div>
              </div>

              {/* Status Modules */}
              <div className="space-y-3">
                <div className="rounded-xl bg-white/5 border border-white/5 p-4 text-xs">
                  <div className="flex items-center justify-between font-bold text-white/80 uppercase tracking-wider mb-2">
                    <span>Service Fee</span>
                    <span className="text-primary font-mono bg-primary/10 px-2 py-0.5 rounded text-[10px] border border-primary/20">{SERVICE_FEE_KAS} KAS</span>
                  </div>
                  <div className="text-white/40 leading-relaxed font-light">
                     Included in the same atomic transaction as every recipient. Fixed cost per batch.
                  </div>
                </div>

                {review && (
                  <div className="rounded-xl bg-primary/10 border border-primary/30 p-4 text-xs space-y-3 shadow-[0_0_15px_rgba(11,213,188,0.1)_inset]">
                    <div className="font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5" /> Review Transaction
                    </div>
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/50">
                      <span>Batch {review.batchNumber} of ~{review.batchCount}</span>
                      <span>{review.recipientCount} recipients</span>
                    </div>
                    <div className="space-y-2 font-mono text-[11px]">
                      <div className="flex justify-between items-end"><span className="text-white/50 uppercase">Recipients</span><span className="text-white">{sompiToKas(review.recipientTotalSompi)} KAS</span></div>
                      <div className="flex justify-between items-end"><span className="text-white/50 uppercase">Service fee</span><span className="text-white">{sompiToKas(review.serviceFeeSompi)} KAS</span></div>
                      <div className="flex justify-between items-end"><span className="text-white/50 uppercase">Network fee</span><span className="text-white/80">{sompiToKas(review.networkFeeSompi)} KAS</span></div>
                    </div>
                    <div className="flex justify-between border-t border-primary/20 pt-3 font-black text-primary text-sm font-mono items-end">
                      <span className="uppercase tracking-widest text-xs">Grand Total</span>
                      <span>{sompiToKas(review.grandTotalSompi)} KAS</span>
                    </div>
                    <div className="text-[9px] text-white/30 uppercase tracking-widest flex justify-between font-mono">
                      <span>
                        Compute: {(review.computeMass ?? review.mass).toLocaleString()} / {(review.maximumComputeMass ?? review.maximumMass).toLocaleString()}
                      </span>
                      {review.storageMass != null && (
                        <span>
                          Storage: {review.storageMass.toLocaleString()} / {(review.maximumStorageMass ?? 500000).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {transactionError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-xs text-destructive/90 backdrop-blur-sm leading-relaxed">
                    {transactionError}
                  </div>
                )}

                {completedTxIds.length > 0 && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl bg-primary/10 border border-primary/30 p-4 text-xs shadow-[0_0_15px_rgba(11,213,188,0.1)_inset]"
                  >
                    <div className="flex items-center gap-2 font-bold text-primary uppercase tracking-wider">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {completedTxIds.length === 1
                        ? 'Transaction complete on Kaspa'
                        : `${completedTxIds.length} transactions complete on Kaspa`}
                    </div>
                    <div className="mt-3 space-y-2">
                      {completedTxIds.map((txId, index) => (
                        <a
                          key={txId}
                          href={`https://explorer.kaspa.org/txs/${txId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-black/20 px-3 py-2 font-mono text-[10px] text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
                        >
                          <span className="truncate">
                            {completedTxIds.length > 1 ? `Batch ${index + 1}: ` : ''}
                            {txId}
                          </span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Progress during send */}
              {isProcessing && (signingIdx !== -1 || isFeeSigning) && (
                <div className="rounded-xl bg-primary/10 border border-primary/30 p-4 text-xs text-primary flex items-center gap-3 shadow-[0_0_15px_rgba(11,213,188,0.1)_inset] animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span className="font-semibold tracking-wide">
                    {isFeeSigning
                      ? `APPROVING DYNAMIC BATCH ${review?.batchNumber ?? 1}...`
                      : `SIGNING ${recipients.length} RECIPIENTS...`}
                  </span>
                </div>
              )}

              {/* Transfer list */}
              {recipients.length > 0 && (
                <div className="flex flex-col min-h-0">
                  <div className="text-[10px] font-bold text-white/30 flex justify-between uppercase tracking-widest mb-3">
                    <span>Distribution Queue</span>
                    <div className="flex gap-3">
                      {sentCount > 0 && <span className="text-primary">{sentCount} SENT</span>}
                      {failedCount > 0 && <span className="text-destructive">{failedCount} FAILED</span>}
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-2 custom-scrollbar">
                    {recipients.map((r, idx) => {
                      const st = statuses[idx] ?? { status: 'pending', txId: '' };
                      return (
                        <div key={idx} className="flex min-h-[46px] items-center justify-between rounded-lg bg-black/30 border border-white/5 p-3 text-xs group hover:bg-black/50 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between mb-1 pr-4">
                              <div className="font-mono font-bold text-white tracking-tight">{r.amount} KAS</div>
                              <div className="font-mono text-white/40 truncate text-[10px] group-hover:text-white/60 transition-colors">
                                {r.address.slice(0, 12)}…{r.address.slice(-6)}
                              </div>
                            </div>
                            {st.txId && (
                              <a
                                href={`https://explorer.kaspa.org/txs/${st.txId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[9px] text-primary hover:text-primary/70 flex items-center gap-1 font-mono tracking-widest transition-colors w-max"
                              >
                                TX: {st.txId.slice(0, 12)}… <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                            {st.error && <div className="text-[10px] text-destructive mt-1 font-mono">{st.error}</div>}
                          </div>
                          <div className="shrink-0 flex items-center justify-end w-20">
                            {st.status === 'pending' && <span className="text-white/20 text-[10px] uppercase font-bold tracking-wider">Pending</span>}
                            {st.status === 'signing' && (
                              <span className="text-primary flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider">
                                <Loader2 className="h-3 w-3 animate-spin" /> Sign
                              </span>
                            )}
                            {st.status === 'sent' && (
                              <span className="text-primary flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                              </span>
                            )}
                            {st.status === 'failed' && (
                              <span className="text-destructive flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider">
                                <AlertCircle className="h-3.5 w-3.5" /> Fail
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs mt-3 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                    <div className="min-w-0 flex-1 pl-2">
                      <div className="flex items-baseline justify-between mb-1 pr-4">
                        <div className="font-bold text-primary uppercase tracking-wider text-[10px]">Service Fee</div>
                        <div className="font-mono text-primary/40 truncate text-[10px]">
                          {SERVICE_FEE_ADDRESS.slice(0, 10)}…{SERVICE_FEE_ADDRESS.slice(-6)}
                        </div>
                      </div>
                      {serviceFeeStatus.txId && (
                        <a
                          href={`https://explorer.kaspa.org/txs/${serviceFeeStatus.txId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[9px] text-primary hover:text-white flex items-center gap-1 font-mono tracking-widest transition-colors w-max"
                        >
                          TX: {serviceFeeStatus.txId.slice(0, 12)}… <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {serviceFeeStatus.error && (
                        <div className="text-[10px] text-destructive mt-1 font-mono">{serviceFeeStatus.error}</div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center justify-end w-24">
                      {serviceFeeStatus.status === 'pending' && <span className="text-white/20 text-[9px] uppercase font-bold tracking-wider text-right leading-tight">Same TX</span>}
                      {serviceFeeStatus.status === 'signing' && (
                        <span className="text-primary flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider">
                          <Loader2 className="h-3 w-3 animate-spin" /> Apprv
                        </span>
                      )}
                      {serviceFeeStatus.status === 'sent' && (
                        <span className="text-primary flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                        </span>
                      )}
                      {serviceFeeStatus.status === 'failed' && (
                        <span className="text-destructive flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider">
                          <AlertCircle className="h-3.5 w-3.5" /> Fail
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Keep the action anchored independently of queue length. */}
              <div className="flex-1 min-h-4"></div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  disabled={isProcessing || recipients.length === 0}
                  onClick={review ? handleSignAndBroadcast : handlePrepareReview}
                  className={`w-full py-4 rounded-xl font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 transition-all duration-300 relative overflow-hidden ${
                    isProcessing || recipients.length === 0
                      ? 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
                      : 'bg-primary hover:bg-[#0cf2d5] text-[#02050a] glow-primary glow-primary-hover border border-transparent hover:scale-[1.02]'
                  }`}
                >
                  {!isProcessing && recipients.length > 0 && (
                    <div className="absolute inset-0 bg-white/20 translate-y-[100%] hover:translate-y-0 transition-transform duration-300 pointer-events-none"></div>
                  )}
                  
                  {isProcessing ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> {review ? 'AWAITING KASWARE...' : 'PREPARING TX...'}</>
                  ) : (
                    <><Send className="h-4 w-4" /> {review
                      ? `APPROVE DYNAMIC BATCH ${review.batchNumber}`
                      : 'REVIEW DYNAMIC BATCHES'}
                    </>
                  )}
                </button>

                {recipients.length > 0 && !isProcessing && (
                  <p className="text-[10px] text-white/30 text-center mt-4 uppercase tracking-widest font-mono">
                    <span className="text-white/60 font-bold">Batch size calculated from live transaction mass</span>
                    {' '}• wallet approval required for each
                  </p>
                )}
              </div>

            </div>
          </div>
        </section>
      </main>

      {/* WALLET MODAL */}
      {isWalletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02050a]/90 backdrop-blur-md p-4">
          <div className="glass-panel p-1 rounded-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#050c18] rounded-[14px] p-6 relative overflow-hidden shadow-2xl">
              
              {/* Modal decorative grid */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>
              
              <div className="relative z-10 flex items-center justify-between pb-6 border-b border-white/10 mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
                    <Wallet className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="text-lg font-bold tracking-wide uppercase text-white/90">CONNECT WALLET</h2>
                </div>
                <button
                  onClick={() => setIsWalletModalOpen(false)}
                  className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="relative z-10 space-y-3">
                {walletError && (
                  <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-xs text-destructive/90 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {walletError}
                  </div>
                )}

                {KASPA_WALLETS.map((wallet) => {
                  const isInstalled = wallet.type !== 'extension' || installedMap[wallet.id];
                  const isLoading = walletLoading === wallet.id;
                  
                  return (
                    <div
                      key={wallet.id}
                      onClick={() => isInstalled && !isLoading && handleConnectWallet(wallet)}
                      className={`group flex items-center justify-between p-4 rounded-xl border transition-all duration-300 ${
                        isInstalled
                          ? 'border-white/10 bg-white/5 hover:bg-primary/5 hover:border-primary/30 cursor-pointer hover:shadow-[0_0_15px_rgba(11,213,188,0.1)_inset]'
                          : 'border-white/5 bg-black/40 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-lg bg-black/50 p-2 flex items-center justify-center border border-white/5 group-hover:border-primary/20 transition-colors">
                          <img
                            src={wallet.icon}
                            alt={wallet.name}
                            className="h-full w-full object-contain filter grayscale group-hover:grayscale-0 transition-all duration-300"
                            onError={(e) => {
                              (e.target as HTMLImageElement).onerror = null;
                              (e.target as HTMLImageElement).src = 'https://kaspa.org/wp-content/uploads/2022/09/kaspa-icon.png';
                            }}
                          />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white tracking-wide">{wallet.name}</div>
                          <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono mt-0.5 block">
                            {wallet.type === 'extension'
                              ? (isInstalled ? 'BROWSER EXT' : 'NOT INSTALLED')
                              : `APP`}
                          </span>
                        </div>
                      </div>
                      
                      <div className="shrink-0">
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        ) : isInstalled ? (
                          <div className="h-6 w-6 rounded-full border border-white/10 flex items-center justify-center group-hover:border-primary/40 group-hover:bg-primary/10 transition-colors">
                            <div className="h-1.5 w-1.5 rounded-full bg-white/20 group-hover:bg-primary group-hover:shadow-[0_0_5px_rgba(11,213,188,0.8)] transition-all"></div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Global CSS injected specifically for the scrollbar to match the theme */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(11, 213, 188, 0.2);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(11, 213, 188, 0.4);
        }
      `}</style>
    </div>
  );

  return (
    <LandingLayout showGrid={false}>
      <div className="px-4 sm:px-6 py-10">{tool}</div>
    </LandingLayout>
  );
}