/**
 * The per-day wayfinding palette — the single source of the day colors shared by the
 * map (dots, routes, legend) and the timeline (day headers, filter chips, stop badges)
 * so the two surfaces read as one system. Day color answers "which day"; the brand accent
 * (teal) is reserved for actions/selection and danger (brick-red) for destructive/error
 * state — neither ever appears as wayfinding, so this palette is built as one 14-hue wheel
 * at a fixed HSL(_, 62%, 58%) rather than a grab-bag of Tailwind's mismatched swatches, with
 * two ~30°-wide gaps carved out of the wheel around the accent hue (~178°) and the danger
 * hue (~8°) so no day color can be confused with either. Loops for trips longer than 14 days.
 */
export const DAY_COLORS: [number, number, number][] = [
  [214, 148, 81], // h30  — amber
  [214, 203, 81], // h55  — yellow-olive
  [170, 214, 81], // h80  — lime
  [115, 214, 81], // h105 — green
  [81, 214, 104], // h130 — emerald
  [81, 214, 159], // h155 — spring green
  [81, 181, 214], // h195 — sky blue
  [81, 132, 214], // h217 — blue
  [81, 84, 214], // h239 — indigo
  [128, 81, 214], // h261 — violet
  [177, 81, 214], // h283 — purple
  [214, 81, 203], // h305 — magenta
  [214, 81, 155], // h327 — rose
  [214, 81, 106], // h349 — rose-red
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
