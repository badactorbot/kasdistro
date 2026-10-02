import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  KRON_CHART_URL,
  KRON_IDX_URL,
  KRON_TOKEN_TICK,
} from '@/lib/dispenser/constants';

const INTERVALS = [
  { id: '1m', label: '1m', seconds: 60 },
  { id: '5m', label: '5m', seconds: 300 },
  { id: '15m', label: '15m', seconds: 900 },
  { id: '1h', label: '1H', seconds: 3600 },
  { id: '4h', label: '4H', seconds: 14_400 },
  { id: '1d', label: '1D', seconds: 86_400 },
] as const;

type KronInterval = (typeof INTERVALS)[number]['id'];

interface OhlcPoint {
  time: number;
  open: number;
  high: number;
  close: number;
  low: number;
  volume: number;
}

interface KronTrade {
  txid?: string;
  ts: number;
  side?: string;
  price: number;
  volume: number;
}

interface TokenMeta {
  tick: string;
  name?: string;
  price: number;
  change24h: number;
  volume24h: number;
}

const UP = '#34d399';
const DOWN = '#f87171';
const CHART_H = 280;
const PAD = { top: 12, right: 12, bottom: 28, left: 72 };

function formatKas(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatTime(time: number, interval: KronInterval) {
  const date = new Date(time * 1000);
  if (interval === '1d') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatTooltipTime(time: number) {
  return new Date(time * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`KRON returned ${response.status}`);
  return response.json() as Promise<T>;
}

function yTicks(min: number, max: number, count = 5) {
  const span = max - min || 1;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

function candlesFromTrades(trades: KronTrade[], seconds: number): OhlcPoint[] {
  const sorted = [...trades]
    .filter((trade) => Number.isFinite(trade.ts) && Number.isFinite(trade.price))
    .sort((a, b) => a.ts - b.ts);
  const buckets = new Map<number, OhlcPoint>();

  for (const trade of sorted) {
    const time = Math.floor(trade.ts / seconds) * seconds;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, {
        time,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: Number.isFinite(trade.volume) ? trade.volume : 0,
      });
      continue;
    }
    existing.high = Math.max(existing.high, trade.price);
    existing.low = Math.min(existing.low, trade.price);
    existing.close = trade.price;
    existing.volume += Number.isFinite(trade.volume) ? trade.volume : 0;
  }

  return [...buckets.values()];
}

function CandlestickChart({
  data,
  interval,
}: {
  data: OhlcPoint[];
  interval: KronInterval;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lows = data.map((d) => d.low);
  const highs = data.map((d) => d.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = (max - min || 1) * 0.08;
  const yMin = min - pad;
  const yMax = max + pad;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(data.length, 1);
  const candleW = Math.max(3, Math.min(14, slot * 0.62));

  const yScale = (value: number) =>
    PAD.top + ((yMax - value) / (yMax - yMin || 1)) * innerH;

  const ticks = yTicks(yMin, yMax);

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - PAD.left;
    const index = Math.min(data.length - 1, Math.max(0, Math.floor(x / slot)));
    setHover(index);
  };

  const active = hover != null ? data[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={CHART_H}
          viewBox={`0 0 ${width} ${CHART_H}`}
          className="overflow-visible"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => {
            const y = yScale(tick);
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="#164e63"
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#67e8f9"
                  fontSize="11"
                >
                  {formatKas(tick)}
                </text>
              </g>
            );
          })}

          {data.map((candle, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const up = candle.close >= candle.open;
            const color = up ? UP : DOWN;
            const bodyTop = yScale(Math.max(candle.open, candle.close));
            const bodyBot = yScale(Math.min(candle.open, candle.close));
            const bodyH = Math.max(1.5, bodyBot - bodyTop);
            const wickTop = yScale(candle.high);
            const wickBot = yScale(candle.low);
            const highlighted = hover === i;

            return (
              <g key={candle.time} opacity={hover == null || highlighted ? 1 : 0.45}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={wickTop}
                  y2={wickBot}
                  stroke={color}
                  strokeWidth={highlighted ? 1.75 : 1.25}
                />
                <rect
                  x={cx - candleW / 2}
                  y={bodyTop}
                  width={candleW}
                  height={bodyH}
                  fill={color}
                  rx={1}
                />
              </g>
            );
          })}

          {data.map((candle, i) => {
            if (interval === '1d') {
              if (i !== 0 && i !== data.length - 1) return null;
            } else if (i !== 0 && i !== data.length - 1 && i % Math.ceil(data.length / 5) !== 0) {
              return null;
            }
            const cx = PAD.left + slot * i + slot / 2;
            return (
              <text
                key={`label-${candle.time}`}
                x={cx}
                y={CHART_H - 8}
                textAnchor="middle"
                fill="#67e8f9"
                fontSize="11"
              >
                {formatTime(candle.time, interval)}
              </text>
            );
          })}
        </svg>
      )}

      {active && (
        <div className="pointer-events-none absolute left-20 top-3 rounded-lg border border-cyan-900/40 bg-[#070b10]/95 px-3 py-2 text-xs text-zinc-200 shadow-xl">
          <div className="font-medium text-cyan-200">{formatTooltipTime(active.time)}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
            <span className="text-zinc-500">Open</span>
            <span>{formatKas(active.open)}</span>
            <span className="text-zinc-500">High</span>
            <span>{formatKas(active.high)}</span>
            <span className="text-zinc-500">Low</span>
            <span>{formatKas(active.low)}</span>
            <span className="text-zinc-500">Close</span>
            <span className={active.close >= active.open ? 'text-emerald-400' : 'text-red-400'}>
              {formatKas(active.close)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function KronPriceChart() {
  const [timeframe, setTimeframe] = useState<KronInterval>('15m');
  const [trades, setTrades] = useState<KronTrade[]>([]);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setError('');
      }
      try {
        const [tradesBody, metaBody] = await Promise.all([
          fetchJson<{ result?: KronTrade[] }>(
            `${KRON_IDX_URL}/v1/kcc20/token/${encodeURIComponent(KRON_TOKEN_TICK)}/trades?limit=1000`,
          ),
          fetchJson<{ result?: TokenMeta[] }>(
            `${KRON_IDX_URL}/v1/kcc20/token/${encodeURIComponent(KRON_TOKEN_TICK)}`,
          ),
        ]);
        if (cancelled) return;
        const nextTrades = Array.isArray(tradesBody.result) ? tradesBody.result : [];
        const token = Array.isArray(metaBody.result) ? metaBody.result[0] ?? null : null;
        setTrades(nextTrades);
        setMeta(token);
        setError(nextTrades.length === 0 ? 'No KRON trades yet.' : '');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load KRON chart.');
        if (!quiet) setTrades([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    const poll = window.setInterval(() => {
      void load(true);
    }, 15_000);

    const stream = new EventSource(
      `${KRON_IDX_URL}/v1/kcc20/stream?tick=${encodeURIComponent(KRON_TOKEN_TICK)}`,
    );
    stream.addEventListener('ready', () => {
      if (!cancelled) setLive(true);
    });
    stream.addEventListener('update', (event) => {
      if (cancelled) return;
      setLive(true);
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          price?: number;
          change24h?: number;
          volume24h?: number;
        };
        if (typeof payload.price === 'number') {
          setMeta((current) =>
            current
              ? {
                  ...current,
                  price: payload.price ?? current.price,
                  change24h: payload.change24h ?? current.change24h,
                  volume24h: payload.volume24h ?? current.volume24h,
                }
              : current,
          );
        }
      } catch {
        /* payload shapes vary; refetch covers the chart */
      }
      void load(true);
    });
    stream.onerror = () => {
      if (!cancelled) setLive(false);
    };

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      stream.close();
    };
  }, []);

  const seconds = INTERVALS.find((item) => item.id === timeframe)?.seconds ?? 900;
  const points = useMemo(() => candlesFromTrades(trades, seconds), [trades, seconds]);
  const up = (meta?.change24h ?? 0) >= 0;

  return (
    <div className="kd-glass-strong rounded-2xl overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-5 py-5 border-b border-cyan-900/20">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-cyan-400">
            KRON
            <span
              className={`normal-case tracking-normal rounded-full px-2 py-0.5 text-[10px] font-medium ${
                live
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-zinc-500/15 text-zinc-400'
              }`}
            >
              {live ? 'Live' : 'Polling'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <h2 className="text-2xl font-bold text-white">
              {meta?.tick ?? KRON_TOKEN_TICK}
              {meta?.name ? <span className="ml-2 text-base font-medium text-cyan-200">{meta.name}</span> : null}
            </h2>
          </div>
          {meta && (
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-xl font-semibold text-white tabular-nums">{formatKas(meta.price)} KAS</span>
              <span className={`text-sm font-medium tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                {up ? '+' : ''}{meta.change24h.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-3">
          <div className="flex rounded-xl border border-cyan-900/30 overflow-hidden">
            {INTERVALS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTimeframe(item.id)}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  timeframe === item.id
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <a
            href={KRON_CHART_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-end gap-1.5 text-sm font-medium text-cyan-300 hover:text-white transition"
          >
            Open on KRON <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="p-4 sm:p-6 min-h-[320px]">
        {loading && points.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-cyan-200 text-sm">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading chart…
          </div>
        ) : error && points.length === 0 ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-zinc-400">{error}</p>
            <a
              href={KRON_CHART_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="kd-btn inline-flex items-center gap-2 text-black font-bold rounded-xl px-5 py-2.5 text-sm"
            >
              Open Chart on KRON <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <CandlestickChart data={points} interval={timeframe} />
        )}
      </div>
    </div>
  );
}
