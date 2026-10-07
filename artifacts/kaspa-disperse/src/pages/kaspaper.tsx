import { type ReactNode } from 'react';
import { Activity, Layers, Shield, Timer, Wallet } from 'lucide-react';
import { LandingLayout } from '@/components/dispenser/landing-layout';
import { DispenserLogo } from '@/components/dispenser/brand-logo';
import { SERVICE_FEE_ADDRESS } from '@/lib/dispenser/constants';

const INGESTION = [
  'Manually entered Kaspa target addresses',
  'KRC-20 token-holder verified snapshots',
  'KCC-20 token-holder snapshots, including live bonding-curve KRON tokens',
];

const RISKS = [
  'Address transcription corruption and duplicate payments',
  'Unintentional omissions and inconsistent payment allocations',
  'Exceeding strict Kaspa transaction storage mass limits',
  'Failure states that obscure partial completion tracking',
];

const WORKFLOW = [
  'User connects a compatible Kaspa wallet.',
  'Recipient source is selected, ingested, and validated.',
  'Addresses are deduplicated and purged of ineligible records.',
  'Recipients are batched into groups of 90.',
  'Transactions are sequentially constructed, signed to a Kaspa wallet, and broadcast with an automated 100 KAS service fee per batch.',
];

const PRINCIPLES = [
  {
    icon: Shield,
    title: 'Non-Custodial Authorization',
    body: 'Zero private key exposure; absolute user sovereignty via Kaspa Wallet.',
  },
  {
    icon: Layers,
    title: 'Mass-Safe Batching',
    body: 'Capping batches at 90 prevents storage mass limit overflows (for example, historical 100-recipient mass spikes past 500,000).',
  },
  {
    icon: Wallet,
    title: 'Sequential UTXO Management',
    body: 'Prevents double-spending by updating the UTXO state after every individual transaction broadcast.',
  },
];

const BATCH_ROWS = [
  ['1 – 90', '90', '1', '100 KAS'],
  ['91 – 180', '90', '2', '200 KAS'],
  ['181 – 270', '90', '3', '300 KAS'],
  ['901 – 990', '90', '11', '1,100 KAS'],
];

const REVENUE_ROWS = [
  ['50 Recipients', '1', '100 KAS'],
  ['250 Recipients', '3', '300 KAS'],
  ['1,000 Recipients', '12', '1,200 KAS'],
  ['5,000 Recipients', '56', '5,600 KAS'],
  ['10,000 Recipients', '112', '11,200 KAS'],
];

const ROADMAP = [
  {
    phase: '01',
    title: 'Core Distribution',
    body: 'Native-KAS distribution, Kaspa wallet integration, 90-recipient batching, and sequential UTXO handling.',
  },
  {
    phase: '02',
    title: 'Token Intelligence',
    body: 'Full KCC-20 pagination, KRON pre-graduation support, and burn-address security hardening.',
  },
  {
    phase: '03',
    title: 'Campaign Tools',
    body: 'Advanced campaign management, saved templates, CSV export, and weighted allocations.',
  },
  {
    phase: '04',
    title: 'Professional Tiers',
    body: 'Professional subscriptions, multi-wallet treasury approval workflows, and role-based permissions.',
  },
  {
    phase: '05',
    title: 'Enterprise',
    body: 'Enterprise infrastructure, white-label portals, and Merkle-based proof attestations.',
  },
];

const VOLUME_SPECS = [
  { icon: Activity, label: 'Fixed Trade Size', value: '21 KAS', detail: 'Exact buy and sell size' },
  { icon: Layers, label: 'Execution Cycle', value: '5 in / 5 out', detail: 'Consecutive buys then sells' },
  { icon: Timer, label: 'Timing Interval', value: '6 minutes', detail: 'Between each sequential trade' },
];

const VOLUME_WORKFLOW = [
  'Project team connects their designated KasWare-compatible deployment wallet.',
  'The user inputs the target KCC-20 token identifier to apply the standard volume model (21 KAS trades, 6-minute intervals).',
  'The system initiates the one-time activation transaction of 100 KAS.',
  'Upon on-chain confirmation of the activation fee, the bot initializes its 5-buy / 5-sell cycle engine.',
  'Autonomous volume generation commences securely under the preset deterministic parameters.',
];

