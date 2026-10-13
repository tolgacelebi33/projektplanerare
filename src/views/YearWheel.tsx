import { colorOf } from "../data/statusColors";
import { defOf, defaultStatusDefs } from "../data/statuses";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dayNumber, todayISO } from "../data/dates";
import { isOverdue } from "../data/rules";
import type { GroupColor, Item, Status, StatusDef } from "../data/types";
import { sv } from "../i18n/sv";
import { STATUS_GLYPH } from "../proto/statusUi";
import {
  YEAR_ZOOM, angleOf, arcLinePath, clipToYear, groupByTopEpic, isCalendarYear, isLowerHalf, packLanesFor, periodOf, polar, sectorPath, stepZoom, textWidth, ticksFor, windowEnd, windowLabel, zoomInto, zoomOut,
  type WheelPeriod, type WheelTick, type WheelWindow, type WheelZoom, type YearSpan,
} from "./wheelGeometry";

const R0 = 120; // innerradie (månadsnamn ligger innanför)
const LANE_H = 24;
const MIN_LANE_H = 3;
const TARGET_R = 360; // yttre radie (SVG-enheter) som hjulet får växa till innan körfälten krymps
const LANE_PAD = 4;
const BAND_GAP = 8;
const FONT = 11;
const MIN_NUMBER_ARC = 16; // px bågbredd som krävs för att få plats med nummer
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface Placed {
  item: Item; s: number; e: number; rIn: number; rOut: number; a0: number; a1: number;
  inside: boolean; no: number | null; clippedStart: boolean; clippedEnd: boolean;
}
interface Band { letter: string; color: GroupColor | null; epic: Item | null; rIn: number; rOut: number; placed: Placed[] }

