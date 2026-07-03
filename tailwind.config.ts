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
      colors: {
        // Accent — still an open decision (#2); placeholder is the existing brand green.
        brand: {
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#052e16",
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
