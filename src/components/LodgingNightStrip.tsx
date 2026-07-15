"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Hotel, Lightbulb, MapPin, X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { clusterByMetro, type MetroCluster } from "@/lib/metroCluster";
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
 * The night strip (#113): a flat, unlabeled row of the trip's nights — one lodging is just a
 * one-lane bar, no threshold-swap to a different layout when a second is added. Drag across empty
 * nights to assign a span in one gesture; drag a bar's edge to resize, its body to move; a
 * body-drag that never actually moved is a plain tap/click, which opens the precise edit panel
 * instead. Overlapping bars stack into extra thin lanes only when they actually occur, so the
 * common case stays a single row. Pointer events (not separate mouse/touch handlers) drive every
 * gesture, so the same interactions work with a mouse, finger, or pen.
 *
 * `NightStripWizard` (#119) runs the post-import assignment flow (#114) against #116's real
 * per-cluster detector: one step per metro with activities but no covering lodging, each saving
 * through the same mutations #113's manual add and the booking-confirmation importer already use.
 *
 * Nights = trip dates minus the final date (a checkout-only day has no night slept).
 */

function nightsOf(trip: TripWithDetails): IsoDate[] {
  const dates = tripDates(trip.startDate, trip.endDate);
  return dates.length > 1 ? dates.slice(0, -1) : dates;
}

const fmtNight = (d: IsoDate) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

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

/** A single select — no typed dates, since the drag-select already fixed the range. */
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

/** A metro whose activities have no covering lodging yet — the wizard's per-step unit, straight
 *  off #116's real detector (no fixture, no re-derived heuristic). */
type UncoveredMetro = MetroCluster<Location, Lodging>;

// Google's formattedAddress for Japan comes back in two different orderings depending on the
// place ("<block/chōme>, <ward>, <city>, <postal>, Japan" vs. "Japan, 〒<postal> <city>, <ward>,
// <block>") — comma-position heuristics (e.g. "second-to-last segment") land on whichever is
// there, which is a street-block or ward name a user wouldn't recognize on a map about as often as
// it lands on the city. The postal code is the one token both orderings agree on, so anchor to it
// instead: the region name always sits immediately beside it, on whichever side isn't the marker.
const JP_POSTAL_THEN_REGION = /〒\s*\d{3}[-−]\d{4}\s+([^,]+)/;
const REGION_THEN_JP_POSTAL = /([A-Za-z][A-Za-z\s]*?)\s*,?\s*\d{3}[-−]\d{4}/;
const REGION_THEN_US_ZIP = /([A-Za-z][A-Za-z\s]*?)\s*,?\s*\d{5}(?:-\d{4})?\b/;

/** A recognizable label for a metro: the prefecture/state-level region read off its first
 *  activity's formatted address, not a ward or neighborhood name. Falls back to the activity's own
 *  name if the address doesn't carry a postal code to anchor on. */
function metroLabel(metro: UncoveredMetro): string {
  const first = metro.activities[0];
  const address = first?.address;
  const fallback = first?.name ?? "this area";
  if (!address) return fallback;
  const region =
    address.match(JP_POSTAL_THEN_REGION)?.[1] ??
    address.match(REGION_THEN_JP_POSTAL)?.[1] ??
    address.match(REGION_THEN_US_ZIP)?.[1];
  return region?.trim() || fallback;
}

/** Post-import wizard (#114's locked contract, #119): one step per metro lacking lodging, each
 *  skippable. No new lodging-creation path — "Import & continue" runs the real booking-
 *  confirmation parser (#57/ADR-0010; a stand-in for whatever richer booking source arrives
 *  later — a forwarded email, a provider integration) and "Save & continue" runs the same
 *  `saveLodgingDates` mutation #113's manual add uses, letting the user promote one of the
 *  places already imported into this metro (never a freshly-typed new place) into the lodging. */
/** Whether each prior step ended in an assigned lodging or a skip — tracked purely so the
 *  closing screen can recap what happened instead of closing silently (see the chip row itself,
 *  below, for why a silent "all set" wasn't enough of a signal on its own). */
type StepOutcome = "assigned" | "skipped";

function NightStripWizard({ metros, onClose }: { metros: UncoveredMetro[]; onClose: () => void }) {
  const importBooking = useTripStore((s) => s.importBooking);
  const saveLodgingDates = useTripStore((s) => s.saveLodgingDates);
  const [step, setStep] = useState(0);
  const [outcomes, setOutcomes] = useState<StepOutcome[]>([]);
  const [bookingText, setBookingText] = useState("");
  const [locationId, setLocationId] = useState("");
  const [checkInDate, setCheckInDate] = useState("");
  const [checkOutDate, setCheckOutDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const metro = metros[step];
  const done = step >= metros.length;

  function advance(outcome: StepOutcome) {
    setBookingText("");
    setLocationId("");
    setCheckInDate("");
    setCheckOutDate("");
    setError(null);
    setOutcomes((o) => [...o, outcome]);
    setStep((s) => s + 1);
  }

  async function handleImport() {
    if (!bookingText.trim()) return;
    setSaving(true);
    const err = await importBooking(bookingText);
    setSaving(false);
    if (err) { setError(err); return; }
    advance("assigned");
  }

  async function handleManualSave() {
    if (!locationId) return;
    // Dates-if-lodging (#114's sole hard rule): a location without both dates is never saved as
    // lodging — surfaced as a blocking error here rather than silently no-op'ing, since the user
    // picked a place and clearly meant to assign it.
    if (!checkInDate || !checkOutDate) { setError("Add both a check-in and check-out date, or skip this city."); return; }
    setSaving(true);
    const err = await saveLodgingDates(locationId, { checkInDate, checkOutDate });
    setSaving(false);
    if (err) { setError(err); return; }
    advance("assigned");
  }

  return (
    <ModalShell title="Add lodging for your trip" onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {metros.map((m, i) => {
              const assigned = outcomes[i] === "assigned";
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`w-3.5 shrink-0 mt-0.5 text-center ${assigned ? "text-brand-600 dark:text-brand-400" : "text-faint"}`}>
                    {assigned ? "✓" : "–"}
                  </span>
                  <span className={assigned ? "text-ink" : "text-sub"}>
                    <span className="font-medium">{metroLabel(m)}</span>
                    {assigned
                      ? " — lodging added"
                      : ` — skipped, ${m.activities.length} place${m.activities.length !== 1 ? "s" : ""} still unassigned`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-sub">Skipped areas stay unassigned and can be added anytime from the night strip above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {metros.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {metros.map((m, i) => (
                <span
                  key={i}
                  className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all ${
                    i === step ? "bg-brand-600 text-white text-sm font-medium ring-2 ring-brand-500/30 scale-105"
                    : i < step ? "bg-surface-2 text-faint text-xs line-through"
                    : "bg-surface-2 text-sub text-xs border border-line-strong"
                  }`}
                >
                  {metroLabel(m)}
                  <span className={`text-numeral ${i === step ? "text-[11px]" : "text-[10px]"} opacity-90`}>{m.activities.length}</span>
                </span>
              ))}
            </div>
          )}

          <p className="text-sm text-sub">
            <MapPin className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
            No lodging yet near <span className="text-ink font-medium">{metroLabel(metro)}</span> — {metro.activities.length} imported place{metro.activities.length !== 1 ? "s" : ""} there
          </p>

          {error && <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs text-faint">Paste a booking confirmation email</label>
            <textarea
              value={bookingText}
              onChange={(e) => setBookingText(e.target.value)}
              rows={3}
              className="input text-sm"
              placeholder={"Property: Shibuya Grand\nCheck-in: Aug 13, 2026\nCheck-out: Aug 17, 2026"}
            />
            <p className="text-[11px] text-faint">We&rsquo;ll pull the property name and dates out automatically.</p>
            <button onClick={handleImport} disabled={saving || !bookingText.trim()} className="btn-primary text-xs py-1.5 px-3 w-full disabled:opacity-40">
              Import & continue
            </button>
          </div>

          <div className="text-center text-xs text-faint">or</div>

          <div className="space-y-1.5">
            <label className="text-xs text-faint">Pick one of the places you already imported</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input py-1.5 text-sm">
              <option value="">Select a place…</option>
              {metro.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="flex items-center gap-1.5">
              <input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} className="input py-1 text-xs flex-1" aria-label="Check-in" />
              <span className="text-faint text-xs">→</span>
              <input type="date" value={checkOutDate} min={checkInDate} onChange={(e) => setCheckOutDate(e.target.value)} className="input py-1 text-xs flex-1" aria-label="Check-out" />
            </div>
            <button onClick={handleManualSave} disabled={saving || !locationId} className="btn-secondary text-xs py-1.5 px-3 w-full disabled:opacity-40">
              Save & continue
            </button>
          </div>

          <button onClick={() => advance("skipped")} className="text-xs text-faint hover:text-ink underline underline-offset-2 w-full text-center">
            Skip this area
          </button>
        </div>
      )}
    </ModalShell>
  );
}

/** The soft, non-blocking nudge for a multi-day, single-metro trip with no lodging at all (#114) —
 *  the case the cluster detector can't see, since a lone metro has nothing to compare itself
 *  against to look "orphaned." Dismissible, never blocking; nothing here is mandatory. */
function DurationTip({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="card p-3 flex items-start gap-2 text-sm">
      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
      <p className="flex-1 text-sub">
        This trip spans multiple days without any lodging — if you're staying somewhere overnight, drag across the nights above to add it.
      </p>
      <button onClick={onDismiss} className="tap-target text-faint hover:text-ink shrink-0" aria-label="Dismiss">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

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
 *  div the drag math relies on. */
function daySeams(nightCount: number): string | undefined {
  if (nightCount <= 1) return undefined;
  const step = 100 / nightCount;
  return `repeating-linear-gradient(to right, transparent 0, transparent calc(${step}% - 1px), var(--canvas) calc(${step}% - 1px), var(--canvas) ${step}%)`;
}

export function NightStrip({ trip, lodgings, activities }: { trip: TripWithDetails; lodgings: Lodging[]; activities: Location[] }) {
  const saveLodgingDates = useTripStore((s) => s.saveLodgingDates);
  const containerRef = useRef<HTMLDivElement>(null);
  const nights = nightsOf(trip);
  const { bars, laneCount } = laneBarsOf(nights, lodgings);

  const router = useRouter();
  const searchParams = useSearchParams();
  // The real per-cluster detector (#116), same one the optimizer's coverage mask (#118) reads —
  // no second heuristic for "does this metro have lodging." `activities` here is already the
  // Manifest's promotable set (not excluded, `kind: activity`).
  const metros = useMemo(() => clusterByMetro<Location, Lodging>(activities, lodgings), [activities, lodgings]);
  const uncoveredMetros = useMemo(() => metros.filter((m) => m.lodgings.length === 0 && m.activities.length > 0), [metros]);
  const isMultiDay = tripDates(trip.startDate, trip.endDate).length > 1;
  // The single-metro case is invisible to the detector (nothing to compare it against) — call it
  // out separately rather than folding it into `uncoveredMetros`.
  const isSingleMetroNoLodging = metros.length === 1 && isMultiDay && lodgings.length === 0;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [durationTipDismissed, setDurationTipDismissed] = useState(false);
  const [select, setSelect] = useState<{ start: number; end: number } | null>(null);
  const [pendingAssign, setPendingAssign] = useState<{ startIdx: number; endIdx: number } | null>(null);
  const [drag, setDrag] = useState<{ lodgingId: string; mode: "resize-start" | "resize-end" | "move"; anchorIdx: number; preview: { startIdx: number; endIdx: number } } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Post-import trigger (#119): ImportForm lands here with `?imported=1`. Runs once per landing —
  // the ref (not just the query param) survives the router.replace below re-rendering this
  // component before the param is gone. Nothing fires if every metro already has covering lodging.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || searchParams.get("imported") !== "1") return;
    firedRef.current = true;
    if (!isSingleMetroNoLodging && uncoveredMetros.length > 0) setWizardOpen(true);
    const params = new URLSearchParams(searchParams);
    params.delete("imported");
    router.replace(params.size > 0 ? `?${params.toString()}` : window.location.pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function idxFromClientX(x: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(nights.length - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * nights.length)));
  }

  // Pointer events (not mouse/touch handlers separately) so drag-select, resize, move, and
  // click-to-edit all work identically with a mouse, a finger, or a pen.
  function startSelect(i: number, e: React.PointerEvent) {
    const pointerId = e.pointerId;
    setSelect({ start: i, end: i });
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      setSelect((s) => (s ? { ...s, end: idxFromClientX(ev.clientX) } : s));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const end = idxFromClientX(ev.clientX);
      setPendingAssign({ startIdx: Math.min(i, end), endIdx: Math.max(i, end) });
      setSelect(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function startBarDrag(bar: LaneBar, mode: "resize-start" | "resize-end" | "move", e: React.PointerEvent) {
    e.stopPropagation();
    const pointerId = e.pointerId;
    const anchorIdx = idxFromClientX(e.clientX);
    // previewRef carries the live range so `onUp` can call saveLodgingDates directly, outside
    // any setState updater (calling it from inside one trips React's "cannot update a component
    // while rendering" check — updaters must stay pure).
    const previewRef = { current: { startIdx: bar.startIdx, endIdx: bar.endIdx } };
    setDrag({ lodgingId: bar.lodging.id, mode, anchorIdx, preview: previewRef.current });

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
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
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const { startIdx, endIdx } = previewRef.current;
      const unchanged = startIdx === bar.startIdx && endIdx === bar.endIdx;
      // A "move" that never actually moved is a plain tap/click on the block — open the edit
      // panel (precise dates + remove) instead of writing a no-op save.
      if (mode === "move" && unchanged) setEditing(bar.lodging.id);
      else saveLodgingDates(bar.lodging.id, { checkInDate: nights[startIdx], checkOutDate: addDaysIso(nights[endIdx], 1) });
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
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
            onPointerDown={(e) => startSelect(i, e)}
            title={fmtNight(date)}
            className="absolute top-0 h-full cursor-crosshair touch-none"
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
                <div onPointerDown={(e) => startBarDrag(bar, "resize-start", e)} className="w-2 h-full cursor-ew-resize touch-none shrink-0" />
                <div onPointerDown={(e) => startBarDrag(bar, "move", e)} className="flex-1 h-full cursor-grab touch-none relative">
                  {overlapping && <AlertTriangle className="w-3 h-3 text-white absolute inset-0 m-auto" />}
                </div>
                <div onPointerDown={(e) => startBarDrag(bar, "resize-end", e)} className="w-2 h-full cursor-ew-resize touch-none shrink-0" />
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

      {isSingleMetroNoLodging && !durationTipDismissed && (
        <DurationTip onDismiss={() => setDurationTipDismissed(true)} />
      )}

      {uncoveredMetros.length > 0 && (
        <button onClick={() => setWizardOpen(true)} className="text-xs text-faint hover:text-brand-600 dark:hover:text-brand-400 underline underline-offset-2">
          Assign lodging for {uncoveredMetros.length} {uncoveredMetros.length === 1 ? "city" : "cities"} →
        </button>
      )}
      {wizardOpen && <NightStripWizard metros={uncoveredMetros} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
