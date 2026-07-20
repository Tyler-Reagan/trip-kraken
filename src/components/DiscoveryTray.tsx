"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronUp, X, ArrowRight, Star } from "lucide-react";
import { deriveDays, type NearbyPlace } from "@/types";
import { useTripStore, type DiscoveryMode } from "@/store/tripStore";
import { placeDragId } from "./DayNavigator";

export const PRICE_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

const RATING_OPTIONS = [
  { label: "Any",  value: null },
  { label: "3+",   value: 3    },
  { label: "4+",   value: 4    },
  { label: "4.5+", value: 4.5  },
] as const;

// Query-text shortcuts, not API type filters — folded into the free-text query (#100).
// Route scope *requires* a query, so its list has no "All" no-op chip.
const NEARBY_TYPES = [
  { label: "All", value: "" },
  { label: "Restaurants", value: "restaurant" },
  { label: "Attractions", value: "tourist attraction" },
  { label: "Cafes", value: "cafe" },
  { label: "Museums", value: "museum" },
  { label: "Parks", value: "park" },
  { label: "Shopping", value: "shopping" },
  { label: "Bars", value: "bar" },
];
const ROUTE_TYPES = [
  { label: "Restaurants", value: "restaurant" },
  { label: "Coffee", value: "coffee" },
  { label: "Attractions", value: "tourist attraction" },
  { label: "Gas", value: "gas station" },
  { label: "Parks", value: "park" },
  { label: "Shopping", value: "shopping" },
];

type ProviderOption = { id: string; label: string };

/**
 * The discovery tray (#134): a fixed footer rail shared by Nearby (stop-anchored) and
 * Along-the-way (consecutive-leg corridor) search — the successor to the side-drawer pair.
 * Scope is chosen from the day card's triggers, never here; the tray only shows it and lets
 * the two modes' last scopes be tab-switched. Results browse horizontally and are draggable
 * onto day cards (the shell's edge-paging carries them to unmounted days).
 */
export default function DiscoveryTray() {
  const mode = useTripStore((s) => s.discoveryMode);
  const trip = useTripStore((s) => s.trip);
  if (!mode || !trip) return null;
  return <TrayInner mode={mode} />;
}

