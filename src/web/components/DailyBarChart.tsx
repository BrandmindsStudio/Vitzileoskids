import { useMemo, useState } from "react";
import { fmtEur, fmtDayShort, fmtDate, athensToday } from "../format";

interface Props {
  data: { date: string; total: number }[]; // sparse: only days with sales
  days: 30 | 90;
}

const H = 180;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;
const W = 720;

/** Daily sales bars, single series. Tap/hover a bar to see the exact value. */
export default function DailyBarChart({ data, days }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const series = useMemo(() => {
    const byDate = new Map(data.map((d) => [d.date, d.total]));
    const out: { date: string; total: number }[] = [];
    // Walk back from "today in Athens" so the axis matches business dates.
    const end = new Date(`${athensToday()}T12:00:00Z`);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, total: byDate.get(key) ?? 0 });
    }
    return out;
  }, [data, days]);

  const max = Math.max(1, ...series.map((s) => s.total));
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const step = W / series.length;
  const barW = Math.max(2, Math.min(16, step - 2)); // ≥2px surface gap between bars
  const maxIdx = series.reduce((best, s, i) => (s.total > series[best].total ? i : best), 0);

  const gridLines = [0.5, 1].map((f) => ({
    y: PAD_TOP + innerH * (1 - f),
    value: max * f,
  }));

  const tickEvery = days === 30 ? 5 : 15;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Ημερήσιες πωλήσεις"
        onPointerLeave={() => setActive(null)}
      >
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={0} x2={W} y1={g.y} y2={g.y} stroke="var(--grid)" strokeWidth={1} />
            {/* Axis values on the left — recent (usually tallest) bars are on the right. */}
            <text x={2} y={g.y - 3} textAnchor="start" fontSize={10} fill="var(--ink-muted)">
              {fmtEur(g.value)}
            </text>
          </g>
        ))}

        {/* baseline */}
        <line x1={0} x2={W} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} stroke="var(--baseline)" strokeWidth={1} />

        {series.map((s, i) => {
          const h = (s.total / max) * innerH;
          const x = i * step + (step - barW) / 2;
          const y = H - PAD_BOTTOM - h;
          return (
            <g key={s.date}>
              {/* invisible hit target wider than the mark */}
              <rect
                x={i * step}
                y={0}
                width={step}
                height={H}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
              {s.total > 0 && (
                <path
                  d={roundedTopBar(x, y, barW, h)}
                  fill="var(--series-1)"
                  opacity={active === null || active === i ? 1 : 0.45}
                  pointerEvents="none"
                />
              )}
              {/* selective direct label: only the max day; clamped so it never
                  leaves the plot or collides with the left-side axis labels */}
              {i === maxIdx && s.total > 0 && active === null && x + barW / 2 > 70 && (
                <text
                  x={Math.min(x + barW / 2, W - 34)}
                  y={y - 5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--ink-2)"
                >
                  {fmtEur(s.total)}
                </text>
              )}
              {i % tickEvery === 0 && (
                <text
                  x={i * step + step / 2}
                  y={H - 7}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--ink-muted)"
                >
                  {fmtDayShort(s.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {active !== null && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs text-white shadow">
          {fmtDate(series[active].date)}: <strong>{fmtEur(series[active].total)}</strong>
        </div>
      )}
    </div>
  );
}

/** Bar anchored flat to the baseline with a 4px rounded data-end (top). */
function roundedTopBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const bottom = y + h;
  return [
    `M ${x} ${bottom}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${bottom}`,
    "Z",
  ].join(" ");
}
