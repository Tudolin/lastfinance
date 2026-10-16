'use client';

import { useId, useMemo, useState } from 'react';
import { formatBRL } from '@/domain/money';

export type ChartPoint = {
  date: string;
  actual: number | null;
  base: number | null;
  low: number | null;
  high: number | null;
  conservative?: number | null;
  optimistic?: number | null;
};

const W = 760;
const H = 260;
const PAD = { l: 64, r: 12, t: 12, b: 28 };

function niceTicks(min: number, max: number, n = 4) {
  const span = Math.max(1, max - min);
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(v);
  return out;
}

const shortBRL = (cents: number) => {
  const v = cents / 100;
  const abs = Math.abs(v);
  const s =
    abs >= 1000
      ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
      : abs.toFixed(0);
  return `${v < 0 ? '−' : ''}R$ ${s}`;
};

/**
 * Saldo realizado (linha sólida) × previsto (tracejado) com a faixa de incerteza, a linha do zero
 * e a da reserva mínima. Sem dependências: SVG puro, legível no claro e no escuro.
 */
export function ForecastChart({
  points,
  reserveCents,
  showScenarios = false,
  label,
  legend = { actual: 'realizado', base: 'previsto' },
}: {
  points: ChartPoint[];
  reserveCents?: number;
  showScenarios?: boolean;
  label: string;
  legend?: { actual: string; base: string };
}) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const { x, y, yTicks, paths, todayIdx } = useMemo(() => {
    const values = points.flatMap((p) =>
      [
        p.actual,
        p.base,
        p.low,
        p.high,
        showScenarios ? p.conservative : null,
        showScenarios ? p.optimistic : null,
      ].filter((v): v is number => v != null),
    );
    values.push(0);
    if (reserveCents) values.push(reserveCents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(1, (max - min) * 0.08);
    const lo = min - pad;
    const hi = max + pad;
    const x = (i: number) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const line = (key: keyof ChartPoint) => {
      let d = '';
      points.forEach((p, i) => {
        const v = p[key] as number | null | undefined;
        if (v == null) return;
        d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      });
      return d;
    };
    const bandIdx = points
      .map((p, i) => (p.low != null && p.high != null ? i : -1))
      .filter((i) => i >= 0);
    const band = bandIdx.length
      ? `M${bandIdx.map((i) => `${x(i).toFixed(1)},${y(points[i]!.high!).toFixed(1)}`).join('L')}L${[
          ...bandIdx,
        ]
          .reverse()
          .map((i) => `${x(i).toFixed(1)},${y(points[i]!.low!).toFixed(1)}`)
          .join('L')}Z`
      : '';
    return {
      x,
      y,
      yTicks: niceTicks(lo, hi),
      paths: {
        actual: line('actual'),
        base: line('base'),
        conservative: showScenarios ? line('conservative') : '',
        optimistic: showScenarios ? line('optimistic') : '',
        band,
      },
      todayIdx: points.findIndex((p) => p.base != null),
    };
  }, [points, reserveCents, showScenarios]);

  if (points.length < 2) return null;
  const xTicks = [
    0,
    Math.floor(points.length / 3),
    Math.floor((2 * points.length) / 3),
    points.length - 1,
  ];
  const hp = hover != null ? points[hover] : null;
  const hv = hp ? (hp.base ?? hp.actual) : null;

  return (
    <figure className="relative flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gid}-band`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.l - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--ink-2)"
              className="money-value"
            >
              {shortBRL(t)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--ink-3)"
          strokeWidth="1.2"
        />
        {reserveCents ? (
          <g>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(reserveCents)}
              y2={y(reserveCents)}
              stroke="var(--warn)"
              strokeWidth="1.2"
              strokeDasharray="2 4"
            />
            <text
              x={W - PAD.r}
              y={y(reserveCents) - 4}
              textAnchor="end"
              fontSize="10.5"
              fill="var(--warn-ink)"
            >
              reserva mínima
            </text>
          </g>
        ) : null}
        {paths.band ? <path d={paths.band} fill={`url(#${gid}-band)`} /> : null}
        {paths.optimistic ? (
          <path
            d={paths.optimistic}
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth="1.2"
            strokeDasharray="2 3"
          />
        ) : null}
        {paths.conservative ? (
          <path
            d={paths.conservative}
            fill="none"
            stroke="var(--danger)"
            strokeWidth="1.2"
            strokeDasharray="2 3"
          />
        ) : null}
        <path
          d={paths.actual}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d={paths.base}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.2"
          strokeDasharray="6 5"
          strokeLinejoin="round"
        />
        {todayIdx > 0 ? (
          <g>
            <line
              x1={x(todayIdx)}
              x2={x(todayIdx)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--ink-3)"
              strokeDasharray="3 3"
            />
            <text x={x(todayIdx) + 4} y={PAD.t + 10} fontSize="10.5" fill="var(--ink-2)">
              hoje
            </text>
          </g>
        ) : null}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-2)">
            {points[i]!.date.slice(8, 10)}/{points[i]!.date.slice(5, 7)}
          </text>
        ))}
        {hp && hv != null ? (
          <g>
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--ink-2)"
              strokeWidth="1"
            />
            <circle
              cx={x(hover!)}
              cy={y(hv)}
              r="4.5"
              fill="var(--surface)"
              stroke="var(--ink)"
              strokeWidth="2"
            />
          </g>
        ) : null}
      </svg>
      <figcaption className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {hp && hv != null ? (
          <span className="font-bold text-ink">
            {hp.date.slice(8, 10)}/{hp.date.slice(5, 7)}:{' '}
            <span className="money-value">{formatBRL(hv)}</span>
            {hp.low != null && hp.high != null && hp.low !== hp.high ? (
              <span className="font-semibold text-ink-2">
                {' '}
                (faixa <span className="money-value">{formatBRL(hp.low)}</span> a{' '}
                <span className="money-value">{formatBRL(hp.high)}</span>)
              </span>
            ) : null}
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5 bg-ink" aria-hidden="true" /> {legend.actual}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-5 border-t-2 border-dashed border-primary"
                aria-hidden="true"
              />{' '}
              {legend.base}
            </span>
            {paths.band ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-5 rounded-sm bg-primary/15"
                  aria-hidden="true"
                />{' '}
                faixa de incerteza
              </span>
            ) : null}
            {showScenarios ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-5 border-t-2 border-dotted border-danger"
                  aria-hidden="true"
                />{' '}
                conservador
              </span>
            ) : null}
          </>
        )}
      </figcaption>
    </figure>
  );
}
