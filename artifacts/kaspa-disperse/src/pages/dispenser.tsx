import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  Search,
  Send,
  Trash2,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { ToolLayout, WalletCard } from '@/components/dispenser/tool-layout';
import { WalletModal } from '@/components/dispenser/wallet-modal';
import { useDispenser } from '@/hooks/use-dispenser';
import { SERVICE_FEE_KAS } from '@/lib/dispenser/constants';

function TransferStatus({ status }: { status: string }) {
  switch (status) {
    case 'sent':
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" /> Sent
        </span>
      );
    case 'signing':
      return (
        <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-red-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5" /> Failed
        </span>
      );
    default:
      return <span className="text-zinc-600 text-xs">Pending</span>;
  }
}

export default function Dispenser() {
  const d = useDispenser();
  const [search, setSearch] = useState('');

  const filteredRecipients = d.recipients
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !search || r.address.toLowerCase().includes(search.toLowerCase()));

  const footerStats =
    d.recipients.length > 0
      ? [
          { label: 'Recipients', value: String(d.recipients.length), sub: 'This drop' },
          {
            label: 'KAS Distributed',
            value: d.totalKas.toLocaleString(undefined, { maximumFractionDigits: 4 }),
            sub: 'To recipients',
          },
          { label: 'Service Fee', value: `${SERVICE_FEE_KAS} KAS`, sub: 'Flat per drop' },
          {
            label: 'Total',
            value: d.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 4 }),
            sub: 'KAS + network fees',
          },
        ]
      : undefined;

  return (
    <ToolLayout
      account={d.account}
      onConnect={() => d.setIsWalletModalOpen(true)}
      footerStats={footerStats}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dispenser</h1>
          <p className="text-sm text-zinc-500 mt-1">Upload recipients, review fees, and dispense KAS rewards.</p>
        </div>

        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8">
          {/* Input + table */}
          <div className="lg:col-span-7 space-y-6">
            <WalletCard
              account={d.account}
              onConnect={() => d.setIsWalletModalOpen(true)}
              onDisconnect={() => d.setAccount(null)}
            />

            <div className="kd-glass-strong rounded-2xl overflow-hidden">
              <div className="flex border-b border-cyan-900/20">
                {(['manual', 'csv'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => d.setInputTab(tab)}
                    className={`flex-1 py-3 text-sm font-medium transition ${
                      d.inputTab === tab
                        ? 'text-cyan-300 bg-cyan-500/5 border-b-2 border-cyan-400'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab === 'manual' ? 'Manual Entry' : 'Upload CSV'}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {d.inputTab === 'manual' ? (
                  <textarea
                    rows={10}
                    value={d.rawInput}
                    onChange={(e) => d.handleParseInput(e.target.value)}
                    placeholder={'kaspa:qq2... 10\nkaspa:qr8... 25.5\n\nOne address and amount per line'}
                    className="w-full rounded-xl bg-black/40 border border-cyan-900/20 p-4 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40 resize-none"
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onDragOver={(e) => { e.preventDefault(); d.setDragOver(true); }}
                    onDragLeave={() => d.setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      d.setDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (file) d.handleFile(file);
                    }}
                    onClick={() => d.fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === 'Enter' && d.fileInputRef.current?.click()}
                    className={`rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition ${
                      d.dragOver ? 'border-cyan-400 bg-cyan-500/10' : 'border-cyan-900/30 hover:border-cyan-500/30'
                    }`}
                  >
                    <input
                      type="file"
                      accept=".csv,.txt"
                      ref={d.fileInputRef}
                      onChange={(e) => e.target.files?.[0] && d.handleFile(e.target.files[0])}
                      className="hidden"
                    />
                    <Upload className="h-10 w-10 text-cyan-400/50 mx-auto mb-3" />
                    <p className="text-sm text-zinc-300">Drag &amp; drop your CSV file here</p>
                    <p className="text-xs text-zinc-500 mt-1">or click to browse · address, amount</p>
                  </div>
                )}
                {d.parseErrors.length > 0 && (
                  <p className="mt-3 text-xs text-red-400">{d.parseErrors.length} line(s) could not be parsed</p>
                )}
              </div>
            </div>

            <div className="kd-glass-strong rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-cyan-900/20 flex items-center justify-between gap-4">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-cyan-400" />
                  Recipients ({d.recipients.length})
                </h2>
                {d.recipients.length > 0 && (
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search…"
                      className="pl-8 pr-3 py-1.5 rounded-lg bg-black/30 border border-cyan-900/20 text-xs w-36 focus:outline-none focus:border-cyan-500/40"
                    />
                  </div>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0b1118] text-[10px] text-zinc-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3 text-left w-10">#</th>
                      <th className="px-5 py-3 text-left">Address</th>
                      <th className="px-5 py-3 text-right">Amount</th>
                      <th className="px-5 py-3 text-right w-16">Status</th>
                      <th className="px-5 py-3 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.recipients.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-12 text-center text-zinc-500 text-sm">
                          No recipients yet — paste addresses above or upload a CSV
                        </td>
                      </tr>
                    ) : (
                      filteredRecipients.map(({ r, i }) => {
                        const st = d.statuses[i];
                        return (
                          <tr key={i} className="border-t border-cyan-900/10 hover:bg-white/[0.02]">
                            <td className="px-5 py-3 text-zinc-500 text-xs">{i + 1}</td>
                            <td className="px-5 py-3 font-mono text-xs text-zinc-300">
                              {r.address.slice(0, 20)}…{r.address.slice(-6)}
                            </td>
                            <td className="px-5 py-3 text-right font-medium text-cyan-300">{r.amount} KAS</td>
                            <td className="px-5 py-3 text-right">
                              <TransferStatus status={st?.status ?? 'pending'} />
                            </td>
                            <td className="px-5 py-3 text-right">
                              {!d.isProcessing && (
                                <button
                                  type="button"
                                  onClick={() => d.removeRecipient(i)}
                                  className="text-zinc-600 hover:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="lg:col-span-5">
            <div className="kd-glass-strong rounded-2xl p-6 lg:sticky lg:top-6 space-y-5">
              <h2 className="font-semibold text-white text-lg">Transaction Summary</h2>

              <div className="space-y-3 text-sm">
                {d.review ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Recipients</span>
                      <span className="text-white font-medium">{d.sompiToKas(d.review.recipientTotalSompi)} KAS</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Service Fee</span>
                      <span className="text-amber-300/90">{d.sompiToKas(d.review.serviceFeeSompi)} KAS</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400 flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-zinc-500" /> Network Fee
                      </span>
                      <span className="text-zinc-500">{d.sompiToKas(d.review.networkFeeSompi)} KAS</span>
                    </div>
                    <p className="text-[10px] text-zinc-500">
                      Transaction mass: {d.review.mass.toLocaleString()} / {d.review.maximumMass.toLocaleString()}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Total Amount</span>
                      <span className="text-white font-medium">
                        {d.totalKas.toLocaleString(undefined, { maximumFractionDigits: 4 })} KAS
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400 flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-zinc-500" /> Network Fee
                      </span>
                      <span className="text-zinc-500">Calculated on review</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Service Fee</span>
                      <span className="text-amber-300/90">{SERVICE_FEE_KAS} KAS</span>
                    </div>
                  </>
                )}
              </div>

              <div className="kd-glass rounded-xl p-5 border-cyan-500/20">
                <div className="text-xs text-zinc-500 uppercase tracking-wider">Total to Send</div>
                <div className="text-3xl font-bold text-cyan-300 mt-1">
                  {d.review
                    ? `${d.sompiToKas(d.review.grandTotalSompi)} KAS`
                    : `${d.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 4 })} KAS`}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {d.review ? 'Includes network fee' : '+ Kaspa network fees'}
                </div>
              </div>

              {d.transactionError && (
                <p className="text-xs text-red-400 leading-relaxed">{d.transactionError}</p>
              )}

              {d.isProcessing && (
                <div className="rounded-xl bg-amber-950/20 border border-amber-800/30 p-3 text-xs text-amber-300 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {d.review ? 'Waiting for KasWare…' : 'Preparing review…'}
                </div>
              )}

              {d.recipients.length > 0 && !d.isProcessing && (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  {d.review
                    ? 'Approve once in KasWare to send all recipients and the service fee together.'
                    : `Review ${d.totalKas.toFixed(4)} KAS to ${d.recipients.length} recipients plus a ${SERVICE_FEE_KAS} KAS service fee. Single approval via KasWare.`}
                </p>
              )}

              <button
                type="button"
                disabled={d.isProcessing || d.recipients.length === 0}
                onClick={d.handleExecute}
                className="kd-btn w-full flex items-center justify-center gap-2 py-4 rounded-xl text-black font-bold uppercase tracking-wide text-sm"
              >
                {d.isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {d.review ? 'Waiting for KasWare…' : 'Preparing review…'}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {d.review ? 'Approve & Send Once' : `Review KAS + ${SERVICE_FEE_KAS} KAS Fee`}
                  </>
                )}
              </button>

              {d.serviceFeeStatus.status === 'sent' && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 justify-center">
                  <CheckCircle2 className="h-4 w-4" /> Distribution complete
                </p>
              )}

              {d.recipients.some((_, i) => d.statuses[i]?.txId) && (
                <div className="pt-4 border-t border-cyan-900/20 space-y-2 max-h-40 overflow-y-auto">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Recent transactions</p>
                  {d.recipients.map((r, i) => {
                    const st = d.statuses[i];
                    if (!st?.txId) return null;
                    return (
                      <a
                        key={i}
                        href={`https://explorer.kaspa.org/txs/${st.txId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between text-xs text-zinc-400 hover:text-cyan-400"
                      >
                        <span className="truncate font-mono">{r.address.slice(0, 12)}…</span>
                        <ExternalLink className="h-3 w-3 shrink-0 ml-2" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <WalletModal
        open={d.isWalletModalOpen}
        onClose={() => d.setIsWalletModalOpen(false)}
        walletError={d.walletError}
        walletLoading={d.walletLoading}
        installedMap={d.installedMap}
        onConnect={d.handleConnectWallet}
      />
    </ToolLayout>
  );
}
