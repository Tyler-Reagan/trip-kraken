"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { WebMercatorViewport } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";
import { luma } from "@luma.gl/core";
import Map from "react-map-gl/maplibre";
import type { TripWithDetails } from "@/types";

// deck.gl v9 defaults to 'best-available' which attempts WebGPU first.
// WebGPU is not yet universally available; when navigator.gpu.requestAdapter()
// returns null the subsequent adapter.limits.maxTextureDimension2D access
// throws. Force WebGL2 so the renderer never reaches that branch.
luma.setDefaultDeviceProps({ type: "webgl" });

const CARTO_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * Per-day color palette — 14 distinct colors, Tailwind 400-level approximations.
 * Colors loop for trips with more than 14 days.
 */
const DAY_COLORS: [number, number, number][] = [
  [251, 191, 36],  // amber-400
  [34, 211, 238],  // cyan-400
  [163, 230, 53],  // lime-400
  [251, 146, 60],  // orange-400
  [167, 139, 250], // violet-400
  [248, 113, 113], // red-400
  [52, 211, 153],  // emerald-400
  [250, 204, 21],  // yellow-400
  [96, 165, 250],  // blue-400
  [244, 114, 182], // pink-400
  [45, 212, 191],  // teal-400
  [251, 113, 133], // rose-400
  [129, 140, 248], // indigo-400
  [56, 189, 248],  // sky-400
];

type ScatterPoint = {
  position: [number, number];
  color: [number, number, number, number];
  locationId: string;
  name: string;
  dayNumber: number;
  order: number;
};

type PathEntry = {
  path: [number, number][];
  color: [number, number, number, number];
  dayNumber: number;
};

interface MapViewProps {
  trip: TripWithDetails;
  selectedDayNumber: number | null;
  highlightedLocationId: string | null;
  onLocationClick: (locationId: string) => void;
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

  try {
    const vp = new WebMercatorViewport({ width: 800, height: 500 });
    const { longitude, latitude, zoom } = vp.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80 }
    );
    return { longitude, latitude, zoom };
  } catch {
    return {
      longitude: (minLng + maxLng) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom: 11,
    };
  }
}

export default function MapView({
  trip,
  selectedDayNumber,
  highlightedLocationId,
  onLocationClick,
}: MapViewProps) {
  // Stable initial viewport — only recomputed when trip ID changes (new import)
  const initialViewState = useMemo(
    () => computeInitialViewState(trip),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip.id]
  );

  const { scatterData, pathData } = useMemo(() => {
    const scatter: ScatterPoint[] = [];
    const paths: PathEntry[] = [];

    for (const day of trip.days) {
      const rgb = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
      const isActive =
        selectedDayNumber === null || selectedDayNumber === day.dayNumber;
      const alpha = isActive ? 220 : 45;

      const geocodedStops = day.stops.filter(
        (s) => s.location.lat !== null && s.location.lng !== null
      );

      for (const stop of geocodedStops) {
        scatter.push({
          position: [stop.location.lng!, stop.location.lat!],
          color: [rgb[0], rgb[1], rgb[2], alpha],
          locationId: stop.location.id,
          name: stop.location.name,
          dayNumber: day.dayNumber,
          order: stop.order,
        });
      }

      if (
        geocodedStops.length >= 2 &&
        (selectedDayNumber === null || selectedDayNumber === day.dayNumber)
      ) {
        paths.push({
          path: geocodedStops.map((s) => [s.location.lng!, s.location.lat!]),
          color: [rgb[0], rgb[1], rgb[2], isActive ? 160 : 0],
          dayNumber: day.dayNumber,
        });
      }
    }

    return { scatterData: scatter, pathData: paths };
  }, [trip.days, selectedDayNumber]);

  const layers = [
    new PathLayer<PathEntry>({
      id: "routes",
      data: pathData,
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: 3,
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
    }),
    new ScatterplotLayer<ScatterPoint>({
      id: "locations",
      data: scatterData,
      getPosition: (d) => d.position,
      getFillColor: (d) =>
        d.locationId === highlightedLocationId
          ? [255, 255, 255, 255]
          : d.color,
      getLineColor: (d) =>
        d.locationId === highlightedLocationId
          ? [22, 163, 74, 255]  // brand-600
          : [0, 0, 0, 80],
      getRadius: (d) =>
        d.locationId === highlightedLocationId ? 18 : 11,
      radiusUnits: "pixels",
      stroked: true,
      lineWidthMinPixels: 2,
      pickable: true,
      updateTriggers: {
        getFillColor: [highlightedLocationId],
        getLineColor: [highlightedLocationId],
        getRadius: [highlightedLocationId],
      },
    }),
  ];

  function getTooltip(info: PickingInfo) {
    const obj = info.object as ScatterPoint | undefined;
    if (!obj) return null;
    return {
      html: `<div style="padding:6px 10px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.4">
        <strong>${obj.name}</strong><br/>
        <span style="opacity:.7">Day ${obj.dayNumber} · Stop ${obj.order + 1}</span>
      </div>`,
      style: {
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.1)",
        padding: "0",
      },
    };
  }

  function handleClick(info: PickingInfo) {
    const obj = info.object as ScatterPoint | undefined;
    if (obj?.locationId) onLocationClick(obj.locationId);
  }

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-gray-200" style={{ height: 520 }}>
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        onClick={handleClick}
        style={{ position: "absolute", inset: "0" }}
      >
        <Map mapStyle={CARTO_DARK} />
      </DeckGL>

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
