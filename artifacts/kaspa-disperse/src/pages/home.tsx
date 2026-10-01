import {
  ArrowRight,
  Building2,
  Coins,
  Gift,
  Rocket,
  Shield,
  Sparkles,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { LandingLayout } from '@/components/dispenser/landing-layout';
import { DispenserLogo } from '@/components/dispenser/brand-logo';
import { TokenDistributionChart } from '@/components/dispenser/token-distribution-chart';

const USE_CASES = [
  'Community Rewards',
  'Holder Rewards',
  'Giveaways',
  'Contest Winners',
  'Event Rewards',
  'Contributor Payments',
  'Promotional Campaigns',
  'Loyalty Rewards',
  'Custom Airdrops',
];

const STEPS = [
  { num: '01', title: 'Connect Your Wallet', body: 'Connect your supported Kaspa wallet to KASDISTRO.' },
  { num: '02', title: 'Add Your Recipients', body: 'Enter or upload the Kaspa wallet addresses receiving the distribution.' },
  { num: '03', title: 'Set Your Rewards', body: 'Send the same amount to everyone or customize individual reward amounts.' },
  { num: '04', title: 'Review Your Drop', body: 'See recipient count, total KAS, network fees, and service fee before anything is sent.' },
  { num: '05', title: 'Dispense', body: 'Confirm the transaction and distribute rewards — no more sending wallet by wallet.' },
];

const AUDIENCES = [
  { icon: Rocket, title: 'Projects', body: 'Reward holders, run campaigns, distribute prizes, and activate your community.' },
  { icon: Sparkles, title: 'Creators', body: 'Reward followers, supporters, contest winners, and collaborators.' },
  { icon: Users, title: 'Communities', body: 'Run giveaways without manually processing dozens of individual payments.' },
  { icon: Building2, title: 'Businesses', body: 'Use KAS for promotions, incentives, affiliate rewards, and loyalty campaigns.' },
];

function CtaButton({ className = '', large = false }: { className?: string; large?: boolean }) {
  return (
    <a
      href="/distro"
      className={`kd-btn inline-flex items-center justify-center gap-2 text-black font-bold rounded-xl uppercase tracking-wide transition ${large ? 'px-10 py-4 text-sm' : 'px-6 py-3 text-xs sm:text-sm'} ${className}`}
    >
      Open Kasdistro <ArrowRight className="h-4 w-4" />
    </a>
  );
}

export default function Home() {
  return (
    <LandingLayout>
      <section className="relative min-h-[min(100dvh,820px)] flex flex-col items-center justify-center px-4 sm:px-6 py-24 text-center">
          <DispenserLogo size="hero" className="mb-8" />
          <p className="mb-6 rounded-full border border-cyan-500/25 bg-cyan-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300/90">
            KASDISTRO
          </p>
          <h1 className="max-w-4xl text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-[1.1]">
            Reward Your Community in{' '}
            <span className="kd-gradient-text">KAS</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl font-extrabold text-cyan-300/90 max-w-2xl">
            One tool. Multiple wallets. One transaction flow.
          </p>
          <p className="mt-4 text-base text-cyan-300/90 max-w-3xl leading-relaxed">
            KASDISTRO gives projects, creators, communities, and teams an easy way to
            distribute KAS rewards to multiple wallet addresses at once.
          </p>
          <p className="mt-6 text-cyan-300/90 font-medium">
            Load your list. Set your rewards. Send the KAS.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <CtaButton large />
            <a href="#how-it-works" className="text-sm text-cyan-200 hover:text-white transition">
              See how it works →
            </a>
          </div>
        </section>

        <section id="how-it-works" className="border-t border-cyan-900/20 py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">How It Works</h2>
              <p className="mt-3 text-cyan-200">From one wallet to many in a few simple steps.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-6">
              {STEPS.map((step) => (
                <div
                  key={step.num}
                  className="kd-glass rounded-2xl p-6 w-full md:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-3rem)/3)]"
                >
                  <span className="text-cyan-500 font-mono text-sm font-bold">{step.num}</span>
                  <h3 className="text-lg font-semibold text-white mt-2 mb-2">{step.title}</h3>
                  <p className="text-sm text-cyan-200 leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-cyan-900/20 py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-2xl mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">Built for Community Rewards</h2>
              <p className="mt-4 text-cyan-200 leading-relaxed">
                Stop manually sending KAS one wallet at a time. Prepare a list of recipient wallets,
                assign amounts, review the distribution, and send your rewards from one place.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-6 mb-14">
              {[
                { icon: Zap, title: 'One to Many', body: 'Bulk-send KAS to hundreds of wallets in one workflow.' },
                { icon: Shield, title: 'Fast & Secure', body: 'Built on Kaspa\'s BlockDAG. You approve every transfer.' },
                { icon: Coins, title: 'Transparent Fees', body: 'See exactly what you send and pay before you confirm.' },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="kd-glass-strong rounded-2xl p-6">
                  <Icon className="h-8 w-8 text-cyan-400 mb-4" />
                  <h3 className="font-semibold text-white mb-2">{title}</h3>
                  <p className="text-sm text-cyan-200 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200 mb-4">Use it for</p>
            <div className="flex flex-wrap gap-2">
              {USE_CASES.map((item) => (
                <span key={item} className="kd-glass px-4 py-2 rounded-full text-sm text-cyan-100">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="token-distribution" className="border-t border-cyan-900/20 py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">Token Distribution</h2>
              <p className="mt-3 text-cyan-200 max-w-xl mx-auto">
                A clear split: burn, dev, team, marketing, and community.
              </p>
            </div>
            <div className="max-w-3xl mx-auto kd-glass-strong rounded-2xl p-8">
              <TokenDistributionChart />
            </div>
          </div>
        </section>

        <section id="holder-rewards" className="border-t border-cyan-900/20 py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-2xl mx-auto kd-glass-strong rounded-2xl p-8 sm:p-10 text-center">
              <div className="h-12 w-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-5">
                <Gift className="h-6 w-6 text-cyan-400" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white">Holder Rewards</h2>
              <p className="mt-4 text-lg text-cyan-200 leading-relaxed">
                Platform Fees &amp; Trade Fees are distributed back to eligible holders weekly.
              </p>
              <p className="mt-4 text-cyan-200 leading-relaxed">
                Every transaction helps generate rewards for the KASDISTRO community.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-cyan-900/20 py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">Made for More Than Token Projects</h2>
              <p className="mt-3 text-cyan-200 max-w-2xl mx-auto">
                If you have a Kaspa community and want to reward people in KAS, this tool was built for you.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-6">
              {AUDIENCES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="kd-glass rounded-2xl p-6 flex gap-4">
                  <div className="h-11 w-11 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">{title}</h3>
                    <p className="text-sm text-cyan-200 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-cyan-900/20 py-24 sm:py-32">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Your KAS. Your Community. Your Drop.
            </h2>
            <p className="text-cyan-200 mb-2">You decide who receives KAS and how much.</p>
            <p className="text-cyan-100 font-medium mb-10">Bulk distribution made simple.</p>
            <a
              href="/distro"
              className="kd-btn inline-flex items-center gap-2 text-black font-bold px-10 py-4 rounded-xl uppercase tracking-wide text-sm"
            >
              <Upload className="h-4 w-4" /> Open Kasdistro
            </a>
          </div>
        </section>
    </LandingLayout>
  );
}
