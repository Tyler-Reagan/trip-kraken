import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, isValidClientKey, isValidSession } from "@/lib/auth";

const CLIENT_KEY_HEADER = "x-tripkraken-client-key";

// The Swift client's trip-less routes (ADR-0043, ADR-0045) — no cookie-login flow exists for a
// native app to complete, so they authenticate with a static key (isValidClientKey) instead.
const CLIENT_KEY_PATHS = new Set(["/api/optimize", "/api/path-geometry"]);

export async function proxy(req: NextRequest) {
  // The gate protects the app from strangers on the open internet (ADR-0037) — on your own
  // machine there's no one to gate out. `VERCEL` is set on every Vercel deployment (Preview and
  // Production alike) and unset everywhere else, so this is "not running on Vercel," not "NODE_ENV
  // is dev" — a local production build (`pnpm build && pnpm start`) skips the gate too.
  if (!process.env.VERCEL) {
    return NextResponse.next();
  }

  if (CLIENT_KEY_PATHS.has(req.nextUrl.pathname)) {
    if (await isValidClientKey(req.headers.get(CLIENT_KEY_HEADER))) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Missing or invalid client key" }, { status: 401 });
  }

  const session = req.cookies.get(COOKIE_NAME)?.value;
  if (await isValidSession(session)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|apple-icon.png|icon.png|kraken-mascot.png).*)",
  ],
};
