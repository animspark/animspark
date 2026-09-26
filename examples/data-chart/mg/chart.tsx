/**
 * An animated data story drawn with SVG and d3: a bar chart builds year by year while a
 * counter keeps the running total, the record year is called out, then the chart hands over
 * to a donut that breaks that year down. The numbers are illustrative, and say so.
 *
 * Both charts are driven by one number each (`bars.p`, `donut.p`, 0 → 1) tweened on the film
 * clock; bar heights, value labels and the counter are all computed from that number, so the
 * text and the bars can never disagree — and any frame renders the same when seeked.
 */
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { useStage } from '@animspark/runtime';
import { scaleBand, scaleLinear } from 'd3-scale';
import { arc, pie } from 'd3-shape';

gsap.registerPlugin(useGSAP);
export const durationSec = 9;

const SURFACE = '#0e1317';
const SUN = '#ffc53d';
const TEXT = '#f2efe8';
const MUTED = '#9aa4ad';
const GRID = '#ffffff1a';

/** Illustrative: new capacity added per year, GW. */
const ADDED = [
  { year: '2016', gw: 76 }, { year: '2017', gw: 98 }, { year: '2018', gw: 104 }, { year: '2019', gw: 118 },
  { year: '2020', gw: 139 }, { year: '2021', gw: 171 }, { year: '2022', gw: 226 }, { year: '2023', gw: 312 },
  { year: '2024', gw: 402 }, { year: '2025', gw: 488 },
];
const TOTAL = ADDED.reduce((sum, row) => sum + row.gw, 0);
/** Illustrative: where 2025's 488 GW came from. */
const MIX = [
  { source: 'Solar', gw: 302, color: SUN }, { source: 'Wind', gw: 103, color: '#4cc9f0' },
  { source: 'Gas', gw: 44, color: '#8d99ae' }, { source: 'Other', gw: 39, color: '#5c677d' },
];

/* Chart geometry in stage pixels at 1080p; scaled by `u` at render time. */
const CW = 1180, CH = 640, PAD = { l: 70, r: 20, t: 30, b: 60 };
const x = scaleBand<string>().domain(ADDED.map((d) => d.year)).range([PAD.l, CW - PAD.r]).padding(0.28);
const y = scaleLinear().domain([0, 500]).range([CH - PAD.b, PAD.t]);
const TICKS = [0, 100, 200, 300, 400, 500];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Bar i's growth at chart progress p: axes take 0–0.25, then bars grow in overlapping, eased windows. */
function barGrowth(p: number, i: number, n: number, overlap = 0.55): number {
  const t = clamp01((p - 0.25) / 0.75);
  const dur = 1 / (n - (n - 1) * overlap);
  const g = clamp01((t - i * dur * (1 - overlap)) / dur);
  return 1 - (1 - g) ** 3;
}

const slices = pie<(typeof MIX)[number]>().value((d) => d.gw).sort(null)(MIX);
const R = 250, RI = 150;
const donutArc = arc<{ startAngle: number; endAngle: number }>().innerRadius(RI).outerRadius(R).cornerRadius(4).padAngle(0.012);

