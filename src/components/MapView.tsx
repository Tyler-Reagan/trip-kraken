"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import Map, { Source, Layer, MapMouseEvent } from "react-map-gl/maplibre";
import type { MapRef, LayerProps } from "react-map-gl/maplibre";
import type { FeatureCollection, LineString, Point } from "geojson";
import { useTripStore } from "@/store/tripStore";

const CARTO_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * Per-day color palette — 14 distinct colors, Tailwind 400-level approximations.
 * Colors loop for trips with more than 14 days.
 */
const DAY_COLORS: [number, number, number][] = [
  [251, 191, 36],   // amber-400
  [34, 211, 238],   // cyan-400
  [163, 230, 53],   // lime-400
  [251, 146, 60],   // orange-400
  [167, 139, 250],  // violet-400
  [248, 113, 113],  // red-400
  [52, 211, 153],   // emerald-400
  [250, 204, 21],   // yellow-400
  [96, 165, 250],   // blue-400
  [244, 114, 182],  // pink-400
  [45, 212, 191],   // teal-400
  [251, 113, 133],  // rose-400
  [129, 140, 248],  // indigo-400
  [56, 189, 248],   // sky-400
];

type TooltipState = {
  x: number;
  y: number;
  name: string;
  isBase: boolean;
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

export default function MapView() {
  const trip = useTripStore((s) => s.trip);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const highlightedLocationId = useTripStore((s) => s.highlightedLocationId);
  const handleMapLocationClick = useTripStore((s) => s.handleMapLocationClick);
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  // Gate Map mounting until the container has real dimensions.
  // MapLibre reads clientWidth/clientHeight synchronously in its constructor,
  // but React's commit phase runs before the browser's layout pass — the
  // container reports 0×0 and MapLibre's WebGL context never recovers from
  // that. ResizeObserver fires after the first real layout, at which point we
  // flip `mapReady` and let <Map> mount against a properly-sized container.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
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

  // Build GeoJSON for route lines and stop dots
  const { pointsGeoJSON, routesGeoJSON } = useMemo(() => {
    const points: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
    const routes: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };

    // Collect anchor/base locations across all days before rendering points.
    // A base appears in every day as stop 0 — we deduplicate into one feature.
    const anchorMap: Record<string, { locationId: string; name: string; lat: number; lng: number; dayNumbers: number[] }> = {};

    for (const day of (trip?.days ?? [])) {
      const rgb = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
      const isActive = selectedDayNumber === null || selectedDayNumber === day.dayNumber;
      const alpha = isActive ? 1 : 0.18;
      const color = toRgb(rgb);

      const geocodedStops = day.stops.filter(
        (s): s is typeof s & { location: typeof s.location & { lat: number; lng: number } } =>
          s.location.lat !== null && s.location.lng !== null
      );

      // Track non-anchor position within this day for stop numbering.
      let nonAnchorIndex = 0;

      for (const stop of geocodedStops) {
        if (stop.location.isAnchor) {
          // Accumulate day membership; will render as a single base feature below.
          const existing = anchorMap[stop.location.id];
          if (existing) {
            existing.dayNumbers.push(day.dayNumber);
          } else {
            anchorMap[stop.location.id] = {
              locationId: stop.location.id,
              name: stop.location.name,
              lat: stop.location.lat,
              lng: stop.location.lng,
              dayNumbers: [day.dayNumber],
            };
          }
          continue;
        }

        nonAnchorIndex++;
        points.features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [stop.location.lng, stop.location.lat] },
          properties: {
            locationId: stop.location.id,
            name: stop.location.name,
            dayNumber: day.dayNumber,
            order: nonAnchorIndex,
            color,
            alpha,
            isHighlighted: stop.location.id === highlightedLocationId ? 1 : 0,
            isBase: 0,
          },
        });
      }

      if (geocodedStops.length >= 2) {
        routes.features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: geocodedStops.map((s) => [s.location.lng, s.location.lat]),
          },
          properties: { color, alpha: isActive ? 0.65 : 0 },
        });
      }
    }

    // Render each base location as a single neutral-colored feature.
    const BASE_COLOR = "#e5e7eb"; // gray-200
    for (const anchor of Object.values(anchorMap)) {
      const sortedDays = anchor.dayNumbers.slice().sort((a: number, b: number) => a - b);
      const isActive = selectedDayNumber === null || sortedDays.includes(selectedDayNumber);
      points.features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [anchor.lng, anchor.lat] },
        properties: {
          locationId: anchor.locationId,
          name: anchor.name,
          dayNumbers: JSON.stringify(sortedDays),
          color: BASE_COLOR,
          alpha: isActive ? 1 : 0.18,
          isHighlighted: anchor.locationId === highlightedLocationId ? 1 : 0,
          isBase: 1,
        },
      });
    }

    return { pointsGeoJSON: points, routesGeoJSON: routes };
  }, [trip?.days, selectedDayNumber, highlightedLocationId]);

  const routeLayer: LayerProps = {
    id: "routes",
    type: "line",
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": ["get", "alpha"],
      "line-width": 3,
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

  const handleClick = useCallback((e: MapMouseEvent) => {
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ["stops"] });
    const f = features?.[0];
    if (f?.properties?.locationId) {
      handleMapLocationClick(f.properties.locationId as string);
    }
  }, [handleMapLocationClick]);

  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ["stops"] });
    const f = features?.[0];
    if (f?.properties) {
      const isBase = f.properties.isBase === 1;
      setTooltip({
        x: e.point.x,
        y: e.point.y,
        name: f.properties.name as string,
        isBase,
        ...(isBase
          ? { dayNumbers: JSON.parse(f.properties.dayNumbers as string) as number[] }
          : { dayNumber: f.properties.dayNumber as number, order: f.properties.order as number }
        ),
      });
    } else {
      setTooltip(null);
    }
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (!trip) return null;

  return (
    <div ref={containerRef} className="relative w-full h-[520px] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
      {mapReady && (
        <Map
          ref={mapRef}
          initialViewState={initialViewState}
          mapStyle={CARTO_DARK}
          style={{ width: "100%", height: "100%" }}
          interactiveLayerIds={["stops"]}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          cursor={tooltip ? "pointer" : "grab"}
        >
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
              ? <span className="opacity-70">Base · Days {tooltip.dayNumbers!.join(", ")}</span>
              : <span className="opacity-70">Day {tooltip.dayNumber} · Stop {tooltip.order}</span>
            }
          </div>
        </div>
      )}

      {/* Legend */}
      {mapReady && (
        <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs rounded-lg px-3 py-2 space-y-1 backdrop-blur-sm pointer-events-none">
          {trip.locations.some((l) => l.isAnchor && l.lat !== null) && (
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0 border-2"
                style={{ background: "#e5e7eb", borderColor: "#374151" }}
              />
              <span>Base</span>
            </div>
          )}
          {trip.days.map((day) => {
            const [r, g, b] = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
            const isActive = selectedDayNumber === null || selectedDayNumber === day.dayNumber;
            return (
              <div
                key={day.id}
                className={`flex items-center gap-2 transition-opacity ${isActive ? "opacity-100" : "opacity-30"}`}
              >
                <span
                  className="inline-block w-3 h-3 rounded-full shrink-0"
                  style={{ background: `rgb(${r},${g},${b})` }}
                />
                <span>
                  Day {day.dayNumber}
                  {day.label ? ` — ${day.label}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