const VOLUME_SECURITY = [
  {
    title: 'Non-Custodial Execution',
    body: 'KasVolume never takes custody of primary token reserves or private keys; trading bots operate via dedicated sub-wallets funded by the project.',
  },
  {
    title: 'Deterministic Rhythms',
    body: 'Fixed 21 KAS sizing and strict 6-minute spacing ensure predictable, audit-friendly automated operations.',
  },
  {
    title: 'Slippage & Drawdown Guardrails',
    body: 'Automated circuit breakers pause trading if token price volatility exceeds preset thresholds.',
  },
  {
    title: 'Transparent Activation',
    body: 'The single 100 KAS activation fee is verified on-chain instantly, with zero recurring subscription fees.',
  },
];

const CYCLE_ROWS = [
  ['Phase A (Buys)', '5 Buys In', '21 KAS', '6 minutes apart'],
  ['Phase B (Sells)', '5 Sells Out', '21 KAS', '6 minutes apart'],
];

const VOLUME_LAUNCH_ROWS = [
  ['1 Project Bot', '100 KAS', 'One-time per launch', '100 KAS'],
  ['10 Project Bots', '100 KAS', 'One-time per launch', '1,000 KAS'],
  ['50 Project Bots', '100 KAS', 'One-time per launch', '5,000 KAS'],
  ['100 Project Bots', '100 KAS', 'One-time per launch', '10,000 KAS'],
];

const VOLUME_MONTHLY_ROWS = [
  ['10 Launches', '100 KAS', '1,000 KAS'],
  ['25 Launches', '100 KAS', '2,500 KAS'],
  ['50 Launches', '100 KAS', '5,000 KAS'],
  ['100 Launches', '100 KAS', '10,000 KAS'],
  ['250 Launches', '100 KAS', '25,000 KAS'],
];

const VOLUME_ROADMAP = [
  {
    phase: '01',
    title: 'Core Engine',
    body: 'KCC-20 volume bot engine with the standard 21 KAS / 6-minute cycle and 100 KAS single-fee deployment.',
  },
  {
    phase: '02',
    title: 'Pool Expansion',
    body: 'Advanced gas optimization and multi-pool support.',
  },
  {
    phase: '03',
    title: 'Live Analytics',
    body: 'Real-time volume analytics dashboard and Telegram/Discord webhook alerts.',
  },
  {
    phase: '04',
    title: 'Enterprise Suites',
    body: 'Enterprise multi-token market-making suites and institutional API access.',
  },
  {
    phase: '05',
    title: 'Governance',
    body: 'Decentralized bot-operator staking and governance integration.',
  },
];

type PaperTone = 'cyan' | 'blue';

