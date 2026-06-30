/**
 * The per-day wayfinding palette — the single source of the day colors shared by the
 * map (dots, routes, legend) and the timeline (day headers, filter chips, stop badges)
 * so the two surfaces read as one system. 14 distinct Tailwind 400-level hues; they loop
 * for trips longer than 14 days. Day color answers "which day"; the brand green is
 * reserved for actions and selection, never wayfinding.
 */
export const DAY_COLORS: [number, number, number][] = [
  [251, 191, 36], // amber-400
  [34, 211, 238], // cyan-400
  [163, 230, 53], // lime-400
  [251, 146, 60], // orange-400
  [167, 139, 250], // violet-400
  [248, 113, 113], // red-400
  [52, 211, 153], // emerald-400
  [250, 204, 21], // yellow-400
  [96, 165, 250], // blue-400
  [244, 114, 182], // pink-400
  [45, 212, 191], // teal-400
  [251, 113, 133], // rose-400
  [129, 140, 248], // indigo-400
  [56, 189, 248], // sky-400
];

export function dayColorRgb(dayNumber: number): [number, number, number] {
  return DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
}

export function dayColorCss(dayNumber: number): string {
  const [r, g, b] = dayColorRgb(dayNumber);
  return `rgb(${r}, ${g}, ${b})`;
}

const INK = "#0a0a0a";
const PAPER = "#ffffff";

function relLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Ink or paper, whichever actually contrasts better on the day color — used for the filled
 * stop-number badge so the number stays legible across all 14 hues. A fixed luminance
 * threshold mis-fires on mid-bright hues (white on orange is only 2.3:1); comparing real
 * WCAG contrast picks the winner every time. On this 400-level palette that's ink, ~7–13:1.
 */
export function dayTextColor(dayNumber: number): string {
  const [r, g, b] = dayColorRgb(dayNumber);
  const bg = relLuminance(r, g, b);
  const contrast = (textLum: number) =>
    (Math.max(bg, textLum) + 0.05) / (Math.min(bg, textLum) + 0.05);
  return contrast(relLuminance(10, 10, 10)) >= contrast(1) ? INK : PAPER;
}
