import {
  CheckCircle2,
  Coins,
  Globe,
  LayoutDashboard,
  Lock,
  PieChart,
  Send,
  Shield,
  Upload,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { type ReactNode } from 'react';
import { type WalletAccount } from '@/lib/dispenser/wallets';
import { cn } from '@/lib/utils';
import { DispenserBrand } from './brand-logo';

const NAV = [
  { id: 'dispenser', label: 'Dispenser', href: '/', icon: LayoutDashboard },
  { id: 'how', label: 'How It Works', href: '/#how-it-works', icon: Zap },
  { id: 'fees', label: 'Fees', href: '/#fees', icon: PieChart },
] as const;

interface AppLayoutProps {
  children: ReactNode;
  account?: WalletAccount | null;
  onConnect?: () => void;
  footerStats?: Array<{ label: string; value: string; sub?: string }>;
}

export function AppLayout({ children, account, onConnect, footerStats }: AppLayoutProps) {
  const [location] = useLocation();
  const connected = !!account;

  return (
    <div className="kd-app min-h-screen flex text-zinc-100">
      <aside className="hidden lg:flex w-[200px] shrink-0 flex-col border-r border-cyan-900/20 bg-[#070b10]/90 backdrop-blur-xl">
        <div className="p-4 border-b border-cyan-900/20">
          <Link href="/">
            <DispenserBrand compact />
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ id, label, href, icon: Icon }) => {
            const active = id === 'dispenser' ? location === '/' : false;
            return (
              <a
                key={id}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition',
                  active
                    ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </a>
            );
          })}
        </nav>
        <div className="p-3 m-2 rounded-xl kd-glass text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Built on Kaspa</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="shrink-0 border-b border-cyan-900/20 bg-[#070b10]/80 backdrop-blur-xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="lg:hidden">
            <DispenserBrand compact />
          </div>
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <span className="kd-pill text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Kaspa Mainnet
            </span>
            {connected ? (
              <span className="kd-pill text-[11px] text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                className="kd-pill text-[11px] text-cyan-300 hover:border-cyan-500/40"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>

        {footerStats && footerStats.length > 0 && (
          <footer className="shrink-0 border-t border-cyan-900/20 bg-[#070b10]/90">
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-cyan-900/20">
              {footerStats.map((stat) => (
                <div key={stat.label} className="px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</div>
                  <div className="text-base font-bold text-white">{stat.value}</div>
                  {stat.sub && <div className="text-[10px] text-zinc-500">{stat.sub}</div>}
                </div>
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

export function WalletCard({
  account,
  onConnect,
  onDisconnect,
}: {
  account?: WalletAccount | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
}) {
  if (!account) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="kd-glass w-full rounded-xl p-4 flex items-center gap-3 text-left hover:border-cyan-500/30 transition"
      >
        <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
          <Wallet className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <div className="text-sm font-medium text-white">Connect Wallet</div>
          <div className="text-xs text-zinc-500">KasWare, Kastle, Nightly & more</div>
        </div>
      </button>
    );
  }

  return (
    <div className="kd-glass rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-black font-bold shrink-0">
          K
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">{account.walletName}</div>
          <div className="text-[11px] text-zinc-500 font-mono truncate">
            {account.address.slice(0, 14)}…{account.address.slice(-6)}
          </div>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          className="text-[11px] text-zinc-500 hover:text-white"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

export { Globe, Lock, Send, Shield, Upload, Users, Wallet };
