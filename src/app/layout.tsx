import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

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
    <html lang="en">
      <body className={inter.className}>
        <nav className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
            <a href="/" className="flex items-center gap-2 font-bold text-lg text-brand-700">
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
