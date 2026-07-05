"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import Map, { Source, Layer, MapMouseEvent } from "react-map-gl/maplibre";
import type { MapRef, LayerProps } from "react-map-gl/maplibre";
import type { FeatureCollection, LineString, Point } from "geojson";
import { useTripStore } from "@/store/tripStore";
import { deriveDays, isLodging, type Location } from "@/types";
import { DAY_COLORS } from "@/lib/dayColors";

const CARTO_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

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

export default function MapView({ heightClass = "h-[520px]" }: { heightClass?: string }) {
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

  // Day-clustered plan, projected from placements + lodging dates (ADR-0015).
  const days = useMemo(() => (trip ? deriveDays(trip) : []), [trip]);

  // Build GeoJSON for route lines and stop dots
  const { pointsGeoJSON, routesGeoJSON } = useMemo(() => {
    const points: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
    const routes: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };

    const lodgingMap: Record<string, { locationId: string; name: string; lat: number; lng: number; dayNumbers: number[] }> = {};
    const addLodging = (loc: Location, dayNumber: number) => {
      if (loc.lat === null || loc.lng === null) return;
      const e = lodgingMap[loc.id];
      if (e) { if (!e.dayNumbers.includes(dayNumber)) e.dayNumbers.push(dayNumber); }
      else lodgingMap[loc.id] = { locationId: loc.id, name: loc.name, lat: loc.lat, lng: loc.lng, dayNumbers: [dayNumber] };
    };

    for (const day of days) {
      const rgb = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
      const isActive = selectedDayNumber === null || selectedDayNumber === day.dayNumber;
      const alpha = isActive ? 1 : 0.18;
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

      if (day.startAnchor) addLodging(day.startAnchor, day.dayNumber);
      if (day.endAnchor) addLodging(day.endAnchor, day.dayNumber);

      const routeCoords: [number, number][] = [];
      if (day.startAnchor?.lat != null && day.startAnchor.lng != null) routeCoords.push([day.startAnchor.lng, day.startAnchor.lat]);
      // Check-in waypoint: drop bags at the new lodging on arrival, before the day's stops
      // (same place as the overnight anchor below; ADR-0013 Phase 2).
      if (day.checkInWaypoint?.lat != null && day.checkInWaypoint.lng != null) routeCoords.push([day.checkInWaypoint.lng, day.checkInWaypoint.lat]);
      for (const s of geocodedStops) routeCoords.push([s.location.lng, s.location.lat]);
      if (day.endAnchor?.lat != null && day.endAnchor.lng != null) routeCoords.push([day.endAnchor.lng, day.endAnchor.lat]);

      if (routeCoords.length >= 2) {
        routes.features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: routeCoords },
          properties: { color, alpha: isActive ? 0.65 : 0 },
        });
      }
    }

    // Render each lodging location as a single neutral-colored feature.
    const BASE_COLOR = "#e5e7eb"; // gray-200
    for (const lodging of Object.values(lodgingMap)) {
      const sortedDays = lodging.dayNumbers.slice().sort((a: number, b: number) => a - b);
      const isActive = selectedDayNumber === null || (typeof selectedDayNumber === "number" && sortedDays.includes(selectedDayNumber));
      points.features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lodging.lng, lodging.lat] },
        properties: {
          locationId: lodging.locationId,
          name: lodging.name,
          dayNumbers: JSON.stringify(sortedDays),
          color: BASE_COLOR,
          alpha: isActive ? 1 : 0.18,
          isHighlighted: lodging.locationId === highlightedLocationId ? 1 : 0,
          isBase: 1,
        },
      });
    }

    return { pointsGeoJSON: points, routesGeoJSON: routes };
  }, [days, selectedDayNumber, highlightedLocationId]);

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
        ? { dayNumbers: JSON.parse(f.properties.dayNumbers as string) as number[] }
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
    <div ref={containerRef} className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-line`}>
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
              ? <span className="opacity-70">Lodging · Days {tooltip.dayNumbers!.join(", ")}</span>
              : <span className="opacity-70">Day {tooltip.dayNumber} · Stop {tooltip.order}</span>
            }
          </div>
        </div>
      )}

      {/* Legend */}
      {mapReady && (
        <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs rounded-lg px-3 py-2 space-y-1 backdrop-blur-sm pointer-events-none">
          {trip.locations.some((l) => isLodging(l) && l.lat !== null) && (
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0 border-2"
                style={{ background: "#e5e7eb", borderColor: "#374151" }}
              />
              <span>Lodging</span>
            </div>
          )}
          {days.map((day) => {
            const [r, g, b] = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
            const isActive = selectedDayNumber === null || selectedDayNumber === day.dayNumber;
            return (
              <div
                key={day.date}
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
