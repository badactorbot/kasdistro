import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { getInspectTestnetTokenQueryKey, useInspectTestnetToken } from '@workspace/api-client-react';
import { LandingLayout } from '@/components/dispenser/landing-layout';

type KasWare = {
  requestAccounts: () => Promise<Array<string | { address: string }>>;
  getNetwork: () => Promise<string>;
  signPskt?: unknown;
  pushTx?: unknown;
};

export default function TestnetLab() {
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState('');
  const [hasSigner, setHasSigner] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const params = { address, ticker: 'sssaa' };
  const ready = address.startsWith('kaspatest:') && (network === 'kaspa_testnet_10' || network === 'testnet-10');
  const inspection = useInspectTestnetToken(params, {
    query: { enabled: ready, queryKey: getInspectTestnetTokenQueryKey(params), retry: false, staleTime: 0 },
  });

  async function connect() {
    setError('');
    setAddress('');
    setNetwork('');
    setConnecting(true);
    try {
      const provider = (window as Window & { kasware?: KasWare }).kasware;
      if (!provider?.requestAccounts || !provider?.getNetwork) {
        throw new Error('KasWare is not available. Install or unlock its browser extension.');
      }
      const accounts = await provider.requestAccounts();
      const firstAccount: unknown = accounts?.[0];
      const selected = typeof firstAccount === 'string'
        ? firstAccount
        : firstAccount
          && typeof firstAccount === 'object'
          && 'address' in firstAccount
          && typeof firstAccount.address === 'string'
          ? firstAccount.address
          : undefined;
      const selectedNetwork = await provider.getNetwork();
      if (!selected?.startsWith('kaspatest:') ||
        (selectedNetwork !== 'kaspa_testnet_10' && selectedNetwork !== 'testnet-10')) {
        throw new Error('Select a kaspatest: account and testnet-10 in KasWare, then reconnect.');
      }
      setHasSigner(typeof provider.signPskt === 'function' && typeof provider.pushTx === 'function');
      setNetwork(selectedNetwork);
      setAddress(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to KasWare.');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <LandingLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-400 font-semibold">Research / testnet-10</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold text-white">KCC-20 distributor lab</h1>
          <p className="mt-4 max-w-2xl text-zinc-400 leading-relaxed">
            Verify your KasWare testnet wallet and inspect your SSSAA token against the live chain.
            This page is read-only: it cannot sign, deposit, or broadcast anything.
          </p>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 flex gap-4 text-amber-100">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <strong>Not safe for deposits yet.</strong>
            <p className="mt-1 text-sm text-amber-100/75">
              The prototype only compiles and passes off-chain model checks. Consensus validation,
              unsigned payout testing, stalled-funds recovery, and an independent security review are still required.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-cyan-900/30 bg-[#0b1118] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">1. Connect KasWare</h2>
              <p className="mt-1 text-sm text-zinc-500">Only testnet-10 accounts can be inspected here.</p>
            </div>
            <button
              type="button" onClick={connect} disabled={connecting}
              data-testid="button-connect-kasware-testnet"
              className="kd-btn inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-black disabled:opacity-60"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {address ? 'Reconnect wallet' : 'Connect KasWare'}
            </button>
          </div>
          {error && <p role="alert" data-testid="status-wallet-error" className="mt-5 text-sm text-red-400">{error}</p>}
          {ready && (
            <div className="mt-6 space-y-3 border-t border-white/10 pt-5 text-sm">
              <p className="flex items-center gap-2 text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Testnet-10 confirmed</p>
              <p className="text-zinc-400 break-all">Account: <span data-testid="text-testnet-address" className="text-zinc-200">{address}</span></p>
              <p data-testid="status-wallet-signer" className={hasSigner ? 'text-emerald-400' : 'text-amber-400'}>
                {hasSigner ? 'KasWare exposes signPskt and pushTx (not invoked)' : 'KasWare does not expose both v1 signing methods; payout test may be blocked'}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-cyan-900/30 bg-[#0b1118] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">2. Verify SSSAA on-chain</h2>
              <p className="mt-1 text-sm text-zinc-500">Checks KRON registry, indexer, Kaspa outputs and current unspent set.</p>
            </div>
            {ready && <button type="button" onClick={() => inspection.refetch()} disabled={inspection.isFetching}
              data-testid="button-refresh-token-inspection" aria-label="Refresh token inspection"
              className="p-2 rounded-lg text-cyan-400 hover:bg-cyan-400/10 disabled:opacity-50">
              <RefreshCw className={`h-5 w-5 ${inspection.isFetching ? 'animate-spin' : ''}`} />
            </button>}
          </div>
          {!ready && <p className="mt-6 text-zinc-500 text-sm">Connect your testnet-10 wallet to start the read-only check.</p>}
          {ready && inspection.isFetching && <p role="status" className="mt-6 text-cyan-300 text-sm">Checking live chain data…</p>}
          {ready && inspection.isError && (
            <p role="alert" data-testid="status-inspection-error" className="mt-6 text-red-400 text-sm">
              Preflight failed: {inspection.error?.message ?? 'Unknown error'}
            </p>
          )}
          {ready && inspection.data && (
            <div className="mt-6 border-t border-white/10 pt-5 grid gap-4 sm:grid-cols-2 text-sm">
              <div><p className="text-zinc-500">Token</p><p data-testid="text-token-ticker" className="text-white font-medium">{inspection.data.ticker} · {inspection.data.tokenDecimals} decimals</p></div>
              <div><p className="text-zinc-500">Confirmed unspent</p><p data-testid="text-token-balance" className="text-white font-medium">{BigInt(inspection.data.balanceUnits).toLocaleString()} units in {inspection.data.utxoCount} UTXOs</p></div>
              <div><p className="text-zinc-500">Owner mode</p><p className="text-zinc-200">Address-presence ({inspection.data.ownerMode})</p></div>
              <div><p className="text-zinc-500">Carrier</p><p className="text-zinc-200">0.5 TKAS per token output</p></div>
              <div className="sm:col-span-2"><p className="text-zinc-500">Token covenant ID</p><p data-testid="text-token-covenant" className="text-cyan-300 font-mono break-all">{inspection.data.tokenCovenantId}</p></div>
              <div className="sm:col-span-2"><p className="text-zinc-500">Verified SilverScript template hash</p><p data-testid="text-template-hash" className="text-cyan-300 font-mono break-all">{inspection.data.tokenTemplateHash}</p></div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 p-6 sm:p-8 text-zinc-300">
          <h2 className="text-xl font-semibold text-white">Next: consensus-level payout tests</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            A proposed tiny trial would distribute five SSSAA units back to the same testnet wallet in two
            batches. This is <strong className="text-white">not</strong> a transaction quote or an approval request.
            No testnet tokens or KAS should be deposited until the contract has been verified and a recovery path exists.
          </p>
          <a href="https://docs.kasware.xyz/wallet/developer-documentation/kaspa/kaspa-transaction#signpskt"
            target="_blank" rel="noopener noreferrer" data-testid="link-kasware-docs"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-cyan-400 hover:text-cyan-300">
            KasWare signing reference <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>
    </LandingLayout>
  );
}