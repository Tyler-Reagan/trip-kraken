import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, isValidSession } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  // The gate protects the app from strangers on the open internet (ADR-0037) — on your own
  // machine there's no one to gate out. `VERCEL` is set on every Vercel deployment (Preview and
  // Production alike) and unset everywhere else, so this is "not running on Vercel," not "NODE_ENV
  // is dev" — a local production build (`pnpm build && pnpm start`) skips the gate too.
  if (!process.env.VERCEL) {
    return NextResponse.next();
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