export function YearWheel({ items, win, colors, statuses, selectedId = null, onOpen, onContext, onWindow }: { items: Item[]; win: WheelWindow; onWindow?: (w: WheelWindow) => void; statuses?: StatusDef[]; colors?: ReadonlyMap<string, GroupColor | "none">; selectedId?: string | null; onOpen?: (id: string) => void; onContext?: (a: { id: string | null; x: number; y: number }) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  // Inzoomning: hela fönstret, ett kvartal eller en månad. Byter fönstret utifrån (verktygsraden) går hjulet tillbaka till hela fönstret.
  const winKey = `${win.sy}-${win.sm}-${win.months}`;
  const [zs, setZs] = useState<{ key: string; zoom: WheelZoom }>({ key: winKey, zoom: YEAR_ZOOM });
  const [animate, setAnimate] = useState(false); // mjuk övergång bara när man själv zoomar, inte när hjulet ritas första gången
  const zoom: WheelZoom = zs.key === winKey ? zs.zoom : YEAR_ZOOM;
  const zoomIn = useCallback((y: number, m: number) => { const z = zoomInto(zoom, y, m); if (z) { setAnimate(true); setZs({ key: winKey, zoom: z }); } }, [zoom, winKey]);
  const zoomBack = useCallback(() => { const z = zoomOut(zoom); if (z) { setAnimate(true); setZs({ key: winKey, zoom: z }); } }, [zoom, winKey]);
  const zoomTo = useCallback((z: WheelZoom) => { setAnimate(true); setZs({ key: winKey, zoom: z }); }, [winKey]);
  const step = useCallback((dir: 1 | -1) => {
    const n = stepZoom(win, zoom, dir);
    setAnimate(true); setZs({ key: `${n.win.sy}-${n.win.sm}-${n.win.months}`, zoom: n.zoom });
    if (`${n.win.sy}-${n.win.sm}-${n.win.months}` !== winKey) onWindow?.(n.win);
  }, [win, zoom, winKey, onWindow]);
  // Esc går ett steg ut, men bara om inget annat (dialog, meny, öppen post) är öppet: då stänger Esc det först
  useEffect(() => {
    if (zoom.kind === "year") return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"], aside.panel')) zoomBack(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [zoom, zoomBack]);
  const source = useRef<"shape" | "row">("row");
  const legendRef = useRef<HTMLElement>(null);
  const active = hover ?? selectedId; // den som redigeras förblir markerad
  const over = (id: string, from: "shape" | "row") => { source.current = from; setHover(id); };
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const toggle = (id: string) => openRef.current?.(id);
  // Pekar du på en båge ska raden i förklaringen synas. Bara förklaringens egen rullning justeras. scrollIntoView
  // skulle bläddra hela sidan, flytta hjulet bort under musen och släppa markeringen.
  useEffect(() => {
    if (!active || source.current !== "shape") return;
    const box = legendRef.current;
    const li = box?.querySelector(`li[data-id="${CSS.escape(active)}"]`);
    if (!box || !li) return;
    const b = box.getBoundingClientRect(), r = li.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop += r.top - b.top - 8;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
  }, [active]);

  const layout = useMemo<Layout>(() => {
    const per = periodOf(win, zoom), y = per.span;
    const ticks = ticksFor(win, zoom);
    // Ett klick på en månad zoomar till kvartalet (i hela fönstret) eller månaden (i ett kvartal): finns inget där är segmentet avstängt
    const real = items.filter((i) => i.type !== "epic");
    const hasIn = (p: WheelPeriod) => real.some((i) => i.end >= p.start && i.start <= p.end);
    const enabled = new Map<string, boolean>(ticks.map((t) => [`${t.kind}${t.s}`, t.kind === "month" && zoom.kind !== "month" ? hasIn(periodOf(win, zoom.kind === "year" ? { kind: "quarter", y: t.y!, q: Math.floor(t.m! / 3) } : { kind: "month", y: t.y!, m: t.m! })) : false]));
    const today = todayISO();
    const groups = groupByTopEpic(items);
    // Pass 1: körfält per grupp. Pass 2: höjd per fält så att hjulet får fast storlek (annat än vid glest innehåll).
    const prepared = groups
      .map((g, gi) => {
        const spans = g.items.map((i) => ({ i, c: clipToYear(i.start, i.end, y) })).filter((x): x is { i: Item; c: { s: number; e: number } } => !!x.c);
        // Milstolpar och korta poster behöver luft i sidled, räknat i dagar
        const pack = packLanesFor(spans.map((x) => ({ s: x.c.s, e: Math.max(x.c.e, x.c.s + 1) })), Math.ceil((y.days / 360) * 14 / 2));
        return { g, gi, spans, pack };
      })
      .filter((x) => x.spans.length);
    const totalLanes = prepared.reduce((n, x) => n + x.pack.count, 0);
    const avail = TARGET_R - R0 - prepared.length * BAND_GAP * 2;
    const laneH = Math.max(MIN_LANE_H, Math.min(LANE_H, avail / Math.max(1, totalLanes) - 1));
    const lanePad = laneH >= 12 ? LANE_PAD : 1;
    const roomy = laneH >= 14; // titlar och nummer ryms bara i höga fält

    const bands: Band[] = [];
    let r = R0;
    let counter = 0;
    prepared.forEach(({ g, gi, spans, pack }) => {
      const rIn = r + BAND_GAP;
      const thick = pack.count * (laneH + lanePad) + lanePad;
      const band: Band = { letter: LETTERS[gi % 26], color: ((c) => (c && c !== "none" ? c : null))(g.epic ? colors?.get(g.epic.id) : undefined), epic: g.epic, rIn, rOut: rIn + thick, placed: [] };
      spans.forEach((x, k) => {
        const lane = pack.lanes[k];
        const li = rIn + lanePad + lane * (laneH + lanePad);
        const a0 = angleOf(x.c.s, y), a1 = angleOf(x.c.e, y);
        const midR = li + laneH / 2;
        const arcLen = (a1 - a0) * midR;
        const label = `${STATUS_GLYPH[x.i.status]} ${x.i.title}`;
        const inside = roomy && x.i.type !== "milestone" && arcLen >= textWidth(label, FONT) + 12;
        band.placed.push({
          item: x.i, s: x.c.s, e: x.c.e, rIn: li, rOut: li + laneH, a0, a1, inside, no: null,
          clippedStart: x.c.s === 0 && x.i.start < per.start, clippedEnd: x.c.e === y.days && x.i.end > per.end,
        });
      });
      // Nummer till poster vars titel inte ryms på bågen (i läsordning: ring, sedan tid)
      band.placed.sort((a, b) => a.s - b.s);
      band.placed.forEach((p) => { if (!p.inside) p.no = ++counter; });
      bands.push(band);
      r = band.rOut;
    });
    const rMax = r + BAND_GAP;
    const showToday = today >= per.start && today <= per.end;
    const todayAngle = showToday ? angleOf(dayNumber(today) - y.startDay + 0.5, y) : null;
    return { y, per, ticks, enabled, zoom, bands, rMax, size: rMax * 2 + 24, todayAngle, today, laneH, lanePad, roomy };
  }, [items, win, zoom, colors]);

  const { bands, size } = layout;
  const count = bands.reduce((n, b) => n + b.placed.length, 0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Markeringen sätts direkt på DOM-noderna (data-hl) i stället för via props. Då ritas inte hundratals former om vid varje hover.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll("[data-hl]").forEach((e) => e.removeAttribute("data-hl"));
    if (active) root.querySelectorAll(`[data-id="${CSS.escape(active)}"]`).forEach((e) => e.setAttribute("data-hl", "1"));
    if (active) root.setAttribute("data-active", "1"); else root.removeAttribute("data-active");
  }, [active, count, winKey, items, zoom]);

  const onEnterShape = useCallback((id: string) => over(id, "shape"), []);
  const onEnterRow = useCallback((id: string) => over(id, "row"), []);
  const onLeave = useCallback(() => setHover(null), []);
  const onToggle = useCallback((id: string) => toggle(id), []);

  // Högerklick (eller ctrl-klick på Mac) på en båge, en förklaringsrad eller en tom yta
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id") ?? null;
    onContext?.({ id, x: e.clientX, y: e.clientY });
  };
  const winName = windowLabel(win, sv.wheel.months, sv.wheel.quarter);
  const wide = windowEnd(win).y !== win.sy; // fönstret sträcker sig över ett årsskifte: kvartal och månader får årtal
  const yy = (y: number) => (wide ? ` ${String(y).slice(2)}` : "");
  const qOf = zoom.kind === "quarter" ? { y: zoom.y, q: zoom.q } : zoom.kind === "month" ? { y: zoom.y, q: Math.floor(zoom.m / 3) } : null;
  const nav = (
    <nav className="wheel-nav" aria-label={sv.wheel.navLabel}>
      <ol className="wheel-crumbs">
        <li><button type="button" className="mini" aria-current={zoom.kind === "year" ? "true" : undefined} onClick={() => zoomTo(YEAR_ZOOM)}>{isCalendarYear(win) ? sv.wheel.wholeYear(win.sy) : winName}</button></li>
        {qOf && <li><button type="button" className="mini" aria-current={zoom.kind === "quarter" ? "true" : undefined} onClick={() => zoomTo({ kind: "quarter", y: qOf.y, q: qOf.q })}>{sv.wheel.quarter(qOf.q + 1)}{yy(qOf.y)}</button></li>}
        {zoom.kind === "month" && <li><button type="button" className="mini" aria-current="true">{sv.wheel.monthsLong[zoom.m]}{wide ? ` ${zoom.y}` : ""}</button></li>}
      </ol>
      {zoom.kind !== "year" && (
        <span className="wheel-step" role="group" aria-label={sv.wheel.stepLabel}>
          <button type="button" className="mini" aria-label={sv.wheel.prevPeriod} onClick={() => step(-1)}>{"\u2039"}</button>
          <button type="button" className="mini" aria-label={sv.wheel.nextPeriod} onClick={() => step(1)}>{"\u203A"}</button>
          <button type="button" className="mini" onClick={zoomBack}>{sv.wheel.back}</button>
        </span>
      )}
    </nav>
  );
  const label = periodLabel(win, zoom, winName);
  return (
    <div className="wheel-wrap">
    {nav}
    <div className={`wheel${count ? "" : " wheel-blank"}`} ref={rootRef} onContextMenu={onContextMenu}>
      <WheelSvg animate={animate} layout={layout} win={win} label={label} size={size} statuses={statuses} onEnter={onEnterShape} onLeave={onLeave} onToggle={onToggle} onZoomIn={zoomIn} onZoomBack={zoomBack} />
      {count ? <WheelLegend bands={bands} legendRef={legendRef} onEnter={onEnterRow} onLeave={onLeave} onToggle={onToggle} /> : <p role="status" className="wheel-empty">{sv.wheel.empty(label)}</p>}
    </div>
    </div>
  );
}

/** Periodens namn: fönstrets ("2026" eller "Kv 3 26 – Kv 2 27"), "Kv 4 2026" eller "okt 2026". */
const periodLabel = (_win: WheelWindow, z: WheelZoom, winName: string): string => (z.kind === "year" ? winName : z.kind === "quarter" ? `${sv.wheel.quarter(z.q + 1)} ${z.y}` : `${sv.wheel.months[z.m]} ${z.y}`);

interface Layout { y: YearSpan; per: WheelPeriod; ticks: WheelTick[]; enabled: Map<string, boolean>; zoom: WheelZoom; bands: Band[]; rMax: number; size: number; todayAngle: number | null; today: string; laneH: number; lanePad: number; roomy: boolean }

const WheelSvg = memo(function WheelSvg({ animate, layout, win, label, size, statuses, onEnter, onLeave, onToggle, onZoomIn, onZoomBack }: {
  animate: boolean; layout: Layout; win: WheelWindow; label: string; size: number; statuses?: StatusDef[]; onEnter: (id: string) => void; onLeave: () => void; onToggle: (id: string) => void; onZoomIn: (y: number, m: number) => void; onZoomBack: () => void;
}) {
  const { y, bands, rMax, todayAngle, today, laneH, lanePad, roomy, ticks, enabled, zoom } = layout;
  // Hela året: ett klick på en månad zoomar till dess kvartal, så det kvartalet markeras (alla tre månaderna) när man pekar eller fokuserar en månad
  const [hq, setHq] = useState<{ y: number; q: number } | null>(null);
  const wide = windowEnd(win).y !== win.sy; // över ett årsskifte: månadsnamnen får årtal vid första månaden och januari
  const c = size / 2;
  // Träffyta: hela körfältets höjd (så att grannfält aldrig täcker varandra) och några dagar extra i sidled, där körfältet har luft
  const hitPath = (p: Placed) => { const da = angleOf(Math.max(0.25, Math.min(3, y.days / 120)), y); return sectorPath(c, c, p.rIn - lanePad / 2, p.rOut + lanePad / 2, p.a0 - da, p.a1 + da); };
  return (
    <svg className={`wheel-svg${animate ? " wheel-anim" : ""}`} key={`${zoom.kind}${zoom.kind === "quarter" ? `${zoom.y}${zoom.q}` : zoom.kind === "month" ? `${zoom.y}${zoom.m}` : ""}`} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={sv.wheel.aria(label)}>
      {bands.map((b, bi) => (
        <path key={`bg${bi}`} className="wheel-band" data-alt={bi % 2} d={sectorPath(c, c, b.rIn, b.rOut, 0, 2 * Math.PI)} fillRule="evenodd" />
      ))}
      {ticks.map((t, ti) => {
        const a0 = angleOf(t.s, y), a1 = angleOf(t.e, y);
        const p0 = polar(c, c, R0 - 34, a0), p1 = polar(c, c, rMax, a0);
        const mid = polar(c, c, R0 - 18, (a0 + a1) / 2);
        const tickLabel = t.kind === "month" ? `${sv.wheel.months[t.m!]}${wide && zoom.kind === "year" && (ti === 0 || t.m === 0) ? ` ${String(t.y).slice(2)}` : ""}` : sv.wheel.weekShort(t.week!);
        const canZoom = t.kind === "month" && zoom.kind !== "month";
        const on = enabled.get(`${t.kind}${t.s}`) ?? false;
        const q = t.kind === "month" ? Math.floor(t.m! / 3) : 0;
        const target = t.kind === "month" ? (zoom.kind === "year" ? `${sv.wheel.quarter(q + 1)}${wide ? ` ${String(t.y).slice(2)}` : ""}, ${sv.wheel.monthsLong[t.m!]}` : sv.wheel.monthsLong[t.m!]) : "";
        return (
          <g key={`${t.kind}${t.s}`}>
            <line className="wheel-grid" x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} />
            {canZoom && on && (
              <path className="wheel-tick-hit" d={sectorPath(c, c, R0 - 34, R0, a0, a1)} role="button" tabIndex={0} aria-label={sv.wheel.zoomIn(target)}
                onPointerEnter={() => zoom.kind === "year" && setHq({ y: t.y!, q })} onPointerLeave={() => setHq(null)} onFocus={() => zoom.kind === "year" && setHq({ y: t.y!, q })} onBlur={() => setHq(null)}
                onClick={() => onZoomIn(t.y!, t.m!)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onZoomIn(t.y!, t.m!); } }} />
            )}
            {canZoom && !on && (
              <path className="wheel-tick-hit wheel-tick-off" d={sectorPath(c, c, R0 - 34, R0, a0, a1)} role="button" aria-disabled="true" aria-label={`${sv.wheel.zoomIn(target)}: ${sv.wheel.noItemsShort}`}><title>{sv.wheel.noItemsShort}</title></path>
            )}
            <text className={`wheel-month${canZoom && !on ? " wheel-month-off" : ""}`} x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{tickLabel}</text>
          </g>
        );
      })}
      {zoom.kind === "year" && hq !== null && (() => {
        const inQ = ticks.filter((t) => t.y === hq.y && Math.floor(t.m! / 3) === hq.q), first = inQ[0], last = inQ[inQ.length - 1];
        if (!first) return null;
        return <path className="wheel-quarter-hl" data-quarter={hq.q + 1} pointerEvents="none" d={sectorPath(c, c, R0 - 34, rMax, angleOf(first.s, y), angleOf(last.e, y))} />;
      })()}
      <circle className="wheel-grid" cx={c} cy={c} r={R0 - 34} fill="none" />
      {zoom.kind !== "year" && <circle className="wheel-center-hit" cx={c} cy={c} r={R0 - 36} role="button" tabIndex={0} aria-label={sv.wheel.back} onClick={onZoomBack} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onZoomBack(); } }} />}
      {bands.map((b, bi) => <circle key={`o${bi}`} className={`wheel-grid${b.color ? " wheel-band-ring" : ""}`} style={b.color ? ({ stroke: `var(--grp-${b.color})` }) : undefined} cx={c} cy={c} r={b.rOut} fill="none" />)}
      <text className={`wheel-year${zoom.kind === "year" && !isCalendarYear(win) ? " wheel-year-long" : ""}`} x={c} y={c} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{zoom.kind === "year" ? label : zoom.kind === "quarter" ? sv.wheel.quarter(zoom.q + 1) : sv.wheel.months[zoom.m]}</text>
      {zoom.kind !== "year" && <text className="wheel-year-sub" x={c} y={c + 24} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{zoom.y}</text>}
      {zoom.kind === "year" && hq !== null && <text className="wheel-year-sub" x={c} y={c + 24} textAnchor="middle" dominantBaseline="middle" pointerEvents="none">{sv.wheel.quarter(hq.q + 1)}{wide ? ` ${String(hq.y).slice(2)}` : ""}</text>}

      {bands.map((b) => b.placed.map((p) => {
        const id = p.item.id;
        const midA = (p.a0 + p.a1) / 2, midR = (p.rIn + p.rOut) / 2;
        const status = p.item.status as Status;
        const overdue = isOverdue(p.item, today);
        const tip = `${p.item.title}\n${p.item.start} till ${p.item.end}\n${sv.status[status]}${overdue ? `, ${sv.overdue}` : ""}`;
        const sc = ((d) => (d ? colorOf(d) : null))(defOf(p.item, statuses ?? defaultStatusDefs()));
        const common = { "data-id": id, "data-status": status, "data-sc": sc ?? undefined, onPointerEnter: () => onEnter(id), onPointerLeave: onLeave, onClick: () => onToggle(id) } as const;
        if (p.item.type === "milestone") {
          const pt = polar(c, c, midR, midA), s = Math.max(3, Math.min(9, laneH / 2 - 1));
          return (
            <g key={id} className="wheel-ms" {...common}>
              <title>{tip}</title>
              <path className="wheel-hit" d={hitPath(p)} />
              <path className="wheel-shape" d={`M${pt.x} ${pt.y - s} L${pt.x + s} ${pt.y} L${pt.x} ${pt.y + s} L${pt.x - s} ${pt.y} Z`} />
              {p.no !== null && roomy && <text className="wheel-no" x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central">{p.no}</text>}
            </g>
          );
        }
        const lower = isLowerHalf(midA);
        const pid = `wp-${id}`;
        return (
          <g key={id} className="wheel-arc" {...common}>
            <title>{tip}</title>
            <path className="wheel-hit" d={hitPath(p)} />
            <path className="wheel-shape" d={sectorPath(c, c, p.rIn, p.rOut, p.a0, p.a1)} />
            {p.clippedStart && <circle className="wheel-clip" cx={polar(c, c, midR, p.a0).x} cy={polar(c, c, midR, p.a0).y} r={2.5} />}
            {p.clippedEnd && <circle className="wheel-clip" cx={polar(c, c, midR, p.a1).x} cy={polar(c, c, midR, p.a1).y} r={2.5} />}
            {p.inside && (
              <>
                <path id={pid} d={arcLinePath(c, c, midR, p.a0, p.a1, lower)} fill="none" stroke="none" />
                <text className="wheel-text" dominantBaseline="central">
                  <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">{STATUS_GLYPH[status]} {p.item.title}</textPath>
                </text>
              </>
            )}
            {!p.inside && p.no !== null && roomy && (p.a1 - p.a0) * midR >= MIN_NUMBER_ARC && (
              <text className="wheel-text" x={polar(c, c, midR, midA).x} y={polar(c, c, midR, midA).y} textAnchor="middle" dominantBaseline="central">{p.no}</text>
            )}
          </g>
        );
      }))}

      {bands.map((b) => {
        const pt = polar(c, c, (b.rIn + b.rOut) / 2, -0.045);
        return (
          <g key={`l${b.letter}${b.rIn}`} className="wheel-letter">
            <circle cx={pt.x} cy={pt.y} r={9} />
            <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central">{b.letter}</text>
          </g>
        );
      })}
      {todayAngle !== null && (() => {
        const p0 = polar(c, c, R0 - 34, todayAngle), p1 = polar(c, c, rMax + 6, todayAngle);
        return <line className="wheel-today" x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} data-testid="wheel-today" />;
      })()}
    </svg>
  );
});

