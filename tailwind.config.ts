import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        // Accent — decided (design-roadmap.md Phase c, decision #2). One ink/teal family
        // used for CTAs, selection, focus rings, and the kraken mark. 400/500 lean brighter
        // for legibility on dark surfaces; 600/700 lean deeper for legibility on light
        // surfaces — same hue throughout, no second accent color.
        brand: {
          50: "#effbfa",
          100: "#d7f2ef",
          200: "#aee3dd",
          300: "#7dd0c7",
          400: "#57bdb8",
          500: "#3fa5a0",
          600: "#0e6b63",
          700: "#0b554f",
          800: "#08403b",
          900: "#062e2a",
          950: "#041d1a",
        },
        // Danger — decided alongside the accent. Muted brick-red rather than a stock,
        // fully-saturated red, so it stays quiet next to the teal accent instead of
        // shouting (PRODUCT.md: restraint, one confident accent). Same 11-step shape as
        // the `brand` scale so existing shade numbers (danger-600/danger-400/etc.) read
        // consistently.
        danger: {
          50: "#fbeded",
          100: "#f5d8d5",
          200: "#eab6b0",
          300: "#df948c",
          400: "#d6796f",
          500: "#c25a4e",
          600: "#a63e31",
          700: "#832f25",
          800: "#5f241c",
          900: "#421a15",
          950: "#26120f",
        },
        // Semantic surface/text/hairline tokens — resolve to CSS vars in globals.css and
        // flip automatically between light (:root) and dark (.dark).
        canvas: "var(--canvas)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        ink: "var(--ink)",
        sub: "var(--sub)",
        faint: "var(--faint)",
        ghost: "var(--ghost)",
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
