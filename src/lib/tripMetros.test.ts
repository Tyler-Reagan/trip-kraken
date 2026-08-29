/**
 * tripMetros address-parsing tests. Standalone: run with `tsx src/lib/tripMetros.test.ts`.
 *
 * Fixtures are real `formattedAddress` values off the Honeymoon trip, kept verbatim — including
 * the chōme long-o and the two different Japanese orderings — because every bug this parsing has
 * had came from an ordering or a glyph that a hand-written fixture would have tidied away.
 */

import assert from "node:assert/strict";
import { localityOf, metroLabel } from "./tripMetros";

const at = (name: string, address: string) => ({ name, address });

// ── metroLabel: the region, not the ward ──
assert.equal(
  metroLabel({
    activities: [
      at(
        "MOMOTARO JEANS OSAKA",
        "1-chōme-12-10 Kitahorie, Nishi Ward, Osaka, 550-0014, Japan",
      ),
    ],
  }),
  "Osaka",
);
assert.equal(
  metroLabel({
    activities: [
      at("Sensō-ji", "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan"),
    ],
  }),
  "Tokyo",
);

// ── localityOf: the unit *below* whatever metroLabel said ──
const locality = (address: string) =>
  localityOf(address, metroLabel({ activities: [at("x", address)] }));

assert.equal(
  locality("1-chōme-12-10 Kitahorie, Nishi Ward, Osaka, 550-0014, Japan"),
  "Nishi Ward",
);
assert.equal(
  locality("2-chōme-5-5 Nakatsu, Kita Ward, Osaka, 531-0071, Japan"),
  "Kita Ward",
);
assert.equal(
  locality("Dotonbori, Chuo Ward, Osaka, 542-0071, Japan"),
  "Chuo Ward",
);
assert.equal(
  locality("1-chōme-1-10 Kaigandōri, Minato Ward, Osaka, 552-0022, Japan"),
  "Minato Ward",
);
assert.equal(
  locality("2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan"),
  "Taito City",
);

// The postal code rides *with* the region here rather than in its own segment, so stripping has to
// happen per-segment before the metro comparison — otherwise "Hokkaido 060-0001" never equals the
// "Hokkaido" metroLabel returned, and the region leaks through as if it were the locality.
assert.equal(
  locality(
    "2 Chome Kita 1 Jonishi, Chuo Ward, Sapporo, Hokkaido 060-0001, Japan",
  ),
  "Sapporo",
  "a metro of Hokkaido leaves Sapporo as the locality, not Chuo Ward",
);

// ── nothing worth printing ──
assert.equal(localityOf(null, "Osaka"), null, "no address, no locality");
assert.equal(
  localityOf("Osaka, Japan", "Osaka"),
  null,
  "nothing survives but the metro itself",
);
assert.equal(
  localityOf("1-chōme-12-10 Kitahorie, Japan", "Osaka"),
  null,
  "a lone street segment is an address, not a locality — never printed as one",
);

console.log("✓ tripMetros.test.ts passed");
