"use client";

// PROTOTYPE — throwaway. Answers: "what should the day-navigator shell look like?" — given
// that the Framer ImmersiveCarousel's always-mounted receding-blur stack breaks down past a
// couple of neighbor cards for real trip lengths. Non-map aspects only (map placement deferred
// to Maps UI overhaul, https://github.com/Tyler-Reagan/trip-kraken/issues/128).
// wayfinder ticket #134, https://github.com/Tyler-Reagan/trip-kraken/issues/134
// Three variants, switchable via ?variant=. Fake data only — no wiring to the real store.
// Not linked from anywhere; delete after the decision is captured.

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
import { animated, to, useTransition, Globals } from "@react-spring/web";

// ---------- fake data: 8 days, so the N-day scaling question is actually visible ----------

const DAYS = [
  { dayNumber: 1, date: "Aug 1", label: "Arrival", stops: ["Haneda Airport", "Shinagawa Hotel Check-in"] },
  { dayNumber: 2, date: "Aug 2", label: "Asakusa", stops: ["Senso-ji Temple", "Nakamise Street", "Tokyo Skytree", "Sumida River Cruise"] },
  { dayNumber: 3, date: "Aug 3", label: null, stops: ["Shibuya Crossing", "Meiji Shrine", "Harajuku Takeshita St"] },
  { dayNumber: 4, date: "Aug 4", label: "Day trip", stops: ["Hakone Ropeway", "Lake Ashi Cruise", "Owakudani"] },
  { dayNumber: 5, date: "Aug 5", label: null, stops: ["Tsukiji Outer Market", "Ginza shopping"] },
  { dayNumber: 6, date: "Aug 6", label: "Kyoto", stops: ["Shinkansen to Kyoto", "Fushimi Inari Shrine"] },
  { dayNumber: 7, date: "Aug 7", label: null, stops: ["Arashiyama Bamboo Grove", "Kinkaku-ji", "Nishiki Market"] },
  { dayNumber: 8, date: "Aug 8", label: "Departure", stops: ["Kyoto Station", "Kansai Airport"] },
];

type Day = (typeof DAYS)[number];

function StopList({ stops, max }: { stops: string[]; max?: number }) {
  const shown = max ? stops.slice(0, max) : stops;
  const overflow = max && stops.length > max ? stops.length - max : 0;
  return (
    <ul className="space-y-1 text-left">
      {shown.map((s) => (
        <li key={s} className="text-xs text-sub truncate">· {s}</li>
      ))}
      {overflow > 0 && <li className="text-xs text-faint italic">+{overflow} more</li>}
    </ul>
  );
}

function DayHeader({ day }: { day: Day }) {
  return (
    <div className="mb-2">
      <p className="text-sm font-semibold text-ink">Day {day.dayNumber} · {day.date}</p>
      {day.label && <p className="text-xs text-brand-600 dark:text-brand-400">{day.label}</p>}
    </div>
  );
}

// ---------- Variant A: Filmstrip ----------
// Native horizontal scroll-snap. Every day is the same size, no scaling/blur trickery.
// "All" is just this same strip, scrolled out — there's no separate mode.

