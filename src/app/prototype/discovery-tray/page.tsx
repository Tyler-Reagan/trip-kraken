"use client";

// PROTOTYPE — throwaway. Answers: "how do Nearby/Along-route/Inspector attach to the
// focal-stack day-navigator shell, now that the map is a popup window?" The shell itself
// (focal stack + index strip + drag-to-edge dwell paging) is the locked Variant B from
// /prototype/day-carousel — held constant here, not re-litigated.
// wayfinder ticket #134, https://github.com/Tyler-Reagan/trip-kraken/issues/134
//
// Three variants, switchable via ?variant=:
//   A — Footer rail: fixed-height bottom tray, results browse horizontally.
//   B — Footer grid: bottom tray with peek/expanded states, results browse vertically.
//   C — Side panel: the current app's right-column attachment, adapted — shows the width
//       competition with the carousel honestly instead of assuming footer wins.
// Constant across variants: inspector opens as a popover anchored to the clicked stop;
// the map is a floating popup window toggled from the header.
// Fake data only — no wiring to the real store. Not linked from anywhere; delete after
// the decision is captured.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { animated, to, useTransition, Globals, type SpringValue } from "@react-spring/web";

// ---------- fake data ----------

const DAYS = [
  { dayNumber: 1, date: "Aug 1", label: "Arrival", stops: ["Haneda Airport", "Shinagawa Hotel Check-in"] },
  { dayNumber: 2, date: "Aug 2", label: "Asakusa", stops: ["Senso-ji Temple", "Nakamise Street", "Tokyo Skytree"] },
  { dayNumber: 3, date: "Aug 3", label: null, stops: ["Shibuya Crossing", "Meiji Shrine", "Harajuku Takeshita St"] },
  { dayNumber: 4, date: "Aug 4", label: "Day trip", stops: ["Hakone Ropeway", "Lake Ashi Cruise", "Owakudani"] },
  { dayNumber: 5, date: "Aug 5", label: null, stops: ["Tsukiji Outer Market", "Ginza shopping"] },
  { dayNumber: 6, date: "Aug 6", label: "Kyoto", stops: ["Shinkansen to Kyoto", "Fushimi Inari Shrine"] },
  { dayNumber: 7, date: "Aug 7", label: null, stops: ["Arashiyama Bamboo Grove", "Kinkaku-ji", "Nishiki Market"] },
  { dayNumber: 8, date: "Aug 8", label: "Departure", stops: ["Kyoto Station", "Kansai Airport"] },
];
type Day = (typeof DAYS)[number];

type FakeResult = {
  id: string;
  name: string;
  rating: number;
  reviews: number;
  price: number; // 0–4
  tag: string;
  hue: number; // photo placeholder color
};

const NEARBY_RESULTS: FakeResult[] = [
  { id: "n1", name: "Kappabashi Coffee", rating: 4.6, reviews: 812, price: 1, tag: "cafe", hue: 25 },
  { id: "n2", name: "Asakusa Imahan", rating: 4.4, reviews: 2103, price: 3, tag: "restaurant", hue: 0 },
  { id: "n3", name: "Sumida Park", rating: 4.3, reviews: 5320, price: 0, tag: "park", hue: 130 },
  { id: "n4", name: "Kaminarimon Gate", rating: 4.5, reviews: 31200, price: 0, tag: "attraction", hue: 210 },
  { id: "n5", name: "Onigiri Yadoroku", rating: 4.5, reviews: 987, price: 1, tag: "restaurant", hue: 45 },
  { id: "n6", name: "Hoppy Street Izakaya", rating: 4.2, reviews: 1440, price: 2, tag: "restaurant", hue: 350 },
  { id: "n7", name: "Don Quijote Asakusa", rating: 4.0, reviews: 8200, price: 1, tag: "shopping", hue: 55 },
  { id: "n8", name: "Asakusa Culture Center", rating: 4.4, reviews: 6100, price: 0, tag: "attraction", hue: 190 },
  { id: "n9", name: "Fuglen Asakusa", rating: 4.5, reviews: 1900, price: 2, tag: "cafe", hue: 30 },
  { id: "n10", name: "Hanayashiki Park", rating: 4.1, reviews: 4400, price: 2, tag: "attraction", hue: 300 },
  { id: "n11", name: "Marugoto Nippon", rating: 4.2, reviews: 2600, price: 2, tag: "shopping", hue: 160 },
  { id: "n12", name: "Kappabashi Kitchen St", rating: 4.5, reviews: 7300, price: 1, tag: "shopping", hue: 80 },
];

