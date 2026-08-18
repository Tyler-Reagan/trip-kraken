"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import Map, { Source, Layer, AttributionControl, MapMouseEvent } from "react-map-gl/maplibre";
import type { MapRef, LayerProps } from "react-map-gl/maplibre";
import type { FeatureCollection, LineString, Point } from "geojson";
import { ChevronRight, Crosshair, Globe, MapPin, PanelLeftClose, TrainFront } from "lucide-react";
import { useTripStore, type FocusTarget } from "@/store/tripStore";
import { deriveTripPlanDays, type DerivedDay, type Location } from "@/types";
import type { PathEndpoint } from "@/types/path";
import { DAY_COLORS, dayColorCss, dayTextColor } from "@/lib/dayColors";
import { boundsOf, metroOfDay, metrosOf, type Bounds, type TripMetro } from "@/lib/tripMetros";
import { pairKey, pairsOfDay } from "@/lib/pathPairs";
import { usePathGeometry } from "@/lib/usePathGeometry";

// #145: CARTO's keyless basemap endpoint is outside its published license (enterprise/grant-only,
// no self-serve tier). Stadia's Alidade Smooth Dark is the visual replacement — see ADR-0027 for
// why Stadia over MapTiler/self-hosted PMTiles. No API key needed on localhost (strict but
// unpublished rate limit); NEXT_PUBLIC_STADIA_API_KEY is read if a key is ever provisioned, but
// nothing sets it today.
const STADIA_STYLE_URL = "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json";
const STADIA_API_KEY = process.env.NEXT_PUBLIC_STADIA_API_KEY;
const STADIA_DARK = STADIA_API_KEY
  ? `${STADIA_STYLE_URL}?api_key=${STADIA_API_KEY}`
  : STADIA_STYLE_URL;

// #145/#150: MapLibre adds an AttributionControl by default, but only in *compact* form — a small
// icon that needs a click to reveal the credit, which doesn't meet OSMF guidance ("should not
// require individuals to interact with the map ... to see the attribution"). Stadia's own style
// JSON declares an accurate, complete attribution string (verified 2026-08-12 — unlike CARTO's,
// which omitted a credit its own license required), so the fix is forcing the control open
// (`compact={false}`), not overriding the text: a hardcoded string here would duplicate what the
// control already renders from the style, and silently drift if Stadia's credit ever changes.

// Camera semantics (#128 decision 1): metro and day targets *fit* their extent; a single stop is a
// flyTo at a fixed zoom, since a one-point bounds has no extent to fit.
const STOP_ZOOM = 14;
const CAMERA_MS = 650;
const FIT_PADDING = 28;
const PANEL_W = 208;

// How loudly a day draws (#128 decision 8: coloring stays day-based — this is opacity only, never
// a recolor). Three tiers, because the map is navigated a metro at a time: the day you're on, its
// siblings in the metro you're browsing, and everything else.
const ALPHA_ACTIVE = 1;
const ALPHA_METRO = 0.55;
// Not near-invisible like the old flat 0.18: the trip-level fit is a first-class camera target
// now, and everything it shows would be off-metro.
const ALPHA_REST = 0.28;

const LODGING_COLOR = "#e5e7eb"; // gray-200

type TooltipState = {
  x: number;
  y: number;
  name: string;
  isBase: boolean;
  /** Which Anchor kind an `isBase` point is (ADR-0028) — a Lodging or a trip-edge Transit
   *  Location — so the tooltip doesn't call an airport "Lodging". Absent for a plain stop. */
  anchorKind?: "lodging" | "transit";
  dayNumber?: number;
  order?: number;
  dayNumbers?: number[];
} | null;

