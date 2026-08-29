import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, isValidSession } from "@/lib/auth";

export async function proxy(req: NextRequest) {
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