const WheelLegend = memo(function WheelLegend({ bands, legendRef, onEnter, onLeave, onToggle }: {
  bands: Band[]; legendRef: React.RefObject<HTMLElement | null>; onEnter: (id: string) => void; onLeave: () => void; onToggle: (id: string) => void;
}) {
  return (
      <aside className="wheel-legend" aria-label={sv.wheel.legend} ref={legendRef}>
      {bands.map((b) => (
        <section key={`s${b.letter}${b.rIn}`}>
          <h2 className={b.color ? "has-grp" : undefined} style={b.color ? ({ "--band-grp": `var(--grp-${b.color})` } as React.CSSProperties) : undefined}><span className="wheel-chip">{b.letter}</span>{b.epic ? b.epic.title : sv.wheel.noEpic}</h2>
          <ul>
            {b.placed.map((p) => (
              <li key={p.item.id} tabIndex={0} data-id={p.item.id} data-on-arc={p.inside ? "1" : undefined}
                onPointerEnter={() => onEnter(p.item.id)} onPointerLeave={onLeave} onFocus={() => onEnter(p.item.id)} onBlur={onLeave}
                onClick={() => onToggle(p.item.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(p.item.id); } }}>
                <span className="wheel-no-chip">{p.no ?? ""}</span>
                <span className="wheel-li-title">{STATUS_GLYPH[p.item.status]} {p.item.title}</span>
                <span className="wheel-li-meta">{p.item.type === "milestone" ? `${sv.milestone} ${p.item.start}` : `${p.item.start} till ${p.item.end}`} · {sv.status[p.item.status]}{p.inside ? ` · ${sv.wheel.onArc}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
});
