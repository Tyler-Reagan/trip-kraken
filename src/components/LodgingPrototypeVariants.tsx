"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Hotel, MapPin, X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import {
  addDaysIso,
  lodgingCoversNight,
  tripDates,
  type IsoDate,
  type Location,
  type Lodging,
  type TripWithDetails,
} from "@/types";

/**
 * PROTOTYPE — throwaway, for ticket #113 (Multi-lodging entry & editing UX). Was five structural
 * variants of the Manifest's Lodging section, compared via `?variant=`; A/B/C/D were torn down
 * once the drag-select night strip (this file's Variant E) won, and iteration continues on E
 * alone. It also previews the post-import assignment wizard (folded in from #114) via a "Preview"
 * trigger, using MOCK_METROS fixture data since the #115/#110 per-cluster detector isn't built
 * yet — the wizard's save is a stub, not a real mutation.
 *
 * Nights = trip dates minus the final date (a checkout-only day has no night slept). A
 * simplification for this prototype, not a claim about final domain logic.
 */

function nightsOf(trip: TripWithDetails): IsoDate[] {
  const dates = tripDates(trip.startDate, trip.endDate);
  return dates.length > 1 ? dates.slice(0, -1) : dates;
}

const fmtNight = (d: IsoDate) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const MOCK_METROS = [
  { id: "osaka", name: "Osaka", activityCount: 7, suggestedNights: ["2026-08-10", "2026-08-11", "2026-08-12"] },
  { id: "tokyo", name: "Tokyo", activityCount: 11, suggestedNights: ["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"] },
];

const PALETTE = ["bg-brand-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-rose-500"];

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md shadow-xl p-4 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-section text-ink">{title}</h2>
          <button onClick={onClose} className="tap-target text-faint hover:text-ink" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A single select — no typed dates, since the calendar drag already fixed the range. */
