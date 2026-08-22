"use client";

/** #139 PROTOTYPE — throwaway. Floating variant switcher, dev-only. Delete alongside
 * `PathShiftRows.prototype.tsx` once a variant is picked (or folded into the real implementation). */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ShiftVariant } from "./PathShiftRows.prototype";

const VARIANTS: { key: ShiftVariant; name: string }[] = [
  { key: "A", name: "Skeleton batch — whole gap placeholders, then all rows at once" },
  { key: "B", name: "Pop-in — no placeholder, rows appear the moment they resolve" },
  { key: "C", name: "Collapsed summary — long chains start collapsed, expand on click" },
];

export function useShiftVariant(): ShiftVariant {
  const params = useSearchParams();
  const v = params.get("variant");
  return v === "B" || v === "C" ? v : "A";
}

export function PrototypeSwitcher() {
  const router = useRouter();
  const params = useSearchParams();
  const current = useShiftVariant();
  const idx = VARIANTS.findIndex((v) => v.key === current);

  const go = (delta: number) => {
    const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length];
    const sp = new URLSearchParams(params.toString());
    sp.set("variant", next.key);
    router.replace(`?${sp.toString()}`);
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const variant = VARIANTS[idx];

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 rounded-full bg-black text-white px-3 py-2 shadow-2xl ring-2 ring-amber-400 text-xs">
      <button onClick={() => go(-1)} aria-label="Previous variant" className="p-1 hover:bg-white/20 rounded-full">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="font-mono font-semibold">{variant.key}</span>
      <span className="max-w-[280px] truncate">{variant.name}</span>
      <button onClick={() => go(1)} aria-label="Next variant" className="p-1 hover:bg-white/20 rounded-full">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