function VariantA() {
  return (
    <div>
      <p className="text-sm text-faint mb-3">Scroll horizontally (trackpad/shift-wheel) or drag the scrollbar. Every day is equal size — nothing shrinks or blurs.</p>
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 -mx-1 px-1">
        {DAYS.map((day) => (
          <div
            key={day.dayNumber}
            className="card p-4 shrink-0 snap-start w-[240px] h-[280px] flex flex-col"
          >
            <DayHeader day={day} />
            <div className="flex-1 overflow-hidden">
              <StopList stops={day.stops} max={4} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Variant B: Focal-stack + index strip ----------
// Center day enlarged, exactly one neighbor peeking each side (nothing further is even
// rendered). A compact per-day index strip lets you jump straight to any day without
// paging through the ones in between.
//
// Also answers the follow-on question: dragging a stop toward the left/right edge of the
// stack pages to the neighbor day while the drag is still held, so a stop can travel across
// multiple days without releasing. This needs the spring (not a CSS transition) because a
// direction reversal mid-page must redirect from the card's current position *and velocity*
// — restarting a CSS transition kills velocity and produces a visible "kink" on reversal.

type Role = "prev" | "active" | "next" | "gone";

const ROLE_TARGET: Record<Exclude<Role, "gone">, { x: number; y: number; scale: number; opacity: number }> = {
  prev: { x: -170, y: 20, scale: 0.82, opacity: 0.65 },
  active: { x: 0, y: 0, scale: 1, opacity: 1 },
  next: { x: 170, y: 20, scale: 0.82, opacity: 0.65 },
};

function DraggableStop({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { label } });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`text-xs px-2 py-1 mb-1 rounded border border-line-strong bg-surface cursor-grab active:cursor-grabbing select-none touch-none transition-opacity ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      ⠿ {label}
    </li>
  );
}

function DroppableDayCard({
  day,
  zIndex,
  style,
  children,
}: {
  day: Day;
  zIndex: number;
  style: { x: import("@react-spring/web").SpringValue<number>; y: import("@react-spring/web").SpringValue<number>; scale: import("@react-spring/web").SpringValue<number>; opacity: import("@react-spring/web").SpringValue<number> };
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.dayNumber}` });
  return (
    <animated.div
      ref={setNodeRef}
      className={`absolute card p-4 flex flex-col w-[260px] h-[300px] ${isOver ? "ring-2 ring-brand-400" : ""}`}
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

const EDGE_ZONE_PX = 70;
const DWELL_MS = 450;
const COOLDOWN_MS = 350;

function VariantB() {
  const [active, setActive] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dwellSide, setDwellSide] = useState<"left" | "right" | null>(null);
  const [draggedLabel, setDraggedLabel] = useState<string | null>(null);
  const [dropMessage, setDropMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<1 | -1>(1);
  const dwellTimerRef = useRef<{ side: "left" | "right"; id: ReturnType<typeof setTimeout> } | null>(null);
  const cooldownRef = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  // Edge-dwell-to-page: only listens while a drag is live, so it never competes with
  // dnd-kit's own PointerSensor for the same events — this is a passive observer, not a
  // second drag handler.
  useEffect(() => {
    if (!isDragging) return;

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
    const idx = DAYS.indexOf(day);
    const d = idx - active;
    return d === -1 ? "prev" : d === 0 ? "active" : d === 1 ? "next" : "gone";
  };

  // Only x/y/scale/opacity are springed (never width/height — animating layout properties
  // thrashes; transform + opacity stay on the compositor).
  const transitions = useTransition(visible, {
    keys: (d) => d.dayNumber,
    from: () => ({ x: directionRef.current * 340, y: 30, scale: 0.7, opacity: 0 }),
    enter: (d) => ROLE_TARGET[roleOf(d) as Exclude<Role, "gone">] ?? ROLE_TARGET.next,
    update: (d) => ROLE_TARGET[roleOf(d) as Exclude<Role, "gone">] ?? ROLE_TARGET.next,
    leave: () => ({ x: -directionRef.current * 340, y: 30, scale: 0.7, opacity: 0 }),
    config: { tension: 300, friction: 30 },
  });

  function handleDragStart(e: DragStartEvent) {
    setIsDragging(true);
    setDropMessage(null);
    setDraggedLabel((e.active.data.current as { label?: string } | undefined)?.label ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setIsDragging(false);
    clearDwell();
    const overId = e.over?.id as string | undefined;
    const label = (e.active.data.current as { label?: string } | undefined)?.label;
    if (overId && label) {
      setDropMessage(`Would move "${label}" to Day ${overId.replace("day:", "")}`);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div>
        {/* index strip: jump to any day directly */}
        <div className="flex gap-1.5 mb-6 flex-wrap">
          {DAYS.map((day, i) => (
            <button
              key={day.dayNumber}
              onClick={() => go(i)}
              className={`w-8 h-8 rounded-full text-xs font-semibold flex items-center justify-center transition-colors ${
                i === active ? "bg-brand-600 dark:bg-brand-500 text-white" : "bg-surface-2 text-sub hover:bg-surface-3"
              }`}
              title={`Day ${day.dayNumber}${day.label ? " – " + day.label : ""}`}
            >
              {day.dayNumber}
            </button>
          ))}
        </div>

        {/* focal stack: only active-1, active, active+1 are ever mounted */}
        <div ref={containerRef} className="relative h-[360px] flex items-center justify-center">
          {isDragging && (
            <>
              <div className={`absolute left-0 top-0 bottom-0 w-[70px] rounded-l-lg transition-colors pointer-events-none ${dwellSide === "left" ? "bg-brand-400/20" : ""}`} />
              <div className={`absolute right-0 top-0 bottom-0 w-[70px] rounded-r-lg transition-colors pointer-events-none ${dwellSide === "right" ? "bg-brand-400/20" : ""}`} />
            </>
          )}

          <button
            onClick={() => go(active - 1)}
            disabled={active === 0}
            className="absolute left-0 z-20 w-10 h-10 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center disabled:opacity-30 hover:bg-surface-3"
          >
            ←
          </button>

          {transitions((style, day) => {
            const role = roleOf(day);
            const isActive = role === "active";
            return (
              <DroppableDayCard key={day.dayNumber} day={day} zIndex={isActive ? 10 : 5} style={style}>
                <DayHeader day={day} />
                <div className="flex-1 overflow-hidden">
                  {isActive ? (
                    <ul>
                      {day.stops.slice(0, 3).map((s) => (
                        <DraggableStop key={s} id={`stop:${day.dayNumber}:${s}`} label={s} />
                      ))}
                    </ul>
                  ) : (
                    <StopList stops={day.stops} max={3} />
                  )}
                </div>
              </DroppableDayCard>
            );
          })}

          <button
            onClick={() => go(active + 1)}
            disabled={active === DAYS.length - 1}
            className="absolute right-0 z-20 w-10 h-10 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center disabled:opacity-30 hover:bg-surface-3"
          >
            →
          </button>
        </div>

        <div className="text-center mt-2 space-y-1 min-h-[40px]">
          <p className="text-sm text-faint">
            Only 3 cards are ever mounted. Drag a stop off the active day toward the left/right edge and hold — paging
            fires after a {DWELL_MS}ms dwell, with a {COOLDOWN_MS}ms cooldown before it can fire again.
          </p>
          {isDragging && (
            <p className="text-xs text-brand-600 dark:text-brand-400">
              dragging: {draggedLabel}{dwellSide ? ` · dwelling ${dwellSide}` : ""}
            </p>
          )}
          {dropMessage && <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{dropMessage}</p>}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {draggedLabel && (
          <div className="card px-3 py-2 shadow-lg text-xs font-medium text-ink rotate-1">{draggedLabel}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------- Variant C: Grid-then-expand ----------
// Default view IS "all days" — a compact grid. Clicking a card expands it into a focal
// single-day view with a back control. No separate carousel-vs-list mode to reconcile.

function VariantC() {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (expanded !== null) {
    const day = DAYS[expanded];
    return (
      <div>
        <button onClick={() => setExpanded(null)} className="btn-ghost text-sm mb-4">
          ← Back to all days
        </button>
        <div className="card p-6 max-w-md mx-auto">
          <DayHeader day={day} />
          <StopList stops={day.stops} />
        </div>
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setExpanded(Math.max(0, expanded - 1))} disabled={expanded === 0} className="btn-ghost text-sm disabled:opacity-30">← Prev day</button>
          <button onClick={() => setExpanded(Math.min(DAYS.length - 1, expanded + 1))} disabled={expanded === DAYS.length - 1} className="btn-ghost text-sm disabled:opacity-30">Next day →</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-faint mb-3">Every day is visible at once by default. Click a card to drill into it.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {DAYS.map((day, i) => (
          <button
            key={day.dayNumber}
            onClick={() => setExpanded(i)}
            className="card p-3 text-left hover:ring-2 hover:ring-brand-400 transition-all h-[140px] flex flex-col"
          >
            <DayHeader day={day} />
            <div className="flex-1 overflow-hidden">
              <StopList stops={day.stops} max={2} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- switcher ----------

const VARIANTS = [
  { key: "A", name: "Filmstrip", Component: VariantA },
  { key: "B", name: "Focal-stack + index", Component: VariantB },
  { key: "C", name: "Grid-then-expand", Component: VariantC },
] as const;

function PrototypeSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = (i: number) => {
    const next = VARIANTS[(i + VARIANTS.length) % VARIANTS.length];
    router.replace(`/prototype/day-carousel?variant=${next.key}`);
  };
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-ink text-canvas rounded-full px-4 py-2 shadow-xl border border-line-strong">
      <button onClick={() => go(idx - 1)} className="px-1 text-lg leading-none">←</button>
      <span className="text-sm font-medium">
        {VARIANTS[idx]?.key} — {VARIANTS[idx]?.name}
      </span>
      <button onClick={() => go(idx + 1)} className="px-1 text-lg leading-none">→</button>
    </div>
  );
}

function DayCarouselPrototypeInner() {
  const searchParams = useSearchParams();
  const variantKey = searchParams.get("variant") ?? "A";
  const variant = VARIANTS.find((v) => v.key === variantKey) ?? VARIANTS[0];
  const { Component } = variant;

  // Reduced-motion gates the spring animation only (variant B's edge-paging) — the
  // dwell/cooldown logic still runs, it just resolves instantly instead of springing.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    Globals.assign({ skipAnimation: mq.matches });
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 pb-24">
      <div>
        <h1 className="text-page-title text-ink">Day-navigator shell prototype</h1>
        <p className="text-body text-sub mt-0.5">
          Ticket #134 — 8 fake days, interaction model only. Map placement deferred to #128. Not linked anywhere in the real app.
        </p>
      </div>
      <Component />
      <PrototypeSwitcher current={variant.key} />
    </div>
  );
}

export default function DayCarouselPrototype() {
  return (
    <Suspense fallback={null}>
      <DayCarouselPrototypeInner />
    </Suspense>
  );
}