function AssignExisting({ activities, onAssign, onCancel }: { activities: Location[]; onAssign: (id: string) => void; onCancel: () => void }) {
  const [locationId, setLocationId] = useState("");
  return (
    <div className="flex items-center gap-2">
      <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input py-1.5 text-sm flex-1">
        <option value="">Select a place…</option>
        {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button onClick={() => locationId && onAssign(locationId)} disabled={!locationId} className="btn-primary text-xs py-1 px-3">Assign</button>
      <button onClick={onCancel} className="btn-secondary text-xs py-1 px-3">Cancel</button>
    </div>
  );
}

/** Post-import wizard preview: each metro's suggested nights render as a read-only preview bar
 *  (the same visual language as the live strip) with a single name field to confirm — mirroring
 *  "drag once, name once" rather than a typed date form. */
function StripWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(MOCK_METROS[0].name + " hotel");
  const metro = MOCK_METROS[step];
  const done = step >= MOCK_METROS.length;

  return (
    <ModalShell title="Lodging found in your import" onClose={onClose}>
      {done ? (
        <p className="text-sm text-sub">All set — mocked save (no real mutation in this prototype).</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-sub">
            <MapPin className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
            {metro.name} · {metro.activityCount} places with no lodging assigned yet
          </p>
          <div className="flex gap-0.5">
            {metro.suggestedNights.map((n) => (
              <div key={n} className={`h-6 flex-1 rounded-sm ${PALETTE[step % PALETTE.length]} opacity-80`} title={fmtNight(n)} />
            ))}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input py-1.5 text-sm" placeholder="Property name" />
          <div className="flex gap-2">
            <button onClick={() => setStep(step + 1)} className="btn-secondary text-xs py-1 px-3">Skip this city</button>
            <button onClick={() => setStep(step + 1)} className="btn-primary text-xs py-1 px-3">Save & next</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant E — Night strip, drag-select: a flat, unlabeled strip (one lodging is
// just a one-lane bar, no threshold-swap to a different layout when a second is
// added). Drag across empty nights to assign a span in one gesture; drag a
// bar's edge to resize, its body to move — no typed date fields at all except
// as a fallback in the edit panel. Overlapping bars stack into extra thin lanes
// only when they actually occur, so the common case stays a single row.
// ─────────────────────────────────────────────────────────────────────────────

const STRIP_LANE_H = 26; // px per lane — thin and unlabeled, on purpose

type LaneBar = { lodging: Lodging; startIdx: number; endIdx: number; lane: number };

function laneBarsOf(nights: IsoDate[], lodgings: Lodging[]): { bars: LaneBar[]; laneCount: number } {
  const bars: LaneBar[] = [];
  for (const l of lodgings) {
    const covered = nights.filter((d) => lodgingCoversNight(l, d));
    if (covered.length === 0) continue;
    const startIdx = nights.indexOf(covered[0]);
    const endIdx = nights.indexOf(covered[covered.length - 1]);
    let lane = 0;
    while (bars.some((b) => b.lane === lane && !(endIdx < b.startIdx || startIdx > b.endIdx))) lane++;
    bars.push({ lodging: l, startIdx, endIdx, lane });
  }
  return { bars, laneCount: Math.max(1, ...bars.map((b) => b.lane + 1)) };
}

/** Thin canvas-colored seams at each night boundary, so a multi-night bar still reads as
 *  distinct day-blocks rather than one fused rectangle — without giving up the single spanning
 *  div startBarDrag's pointer math relies on. */
function daySeams(nightCount: number): string | undefined {
  if (nightCount <= 1) return undefined;
  const step = 100 / nightCount;
  return `repeating-linear-gradient(to right, transparent 0, transparent calc(${step}% - 1px), var(--canvas) calc(${step}% - 1px), var(--canvas) ${step}%)`;
}

export function VariantE({ trip, lodgings, activities }: { trip: TripWithDetails; lodgings: Lodging[]; activities: Location[] }) {
  const saveLodgingDates = useTripStore((s) => s.saveLodgingDates);
  const containerRef = useRef<HTMLDivElement>(null);
  const nights = nightsOf(trip);
  const { bars, laneCount } = laneBarsOf(nights, lodgings);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [select, setSelect] = useState<{ start: number; end: number } | null>(null);
  const [pendingAssign, setPendingAssign] = useState<{ startIdx: number; endIdx: number } | null>(null);
  const [drag, setDrag] = useState<{ lodgingId: string; mode: "resize-start" | "resize-end" | "move"; anchorIdx: number; preview: { startIdx: number; endIdx: number } } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  function idxFromClientX(x: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(nights.length - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * nights.length)));
  }

  function startSelect(i: number) {
    setSelect({ start: i, end: i });
    const onMove = (e: MouseEvent) => setSelect((s) => (s ? { ...s, end: idxFromClientX(e.clientX) } : s));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const end = idxFromClientX(e.clientX);
      setPendingAssign({ startIdx: Math.min(i, end), endIdx: Math.max(i, end) });
      setSelect(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startBarDrag(bar: LaneBar, mode: "resize-start" | "resize-end" | "move", e: React.MouseEvent) {
    e.stopPropagation();
    const anchorIdx = idxFromClientX(e.clientX);
    // previewRef carries the live range so `onUp` can call saveLodgingDates directly, outside
    // any setState updater (calling it from inside one trips React's "cannot update a component
    // while rendering" check — updaters must stay pure).
    const previewRef = { current: { startIdx: bar.startIdx, endIdx: bar.endIdx } };
    setDrag({ lodgingId: bar.lodging.id, mode, anchorIdx, preview: previewRef.current });

    const onMove = (ev: MouseEvent) => {
      const i = idxFromClientX(ev.clientX);
      let next = previewRef.current;
      if (mode === "resize-start") next = { startIdx: Math.min(i, bar.endIdx), endIdx: bar.endIdx };
      else if (mode === "resize-end") next = { startIdx: bar.startIdx, endIdx: Math.max(i, bar.startIdx) };
      else {
        const delta = i - anchorIdx;
        const span = bar.endIdx - bar.startIdx;
        const start = Math.min(Math.max(0, bar.startIdx + delta), nights.length - 1 - span);
        next = { startIdx: start, endIdx: start + span };
      }
      previewRef.current = next;
      setDrag((d) => (d ? { ...d, preview: next } : d));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const { startIdx, endIdx } = previewRef.current;
      const unchanged = startIdx === bar.startIdx && endIdx === bar.endIdx;
      // A "move" that never actually moved is a plain click on the block — open the edit panel
      // (precise dates + remove) instead of writing a no-op save.
      if (mode === "move" && unchanged) setEditing(bar.lodging.id);
      else saveLodgingDates(bar.lodging.id, { checkInDate: nights[startIdx], checkOutDate: addDaysIso(nights[endIdx], 1) });
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const selectRange = select ? { startIdx: Math.min(select.start, select.end), endIdx: Math.max(select.start, select.end) } : null;
  const pct = (idx: number) => `${(idx / nights.length) * 100}%`;
  const widthPct = (startIdx: number, endIdx: number) => `${((endIdx - startIdx + 1) / nights.length) * 100}%`;

  return (
    <div className="space-y-1.5">
      <div ref={containerRef} className="relative select-none" style={{ height: laneCount * STRIP_LANE_H }}>
        {nights.map((date, i) => (
          <button
            key={date}
            onMouseDown={() => startSelect(i)}
            title={fmtNight(date)}
            className="absolute top-0 h-full cursor-crosshair"
            style={{ left: pct(i), width: `${100 / nights.length}%` }}
          >
            {!bars.some((b) => i >= b.startIdx && i <= b.endIdx) && (
              <span className="block mx-px rounded-sm bg-[repeating-linear-gradient(45deg,var(--surface-3),var(--surface-3)_3px,transparent_3px,transparent_6px)] border border-dashed border-line-strong" style={{ height: STRIP_LANE_H - 2 }} />
            )}
          </button>
        ))}

        {selectRange && (
          <div
            className="absolute top-0 rounded-sm bg-brand-500/25 border-2 border-dashed border-brand-500 pointer-events-none"
            style={{ left: pct(selectRange.startIdx), width: widthPct(selectRange.startIdx, selectRange.endIdx), height: STRIP_LANE_H - 2 }}
          />
        )}

        {bars.map((bar) => {
          const live = drag?.lodgingId === bar.lodging.id ? drag.preview : { startIdx: bar.startIdx, endIdx: bar.endIdx };
          const overlapping = bars.some((o) => o !== bar && !(live.endIdx < o.startIdx || live.startIdx > o.endIdx));
          const isHovered = hovered === bar.lodging.id && drag?.lodgingId !== bar.lodging.id;
          return (
            <div key={bar.lodging.id} className="absolute" style={{ top: bar.lane * STRIP_LANE_H, left: pct(live.startIdx), width: widthPct(live.startIdx, live.endIdx) }}>
              {isHovered && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded-md bg-ink text-canvas text-xs px-2 py-1 shadow-lg pointer-events-none">
                  <span className="font-medium">{bar.lodging.name}</span>
                  <span className="opacity-70"> · {fmtNight(nights[live.startIdx])} → {fmtNight(addDaysIso(nights[live.endIdx], 1))}</span>
                </div>
              )}
              <div
                onMouseEnter={() => setHovered(bar.lodging.id)}
                onMouseLeave={() => setHovered((h) => (h === bar.lodging.id ? null : h))}
                className={`rounded-sm z-10 ${PALETTE[lodgings.findIndex((l) => l.id === bar.lodging.id) % PALETTE.length]}
                  ${isHovered ? "opacity-100 ring-2 ring-ink/40 dark:ring-white/40" : "opacity-80"} flex ${overlapping ? "ring-2 ring-danger-500" : ""}`}
                style={{ height: STRIP_LANE_H - 2, backgroundImage: daySeams(live.endIdx - live.startIdx + 1) }}
              >
                <div onMouseDown={(e) => startBarDrag(bar, "resize-start", e)} className="w-2 h-full cursor-ew-resize shrink-0" />
                <div onMouseDown={(e) => startBarDrag(bar, "move", e)} className="flex-1 h-full cursor-grab relative">
                  {overlapping && <AlertTriangle className="w-3 h-3 text-white absolute inset-0 m-auto" />}
                </div>
                <div onMouseDown={(e) => startBarDrag(bar, "resize-end", e)} className="w-2 h-full cursor-ew-resize shrink-0" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-xs text-faint">
        <span>{fmtNight(nights[0])}</span>
        <span>{fmtNight(nights[nights.length - 1])}</span>
      </div>

      {pendingAssign && (
        <div className="card p-3 space-y-2">
          <p className="text-xs text-faint">
            Assign lodging for {fmtNight(nights[pendingAssign.startIdx])} → {fmtNight(addDaysIso(nights[pendingAssign.endIdx], 1))}
          </p>
          <AssignExisting
            activities={activities}
            onCancel={() => setPendingAssign(null)}
            onAssign={async (locationId) => {
              await saveLodgingDates(locationId, { checkInDate: nights[pendingAssign.startIdx], checkOutDate: addDaysIso(nights[pendingAssign.endIdx], 1) });
              setPendingAssign(null);
            }}
          />
        </div>
      )}

      {editing && (() => {
        const l = lodgings.find((x) => x.id === editing);
        if (!l) return null;
        return (
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink flex items-center gap-1.5"><Hotel className="w-3.5 h-3.5" />{l.name}</p>
              <button onClick={() => setEditing(null)} className="text-faint hover:text-ink p-0.5" aria-label="Close"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <input type="date" value={l.checkInDate} onChange={(e) => saveLodgingDates(l.id, { checkInDate: e.target.value, checkOutDate: l.checkOutDate })} className="input py-1 text-xs" aria-label="Check-in" />
              <span className="text-faint">→</span>
              <input type="date" value={l.checkOutDate} min={l.checkInDate} onChange={(e) => saveLodgingDates(l.id, { checkInDate: l.checkInDate, checkOutDate: e.target.value })} className="input py-1 text-xs" aria-label="Check-out" />
            </div>
            <button onClick={() => { saveLodgingDates(l.id, null); setEditing(null); }} className="text-xs text-danger-600 dark:text-danger-400 hover:underline">
              Remove booking
            </button>
          </div>
        );
      })()}

      <button onClick={() => setWizardOpen(true)} className="text-xs text-faint hover:text-brand-600 dark:hover:text-brand-400 underline underline-offset-2">
        Preview: post-import wizard →
      </button>
      {wizardOpen && <StripWizard onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