function toRgb(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function computeInitialViewState(trip: { locations: { excluded: boolean; lat: number | null; lng: number | null }[] }) {
  const valid = trip.locations.filter(
    (l): l is typeof l & { lat: number; lng: number } =>
      !l.excluded && l.lat !== null && l.lng !== null
  );
  if (valid.length === 0) return { longitude: 139.69, latitude: 35.69, zoom: 10 };
  if (valid.length === 1) {
    return { longitude: valid[0].lng, latitude: valid[0].lat, zoom: 14 };
  }

  const lngs = valid.map((l) => l.lng);
  const lats = valid.map((l) => l.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  return {
    longitude: (minLng + maxLng) / 2,
    latitude: (minLat + maxLat) / 2,
    zoom: 11,
  };
}

/** Every point a day actually draws — its stops plus its lodging bookends, which are on the map
 *  and on the day's route line, so fitting to the stops alone would crop them out. */
function pointsOfDay(day: DerivedDay): { lat: number | null; lng: number | null }[] {
  return [...day.stops.map((s) => s.location), day.startAnchor, day.endAnchor].filter((p) => p !== null);
}

/**
 * The trip map (#128). The canvas renders the plan day-colored; above it sit the two navigation
 * bands the "split bands" design settled on (#136) — metro **underline tabs** and day **pills**,
 * two tiers told apart by idiom rather than weight — feeding a collapsible left-docked stop panel
 * for the day in view. Every tier click is a `focusMap` command; `MapView` is the sole consumer of
 * `focusTarget` and never reads `activeDayNumber` for camera purposes (#137).
 */
export default function MapView() {
  const trip = useTripStore((s) => s.trip);
  const activeDayNumber = useTripStore((s) => s.activeDayNumber);
  const highlightedLocationId = useTripStore((s) => s.highlightedLocationId);
  const handleMapLocationClick = useTripStore((s) => s.handleMapLocationClick);
  const focusTarget = useTripStore((s) => s.focusTarget);
  const focusMap = useTripStore((s) => s.focusMap);
  const consumeFocusTarget = useTripStore((s) => s.consumeFocusTarget);
  const disarmAutoFocus = useTripStore((s) => s.disarmAutoFocus);

  const mapRef = useRef<MapRef>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  // Gate Map mounting until the container has real dimensions.
  // MapLibre reads clientWidth/clientHeight synchronously in its constructor,
  // but React's commit phase runs before the browser's layout pass — the
  // container reports 0×0 and MapLibre's WebGL context never recovers from
  // that. ResizeObserver fires after the first real layout, at which point we
  // flip `mapReady` and let <Map> mount against a properly-sized container.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setMapReady(true);
      // Keep map in sync on subsequent container size changes (e.g. NearbyDrawer toggle).
      mapRef.current?.resize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const initialViewState = useMemo(
    () => trip ? computeInitialViewState(trip) : { longitude: 139.69, latitude: 35.69, zoom: 10 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.id]
  );

  // Day-clustered plan, projected from placements + lodging dates (ADR-0015).
  const days = useMemo(() => (trip ? deriveTripPlanDays(trip) : []), [trip]);
  // The shared metro source (#128 decision 3) — memoized per trip, same array the day cards read.
  const metros = useMemo(() => (trip ? metrosOf(trip) : []), [trip]);

  // Which metro's days the pill band is showing. Normally the one holding the day in view; a metro
  // tab click overrides that so you can browse another metro's days without leaving the day you're
  // on. Any day change resolves the override — by then the day itself says which metro to show.
  const [metroOverride, setMetroOverride] = useState<string | null>(null);
  useEffect(() => setMetroOverride(null), [activeDayNumber]);
  const browsedMetro: TripMetro | null =
    metros.find((m) => m.id === metroOverride) ?? metroOfDay(metros, activeDayNumber) ?? metros[0] ?? null;
  const browsedDays = useMemo(() => new Set(browsedMetro?.dayNumbers ?? []), [browsedMetro]);

  const activeDay = days.find((d) => d.dayNumber === activeDayNumber) ?? null;

  // Real Path geometry for the Day lines (ADR-0029). Held by pair and requested only where missing,
  // so a drag costs the pairs it made newly adjacent rather than the whole Trip.
  const roadProfile = trip?.roadProfile ?? "walking";
  const pathGeometry = usePathGeometry(trip?.id ?? null, days, roadProfile);

  // Build GeoJSON for route lines and stop dots
  const { pointsGeoJSON, routesGeoJSON } = useMemo(() => {
    const points: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
    const routes: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };

    // "Anchor" here covers both bookend kinds (ADR-0028): a Lodging or a trip-edge Transit
    // Location. Both render as the same neutral marker — only the tooltip/panel text tells them
    // apart, since a full distinct map icon would need a symbol layer this style doesn't load.
    const anchorMap: Record<string, { locationId: string; name: string; lat: number; lng: number; kind: "lodging" | "transit"; dayNumbers: number[] }> = {};
    const addAnchor = (loc: Location, dayNumber: number) => {
      if (loc.lat === null || loc.lng === null || loc.kind === "activity") return;
      const e = anchorMap[loc.id];
      if (e) { if (!e.dayNumbers.includes(dayNumber)) e.dayNumbers.push(dayNumber); }
      else anchorMap[loc.id] = { locationId: loc.id, name: loc.name, lat: loc.lat, lng: loc.lng, kind: loc.kind, dayNumbers: [dayNumber] };
    };
    const alphaFor = (dayNumbers: number[]) =>
      dayNumbers.includes(activeDayNumber) ? ALPHA_ACTIVE
      : dayNumbers.some((n) => browsedDays.has(n)) ? ALPHA_METRO
      : ALPHA_REST;

    for (const day of days) {
      const rgb = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
      const isActive = activeDayNumber === day.dayNumber;
      const alpha = alphaFor([day.dayNumber]);
      const color = toRgb(rgb);

      const geocodedStops = day.stops.filter(
        (s): s is typeof s & { location: typeof s.location & { lat: number; lng: number } } =>
          s.location.lat !== null && s.location.lng !== null
      );

      geocodedStops.forEach((stop, i) => {
        points.features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [stop.location.lng, stop.location.lat] },
          properties: {
            locationId: stop.location.id,
            name: stop.location.name,
            dayNumber: day.dayNumber,
            order: i + 1,
            color,
            alpha,
            isHighlighted: stop.location.id === highlightedLocationId ? 1 : 0,
            isBase: 0,
          },
        });
      });

      if (day.startAnchor) addAnchor(day.startAnchor, day.dayNumber);
      if (day.endAnchor) addAnchor(day.endAnchor, day.dayNumber);

      // One line per Path, not one per Day (ADR-0029 §1). The Day's chain — start Anchor, check-in
      // waypoint, stops, end Anchor — is `pairsOfDay`'s rule now, not this component's.
      //
      // Route lines overlap and thicken each other, so only the day in view draws at full strength;
      // its metro siblings hint at their shape, the rest stay off entirely. Every Path of a Day
      // shares that one opacity, so the solid/dashed distinction reads as provenance rather than as
      // emphasis (§3).
      const routeAlpha = isActive ? 0.65 : browsedDays.has(day.dayNumber) ? 0.18 : 0;
      const drawStraight = (from: PathEndpoint, to: PathEndpoint) => {
        routes.features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
          properties: { color, alpha: routeAlpha, dashed: 1 },
        });
      };

      for (const pair of pairsOfDay(day)) {
        const paths = pathGeometry.get(pairKey(roadProfile, pair));

        // Not yet answered (§7 — the canvas never waits), or refused outright by the router.
        if (!paths?.length) {
          drawStraight(pair.from, pair.to);
          continue;
        }

        for (const path of paths) {
          // Presence of geometry, not `basisOfCost` — "is there a real shape to draw" is the
          // question, and it stays right for a rail Path with a real Basis and no shape yet (#142).
          if (path.geometry) {
            routes.features.push({ type: "Feature", geometry: path.geometry, properties: { color, alpha: routeAlpha, dashed: 0 } });
          } else {
            drawStraight(path.from, path.to);
          }
        }
      }
    }

    // Render each Anchor (Lodging or trip-edge Transit) as a single neutral-colored feature.
    for (const anchor of Object.values(anchorMap)) {
      const sortedDays = anchor.dayNumbers.slice().sort((a: number, b: number) => a - b);
      points.features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [anchor.lng, anchor.lat] },
        properties: {
          locationId: anchor.locationId,
          name: anchor.name,
          anchorKind: anchor.kind,
          dayNumbers: JSON.stringify(sortedDays),
          color: LODGING_COLOR,
          alpha: alphaFor(sortedDays),
          isHighlighted: anchor.locationId === highlightedLocationId ? 1 : 0,
          isBase: 1,
        },
      });
    }

    return { pointsGeoJSON: points, routesGeoJSON: routes };
  }, [days, activeDayNumber, browsedDays, highlightedLocationId, pathGeometry, roadProfile]);

  // ADR-0029 §3: a Path with no real shape draws dashed, in the same day colour and opacity — the
  // traveler sees that we are guessing at that stretch, not that it matters more or less. Same
  // data-driven technique the colour and opacity above already use; `line-dasharray` is
  // `cross-faded-data-driven` in the pinned MapLibre (5.21.1 / style-spec 24.7.0).
  const routeLayer: LayerProps = {
    id: "routes",
    type: "line",
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": ["get", "alpha"],
      "line-width": 3,
      "line-dasharray": ["case", ["==", ["get", "dashed"], 1], ["literal", [2, 1.5]], ["literal", [1, 0]]],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  };

  const dotsLayer: LayerProps = {
    id: "stops",
    type: "circle",
    paint: {
      "circle-radius": [
        "case",
        ["==", ["get", "isHighlighted"], 1], 18,
        ["==", ["get", "isBase"], 1], 13,
        11,
      ],
      "circle-color": ["case", ["==", ["get", "isHighlighted"], 1], "#ffffff", ["get", "color"]],
      "circle-opacity": ["get", "alpha"],
      "circle-stroke-width": [
        "case",
        ["==", ["get", "isBase"], 1], 3,
        2,
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "isHighlighted"], 1], "#16a34a",
        ["==", ["get", "isBase"], 1], "#374151",
        "rgba(0,0,0,0.3)",
      ],
      "circle-stroke-opacity": ["get", "alpha"],
    },
  };

  // ── Camera ──────────────────────────────────────────────────────────────────
  // Keep the fitted extent clear of the docked panel, but never pad a narrow canvas into nothing.
  const fitPadding = useCallback(() => {
    const width = canvasRef.current?.clientWidth ?? 0;
    const left = panelOpen && width > 2 * PANEL_W ? PANEL_W + FIT_PADDING : FIT_PADDING;
    return { top: FIT_PADDING, bottom: FIT_PADDING, right: FIT_PADDING, left };
  }, [panelOpen]);

  const boundsFor = useCallback(
    (target: Exclude<FocusTarget, { tier: "stop" }>): Bounds | null => {
      if (target.tier === "trip") return boundsOf(days.flatMap(pointsOfDay));
      if (target.tier === "metro") return metros.find((m) => m.id === target.metroId)?.bounds ?? null;
      const day = days.find((d) => d.dayNumber === target.dayNumber);
      return day ? boundsOf(pointsOfDay(day)) : null;
    },
    [days, metros]
  );

  // Consume the focus command (#137): move the camera, then clear it. Returns false only when
  // there's no map to point yet — the command survives so it can land once there is.
  const applyFocus = useCallback(
    (target: FocusTarget): boolean => {
      const map = mapRef.current;
      if (!map) return false;
      if (target.tier === "stop") {
        const loc = trip?.locations.find((l) => l.id === target.locationId);
        if (loc?.lat != null && loc.lng != null) {
          map.flyTo({ center: [loc.lng, loc.lat], zoom: STOP_ZOOM, duration: CAMERA_MS });
        }
        return true;
      }
      const bounds = boundsFor(target);
      // maxZoom keeps a one-stop day or metro from slamming to street level.
      if (bounds) map.fitBounds(bounds, { padding: fitPadding(), maxZoom: STOP_ZOOM, duration: CAMERA_MS });
      return true;
    },
    [trip, boundsFor, fitPadding]
  );

  useEffect(() => {
    if (!focusTarget || !mapReady) return;
    if (applyFocus(focusTarget)) consumeFocusTarget();
  }, [focusTarget, mapReady, applyFocus, consumeFocusTarget]);

  // A pan or zoom the *user* performed disarms auto-focus until their next explicit click (#137).
  // `originalEvent` is exactly that discriminator: our own flyTo/fitBounds carry none.
  const handleUserMove = useCallback(
    (e: { originalEvent?: MouseEvent | TouchEvent | WheelEvent }) => {
      if (e.originalEvent) disarmAutoFocus();
    },
    [disarmAutoFocus]
  );

  // Shared by click (tap) and hover so touch devices — which never fire mousemove — get the
  // same info surface a mouse hover gets, just triggered by tapping the stop instead.
  const buildTooltip = useCallback((e: MapMouseEvent): TooltipState => {
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ["stops"] });
    const f = features?.[0];
    if (!f?.properties) return null;
    const isBase = f.properties.isBase === 1;
    return {
      x: e.point.x,
      y: e.point.y,
      name: f.properties.name as string,
      isBase,
      ...(isBase
        ? {
            anchorKind: f.properties.anchorKind as "lodging" | "transit",
            dayNumbers: JSON.parse(f.properties.dayNumbers as string) as number[],
          }
        : { dayNumber: f.properties.dayNumber as number, order: f.properties.order as number }
      ),
    };
  }, []);

  const handleClick = useCallback((e: MapMouseEvent) => {
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ["stops"] });
    const f = features?.[0];
    if (f?.properties?.locationId) {
      handleMapLocationClick(f.properties.locationId as string);
    }
    setTooltip(buildTooltip(e));
  }, [handleMapLocationClick, buildTooltip]);

  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    setTooltip(buildTooltip(e));
  }, [buildTooltip]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (!trip) return null;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {/* Metro band — underline tabs, led by the trip-reset chip. */}
      <div className="flex items-stretch shrink-0 bg-surface-2 border-b border-line">
        <button
          onClick={() => focusMap({ tier: "trip" })}
          title={`Fit the whole trip — ${trip.name}`}
          className="flex items-center gap-1.5 px-2.5 text-xs font-medium text-sub hover:text-ink border-r border-line shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-faint shrink-0" />
          <span className="truncate max-w-[7rem]">{trip.name}</span>
        </button>
        <div className="flex items-stretch overflow-x-auto">
          {metros.map((metro) => {
            const selected = browsedMetro?.id === metro.id;
            return (
              <button
                key={metro.id}
                onClick={() => { setMetroOverride(metro.id); focusMap({ tier: "metro", metroId: metro.id }); }}
                aria-pressed={selected}
                title={`Fit ${metro.label} — ${metro.stopCount} stop${metro.stopCount !== 1 ? "s" : ""} across the trip`}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs shrink-0 border-b-2 -mb-px transition-colors ${
                  selected ? "border-brand-400 text-ink font-semibold" : "border-transparent text-sub hover:text-ink"
                }`}
              >
                <MapPin className={`w-3.5 h-3.5 shrink-0 ${selected ? "text-brand-500 dark:text-brand-400" : "text-faint"}`} />
                {metro.label}
                <span className="text-numeral text-faint">{metro.stopCount}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day band — pills, a different idiom from the tabs above so the tiers can't be confused. */}
      {browsedMetro && (
        <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto bg-surface px-2 py-1.5 border-b border-line">
          {browsedMetro.dayNumbers.map((dayNumber) => {
            const day = days.find((d) => d.dayNumber === dayNumber);
            const selected = dayNumber === activeDayNumber;
            return (
              <button
                key={dayNumber}
                onClick={() => focusMap({ tier: "day", dayNumber })}
                aria-pressed={selected}
                title={`Fit day ${dayNumber}${day?.label ? ` — ${day.label}` : ""}`}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs shrink-0 transition-colors ${
                  selected ? "bg-surface-3 text-ink ring-1 ring-brand-500" : "text-sub hover:bg-surface-2"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dayColorCss(dayNumber) }} />
                <span className="font-medium">Day {dayNumber}</span>
                <span className="text-numeral text-faint">{day?.stops.length ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      <div ref={canvasRef} className="relative flex-1 min-h-0">
        {mapReady && (
          <Map
            ref={mapRef}
            initialViewState={initialViewState}
            mapStyle={STADIA_DARK}
            style={{ width: "100%", height: "100%" }}
            interactiveLayerIds={["stops"]}
            attributionControl={false}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onDragStart={handleUserMove}
            onZoomStart={handleUserMove}
            cursor={tooltip ? "pointer" : "grab"}
          >
            <AttributionControl compact={false} />
            <Source id="routes" type="geojson" data={routesGeoJSON}>
              <Layer {...routeLayer} />
            </Source>
            <Source id="stops" type="geojson" data={pointsGeoJSON}>
              <Layer {...dotsLayer} />
            </Source>
          </Map>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
          >
            <div className="bg-gray-900/90 text-white text-xs rounded-lg border border-white/10 px-2.5 py-1.5 leading-snug">
              <strong className="font-semibold">{tooltip.name}</strong>
              <br />
              {tooltip.isBase
                ? <span className="opacity-70">{tooltip.anchorKind === "transit" ? "Transit" : "Lodging"} · Days {tooltip.dayNumbers!.join(", ")}</span>
                : <span className="opacity-70">Day {tooltip.dayNumber} · Stop {tooltip.order}</span>
              }
            </div>
          </div>
        )}

        {mapReady && activeDay && (
          <StopPanel day={activeDay} open={panelOpen} onToggle={setPanelOpen} onFocus={focusMap} />
        )}
      </div>
    </div>
  );
}

/**
 * The day in view, stop by stop — the third tier of the navigator, and what replaced the old
 * day-list legend: the day colors now read off the pills above, and this says what the dots *are*.
 * Docked rather than floating so it can be collapsed out of the way on a small canvas.
 */
function StopPanel({
  day, open, onToggle, onFocus,
}: {
  day: DerivedDay;
  open: boolean;
  onToggle: (v: boolean) => void;
  onFocus: (target: FocusTarget) => void;
}) {
  if (!open) {
    return (
      <button
        onClick={() => onToggle(true)}
        className="absolute left-0 top-3 flex items-center gap-1.5 rounded-r-lg bg-surface border border-l-0 border-line pl-2 pr-2.5 py-1.5 text-xs text-ink shadow-lg hover:bg-surface-2"
      >
        <ChevronRight className="w-3.5 h-3.5 text-brand-500 dark:text-brand-400" />
        <span className="font-medium">{day.stops.length} stop{day.stops.length !== 1 ? "s" : ""}</span>
      </button>
    );
  }

  return (
    <div
      className="absolute left-0 top-0 bottom-0 flex flex-col bg-surface border-r border-line shadow-xl"
      style={{ width: PANEL_W }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-line">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dayColorCss(day.dayNumber) }} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink leading-tight">Day {day.dayNumber}</p>
          <p className="text-meta text-faint truncate">
            {day.stops.length} stop{day.stops.length !== 1 ? "s" : ""}{day.label ? ` · ${day.label}` : ""}
          </p>
        </div>
        <button
          onClick={() => onToggle(false)}
          title="Hide stops"
          aria-label="Hide stops"
          className="ml-auto p-1 -mr-0.5 rounded text-faint hover:text-ink hover:bg-surface-2"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {day.startAnchor && (
          <PanelAnchorRow loc={day.startAnchor} label={day.startAnchor.kind === "transit" ? "Arrived here" : "Woke here"} onFocus={onFocus} />
        )}
        {day.stops.map((stop, i) => (
          <PanelStopRow key={stop.placement.id} loc={stop.location} dayNumber={day.dayNumber} index={i} onFocus={onFocus} />
        ))}
        {day.endAnchor && (
          <PanelAnchorRow loc={day.endAnchor} label={day.endAnchor.kind === "transit" ? "Departs from here" : "Overnight"} onFocus={onFocus} />
        )}
        {day.stops.length === 0 && !day.startAnchor && !day.endAnchor && (
          <p className="px-2.5 py-3 text-xs text-faint italic">Nothing planned this day.</p>
        )}
      </div>
    </div>
  );
}

/** Ungeocoded stops are disabled, matching the day card's Search convention (#128 decision 7) —
 *  there's no coordinate to fly to. */
function PanelStopRow({
  loc, dayNumber, index, onFocus,
}: {
  loc: Location;
  dayNumber: number;
  index: number;
  onFocus: (target: FocusTarget) => void;
}) {
  const geocoded = loc.lat !== null && loc.lng !== null;
  return (
    <button
      disabled={!geocoded}
      onClick={() => onFocus({ tier: "stop", locationId: loc.id })}
      title={geocoded ? `Zoom to ${loc.name}` : "No coordinates — run Enrich first"}
      className="group w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-surface-2 disabled:cursor-not-allowed"
    >
      <span
        className="w-5 h-5 grid place-items-center rounded-full text-[10px] font-semibold shrink-0"
        style={
          geocoded
            ? { background: dayColorCss(dayNumber), color: dayTextColor(dayNumber) }
            : { border: "1px dashed var(--border-strong)", color: "var(--faint)" }
        }
      >
        {index + 1}
      </span>
      <span className={`text-xs truncate flex-1 ${geocoded ? "text-sub group-hover:text-ink" : "text-faint"}`}>
        {loc.name}
      </span>
      {geocoded && (
        <Crosshair className="w-3.5 h-3.5 shrink-0 text-faint opacity-0 group-hover:opacity-100 group-hover:text-brand-500 dark:group-hover:text-brand-400 transition-opacity" />
      )}
    </button>
  );
}

/** An Anchor bookend — a Lodging (the surviving "gray dot = lodging" key from the old legend) or,
 *  per ADR-0028, a trip-edge Transit Location — attached to the actual place rather than floating
 *  over the canvas. Both share the neutral dot; a Transit edge additionally carries the icon
 *  already used for it in the Manifest, since the map's circle layer has no room for a second
 *  distinct marker shape without a symbol layer this style doesn't load. */
function PanelAnchorRow({
  loc, label, onFocus,
}: {
  loc: Location;
  label: string;
  onFocus: (target: FocusTarget) => void;
}) {
  const geocoded = loc.lat !== null && loc.lng !== null;
  const isEdge = loc.kind === "transit";
  return (
    <button
      disabled={!geocoded}
      onClick={() => onFocus({ tier: "stop", locationId: loc.id })}
      title={geocoded ? `Zoom to ${loc.name}` : "No coordinates — run Enrich first"}
      className="group w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-surface-2 disabled:cursor-not-allowed"
    >
      <span
        className="w-5 h-5 rounded-full shrink-0 border-2 grid place-items-center"
        style={{ background: LODGING_COLOR, borderColor: "#374151" }}
      >
        {isEdge && <TrainFront className="w-3 h-3 text-gray-700" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs truncate text-sub group-hover:text-ink">{loc.name}</span>
        <span className="block text-meta text-faint">{label}</span>
      </span>
    </button>
  );
}