export default function DataChart() {
  const ref = useRef<HTMLDivElement>(null);
  const { h } = useStage();
  const u = h / 1080;

  useGSAP(() => {
    const root = ref.current!;
    const q = <T extends Element>(s: string) => Array.from(root.querySelectorAll<T>(s));
    const rects = q<SVGRectElement>('.dc-bar');
    const values = q<SVGTextElement>('.dc-val');
    const grid = q<SVGGElement>('.dc-grid');
    const counter = root.querySelector<HTMLElement>('.dc-count')!;
    const arcs = q<SVGPathElement>('.dc-arc');
    const legend = q<HTMLElement>('.dc-leg');

    /* Frame 0 is already a complete picture: title and axes are there, bars start growing at once. */
    const bars = { p: 0.25 };
    const renderBars = () => {
      const axis = clamp01(bars.p / 0.25);
      grid.forEach((g, i) => { g.style.opacity = String(clamp01(axis * TICKS.length - i)); });
      let sum = 0;
      ADDED.forEach((row, i) => {
        const g = barGrowth(bars.p, i, ADDED.length);
        sum += row.gw * g;
        const top = y(row.gw * g);
        rects[i]!.setAttribute('y', String(top));
        rects[i]!.setAttribute('height', String(Math.max(0, y(0) - top)));
        values[i]!.setAttribute('y', String(top - 12));
        values[i]!.style.opacity = String(clamp01((g - 0.6) / 0.4));
        values[i]!.textContent = `${Math.round(row.gw * g)}`;
      });
      counter.textContent = Math.round(sum).toLocaleString('en-US');
    };

    const donut = { p: 0 };
    const renderDonut = () => {
      /* Slices sweep in order, like a pen going round: slice k draws over its own share of p. */
      let before = 0;
      slices.forEach((s, k) => {
        const share = s.data.gw / 488;
        const g = clamp01((donut.p - before) / share);
        before += share;
        arcs[k]!.setAttribute('d', donutArc({ startAngle: s.startAngle, endAngle: s.startAngle + (s.endAngle - s.startAngle) * g }) ?? '');
        legend[k]!.style.opacity = String(clamp01(g * 2));
      });
    };
    renderBars();
    renderDonut();

    const tl = gsap.timeline();
    tl.from('.dc-side > .dc-in', { opacity: 0, x: 30 * u, duration: 0.5, ease: 'power3.out', stagger: 0.1 }, 0.2)
      .to(bars, { p: 1, duration: 4.8, ease: 'none', onUpdate: renderBars }, 0)
      .from('.dc-call', { opacity: 0, scale: 0.8, duration: 0.4, ease: 'back.out(2)' }, 5.0)
      // hand-over: bars out, donut in
      .to('.dc-bars, .dc-side', { opacity: 0, y: -30 * u, duration: 0.5, ease: 'power2.in' }, 5.8)
      .to('.dc-head .dc-title-a', { opacity: 0, duration: 0.3 }, 5.8)
      .from('.dc-head .dc-title-b', { opacity: 0, y: 20 * u, duration: 0.5, ease: 'power3.out' }, 6.05)
      .from('.dc-donut', { opacity: 0, scale: 0.92, duration: 0.5, ease: 'power3.out' }, 6.0)
      .to(donut, { p: 1, duration: 2.2, ease: 'power1.inOut', onUpdate: renderDonut }, 6.1);
  }, { scope: ref });

  const mono = "'JetBrains Mono', monospace";
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, background: SURFACE, color: TEXT, overflow: 'hidden' }}>
      <div className="dc-head" style={{ position: 'absolute', left: 110 * u, top: 80 * u }}>
        <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 24 * u, letterSpacing: '0.12em', color: SUN }}>EXAMPLE 03 · SVG + d3</div>
        <div style={{ position: 'relative', height: 110 * u, marginTop: 14 * u }}>
          <div className="dc-title-a" style={{ position: 'absolute', whiteSpace: 'nowrap', fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: 88 * u, letterSpacing: '-0.02em' }}>The decade solar took off</div>
          <div className="dc-title-b" style={{ position: 'absolute', whiteSpace: 'nowrap', fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: 88 * u, letterSpacing: '-0.02em' }}>Where 2025's new power came from</div>
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: 28 * u, color: MUTED, marginTop: 6 * u }}>Illustrative numbers, drawn to show the chart grammar.</div>
      </div>

      <svg className="dc-bars" viewBox={`0 0 ${CW} ${CH}`} style={{ position: 'absolute', left: 90 * u, top: 330 * u, width: CW * u, height: CH * u, overflow: 'visible' }}>
        {TICKS.map((t) => (
          <g key={t} className="dc-grid">
            <line x1={PAD.l} x2={CW - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#ffffff55' : GRID} strokeWidth={t === 0 ? 2 : 1} />
            <text x={PAD.l - 14} y={y(t) + 6} textAnchor="end" fill={MUTED} fontFamily={mono} fontSize={18}>{t}</text>
          </g>
        ))}
        <text x={PAD.l - 14} y={PAD.t - 12} textAnchor="end" fill={MUTED} fontFamily={mono} fontSize={16}>GW</text>
        {ADDED.map((row) => (
          <g key={row.year}>
            <rect className="dc-bar" x={x(row.year)} width={x.bandwidth()} y={y(0)} height={0} rx={4} fill={SUN} />
            <text className="dc-val" x={(x(row.year) ?? 0) + x.bandwidth() / 2} y={y(0)} textAnchor="middle" fill={TEXT} fontFamily={mono} fontWeight={700} fontSize={20} style={{ opacity: 0 }}>0</text>
            <text x={(x(row.year) ?? 0) + x.bandwidth() / 2} y={CH - PAD.b + 34} textAnchor="middle" fill={MUTED} fontFamily={mono} fontSize={18}>{row.year}</text>
          </g>
        ))}
        <text x={PAD.l} y={CH + 10} fill="#5f6b75" fontFamily={mono} fontSize={16}>Source: illustrative data</text>
      </svg>

      <div className="dc-side" style={{ position: 'absolute', left: 1360 * u, top: 380 * u, width: 470 * u }}>
        <div className="dc-in" style={{ fontFamily: mono, fontSize: 24 * u, color: MUTED, letterSpacing: '0.08em' }}>ADDED SINCE 2016</div>
        <div className="dc-in" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 150 * u, lineHeight: 1, letterSpacing: '-0.04em', marginTop: 10 * u }}>
          <span className="dc-count">0</span>
        </div>
        <div className="dc-in" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, fontSize: 44 * u, color: SUN }}>gigawatts</div>
        <div className="dc-call" style={{ marginTop: 50 * u, padding: `${18 * u}px ${24 * u}px`, borderLeft: `${6 * u}px solid ${SUN}`, background: '#ffffff0d', fontFamily: "'Inter', sans-serif", fontSize: 30 * u, lineHeight: 1.35, transformOrigin: '0% 50%' }}>
          2025 alone: <b style={{ color: SUN }}>488 GW</b>,<br />6× the 2016 build.
        </div>
        <div className="dc-in" style={{ marginTop: 20 * u, fontFamily: mono, fontSize: 20 * u, color: '#5f6b75' }}>total {TOTAL.toLocaleString('en-US')} GW · illustrative</div>
      </div>

      <div className="dc-donut" style={{ position: 'absolute', left: 420 * u, top: 330 * u, display: 'flex', alignItems: 'center', gap: 90 * u }}>
        <svg viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`} style={{ width: R * 2 * u, height: R * 2 * u, overflow: 'visible' }}>
          {slices.map((s) => <path key={s.data.source} className="dc-arc" fill={s.data.color} d="" />)}
          <text y={-6} textAnchor="middle" fill={TEXT} fontFamily="'Space Grotesk', sans-serif" fontWeight={700} fontSize={64}>488</text>
          <text y={34} textAnchor="middle" fill={MUTED} fontFamily={mono} fontSize={20}>GW IN 2025</text>
        </svg>
        <div>
          {MIX.map((m) => (
            <div key={m.source} className="dc-leg" style={{ display: 'flex', alignItems: 'baseline', gap: 18 * u, marginBottom: 26 * u, opacity: 0 }}>
              <span style={{ width: 22 * u, height: 22 * u, borderRadius: 4 * u, background: m.color, alignSelf: 'center' }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 40 * u, width: 180 * u }}>{m.source}</span>
              <span style={{ fontFamily: mono, fontSize: 30 * u, color: MUTED }}>{m.gw} GW · {Math.round((m.gw / 488) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
      {/* a warm glow over the story */}
      <div style={{ position: 'absolute', right: -300 * u, top: -300 * u, width: 1000 * u, height: 1000 * u, borderRadius: '50%', background: `radial-gradient(circle, ${SUN}2e, transparent 65%)`, mixBlendMode: 'screen', pointerEvents: 'none' }} />
    </div>
  );
}
