import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { type ReactNode } from 'react';
import { DispenserLogo } from './brand-logo';

const LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Fees', href: '/#fees' },
  { label: 'Token Distribution', href: '/#token-distribution' },
];

export function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kd-app min-h-screen flex flex-col text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-cyan-900/20 bg-[#060a0e]/90 backdrop-blur-xl">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center">
          <nav className="hidden md:flex items-center gap-8">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-zinc-400 hover:text-white transition"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <Link
            href="/"
            className="mr-auto md:mr-0 md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 hover:opacity-90 transition"
          >
            <DispenserLogo size="md" />
          </Link>

          <Link
            href="/dispenser"
            className="kd-btn ml-auto inline-flex items-center gap-2 text-black font-semibold text-sm px-5 py-2.5 rounded-xl"
          >
            Launch KASDISTRO <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-cyan-900/20 bg-[#070b10]/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <DispenserLogo size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-zinc-500">
            <a href="/#features" className="hover:text-zinc-300">Features</a>
            <a href="/#how-it-works" className="hover:text-zinc-300">How It Works</a>
            <a href="/#token-distribution" className="hover:text-zinc-300">Token Distribution</a>
            <Link href="/dispenser" className="hover:text-cyan-400">Launch KASDISTRO</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