function Section({
  num,
  title,
  children,
  tone = 'cyan',
}: {
  num: string;
  title: string;
  children: ReactNode;
  tone?: PaperTone;
}) {
  let numClass: string;
  switch (tone) {
    case 'blue':
      numClass = 'text-sky-300';
      break;
    case 'cyan':
      numClass = 'text-cyan-400';
      break;
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
  return (
    <section className="scroll-mt-28">
      <div className="mb-6 flex items-baseline gap-4">
        <span className={`font-mono text-sm font-bold ${numClass}`}>{num}</span>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
      </div>
      <div className="space-y-5 text-base leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

function PaperTable({
  headers,
  rows,
  tone = 'cyan',
}: {
  headers: string[];
  rows: string[][];
  tone?: PaperTone;
}) {
  let shell: string;
  let head: string;
  let headText: string;
  let rowBorder: string;
  switch (tone) {
    case 'blue':
      shell = 'border-sky-400/30';
      head = 'border-b border-sky-400/30 bg-sky-500/10';
      headText = 'text-sky-200';
      rowBorder = 'border-b border-sky-400/15 last:border-0';
      break;
    case 'cyan':
      shell = 'border-cyan-900/30';
      head = 'border-b border-cyan-900/30 bg-cyan-500/5';
      headText = 'text-cyan-300';
      rowBorder = 'border-b border-cyan-900/15 last:border-0';
      break;
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }

  return (
    <div className={`overflow-x-auto rounded-2xl border ${shell}`}>
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className={head}>
            {headers.map((header) => (
              <th
                key={header}
                className={`px-4 py-3 font-semibold uppercase tracking-wider ${headText}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('-')} className={rowBorder}>
              {row.map((cell, index) => (
                <td
                  key={`${row[0]}-${index}`}
                  className={`px-4 py-3 ${index === row.length - 1 ? 'font-medium text-white' : 'text-zinc-300'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Kaspaper() {
  return (
    <LandingLayout showGrid={false}>
      <div className="sticky top-20 z-40 flex flex-wrap justify-center gap-3 border-b border-white/5 bg-[#060a0e]/80 px-4 py-3 backdrop-blur-xl">
        <a
          href="#kasdistro"
          className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200 hover:bg-cyan-500/20"
        >
          Distro Paper
        </a>
        <a
          href="#kasvolume"
          className="rounded-full border border-sky-500/35 bg-sky-500/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200 hover:bg-sky-500/20"
        >
          Volume Paper
        </a>
      </div>

      <article id="kasdistro" className="relative scroll-mt-40">
        <header className="px-4 sm:px-6 pt-12 sm:pt-20 pb-14 text-center">
          <DispenserLogo size="lg" className="mx-auto mb-8" />
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/90">
            KasDistro Protocol · White Paper v1.0
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] text-white">
            Enterprise-Grade Native{' '}
            <span className="kd-gradient-text">KAS</span> Distribution
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            The definitive architecture for non-custodial multi-recipient distribution
            on Kaspa. September 2026.
          </p>
        </header>

        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 space-y-20">
          <Section num="01" title="Executive Summary">
            <p>
              KasDistro is a non-custodial bulk distribution platform engineered specifically
              for the Kaspa ecosystem. It empowers projects, communities, token issuers,
              mining operations, and decentralized organizations to distribute native KAS to
              massive recipient lists without manual transaction construction or compromised
              security.
            </p>
            <p>KasDistro supports three primary recipient ingestion vectors:</p>
            <ul className="grid gap-3">
              {INGESTION.map((item) => (
                <li
                  key={item}
                  className="kd-glass rounded-xl px-4 py-3 text-sm text-zinc-300"
                >
                  {item}
                </li>
              ))}
            </ul>
            <p>
              Large recipient cohorts are intelligently partitioned into sequential, mass-safe
              batches of up to 90 recipients per transaction. Every transaction is independently
              verified and authorized through KasWare Wallet without relinquishing private key
              custody.
            </p>
          </Section>

          <Section num="02" title="The Problem">
            <p>
              Ecosystem participants regularly encounter complex disbursement challenges — from
              token rewards and mining pool distributions to DAO treasuries and airdrops.
              Manual distribution introduces severe systemic risks:
            </p>
            <ul className="space-y-2">
              {RISKS.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="kd-glass-strong rounded-2xl p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">
                The Completeness Principle
              </p>
              <p className="mt-3 text-white leading-relaxed">
                A list that appears valid can easily be incomplete or omit critical exclusions.
                KasDistro enforces a strict operational invariant: a holder import must be
                complete, or it must be rejected outright. Capped top-holder API responses are
                never silently converted into incomplete distribution runs.
              </p>
            </div>
          </Section>

          <Section num="03" title="Product Overview">
            <p>
              KasDistro delivers a guided, highly reliable workflow converting raw recipient
              sets into structured transaction sequences:
            </p>
            <ol className="space-y-3">
              {WORKFLOW.map((step, index) => (
                <li key={step} className="flex gap-4 rounded-xl kd-glass p-4">
                  <span className="font-mono text-sm font-bold text-cyan-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-zinc-300">{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-sm">
              Service-fee destination:{' '}
              <span className="mt-1 block break-all font-mono text-xs text-cyan-300">
                {SERVICE_FEE_ADDRESS}
              </span>
            </p>
          </Section>

          <Section num="04" title="Architectural Principles">
            <div className="grid gap-4">
              {PRINCIPLES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="kd-glass-strong rounded-2xl p-6 flex gap-4">
                  <div className="h-11 w-11 shrink-0 rounded-xl border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <p>
              Universal safeguards hardcoded across all distribution paths purge the canonical
              burn address and contract-owned covenant inventory (<span className="font-mono text-cyan-300">covenant:</span>).
            </p>
            <PaperTable
              headers={['Recipient Range', 'Max Batch', 'Transactions', 'Service Fee']}
              rows={BATCH_ROWS}
            />
          </Section>

          <Section num="05" title="Revenue Model">
            <p>
              KasDistro captures sustainable protocol revenue through a hybrid architecture
              combining per-transaction service fees, professional tiers, and enterprise
              white-label licensing.
            </p>
            <PaperTable
              headers={['Campaign Scale', 'Transactions', 'Gross Protocol Revenue']}
              rows={REVENUE_ROWS}
            />
          </Section>

          <Section num="06" title="Strategic Roadmap">
            <div className="relative space-y-4 before:absolute before:left-[1.15rem] before:top-4 before:bottom-4 before:w-px before:bg-cyan-500/20">
              {ROADMAP.map((item) => (
                <div key={item.phase} className="relative grid grid-cols-[2.3rem_1fr] gap-4">
                  <div className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-cyan-500/30 bg-[#070b10] font-mono text-xs font-bold text-cyan-300">
                    {item.phase}
                  </div>
                  <div className="kd-glass rounded-2xl p-5">
                    <h3 className="font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section num="07" title="Conclusion">
            <p>
              KasDistro solves the fundamental infrastructure bottleneck of native KAS
              distribution. By uniting unbreakable non-custodial safety, rigorous token
              intelligence, and predictable transaction economics, KasDistro stands as the
              definitive distribution layer for the Kaspa ecosystem.
            </p>
            <p className="text-sm text-zinc-500">
              This document is a technical white paper and product proposal, not financial
              or legal advice. Revenue illustrations are hypothetical.
            </p>
          </Section>
        </div>
      </article>

      <article
        id="kasvolume"
        className="relative scroll-mt-40 border-t border-sky-500/20"
      >
        <header className="px-4 sm:px-6 pt-16 sm:pt-24 pb-14 text-center">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.32em] text-sky-300/90">
            KasVolume Protocol · White Paper v1.1
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] text-white">
            Enterprise-Grade KCC-20{' '}
            <span className="bg-gradient-to-r from-sky-300 via-blue-400 to-blue-200 bg-clip-text text-transparent">
              Volume Trading Bot
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            Automated market liquidity and volume generation. Non-custodial trading
            infrastructure. September 2026.
          </p>
        </header>

        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 space-y-20">
              <Section tone="blue" num="01" title="Executive Summary">
                <p>
                  KasVolume is a specialized, automated volume-trading and market-liquidity bot
                  engineered specifically for KCC-20 tokens within the Kaspa ecosystem. It
                  empowers project founders, token creators, and market makers to maintain
                  healthy market liquidity, consistent trading activity, and algorithmic price
                  discovery without manual intervention.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {VOLUME_SPECS.map(({ icon: Icon, label, value, detail }) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-sky-500/25 bg-sky-500/10 p-5"
                    >
                      <Icon className="mb-3 h-5 w-5 text-sky-300" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200/80">
                        {label}
                      </p>
                      <p className="mt-2 text-xl font-bold text-white">{value}</p>
                      <p className="mt-1 text-xs text-zinc-400">{detail}</p>
                    </div>
                  ))}
                </div>
                <p>
                  Each project bot deployment is initiated via a one-time activation fee of
                  exactly 100 KAS, paid directly upon setup. Once launched, the trading bot
                  operates continuously according to the deterministic cycle profile.
                </p>
                <div className="rounded-2xl border border-sky-400/30 bg-gradient-to-r from-sky-500/15 to-blue-500/10 p-6">
                  <p className="text-sm font-medium leading-relaxed text-sky-100">
                    KasVolume revenue = launched project bots × 100 KAS (one-time activation
                    fee per project deployment).
                  </p>
                </div>
              </Section>

              <Section tone="blue" num="02" title="The Deterministic Volume Model">
                <p>
                  To eliminate ambiguity and ensure predictable liquidity generation, KasVolume
                  operates on a structured, rhythmic engine.
                </p>
                <PaperTable
                  tone="blue"
                  headers={['Cycle Phase', 'Action Type', 'Amount Per Trade', 'Time Interval']}
                  rows={CYCLE_ROWS}
                />
                <div className="rounded-2xl border border-sky-400/20 bg-[#06131c] p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
                    Why the 21 KAS / 6-Minute Model?
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                    This rhythm prevents erratic order book distortion while maintaining a
                    steady heartbeat of transactions every 6 minutes. The balanced 5-in / 5-out
                    cycle with exact 21 KAS sizing establishes stable volume metrics visible on
                    decentralized aggregators without inducing artificial downward or upward
                    price drift.
                  </p>
                </div>
              </Section>

              <Section tone="blue" num="03" title="Product Architecture & Deployment">
                <p>
                  KasVolume delivers a streamlined deployment workflow for token projects:
                </p>
                <ol className="space-y-3">
                  {VOLUME_WORKFLOW.map((step, index) => (
                    <li
                      key={step}
                      className="flex gap-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4"
                    >
                      <span className="font-mono text-sm font-bold text-sky-300">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-zinc-300">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-sm">
                  Protocol fee destination:{' '}
                  <span className="mt-1 block break-all font-mono text-xs text-sky-300">
                    {SERVICE_FEE_ADDRESS}
                  </span>
                </p>
              </Section>

              <Section tone="blue" num="04" title="Security & Non-Custodial Design">
                <div className="grid gap-4 sm:grid-cols-2">
                  {VOLUME_SECURITY.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-2xl border border-sky-500/20 bg-[#061018] p-5"
                    >
                      <h3 className="font-semibold text-white">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed">{item.body}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section tone="blue" num="05" title="Revenue Model & Projections">
                <p>
                  KasVolume captures protocol revenue exclusively through the one-time 100 KAS
                  project bot activation fee.
                </p>
                <PaperTable
                  tone="blue"
                  headers={['Project Launches', 'Fee Structure', 'Billing Model', 'Total Activation Revenue']}
                  rows={VOLUME_LAUNCH_ROWS}
                />
                <PaperTable
                  tone="blue"
                  headers={['Monthly Active Launches', 'Fee Per Launch', 'Monthly Gross Revenue (KAS)']}
                  rows={VOLUME_MONTHLY_ROWS}
                />
              </Section>

              <Section tone="blue" num="06" title="Strategic Roadmap">
                <div className="grid gap-3">
                  {VOLUME_ROADMAP.map((item) => (
                    <div
                      key={item.phase}
                      className="grid grid-cols-[3.5rem_1fr] overflow-hidden rounded-2xl border border-sky-500/20 bg-sky-500/5"
                    >
                      <div className="flex items-center justify-center bg-sky-500/20 font-mono text-sm font-bold text-sky-200">
                        {item.phase}
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed">{item.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section tone="blue" num="07" title="Conclusion">
                <p>
                  KasVolume eliminates the liquidity cold-start problem for KCC-20 tokens
                  through a proven, deterministic model (21 KAS trades, 5-in / 5-out cycles,
                  6-minute spacing) backed by a simple one-time 100 KAS activation fee.
                </p>
                <p className="text-sm text-zinc-500">
                  This document is a technical white paper and product proposal, not financial
                  or legal advice. Revenue illustrations are hypothetical.
                </p>
              </Section>
        </div>
      </article>
    </LandingLayout>
  );
}
