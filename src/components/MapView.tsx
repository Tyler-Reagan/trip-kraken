"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useState, useCallback, useRef } from "react";
import Map, { Source, Layer, MapMouseEvent } from "react-map-gl/maplibre";
import type { MapRef, LayerProps } from "react-map-gl/maplibre";
import type { TripWithDetails } from "@/types";
import type { FeatureCollection, LineString, Point } from "geojson";

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

interface MapViewProps {
  trip: TripWithDetails;
  selectedDayNumber: number | null;
  highlightedLocationId: string | null;
  onLocationClick: (locationId: string) => void;
}

type TooltipState = {
  x: number;
  y: number;
  name: string;
  dayNumber: number;
  order: number;
} | null;

function toRgb(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function computeInitialViewState(trip: TripWithDetails) {
  const valid = trip.locations.filter(
    (l) => !l.excluded && l.lat !== null && l.lng !== null
  );
  if (valid.length === 0) return { longitude: 139.69, latitude: 35.69, zoom: 10 };
  if (valid.length === 1) {
    return { longitude: valid[0].lng!, latitude: valid[0].lat!, zoom: 14 };
  }

  const lngs = valid.map((l) => l.lng!);
  const lats = valid.map((l) => l.lat!);
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

export default function MapView({
  trip,
  selectedDayNumber,
  highlightedLocationId,
  onLocationClick,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const initialViewState = useMemo(
    () => computeInitialViewState(trip),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip.id]
  );

  // Build GeoJSON for route lines and stop dots
  const { pointsGeoJSON, routesGeoJSON } = useMemo(() => {
    const points: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
    const routes: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };

    for (const day of trip.days) {
      const rgb = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
      const isActive = selectedDayNumber === null || selectedDayNumber === day.dayNumber;
      const alpha = isActive ? 1 : 0.18;
      const color = toRgb(rgb);

      const geocodedStops = day.stops.filter(
        (s) => s.location.lat !== null && s.location.lng !== null
      );

      for (const stop of geocodedStops) {
        points.features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [stop.location.lng!, stop.location.lat!] },
          properties: {
            locationId: stop.location.id,
            name: stop.location.name,
            dayNumber: day.dayNumber,
            order: stop.order,
            color,
            alpha,
            isHighlighted: stop.location.id === highlightedLocationId,
          },
        });
      }

      if (geocodedStops.length >= 2) {
        routes.features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: geocodedStops.map((s) => [s.location.lng!, s.location.lat!]),
          },
          properties: { color, alpha: isActive ? 0.65 : 0 },
        });
      }
    }

    return { pointsGeoJSON: points, routesGeoJSON: routes };
  }, [trip.days, selectedDayNumber, highlightedLocationId]);

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
      "circle-radius": ["case", ["get", "isHighlighted"], 18, 11],
      "circle-color": ["case", ["get", "isHighlighted"], "#ffffff", ["get", "color"]],
      "circle-opacity": ["get", "alpha"],
      "circle-stroke-width": 2,
      "circle-stroke-color": ["case", ["get", "isHighlighted"], "#16a34a", "rgba(0,0,0,0.3)"],
      "circle-stroke-opacity": ["get", "alpha"],
    },
  };

  const handleClick = useCallback((e: MapMouseEvent) => {
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ["stops"] });
    const f = features?.[0];
    if (f?.properties?.locationId) {
      onLocationClick(f.properties.locationId as string);
    }
  }, [onLocationClick]);

  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ["stops"] });
    const f = features?.[0];
    if (f?.properties) {
      setTooltip({
        x: e.point.x,
        y: e.point.y,
        name: f.properties.name as string,
        dayNumber: f.properties.dayNumber as number,
        order: f.properties.order as number,
      });
    } else {
      setTooltip(null);
    }
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-gray-200" style={{ height: 520 }}>
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

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.85)",
              color: "#fff",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "6px 10px",
              fontFamily: "system-ui,sans-serif",
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <strong>{tooltip.name}</strong>
            <br />
            <span style={{ opacity: 0.7 }}>Day {tooltip.dayNumber} · Stop {tooltip.order + 1}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs rounded-lg px-3 py-2 space-y-1 backdrop-blur-sm pointer-events-none">
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
    </div>
  );
}
