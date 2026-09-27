import { Download, ExternalLink, Loader2, Wallet, X } from 'lucide-react';
import { KASPA_WALLETS } from '@/lib/dispenser/wallets';

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
  walletError: string;
  walletLoading: string | null;
  installedMap: Record<string, boolean>;
  onConnect: (wallet: (typeof KASPA_WALLETS)[number]) => void;
}

export function WalletModal({
  open,
  onClose,
  walletError,
  walletLoading,
  installedMap,
  onConnect,
}: WalletModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="relative w-full max-w-md kd-glass rounded-2xl p-6 shadow-2xl shadow-cyan-500/10">
        <div className="flex items-center justify-between pb-4 border-b border-cyan-900/30">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white">Connect Your Wallet</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {walletError && (
          <div className="mt-4 rounded-lg bg-red-950/50 border border-red-800/60 p-3 text-xs text-red-300">
            {walletError}
          </div>
        )}

        <div className="mt-4 space-y-2">
          {KASPA_WALLETS.map((wallet) => {
            const isInstalled = wallet.type !== 'extension' || installedMap[wallet.id];
            const isLoading = walletLoading === wallet.id;
            return (
              <div
                key={wallet.id}
                role="button"
                tabIndex={0}
                onClick={() => isInstalled && !isLoading && onConnect(wallet)}
                onKeyDown={(e) => e.key === 'Enter' && isInstalled && !isLoading && onConnect(wallet)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition cursor-pointer ${
                  isInstalled
                    ? 'border-cyan-900/30 bg-white/5 hover:bg-white/8 hover:border-cyan-500/30'
                    : 'border-zinc-800/50 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-900 p-1 flex items-center justify-center border border-zinc-700/50">
                    <img
                      src={wallet.icon}
                      alt={wallet.name}
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).onerror = null;
                        (e.target as HTMLImageElement).src =
                          'https://kaspa.org/wp-content/uploads/2022/09/kaspa-icon.png';
                      }}
                    />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{wallet.name}</div>
                    <span className="text-[11px] text-zinc-400">
                      {wallet.type === 'extension'
                        ? isInstalled
                          ? 'Browser Extension'
                          : 'Not Installed'
                        : `${wallet.type.charAt(0).toUpperCase()}${wallet.type.slice(1)} Wallet`}
                    </span>
                  </div>
                </div>
                <div>
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                  ) : !isInstalled ? (
                    <a
                      href={wallet.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      Get <Download className="h-3 w-3" />
                    </a>
                  ) : (
                    <ExternalLink className="h-4 w-4 text-zinc-500" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