const ROUTE_RESULTS: FakeResult[] = [
  { id: "r1", name: "Mizumachi Riverside", rating: 4.3, reviews: 2100, price: 1, tag: "shopping", hue: 200 },
  { id: "r2", name: "Sumida Aquarium", rating: 4.4, reviews: 15800, price: 3, tag: "attraction", hue: 220 },
  { id: "r3", name: "Kirby Café", rating: 4.3, reviews: 3600, price: 2, tag: "cafe", hue: 330 },
  { id: "r4", name: "Ushijima Shrine", rating: 4.4, reviews: 980, price: 0, tag: "attraction", hue: 15 },
  { id: "r5", name: "Rokurinsha Ramen", rating: 4.2, reviews: 5100, price: 1, tag: "restaurant", hue: 40 },
  { id: "r6", name: "Sumida Riverside Walk", rating: 4.5, reviews: 3900, price: 0, tag: "park", hue: 140 },
];

const FILTER_TAGS = ["all", "restaurant", "cafe", "attraction", "shopping", "park"];
const PRICE = ["Free", "$", "$$", "$$$", "$$$$"];

type TrayMode = "nearby" | "route";

// ---------- shared bits ----------

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs">
      <span className="text-amber-500">★</span>
      <span className="font-medium text-ink">{rating.toFixed(1)}</span>
    </span>
  );
}

/** One discovery result. Draggable up to a day card; the Add button is the click path. */
function ResultCard({ result, wide }: { result: FakeResult; wide?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `result:${result.id}`,
    data: { label: result.name, kind: "result" },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`card p-2 flex flex-col gap-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none transition-opacity ${
        isDragging ? "opacity-30" : ""
      } ${wide ? "w-full" : "w-[168px]"}`}
    >
      <div
        className="h-14 rounded-md w-full"
        style={{ background: `linear-gradient(135deg, hsl(${result.hue} 45% 72%), hsl(${result.hue + 30} 40% 55%))` }}
      />
      <p className="text-xs font-medium text-ink truncate">{result.name}</p>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-sub">
          <Stars rating={result.rating} />
          <span className="text-faint">·</span>
          <span className="text-faint">{PRICE[result.price]}</span>
        </span>
        <button className="text-[11px] px-1.5 py-0.5 rounded bg-brand-600 dark:bg-brand-500 text-white font-medium">
          + Add
        </button>
      </div>
    </div>
  );
}

/** Filter controls as a single toolbar row — the footer's natural form for them. */
function FilterRow({
  tag, setTag, keyword, setKeyword, compact,
}: {
  tag: string; setTag: (t: string) => void;
  keyword: string; setKeyword: (k: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${compact ? "flex-wrap" : ""}`}>
      {FILTER_TAGS.map((t) => (
        <button
          key={t}
          onClick={() => setTag(t)}
          className={`px-2 py-0.5 text-[11px] rounded-full border capitalize whitespace-nowrap transition-colors ${
            tag === t
              ? "bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500"
              : "bg-surface-2 text-sub border-line-strong hover:bg-surface-3"
          }`}
        >
          {t}
        </button>
      ))}
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="Search…"
        className="input py-0.5 px-2 text-xs flex-1 min-w-[100px] max-w-[200px]"
      />
      <button className="text-[11px] text-sub whitespace-nowrap hover:text-ink">More filters ▾</button>
    </div>
  );
}

function useFilteredResults(mode: TrayMode, tag: string, keyword: string) {
  const base = mode === "nearby" ? NEARBY_RESULTS : ROUTE_RESULTS;
  return base.filter(
    (r) =>
      (tag === "all" || r.tag === tag) &&
      (!keyword.trim() || r.name.toLowerCase().includes(keyword.trim().toLowerCase()))
  );
}

function TrayTitle({ mode, setMode, onClose }: { mode: TrayMode; setMode: (m: TrayMode) => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex rounded-lg border border-line-strong overflow-hidden text-xs shrink-0">
        {(["nearby", "route"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-2.5 py-1 font-medium transition-colors ${
              mode === m ? "bg-ink text-canvas" : "bg-surface-2 text-sub hover:bg-surface-3"
            }`}
          >
            {m === "nearby" ? "Nearby" : "Along the way"}
          </button>
        ))}
      </div>
      <p className="text-xs text-sub truncate">
        {mode === "nearby" ? "around Senso-ji Temple" : "Senso-ji Temple → Tokyo Skytree"}
      </p>
      <button onClick={onClose} className="ml-auto text-faint hover:text-sub text-sm shrink-0" aria-label="Close">
        ✕
      </button>
    </div>
  );
}

