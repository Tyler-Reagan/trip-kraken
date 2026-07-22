"use client";

/**
 * PROTOTYPE — wayfinder #136. Throwaway. Delete after the design decision lands.
 *
 * Foundation is settled: variant "C" (a focus surface over the map + a collapsible left-docked
 * stop panel). The open question narrowed to ONE thing: how to represent the metro and day tiers
 * so they read as distinct and SCALE (many metros, many days per metro). These three variants are
 * three answers to that, sharing the same map + stop panel:
 *   drill — one tier at a time in a top bar (metros → days → panel), back-navigated. Max scale.
 *   split — two visually-distinct always-visible bands: metro TABS + a day TIMELINE scrubber.
 *   tree  — no top bar; the left panel becomes an indented metro▸day▸stop tree.
 *
 * The map is a stylised stand-in (colored dots), not real MapLibre. Clicking any tier writes the
 * camera action it would fire to the focus-intent readout up top, so behavior is judgeable.
 * Teal = selection only; day color = identity swatch only. #137 (the state model) stays out.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Crosshair, ChevronDown, ChevronRight, Globe, ArrowLeft } from "lucide-react";
import { dayColorCss, dayTextColor } from "@/lib/dayColors";

// ── Seed: a multi-metro Japan trip with uneven day counts, to stress tier scaling ───────
type Stop = { name: string; geocoded: boolean };
type Day = { dayNumber: number; label: string; stops: Stop[] };
type Metro = { name: string; dayNumbers: number[] };

const DAYS: Day[] = [
  { dayNumber: 1, label: "Asakusa & east", stops: [
    { name: "Sensō-ji Temple", geocoded: true }, { name: "Tokyo Skytree", geocoded: true }, { name: "Akihabara", geocoded: true } ] },
  { dayNumber: 2, label: "West side", stops: [
    { name: "Meiji Shrine", geocoded: true }, { name: "Shibuya Crossing", geocoded: true }, { name: "teamLab Planets", geocoded: true } ] },
  { dayNumber: 3, label: "Central", stops: [
    { name: "Tsukiji Outer Market", geocoded: true }, { name: "Imperial Palace", geocoded: true }, { name: "Friend's ramen rec — TBD", geocoded: false } ] },
  { dayNumber: 4, label: "Ueno & museums", stops: [
    { name: "Ueno Park", geocoded: true }, { name: "Tokyo National Museum", geocoded: true }, { name: "Yanaka Ginza", geocoded: true } ] },
  { dayNumber: 5, label: "Hakone day trip", stops: [
    { name: "Open-Air Museum", geocoded: true }, { name: "Lake Ashi cruise", geocoded: true }, { name: "Ōwakudani", geocoded: true } ] },
  { dayNumber: 6, label: "Southern Higashiyama", stops: [
    { name: "Fushimi Inari Taisha", geocoded: true }, { name: "Tōfuku-ji", geocoded: true }, { name: "Sanjūsangen-dō", geocoded: true },
    { name: "Kiyomizu-dera", geocoded: true }, { name: "Yasaka Pagoda", geocoded: true }, { name: "Kōdai-ji", geocoded: true },
    { name: "Maruyama Park", geocoded: true }, { name: "Gion district", geocoded: true }, { name: "Pontochō alley — TBD", geocoded: false } ] },
  { dayNumber: 7, label: "Arashiyama", stops: [
    { name: "Bamboo Grove", geocoded: true }, { name: "Kinkaku-ji", geocoded: true }, { name: "Nishiki Market", geocoded: true } ] },
  { dayNumber: 8, label: "Northern", stops: [
    { name: "Ginkaku-ji", geocoded: true }, { name: "Philosopher's Path", geocoded: true }, { name: "Nanzen-ji", geocoded: true } ] },
  { dayNumber: 9, label: "Minami", stops: [
    { name: "Osaka Castle", geocoded: true }, { name: "Dōtonbori", geocoded: true }, { name: "Shinsekai", geocoded: true } ] },
  { dayNumber: 10, label: "Kita", stops: [
    { name: "Umeda Sky Building", geocoded: true }, { name: "Kuromon street food — TBD", geocoded: false } ] },
];

const METROS: Metro[] = [
  { name: "Tokyo", dayNumbers: [1, 2, 3, 4] },
  { name: "Hakone", dayNumbers: [5] },
  { name: "Kyoto", dayNumbers: [6, 7, 8] },
  { name: "Osaka", dayNumbers: [9, 10] },
];

const dayOf = (n: number) => DAYS.find((d) => d.dayNumber === n)!;
const metroOfDay = (n: number) => METROS.find((m) => m.dayNumbers.includes(n))!;
const stopTotal = (m: Metro) => m.dayNumbers.reduce((s, n) => s + dayOf(n).stops.length, 0);

const METRO_XY: Record<string, { x: number; y: number }> = {
  Tokyo: { x: 78, y: 40 }, Hakone: { x: 66, y: 46 }, Kyoto: { x: 40, y: 58 }, Osaka: { x: 30, y: 66 },
};

// ── Focus intent: names the camera action a tier click would fire (surface the state) ───
type Focus = { tier: "trip" | "metro" | "day" | "stop"; label: string; action: string } | null;
const fitTrip = (): Focus => ({ tier: "trip", label: "Japan", action: "fitBounds → all stops" });
const fitMetro = (name: string): Focus => ({ tier: "metro", label: name, action: "fitBounds → metro activities (trip-scoped)" });
const fitDay = (n: number): Focus => ({ tier: "day", label: `Day ${n} — ${dayOf(n).label}`, action: "fitBounds → day stops" });
const flyStop = (name: string): Focus => ({ tier: "stop", label: name, action: "flyTo + zoom 14" });

function FocusReadout({ focus }: { focus: Focus }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <Crosshair className="w-4 h-4 text-brand-400 shrink-0" />
      {focus ? (
        <span className="text-ink">
          <span className="text-faint">focus →</span>{" "}
          <span className="font-semibold capitalize">{focus.tier}</span>{" "}
          <span className="text-sub">{focus.label}</span>{" "}
          <span className="text-faint">· {focus.action}</span>
        </span>
      ) : <span className="text-faint">No focus yet — click a metro, day, or stop.</span>}
    </div>
  );
}

function DaySwatch({ n, size = 12 }: { n: number; size?: number }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: dayColorCss(n) }} />;
}

// ── Stand-in map surface: dark box, day-colored dots by metro, active day glows ─────────
function MapCanvas({ activeDay, children }: { activeDay: number | null; children?: React.ReactNode }) {
  return (
    <div className="relative w-full h-[340px] rounded-b-xl overflow-hidden"
      style={{ background: "radial-gradient(circle at 60% 40%, #1c2530, #0d1117)" }}>
      {DAYS.flatMap((day) => {
        const base = METRO_XY[metroOfDay(day.dayNumber).name];
        return day.stops.filter((s) => s.geocoded).map((s, i) => {
          const jx = ((day.dayNumber * 7 + i * 13) % 11) - 5, jy = ((day.dayNumber * 5 + i * 17) % 11) - 5;
          const active = activeDay === day.dayNumber;
          return <span key={`${day.dayNumber}-${i}`} className="absolute rounded-full transition-all"
            style={{ left: `${base.x + jx}%`, top: `${base.y + jy}%`, width: active ? 12 : 8, height: active ? 12 : 8,
              background: dayColorCss(day.dayNumber), opacity: activeDay == null ? 0.7 : active ? 1 : 0.2,
              boxShadow: active ? `0 0 10px ${dayColorCss(day.dayNumber)}` : "none" }} />;
        });
      })}
      {children}
    </div>
  );
}

// ── Shared collapsible left-docked stop panel (used by drill + split) ───────────────────
function StopPanel({ day, open, onToggle, setFocus }: {
  day: Day; open: boolean; onToggle: (v: boolean) => void; setFocus: (f: Focus) => void;
}) {
  if (!open) return (
    <button onClick={() => onToggle(true)}
      className="absolute left-0 top-3 flex items-center gap-1.5 rounded-r-lg bg-surface border border-l-0 border-line pl-2.5 pr-3 py-2 text-xs text-ink shadow-lg hover:bg-surface-2">
      <ChevronRight className="w-3.5 h-3.5 text-brand-400" /><span className="font-medium">{day.stops.length} stops</span>
    </button>
  );
  return (
    <div className="absolute left-0 top-0 bottom-0 w-56 flex flex-col bg-surface border-r border-line shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <DaySwatch n={day.dayNumber} />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-ink leading-tight">Day {day.dayNumber}</div>
          <div className="text-[11px] text-faint truncate">{day.stops.length} stops · {day.label}</div>
        </div>
        <button onClick={() => onToggle(false)} title="Hide stops" className="ml-auto p-1 -mr-1 rounded text-faint hover:text-ink hover:bg-surface-2">
          <ChevronDown className="w-4 h-4 -rotate-90" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {day.stops.map((s, i) => (
          <button key={i} disabled={!s.geocoded} onClick={() => setFocus(flyStop(s.name))}
            className="group w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors enabled:hover:bg-surface-2 disabled:cursor-not-allowed">
            <StopBadge day={day.dayNumber} index={i} geocoded={s.geocoded} />
            <span className={`text-xs truncate flex-1 ${s.geocoded ? "text-sub group-hover:text-ink" : "text-faint"}`}>{s.name}</span>
            {s.geocoded
              ? <Crosshair className="w-3.5 h-3.5 text-faint opacity-0 group-hover:opacity-100 group-hover:text-brand-400 shrink-0 transition-opacity" />
              : <span className="text-[10px] text-faint shrink-0">no coords</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function StopBadge({ day, index, geocoded }: { day: number; index: number; geocoded: boolean }) {
  return <span className="w-5 h-5 grid place-items-center rounded-full text-[10px] font-semibold shrink-0"
    style={{ background: geocoded ? dayColorCss(day) : "transparent", color: geocoded ? dayTextColor(day) : "var(--faint)",
      border: geocoded ? "none" : "1px dashed var(--border-strong)" }}>{index + 1}</span>;
}

// =============================================================================
// DRILL — one tier at a time in the top bar. Metros → (pick) → that metro's days → (pick) →
// stop panel. A back chip returns up a level. Only ever one tier of pills on screen, so the
// tiers can never be confused, and any count scrolls horizontally instead of cluttering.
// =============================================================================
function VariantDrill({ setFocus }: { setFocus: (f: Focus) => void }) {
  const [activeMetro, setActiveMetro] = useState("Kyoto");
  const [activeDay, setActiveDay] = useState<number | null>(6);
  const [level, setLevel] = useState<"metro" | "day">("day");
  const [stopsOpen, setStopsOpen] = useState(true);
  const metro = METROS.find((m) => m.name === activeMetro)!;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-2.5 py-2 overflow-x-auto">
        {level === "metro" ? (
          <>
            <button onClick={() => { setActiveDay(null); setFocus(fitTrip()); }} title="Fit the whole trip"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-sub hover:text-ink hover:bg-surface-3 shrink-0">
              <Globe className="w-3.5 h-3.5 text-faint" />Japan
            </button>
            <span className="w-px h-4 bg-line mx-0.5 shrink-0" />
            {METROS.map((m) => (
              <button key={m.name} onClick={() => { setActiveMetro(m.name); setActiveDay(null); setLevel("day"); setFocus(fitMetro(m.name)); }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-sub hover:text-ink hover:bg-surface-3 shrink-0">
                <MapPin className="w-3.5 h-3.5 text-faint" />{m.name}
                <span className="text-faint tabular-nums">{m.dayNumbers.length}d</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <button onClick={() => setLevel("metro")} title="Back to metros"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink bg-surface-3 hover:bg-surface shrink-0">
              <ArrowLeft className="w-3.5 h-3.5 text-brand-400" /><MapPin className="w-3.5 h-3.5" />{activeMetro}
            </button>
            <span className="w-px h-4 bg-line mx-0.5 shrink-0" />
            {metro.dayNumbers.map((n) => {
              const selected = activeDay === n;
              return (
                <button key={n} onClick={() => { setActiveDay(n); setStopsOpen(true); setFocus(fitDay(n)); }} aria-pressed={selected}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs shrink-0 transition-colors ${
                    selected ? "bg-surface text-ink ring-1 ring-brand-500" : "text-sub hover:bg-surface-3"}`}>
                  <DaySwatch n={n} size={11} /><span className="font-medium">Day {n}</span>
                  <span className="text-faint tabular-nums">{dayOf(n).stops.length}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
      <div className="relative">
        <MapCanvas activeDay={activeDay} />
        {activeDay != null && <StopPanel day={dayOf(activeDay)} open={stopsOpen} onToggle={setStopsOpen} setFocus={setFocus} />}
      </div>
    </div>
  );
}

// =============================================================================
// SPLIT — two always-visible bands in DIFFERENT visual languages, each independently
// scrollable so neither tier clutters the other. Metro = underline TABS. Day = a horizontal
// TIMELINE scrubber (nodes on a track). The language contrast is what keeps the tiers unmuddied.
// =============================================================================
function VariantSplit({ setFocus }: { setFocus: (f: Focus) => void }) {
  const [activeMetro, setActiveMetro] = useState("Kyoto");
  const [activeDay, setActiveDay] = useState<number | null>(6);
  const [stopsOpen, setStopsOpen] = useState(true);
  const metro = METROS.find((m) => m.name === activeMetro)!;

  return (
    <div className="card p-0 overflow-hidden">
      {/* Metro tabs */}
      <div className="flex items-stretch bg-surface-2 border-b border-line">
        <button onClick={() => { setActiveDay(null); setFocus(fitTrip()); }} title="Fit the whole trip"
          className="inline-flex items-center gap-1.5 px-3 text-xs font-medium text-sub hover:text-ink border-r border-line shrink-0">
          <Globe className="w-3.5 h-3.5 text-faint" />Japan
        </button>
        <div className="flex items-stretch overflow-x-auto">
          {METROS.map((m) => {
            const selected = activeMetro === m.name;
            return (
              <button key={m.name} onClick={() => { setActiveMetro(m.name); setActiveDay(null); setFocus(fitMetro(m.name)); }} aria-pressed={selected}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs border-b-2 -mb-px shrink-0 transition-colors ${
                  selected ? "border-brand-400 text-ink font-semibold" : "border-transparent text-sub hover:text-ink"}`}>
                <MapPin className={`w-3.5 h-3.5 ${selected ? "text-brand-400" : "text-faint"}`} />{m.name}
                <span className="text-faint tabular-nums">{stopTotal(m)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day pills for the active metro — minimalist footprint (from drill) */}
      <div className="flex items-center gap-1.5 overflow-x-auto bg-surface px-2.5 py-2 border-b border-line">
        {metro.dayNumbers.map((n) => {
          const selected = activeDay === n;
          return (
            <button key={n} onClick={() => { setActiveDay(n); setStopsOpen(true); setFocus(fitDay(n)); }} aria-pressed={selected}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs shrink-0 transition-colors ${
                selected ? "bg-surface-3 text-ink ring-1 ring-brand-500" : "text-sub hover:bg-surface-3"}`}>
              <DaySwatch n={n} size={11} /><span className="font-medium">Day {n}</span>
              <span className="text-faint tabular-nums">{dayOf(n).stops.length}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <MapCanvas activeDay={activeDay} />
        {activeDay != null && <StopPanel day={dayOf(activeDay)} open={stopsOpen} onToggle={setStopsOpen} setFocus={setFocus} />}
      </div>
    </div>
  );
}

// =============================================================================
// TREE — no top bar. The left panel is the whole navigator: an indented, collapsible
// metro ▸ day ▸ stop tree. Indentation makes the tiers unambiguous; vertical scroll scales to
// any depth. Absorbs the stop panel you liked and extends it up to the metro/day tiers.
// =============================================================================
function VariantTree({ setFocus }: { setFocus: (f: Focus) => void }) {
  const [openMetros, setOpenMetros] = useState<Set<string>>(new Set(["Kyoto"]));
  const [openDays, setOpenDays] = useState<Set<number>>(new Set([6]));
  const [activeDay, setActiveDay] = useState<number | null>(6);
  const [panelOpen, setPanelOpen] = useState(true);
  const toggle = <T,>(set: Set<T>, v: T) => { const next = new Set(set); next.has(v) ? next.delete(v) : next.add(v); return next; };

  return (
    <div className="card p-0 overflow-hidden">
      <div className="relative">
        <MapCanvas activeDay={activeDay} />
        {!panelOpen ? (
          <button onClick={() => setPanelOpen(true)}
            className="absolute left-0 top-3 flex items-center gap-1.5 rounded-r-lg bg-surface border border-l-0 border-line pl-2.5 pr-3 py-2 text-xs text-ink shadow-lg hover:bg-surface-2">
            <ChevronRight className="w-3.5 h-3.5 text-brand-400" /><span className="font-medium">Places</span>
          </button>
        ) : (
          <div className="absolute left-0 top-0 bottom-0 w-64 flex flex-col bg-surface border-r border-line shadow-xl">
            <button onClick={() => { setActiveDay(null); setFocus(fitTrip()); }}
              className="flex items-center gap-2 px-3 py-2.5 border-b border-line text-left hover:bg-surface-2">
              <Globe className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-semibold text-ink">Japan</span>
              <span className="ml-auto text-[11px] text-faint">{DAYS.length} days</span>
              <ChevronDown className="w-4 h-4 -rotate-90 text-faint" onClick={(e) => { e.stopPropagation(); setPanelOpen(false); }} />
            </button>
            <div className="flex-1 overflow-y-auto py-1">
              {METROS.map((m) => {
                const mOpen = openMetros.has(m.name);
                return (
                  <div key={m.name}>
                    <div className="flex items-center hover:bg-surface-2">
                      <button onClick={() => setOpenMetros((s) => toggle(s, m.name))} className="p-2 text-faint hover:text-ink" title={mOpen ? "Collapse" : "Expand"}>
                        {mOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => setFocus(fitMetro(m.name))} className="flex items-center gap-2 flex-1 py-2 pr-3 text-left">
                        <MapPin className="w-3.5 h-3.5 text-sub" />
                        <span className="text-sm font-medium text-ink">{m.name}</span>
                        <span className="ml-auto text-[11px] text-faint tabular-nums">{m.dayNumbers.length}d · {stopTotal(m)}</span>
                      </button>
                    </div>
                    {mOpen && m.dayNumbers.map((n) => {
                      const dOpen = openDays.has(n);
                      const day = dayOf(n);
                      return (
                        <div key={n}>
                          <div className={`flex items-center hover:bg-surface-2 ${activeDay === n ? "bg-surface-2" : ""}`}>
                            <button onClick={() => setOpenDays((s) => toggle(s, n))} className="p-1.5 ml-6 text-faint hover:text-ink">
                              {dOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => { setActiveDay(n); setFocus(fitDay(n)); }} className="flex items-center gap-2 flex-1 py-1.5 pr-3 text-left">
                              <DaySwatch n={n} />
                              <span className="text-xs text-ink">Day {n}</span>
                              <span className="text-xs text-faint truncate">{day.label}</span>
                              <span className="ml-auto text-[11px] text-faint tabular-nums shrink-0">{day.stops.length}</span>
                            </button>
                          </div>
                          {dOpen && day.stops.map((s, i) => (
                            <button key={i} disabled={!s.geocoded} onClick={() => setFocus(flyStop(s.name))}
                              className="group w-full flex items-center gap-2 py-1.5 pl-[68px] pr-3 text-left enabled:hover:bg-surface-2 disabled:cursor-not-allowed">
                              <StopBadge day={n} index={i} geocoded={s.geocoded} />
                              <span className={`text-[11px] truncate flex-1 ${s.geocoded ? "text-sub group-hover:text-ink" : "text-faint"}`}>{s.name}</span>
                              {s.geocoded
                                ? <Crosshair className="w-3 h-3 text-faint opacity-0 group-hover:opacity-100 group-hover:text-brand-400 shrink-0" />
                                : <span className="text-[10px] text-faint shrink-0">no coords</span>}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Floating variant switcher (throwaway; hidden in prod) ────────────────────
const VARIANTS: { key: string; name: string; render: (p: { setFocus: (f: Focus) => void }) => React.ReactNode }[] = [
  { key: "drill", name: "Drill-down — one tier at a time", render: (p) => <VariantDrill {...p} /> },
  { key: "split", name: "Split bands — metro tabs · day timeline", render: (p) => <VariantSplit {...p} /> },
  { key: "tree", name: "Nested tree panel", render: (p) => <VariantTree {...p} /> },
];

function Switcher({ current }: { current: string }) {
  const router = useRouter();
  const go = useCallback((key: string) => router.replace(`?variant=${key}`), [router]);
  const idx = Math.max(0, VARIANTS.findIndex((v) => v.key === current));
  const cycle = useCallback((dir: number) => go(VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length].key), [idx, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycle]);

  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-black text-white shadow-2xl px-3 py-2 text-sm">
      <button onClick={() => cycle(-1)} className="px-2 hover:text-brand-300">←</button>
      <span>{VARIANTS[idx].name}</span>
      <button onClick={() => cycle(1)} className="px-2 hover:text-brand-300">→</button>
    </div>
  );
}

export default function MapAffordancesPrototype() {
  const params = useSearchParams();
  const key = params.get("variant") ?? "drill";
  const variant = VARIANTS.find((v) => v.key === key) ?? VARIANTS[0];
  const [focus, setFocus] = useState<Focus>(null);

  return (
    <div className="dark min-h-screen bg-canvas text-ink p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-ink">Tier representation — prototype</h1>
            <p className="text-xs text-faint">wayfinder #136 · throwaway · {variant.name}</p>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-danger-400 border border-danger-400/40 rounded px-2 py-1">Prototype</span>
        </header>

        <div className="card px-4 py-2.5"><FocusReadout focus={focus} /></div>
        {variant.render({ setFocus })}
      </div>
      <Switcher current={key} />
    </div>
  );
}
