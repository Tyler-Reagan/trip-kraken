/**
 * Booking-confirmation parser (ADR-0013 Phase 2 / ADR-0010, #57). A reservation maps field-for-
 * field onto a date Stay: property → Lodging, check-in/out date → checkInDate/checkOutDate
 * (ADR-0014). This is a *heuristic* text parser for pasted confirmations — it reads labelled
 * check-in/out dates (falling back to the first two dates found) and a labelled property name,
 * and reports clearly when it can't, rather than guessing silently.
 */

export type ParsedBooking = { property: string; checkInDate: string; checkOutDate: string };
export type ParseResult = { ok: true; booking: ParsedBooking } | { ok: false; error: string };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Parse the first date in `s` to "YYYY-MM-DD": ISO, "Aug 3, 2026", or "3 August 2026". */
function parseDate(s: string): string | null {
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`;
  }

  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`;
  }
  return null;
}

/** The date on the first line matching `label`, if any. */
function labelledDate(lines: string[], label: RegExp): string | null {
  for (const line of lines) {
    if (label.test(line)) {
      const d = parseDate(line);
      if (d) return d;
    }
  }
  return null;
}

/** Every parseable date in document order (for the unlabelled fallback). */
function allDates(lines: string[]): string[] {
  return lines.map(parseDate).filter((d): d is string => d !== null);
}

const tidy = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.,;]+$/, "");

function findProperty(text: string): string | null {
  const m =
    text.match(/(?:property|hotel|accommodation|lodging)\s*[:\-]\s*(.+)/i) ??
    text.match(/(?:your stay at|staying at|booking (?:at|for))\s+(.+)/i);
  return m ? tidy(m[1]) : null;
}

export function parseBookingConfirmation(text: string): ParseResult {
  const lines = text.split("\n");

  let checkInDate = labelledDate(lines, /check[\s-]*in|arrival/i);
  let checkOutDate = labelledDate(lines, /check[\s-]*out|departure/i);
  if (!checkInDate || !checkOutDate) {
    // Fallback: no clear labels — take the first two dates as in/out, in document order.
    const dates = allDates(lines);
    checkInDate ??= dates[0] ?? null;
    checkOutDate ??= dates[1] ?? null;
  }

  const property = findProperty(text);

  if (!checkInDate || !checkOutDate) {
    return { ok: false, error: "Couldn't find a check-in and check-out date in that confirmation." };
  }
  if (checkInDate >= checkOutDate) {
    return { ok: false, error: "Check-in date must be before check-out date." };
  }
  if (!property) {
    return { ok: false, error: "Couldn't find the property name. Add a line like \"Property: <name>\"." };
  }
  return { ok: true, booking: { property, checkInDate, checkOutDate } };
}
