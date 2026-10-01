import { type ReactNode } from 'react';
import { Home } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { InductionNavButton } from '@/components/ui/induction-nav-button';
import KineticGrid from '@/components/ui/kinetic-grid';
import { KRON_CHART_URL } from '@/lib/dispenser/constants';

function NavAnchor({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  if (href.startsWith('/#')) {
    const hash = href.slice(2);
    return (
      <Link
        href="/"
        className={className}
        onClick={() => {
          window.setTimeout(() => {
            document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
            window.history.replaceState(null, '', href);
          }, 50);
        }}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

const LINKS = [
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Features', href: '/#features' },
  { label: 'Token Distribution', href: '/#token-distribution' },
  { label: 'Holder Rewards', href: '/#holder-rewards' },
  { label: 'Kaspaper', href: '/kaspaper' },
];

const SOCIALS = [
  {
    label: 'X',
    href: 'https://x.com/KasDistro',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-full w-full fill-current">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.726-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

function SocialLinks({
  className = '',
  size = 'md',
}: {
  className?: string;
  size?: 'md' | 'lg';
}) {
  const iconBox = size === 'lg' ? 'h-7 w-7' : 'h-4 w-4';
  const hit = size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {SOCIALS.map((social) => (
        <a
          key={social.href}
          href={social.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={social.label}
          title={social.label}
          className={`inline-flex ${hit} items-center justify-center rounded-xl text-cyan-200 transition hover:bg-white/5 hover:text-white`}
        >
          <span className={iconBox}>{social.icon}</span>
        </a>
      ))}
    </div>
  );
}

export function LandingLayout({
  children,
  showGrid = true,
}: {
  children: ReactNode;
  showGrid?: boolean;
}) {
  const [location] = useLocation();
  const showHome = location !== '/';

  const chrome = (
    <>
        <header className="sticky top-0 z-50 border-b border-cyan-900/20 bg-[#060a0e]/55 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center gap-6">
            {showHome ? (
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 whitespace-nowrap text-base font-medium text-cyan-200 hover:text-white transition"
              >
                <Home className="h-4 w-4" />
                Home
              </Link>
            ) : null}
            <nav className="hidden lg:flex items-center gap-6">
              {LINKS.map((link) => (
                <NavAnchor
                  key={link.href}
                  href={link.href}
                  className="whitespace-nowrap text-base font-medium text-cyan-200 hover:text-white transition"
                >
                  {link.label}
                </NavAnchor>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <SocialLinks size="lg" />
              <NavAnchor
                href="/volume-bot"
                className="kd-cta-bot inline-flex items-center justify-center whitespace-nowrap rounded-xl px-4 py-3 text-sm font-bold tracking-wide"
              >
                Volume Bot
              </NavAnchor>
              <NavAnchor
                href="/distro"
                className="kd-btn inline-flex items-center justify-center whitespace-nowrap text-black font-bold text-sm px-5 py-3 rounded-xl uppercase tracking-wide"
              >
                Open Kasdistro
              </NavAnchor>
              <a
                href={KRON_CHART_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:block shrink-0 rounded-[18px] transition-transform duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <InductionNavButton label="BUY KDIST" className="h-14 w-[12.25rem]" />
              </a>
            </div>
          </div>
        </header>

        <main>{children}</main>

        <footer className="border-t border-cyan-900/20 bg-[#070b10]/55 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-cyan-200">KASDISTRO</div>
            <div className="flex items-center gap-6 text-xs text-cyan-200">
              {showHome ? (
                <NavAnchor href="/" className="hover:text-cyan-100">Home</NavAnchor>
              ) : null}
              <NavAnchor href="/#how-it-works" className="hover:text-cyan-100">How It Works</NavAnchor>
              <NavAnchor href="/distro" className="hover:text-cyan-100">Open Kasdistro</NavAnchor>
              <NavAnchor href="/#token-distribution" className="hover:text-cyan-100">Token Distribution</NavAnchor>
              <NavAnchor href="/#holder-rewards" className="hover:text-cyan-100">Holder Rewards</NavAnchor>
              <NavAnchor href="/kaspaper" className="hover:text-cyan-100">Kaspaper</NavAnchor>
              <NavAnchor href="/volume-bot" className="hover:text-cyan-100">Volume Bot</NavAnchor>
               <NavAnchor href="/kcc20" className="hover:text-cyan-100">KCC-20</NavAnchor>
               <NavAnchor href="/testnet-lab" className="hover:text-cyan-100">Testnet Lab</NavAnchor>
            </div>
            <SocialLinks />
          </div>
        </footer>
    </>
  );

  return (
    <div className="relative min-h-dvh bg-[#060a0e] text-zinc-100">
      {showGrid ? <KineticGrid pinned>{chrome}</KineticGrid> : chrome}
    </div>
  );
}
