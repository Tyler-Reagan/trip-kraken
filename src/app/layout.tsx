import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// IBM Plex Sans/Mono replace Inter (design-roadmap.md Phase c type scale pass) — Inter reads
// as a generic "AI app" default; Plex Mono is reserved for the Numeral role (times, durations,
// counts, ratings) via the `font-mono` utility so numbers read as engineered/precise.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Trip Kraken",
  description: "Turn a Google Maps list into a fully optimized travel itinerary.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans`}>
        <nav className="border-b border-line bg-canvas">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
            <a href="/" className="flex items-center gap-2 font-bold text-lg text-brand-600 dark:text-brand-400">
              <span className="text-2xl">🐙</span>
              Trip Kraken
            </a>
          </div>
        </nav>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