// ---------- inspector popover (constant across variants) ----------

type Inspected = { stop: string; rect: DOMRect };

function InspectorPopover({ inspected, onClose }: { inspected: Inspected; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  // Anchor beside the clicked stop row; clamp so it never leaves the viewport.
  const W = 260;
  const left = Math.min(inspected.rect.right + 10, window.innerWidth - W - 12);
  const top = Math.min(Math.max(inspected.rect.top - 8, 12), window.innerHeight - 240);

  return (
    <div
      ref={ref}
      className="fixed z-40 card shadow-xl p-3 space-y-2"
      style={{ left, top, width: W }}
      role="dialog"
      aria-label={`Details for ${inspected.stop}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink leading-snug">{inspected.stop}</p>
        <button onClick={onClose} className="text-faint hover:text-sub shrink-0" aria-label="Close">✕</button>
      </div>
      <div className="flex items-center gap-1.5">
        <Stars rating={4.5} />
        <span className="text-[11px] text-faint">(12,840 reviews)</span>
      </div>
      <p className="text-[11px] text-sub">2 Chome-3-1 Asakusa, Taito City, Tokyo</p>
      <div className="text-[11px] text-sub">
        <p className="font-medium">Hours</p>
        <div className="flex justify-between"><span>Mon–Sun</span><span>6:00–17:00</span></div>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-sub">
        <span className="w-20">Visit duration</span>
        <input defaultValue={1} className="w-7 text-center bg-surface-2 border border-line-strong rounded px-1 py-0.5 text-xs" />
        <span className="text-faint">h</span>
        <input defaultValue={30} className="w-7 text-center bg-surface-2 border border-line-strong rounded px-1 py-0.5 text-xs" />
        <span className="text-faint">m</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {["buddhist temple", "landmark"].map((c) => (
          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-sub">{c}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- map popup window (constant across variants) ----------

function MapPopup({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed right-6 top-20 z-40 card shadow-2xl overflow-hidden w-[360px]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line bg-surface-2">
        <p className="text-xs font-medium text-ink">Map</p>
        <button onClick={onClose} className="text-faint hover:text-sub text-sm" aria-label="Close map">✕</button>
      </div>
      <div className="relative h-[240px] bg-gradient-to-br from-sky-200 to-emerald-200 dark:from-sky-900 dark:to-emerald-900">
        {[[30, 40], [55, 30], [70, 60], [45, 70], [80, 25]].map(([x, y], i) => (
          <span
            key={i}
            className="absolute w-3 h-3 rounded-full bg-brand-600 border-2 border-white shadow"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
        <p className="absolute bottom-2 left-2 text-[10px] text-ink/60">popup window stand-in — real map owned by #128</p>
      </div>
    </div>
  );
}

// ---------- the locked focal-stack shell (from /prototype/day-carousel Variant B) ----------

type Role = "prev" | "active" | "next" | "gone";

const ROLE_TARGET: Record<Exclude<Role, "gone">, { x: number; y: number; scale: number; opacity: number }> = {
  prev: { x: -170, y: 20, scale: 0.82, opacity: 0.65 },
  active: { x: 0, y: 0, scale: 1, opacity: 1 },
  next: { x: 170, y: 20, scale: 0.82, opacity: 0.65 },
};

const EDGE_ZONE_PX = 70;
const DWELL_MS = 450;
const COOLDOWN_MS = 350;

function DraggableStop({ id, label, onInspect }: { id: string; label: string; onInspect: (rect: DOMRect) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { label, kind: "stop" } });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => onInspect(e.currentTarget.getBoundingClientRect())}
      className={`text-xs px-2 py-1 mb-1 rounded border border-line-strong bg-surface cursor-grab active:cursor-grabbing select-none touch-none transition-opacity hover:border-brand-400 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      ⠿ {label}
    </li>
  );
}

function DroppableDayCard({
  day, zIndex, style, children,
}: {
  day: Day;
  zIndex: number;
  style: { x: SpringValue<number>; y: SpringValue<number>; scale: SpringValue<number>; opacity: SpringValue<number> };
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.dayNumber}` });
  return (
    <animated.div
      ref={setNodeRef}
      className={`absolute card p-4 flex flex-col w-[260px] h-[280px] ${isOver ? "ring-2 ring-brand-400" : ""}`}
      style={{
        zIndex,
        opacity: style.opacity,
        transform: to([style.x, style.y, style.scale], (x, y, scale) => `translate(${x}px, ${y}px) scale(${scale})`),
      }}
    >
      {children}
    </animated.div>
  );
}

function FocalStack({
  isDragging, onInspect, stackHeight = 340,
}: {
  isDragging: boolean;
  onInspect: (stop: string, rect: DOMRect) => void;
  stackHeight?: number;
}) {
  const [active, setActive] = useState(1);
  const [dwellSide, setDwellSide] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<1 | -1>(1);
  const dwellTimerRef = useRef<{ side: "left" | "right"; id: ReturnType<typeof setTimeout> } | null>(null);
  const cooldownRef = useRef(false);

  function go(next: number) {
    const clamped = Math.max(0, Math.min(DAYS.length - 1, next));
    if (clamped === active) return;
    directionRef.current = clamped > active ? 1 : -1;
    setActive(clamped);
  }

  function clearDwell() {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current.id);
    dwellTimerRef.current = null;
    setDwellSide(null);
  }

  // Edge-dwell paging: passive observer of any live drag (a stop OR a discovery result),
  // so the same gesture vocabulary covers "move a stop" and "add a find to another day."
  useEffect(() => {
    if (!isDragging) { clearDwell(); return; }

    function armDwell(side: "left" | "right") {
      if (cooldownRef.current) return;
      if (dwellTimerRef.current?.side === side) return;
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current.id);
      setDwellSide(side);
      const id = setTimeout(() => {
        dwellTimerRef.current = null;
        setDwellSide(null);
        go(active + (side === "left" ? -1 : 1));
        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, COOLDOWN_MS);
      }, DWELL_MS);
      dwellTimerRef.current = { side, id };
    }

    function onMove(e: PointerEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Only page when the pointer is vertically within the stack — dragging along the
      // tray's own edge shouldn't flip days.
      if (e.clientY < rect.top || e.clientY > rect.bottom) { clearDwell(); return; }
      if (e.clientX < rect.left + EDGE_ZONE_PX && active > 0) armDwell("left");
      else if (e.clientX > rect.right - EDGE_ZONE_PX && active < DAYS.length - 1) armDwell("right");
      else clearDwell();
    }

    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, active]);

  const visible = [active - 1, active, active + 1]
    .filter((i) => i >= 0 && i < DAYS.length)
    .map((i) => DAYS[i]);

  const roleOf = (day: Day): Role => {
    const d = DAYS.indexOf(day) - active;
    return d === -1 ? "prev" : d === 0 ? "active" : d === 1 ? "next" : "gone";
  };

  const transitions = useTransition(visible, {
    keys: (d) => d.dayNumber,
    from: () => ({ x: directionRef.current * 340, y: 30, scale: 0.7, opacity: 0 }),
    enter: (d) => ROLE_TARGET[roleOf(d) as Exclude<Role, "gone">] ?? ROLE_TARGET.next,
    update: (d) => ROLE_TARGET[roleOf(d) as Exclude<Role, "gone">] ?? ROLE_TARGET.next,
    leave: () => ({ x: -directionRef.current * 340, y: 30, scale: 0.7, opacity: 0 }),
    config: { tension: 300, friction: 30 },
  });

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap justify-center">
        {DAYS.map((day, i) => (
          <button
            key={day.dayNumber}
            onClick={() => go(i)}
            className={`w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center transition-colors ${
              i === active ? "bg-brand-600 dark:bg-brand-500 text-white" : "bg-surface-2 text-sub hover:bg-surface-3"
            }`}
            title={`Day ${day.dayNumber}${day.label ? " – " + day.label : ""}`}
          >
            {day.dayNumber}
          </button>
        ))}
      </div>

      <div ref={containerRef} className="relative flex items-center justify-center" style={{ height: stackHeight }}>
        {isDragging && (
          <>
            <div className={`absolute left-0 top-0 bottom-0 w-[70px] rounded-l-lg transition-colors pointer-events-none z-10 ${dwellSide === "left" ? "bg-brand-400/20" : ""}`} />
            <div className={`absolute right-0 top-0 bottom-0 w-[70px] rounded-r-lg transition-colors pointer-events-none z-10 ${dwellSide === "right" ? "bg-brand-400/20" : ""}`} />
          </>
        )}

        <button
          onClick={() => go(active - 1)}
          disabled={active === 0}
          className="absolute left-0 z-20 w-9 h-9 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center disabled:opacity-30 hover:bg-surface-3"
        >
          ←
        </button>

        {transitions((style, day) => {
          const role = roleOf(day);
          const isActive = role === "active";
          return (
            <DroppableDayCard key={day.dayNumber} day={day} zIndex={isActive ? 10 : 5} style={style}>
              <div className="mb-2">
                <p className="text-sm font-semibold text-ink">Day {day.dayNumber} · {day.date}</p>
                {day.label && <p className="text-xs text-brand-600 dark:text-brand-400">{day.label}</p>}
              </div>
              <div className="flex-1 overflow-hidden">
                {isActive ? (
                  <ul>
                    {day.stops.map((s) => (
                      <DraggableStop
                        key={s}
                        id={`stop:${day.dayNumber}:${s}`}
                        label={s}
                        onInspect={(rect) => onInspect(s, rect)}
                      />
                    ))}
                  </ul>
                ) : (
                  <ul className="space-y-1">
                    {day.stops.slice(0, 4).map((s) => (
                      <li key={s} className="text-xs text-sub truncate">· {s}</li>
                    ))}
                  </ul>
                )}
              </div>
            </DroppableDayCard>
          );
        })}

        <button
          onClick={() => go(active + 1)}
          disabled={active === DAYS.length - 1}
          className="absolute right-0 z-20 w-9 h-9 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center disabled:opacity-30 hover:bg-surface-3"
        >
          →
        </button>
      </div>
    </div>
  );
}

// ---------- variant scaffold: DndContext + inspector + map, shared by all variants ----------

function Scaffold({
  children, discoveryOpen, setDiscoveryOpen,
}: {
  children: (ctx: { isDragging: boolean; onInspect: (stop: string, rect: DOMRect) => void }) => React.ReactNode;
  discoveryOpen: boolean;
  setDiscoveryOpen: (v: boolean) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedLabel, setDraggedLabel] = useState<string | null>(null);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragStart(e: DragStartEvent) {
    setIsDragging(true);
    setDropMessage(null);
    setInspected(null);
    setDraggedLabel((e.active.data.current as { label?: string } | undefined)?.label ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setIsDragging(false);
    const overId = e.over?.id as string | undefined;
    const data = e.active.data.current as { label?: string; kind?: string } | undefined;
    if (overId?.startsWith("day:") && data?.label) {
      const day = overId.replace("day:", "");
      setDropMessage(
        data.kind === "result" ? `Would add "${data.label}" to Day ${day}` : `Would move "${data.label}" to Day ${day}`
      );
    }
    setDraggedLabel(null);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-2">
          <button
            onClick={() => setDiscoveryOpen(!discoveryOpen)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              discoveryOpen ? "bg-ink text-canvas border-ink" : "bg-surface-2 text-sub border-line-strong hover:bg-surface-3"
            }`}
          >
            🔍 Discover
          </button>
          <button
            onClick={() => setMapOpen(!mapOpen)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              mapOpen ? "bg-ink text-canvas border-ink" : "bg-surface-2 text-sub border-line-strong hover:bg-surface-3"
            }`}
          >
            🗺 Map
          </button>
        </div>
        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium min-h-[16px]">{dropMessage}</p>
      </div>

      {children({ isDragging, onInspect: (stop, rect) => setInspected({ stop, rect }) })}

      {inspected && <InspectorPopover inspected={inspected} onClose={() => setInspected(null)} />}
      {mapOpen && <MapPopup onClose={() => setMapOpen(false)} />}

      <DragOverlay dropAnimation={null}>
        {draggedLabel && (
          <div className="card px-3 py-2 shadow-lg text-xs font-medium text-ink rotate-1">{draggedLabel}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------- Variant A: footer rail ----------
// Fixed short tray; results browse horizontally in one row. Never competes with the
// stack for much height, but 12+ results means sideways scrolling with a mouse wheel.

function VariantA() {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<TrayMode>("nearby");
  const [tag, setTag] = useState("all");
  const [keyword, setKeyword] = useState("");
  const results = useFilteredResults(mode, tag, keyword);

  return (
    <Scaffold discoveryOpen={open} setDiscoveryOpen={setOpen}>
      {({ isDragging, onInspect }) => (
        <>
          <FocalStack isDragging={isDragging} onInspect={onInspect} stackHeight={320} />
          {open && (
            <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-line shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
              <div className="max-w-6xl mx-auto px-4 py-2 space-y-2">
                <div className="flex items-center gap-4 flex-wrap">
                  <TrayTitle mode={mode} setMode={setMode} onClose={() => setOpen(false)} />
                  <FilterRow tag={tag} setTag={setTag} keyword={keyword} setKeyword={setKeyword} />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {results.length === 0 ? (
                    <p className="text-xs text-faint py-6">No results — try a different filter or search.</p>
                  ) : (
                    results.map((r) => <ResultCard key={r.id} result={r} />)
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Scaffold>
  );
}

// ---------- Variant B: footer grid with peek/expanded states ----------
// Peek shows one rail row; expanding grows the tray to ~40vh with a wrapped grid that
// scrolls vertically — mouse-wheel-friendly browsing at the cost of covering more stack.

function VariantB() {
  const [open, setOpen] = useState(true);
  const [expandedTray, setExpandedTray] = useState(false);
  const [mode, setMode] = useState<TrayMode>("nearby");
  const [tag, setTag] = useState("all");
  const [keyword, setKeyword] = useState("");
  const results = useFilteredResults(mode, tag, keyword);

  return (
    <Scaffold discoveryOpen={open} setDiscoveryOpen={setOpen}>
      {({ isDragging, onInspect }) => (
        <>
          <FocalStack isDragging={isDragging} onInspect={onInspect} stackHeight={320} />
          {open && (
            <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-line shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
              <div className="max-w-6xl mx-auto px-4 py-2 space-y-2">
                <div className="flex items-center gap-4 flex-wrap">
                  <button
                    onClick={() => setExpandedTray((v) => !v)}
                    className="text-xs text-sub hover:text-ink shrink-0"
                    aria-label={expandedTray ? "Collapse tray" : "Expand tray"}
                  >
                    {expandedTray ? "▾ Collapse" : "▴ Expand"}
                  </button>
                  <TrayTitle mode={mode} setMode={setMode} onClose={() => setOpen(false)} />
                  <FilterRow tag={tag} setTag={setTag} keyword={keyword} setKeyword={setKeyword} />
                </div>
                {expandedTray ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 overflow-y-auto pb-2" style={{ maxHeight: "40vh" }}>
                    {results.map((r) => <ResultCard key={r.id} result={r} wide />)}
                    {results.length === 0 && <p className="text-xs text-faint py-6">No results.</p>}
                  </div>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {results.slice(0, 8).map((r) => <ResultCard key={r.id} result={r} />)}
                    {results.length > 8 && (
                      <button
                        onClick={() => setExpandedTray(true)}
                        className="shrink-0 w-[100px] card flex items-center justify-center text-xs text-sub hover:text-ink"
                      >
                        +{results.length - 8} more
                      </button>
                    )}
                    {results.length === 0 && <p className="text-xs text-faint py-6">No results.</p>}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Scaffold>
  );
}

// ---------- Variant C: side panel ----------
// The current app's attachment, adapted to the new shell: discovery keeps a right column
// with vertically-stacked controls and a vertical result list. Shows what that width
// does to the carousel instead of assuming the footer wins.

function VariantC() {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<TrayMode>("nearby");
  const [tag, setTag] = useState("all");
  const [keyword, setKeyword] = useState("");
  const results = useFilteredResults(mode, tag, keyword);

  return (
    <Scaffold discoveryOpen={open} setDiscoveryOpen={setOpen}>
      {({ isDragging, onInspect }) => (
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <FocalStack isDragging={isDragging} onInspect={onInspect} stackHeight={340} />
          </div>
          {open && (
            <aside className="w-[300px] shrink-0 card flex flex-col max-h-[calc(100vh-9rem)]">
              <div className="p-3 border-b border-line space-y-2">
                <TrayTitle mode={mode} setMode={setMode} onClose={() => setOpen(false)} />
                <FilterRow tag={tag} setTag={setTag} keyword={keyword} setKeyword={setKeyword} compact />
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {results.map((r) => <ResultCard key={r.id} result={r} wide />)}
                {results.length === 0 && <p className="text-xs text-faint py-6">No results.</p>}
              </div>
            </aside>
          )}
        </div>
      )}
    </Scaffold>
  );
}

// ---------- switcher (top-center here — the footer is the thing being evaluated) ----------

const VARIANTS = [
  { key: "A", name: "Footer rail", Component: VariantA },
  { key: "B", name: "Footer grid (peek/expand)", Component: VariantB },
  { key: "C", name: "Side panel", Component: VariantC },
] as const;

function PrototypeSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = (i: number) => {
    const next = VARIANTS[(i + VARIANTS.length) % VARIANTS.length];
    router.replace(`/prototype/discovery-tray?variant=${next.key}`);
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "ArrowLeft") go(idx - 1);
      if (e.key === "ArrowRight") go(idx + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-ink text-canvas rounded-full px-4 py-2 shadow-xl border border-line-strong">
      <button onClick={() => go(idx - 1)} className="px-1 text-lg leading-none">←</button>
      <span className="text-sm font-medium">
        {VARIANTS[idx]?.key} — {VARIANTS[idx]?.name}
      </span>
      <button onClick={() => go(idx + 1)} className="px-1 text-lg leading-none">→</button>
    </div>
  );
}

function DiscoveryTrayPrototypeInner() {
  const searchParams = useSearchParams();
  const variantKey = searchParams.get("variant") ?? "A";
  const variant = VARIANTS.find((v) => v.key === variantKey) ?? VARIANTS[0];
  const { Component } = variant;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    Globals.assign({ skipAnimation: mq.matches });
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 pt-16 pb-64 space-y-3">
      <div>
        <h1 className="text-page-title text-ink">Discovery attachment prototype</h1>
        <p className="text-body text-sub mt-0.5">
          Ticket #134 — how Nearby/Along-route/Inspector attach to the locked focal-stack shell.
          Click a stop for its inspector popover; drag a stop or a result card onto a day (edges page while dragging).
          Map is a popup via the 🗺 button. Fake data; not linked from the real app.
        </p>
      </div>
      <Component key={variant.key} />
      <PrototypeSwitcher current={variant.key} />
    </div>
  );
}

export default function DiscoveryTrayPrototype() {
  return (
    <Suspense fallback={null}>
      <DiscoveryTrayPrototypeInner />
    </Suspense>
  );
}
