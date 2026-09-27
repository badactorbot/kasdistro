import { TOKEN_DISTRIBUTION } from '@/lib/dispenser/constants';

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 78;
const STROKE = 28;

function slicePath(startPct: number, pct: number) {
  const startAngle = (startPct / 100) * 360 - 90;
  const endAngle = ((startPct + pct) / 100) * 360 - 90;
  const start = polar(startAngle);
  const end = polar(endAngle);
  const largeArc = pct > 50 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function polar(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + RADIUS * Math.cos(rad),
    y: CY + RADIUS * Math.sin(rad),
  };
}

export function TokenDistributionChart() {
  let offset = 0;
  const slices = TOKEN_DISTRIBUTION.map((item) => {
    const path = slicePath(offset, item.pct);
    offset += item.pct;
    return { ...item, path };
  });

  return (
    <div className="flex flex-col lg:flex-row items-center gap-10">
      <div className="relative shrink-0">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {slices.map((slice) => (
            <path
              key={slice.label}
              d={slice.path}
              fill="none"
              stroke={slice.color}
              strokeWidth={STROKE}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Allocation</span>
          <span className="text-lg font-bold text-white">100%</span>
        </div>
      </div>
      <ul className="w-full space-y-4">
        {TOKEN_DISTRIBUTION.map((item) => (
          <li key={item.label} className="flex items-start gap-3">
            <span
              className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-white">{item.label}</span>
                <span className="text-sm font-semibold text-cyan-300 tabular-nums">{item.pct}%</span>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed mt-0.5">{item.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