function TrayInner({ mode }: { mode: DiscoveryMode }) {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const setDiscoveryMode = useTripStore((s) => s.setDiscoveryMode);
  const closeDiscovery = useTripStore((s) => s.closeDiscovery);
  const nearbyLocation = useTripStore((s) => s.nearbySearchLocation);
  const nearbyDate = useTripStore((s) => s.nearbySearchDate);
  const routeSearch = useTripStore((s) => s.routeSearch);
  const addDiscoveredPlace = useTripStore((s) => s.addDiscoveredPlace);

  const [results, setResults] = useState<NearbyPlace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState(1000);
  const [type, setType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [providers, setProviders] = useState<ProviderOption[]>([{ id: "google", label: "Google" }]);
  const [source, setSource] = useState("google");
  const [openNow, setOpenNow] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [priceLevels, setPriceLevels] = useState<Set<number>>(new Set());
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ place: NearbyPlace; rect: DOMRect } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The day the search places adds on: the date the scope was opened with, else (nearby) the
  // day the anchor is placed on (ADR-0015 — days are derived).
  const days = trip ? deriveDays(trip) : [];
  const anchorDate =
    mode === "route"
      ? routeSearch?.date ?? null
      : nearbyDate ??
        (nearbyLocation
          ? days.find((d) => d.stops.some((s) => s.location.id === nearbyLocation.id))?.date ?? null
          : null);

  // An along-route add goes between the corridor's two anchor stops (#131). `from` may be a
  // lodging anchor with no placement (ADR-0015) — the formula then lands on 0, the day's first slot.
  const insertOrder =
    mode === "route" && routeSearch?.date && trip
      ? (trip.placements.find((p) => p.locationId === routeSearch.from.id && p.date === routeSearch.date)?.order ?? -1) + 1
      : undefined;

  // Anchored providers that apply at this location — drives the source toggle (ADR-0009).
  useEffect(() => {
    if (mode !== "nearby" || !nearbyLocation) return;
    const params = new URLSearchParams({ mode: "anchored" });
    if (nearbyLocation.lat !== null && nearbyLocation.lng !== null) {
      params.set("lat", String(nearbyLocation.lat));
      params.set("lng", String(nearbyLocation.lng));
    }
    fetch(`/api/discovery/providers?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((list: ProviderOption[] | null) => { if (list?.length) setProviders(list); })
      .catch(() => { /* keep the default google-only toggle */ });
  }, [mode, nearbyLocation?.lat, nearbyLocation?.lng, nearbyLocation]);

  useEffect(() => {
    if (!providers.some((p) => p.id === source)) setSource(providers[0]?.id ?? "google");
  }, [providers, source]);

  const query = [type, keyword.trim()].filter(Boolean).join(" ");
  const fromId = routeSearch?.from.id;
  const toId = routeSearch?.to.id;
  const anchorId = nearbyLocation?.id;

  const doFetch = useCallback(async () => {
    if (!tripId) return;
    setError(null);
    if (mode === "route") {
      if (!fromId || !toId) return;
      if (!query.trim()) { setResults(null); return; }
      setLoading(true);
      try {
        const params = new URLSearchParams({ from: fromId, to: toId, q: query.trim(), limit: "20" });
        if (openNow) params.set("openNow", "true");
        const res = await fetch(`/api/trips/${tripId}/locations/along-route?${params}`);
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Failed to load places along the route"); setResults(null); }
        else setResults(data as NearbyPlace[]);
      } catch {
        setError("Network error. Check your connection.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    } else {
      if (!anchorId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ radius: String(radius), limit: "20" });
        if (query) params.set("keyword", query);
        if (openNow) params.set("openNow", "true");
        if (anchorDate) params.set("date", anchorDate);
        params.set("source", source);
        const res = await fetch(`/api/trips/${tripId}/locations/${anchorId}/nearby?${params}`);
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Failed to load nearby places"); setResults(null); }
        else setResults(data as NearbyPlace[]);
      } catch {
        setError("Network error. Check your connection.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }
  }, [tripId, mode, fromId, toId, anchorId, query, openNow, radius, anchorDate, source]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(doFetch, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [doFetch]);

  if (!tripId || !trip) return null;

  const addedIds = new Set(trip.locations.map((l) => l.placeId).filter(Boolean) as string[]);

  // Client-side post-filters (rating and price — not supported as Google API params)
  const filtered = (results ?? []).filter((p) => {
    if (minRating !== null && (p.rating === null || p.rating < minRating)) return false;
    if (priceLevels.size > 0 && (p.priceLevel === null || !priceLevels.has(p.priceLevel))) return false;
    return true;
  });

  const activeMoreFiltersCount =
    (openNow ? 1 : 0) + (minRating !== null ? 1 : 0) + (priceLevels.size > 0 ? 1 : 0);

  async function handleAdd(place: NearbyPlace) {
    setAddingId(place.placeId);
    setAddError(null);
    const err = await addDiscoveredPlace(place, anchorDate, insertOrder);
    if (err) setAddError(err);
    setAddingId(null);
    setInspected(null);
  }

  function togglePriceLevel(level: number) {
    setPriceLevels((prev) => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  }

  const types = mode === "nearby" ? NEARBY_TYPES : ROUTE_TYPES;
  const scope =
    mode === "nearby" ? (
      <span className="truncate">around {nearbyLocation?.name}</span>
    ) : routeSearch ? (
      <span className="flex items-center gap-1 min-w-0">
        <span className="truncate">{routeSearch.from.name}</span>
        <ArrowRight className="w-3 h-3 shrink-0 text-faint" />
        <span className="truncate">{routeSearch.to.name}</span>
      </span>
    ) : null;

  const chipCls = (active: boolean) =>
    `px-2 py-0.5 text-[11px] rounded-full border whitespace-nowrap transition-colors ${
      active
        ? "bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500"
        : "bg-surface-2 text-sub border-line-strong hover:bg-surface-3"
    }`;

  return (
    <div
      role="complementary"
      aria-label="Discovery"
      className="fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-line shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="max-w-6xl mx-auto px-4 py-2 space-y-2">
        {/* Header: mode tabs + scope + close. A tab without a scope is disabled — scope is
            chosen from the day card's per-stop / per-leg triggers, never here. */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex rounded-lg border border-line-strong overflow-hidden text-xs shrink-0">
            <button
              onClick={() => nearbyLocation && setDiscoveryMode("nearby")}
              disabled={!nearbyLocation}
              title={nearbyLocation ? undefined : "Use the search icon on a stop to pick an anchor"}
              className={`px-2.5 py-1 font-medium transition-colors disabled:opacity-40 ${
                mode === "nearby" ? "bg-ink text-canvas" : "bg-surface-2 text-sub hover:bg-surface-3"
              }`}
            >
              Nearby
            </button>
            <button
              onClick={() => routeSearch && setDiscoveryMode("route")}
              disabled={!routeSearch}
              title={routeSearch ? undefined : "Use “Along the way” between two stops to pick a leg"}
              className={`px-2.5 py-1 font-medium transition-colors disabled:opacity-40 ${
                mode === "route" ? "bg-ink text-canvas" : "bg-surface-2 text-sub hover:bg-surface-3"
              }`}
            >
              Along the way
            </button>
          </div>
          <div className="text-xs text-sub min-w-0">{scope}</div>
          <button onClick={closeDiscovery} className="ml-auto text-faint hover:text-sub shrink-0" aria-label="Close discovery">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar: category chips · keyword · radius/source (nearby) · more-filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(mode === "nearby" && source !== "google" ? [] : types).map((pt) => (
            <button
              key={pt.label}
              onClick={() => setType(mode === "route" && type === pt.value ? "" : pt.value)}
              className={chipCls(type === pt.value)}
            >
              {pt.label}
            </button>
          ))}
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={mode === "nearby" ? "Search by keyword…" : "Search along the way…"}
            className="input py-0.5 px-2 text-xs flex-1 min-w-[120px] max-w-[220px]"
          />
          {mode === "nearby" && (
            <label className="flex items-center gap-1.5 text-[11px] text-sub shrink-0">
              <span className="text-numeral">{radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`}</span>
              <input
                type="range"
                min={500}
                max={5000}
                step={500}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-24 accent-brand-500"
                aria-label="Search radius"
              />
            </label>
          )}
          {mode === "nearby" && providers.length > 1 && (
            <div className="flex rounded-lg border border-line-strong overflow-hidden text-[11px] shrink-0">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSource(p.id)}
                  className={`px-2 py-0.5 font-medium transition-colors ${
                    source === p.id ? "bg-brand-600 dark:bg-brand-500 text-white" : "bg-surface-2 text-sub hover:bg-surface-3"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowMoreFilters((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-sub hover:text-ink transition-colors shrink-0"
          >
            {showMoreFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            More filters
            {!showMoreFilters && activeMoreFiltersCount > 0 ? ` (${activeMoreFiltersCount})` : ""}
          </button>
        </div>

        {showMoreFilters && (
          <div className="flex items-center gap-4 flex-wrap">
            {(mode === "route" || source === "google") && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-sub">
                <input
                  type="checkbox"
                  checked={openNow}
                  onChange={(e) => setOpenNow(e.target.checked)}
                  className="rounded border-line-strong text-brand-600 focus:ring-brand-500"
                />
                Open now
              </label>
            )}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-sub mr-1">Rating</span>
              {RATING_OPTIONS.map((opt) => (
                <button key={String(opt.value)} onClick={() => setMinRating(opt.value)} className={chipCls(minRating === opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-sub mr-1">Price</span>
              {PRICE_LABELS.map((label, level) => (
                <button key={level} onClick={() => togglePriceLevel(level)} className={chipCls(priceLevels.has(level))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result rail */}
        {addError && <p className="text-xs text-danger-600 dark:text-danger-400">{addError}</p>}
        {mode === "route" && !query.trim() ? (
          <div className="flex items-center justify-center h-24 text-sm text-faint text-center">
            Pick a category or type a search to find places along the way.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-24 text-sm text-faint">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-24 text-sm text-danger-600 dark:text-danger-400">{error}</div>
        ) : results !== null && filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-faint text-center">
            {mode === "nearby"
              ? "No results. Try a larger radius or adjust filters."
              : "Nothing along this leg. Try a different search or adjust filters."}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2 min-h-[6.5rem]">
            {filtered.map((place) => (
              <ResultCard
                key={place.placeId}
                place={place}
                isAdded={addedIds.has(place.placeId)}
                isAdding={addingId === place.placeId}
                onAdd={() => handleAdd(place)}
                onInspect={(rect) => setInspected({ place, rect })}
              />
            ))}
          </div>
        )}
      </div>

      {inspected && (
        <ResultPopover
          place={inspected.place}
          rect={inspected.rect}
          isAdded={addedIds.has(inspected.place.placeId)}
          isAdding={addingId === inspected.place.placeId}
          onAdd={() => handleAdd(inspected.place)}
          onClose={() => setInspected(null)}
        />
      )}
    </div>
  );
}

function distLabel(place: NearbyPlace): string | null {
  if (place.distanceMeters === null) return null;
  return place.distanceMeters >= 1000 ? `~${(place.distanceMeters / 1000).toFixed(1)}km` : `~${place.distanceMeters}m`;
}

/** One rail card. Drags onto day cards; clicking opens the fuller result popover (#134 —
 *  name + rating alone was ruled insufficient). */
function ResultCard({
  place, isAdded, isAdding, onAdd, onInspect,
}: {
  place: NearbyPlace;
  isAdded: boolean;
  isAdding: boolean;
  onAdd: () => void;
  onInspect: (rect: DOMRect) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: placeDragId(place.placeId),
    data: { kind: "place", place },
  });
  const dist = distLabel(place);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onInspect(e.currentTarget.getBoundingClientRect());
      }}
      className={`card p-2 w-[200px] shrink-0 flex flex-col gap-1 cursor-grab active:cursor-grabbing select-none touch-none transition-opacity hover:border-brand-400 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <p className="text-xs font-medium text-ink truncate">{place.name}</p>
      <div className="flex items-center gap-1 text-[10px] text-faint whitespace-nowrap overflow-hidden">
        {place.rating !== null && (
          <span className="inline-flex items-center gap-0.5 text-sub">
            <Star className="w-3 h-3 text-amber-500 fill-current" />
            {place.rating}
            {place.reviewCount !== null ? ` (${place.reviewCount.toLocaleString()})` : ""}
          </span>
        )}
        {place.priceLevel !== null && <span>· {PRICE_LABELS[place.priceLevel]}</span>}
        {dist && <span>· {dist}</span>}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-sub bg-surface-2 px-1.5 py-0.5 rounded capitalize truncate">
          {place.categories[0]?.replace(/_/g, " ") ?? "place"}
        </span>
        <button
          onClick={onAdd}
          disabled={isAdded || isAdding}
          className={`text-[11px] px-2 py-0.5 rounded font-medium shrink-0 transition-colors ${
            isAdded
              ? "bg-surface-2 text-faint cursor-default"
              : "bg-brand-600 dark:bg-brand-500 text-white hover:bg-brand-700 dark:hover:bg-brand-400 disabled:opacity-50"
          }`}
        >
          {isAdding ? "…" : isAdded ? "Added" : "Add"}
        </button>
      </div>
    </div>
  );
}

/** Full result detail, anchored above the clicked rail card (interaction locality, #134). */
function ResultPopover({
  place, rect, isAdded, isAdding, onAdd, onClose,
}: {
  place: NearbyPlace;
  rect: DOMRect;
  isAdded: boolean;
  isAdding: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const W = 280;
  const H = 220;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - W - 12));
  const top = Math.max(12, rect.top - H - 8);
  const dist = distLabel(place);

  return (
    <div
      ref={ref}
      className="fixed z-40 card shadow-xl p-3 space-y-2"
      style={{ left, top, width: W }}
      role="dialog"
      aria-label={`Details for ${place.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink leading-snug">{place.name}</p>
        <button onClick={onClose} className="text-faint hover:text-sub shrink-0" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        {place.rating !== null && (
          <span className="inline-flex items-center gap-0.5 text-sub">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-current" />
            <span className="font-medium text-ink">{place.rating}</span>
            {place.reviewCount !== null && <span className="text-faint">({place.reviewCount.toLocaleString()})</span>}
          </span>
        )}
        {place.priceLevel !== null && <span className="text-sub">· {PRICE_LABELS[place.priceLevel]}</span>}
        {dist && <span className="text-brand-500 dark:text-brand-400 font-medium">· {dist}</span>}
      </div>
      <p className="text-[11px] text-sub leading-relaxed">{place.address}</p>
      {place.categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {place.categories.slice(0, 4).map((c) => (
            <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-sub capitalize">
              {c.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
      <button
        onClick={onAdd}
        disabled={isAdded || isAdding}
        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
          isAdded
            ? "bg-surface-2 text-faint cursor-default"
            : "bg-brand-600 dark:bg-brand-500 text-white hover:bg-brand-700 dark:hover:bg-brand-400 disabled:opacity-50"
        }`}
      >
        {isAdding ? "…" : isAdded ? "Added" : "Add to trip"}
      </button>
    </div>
  );
}
