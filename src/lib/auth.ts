/** ADR-0037: a shared-password gate sized for 1-2 known people, not a real user base — no
 *  accounts, no rate limiting, no audit trail. */

export const COOKIE_NAME = "tk_session";

function sitePassword(): string {
  const password = process.env.SITE_PASSWORD;
  if (!password) throw new Error("SITE_PASSWORD is not configured");
  return password;
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// SHA-256 hex digests are always 64 characters, so comparing digests (rather than the raw
// strings) keeps this constant-time without a length check ever short-circuiting it.
function timingSafeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return mismatch === 0;
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    sha256Hex(candidate),
    sha256Hex(sitePassword()),
  ]);
  return timingSafeEqual(a, b);
}

// Derived from the password rather than equal to it, so a leaked cookie doesn't hand over
// the password itself, and rotating SITE_PASSWORD invalidates every existing cookie at once
// (matches how Vercel's own Password Protection behaves on a password change).
export async function sessionToken(): Promise<string> {
  return sha256Hex(`${sitePassword()}:trip-kraken-session`);
}

export async function isValidSession(
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  return timingSafeEqual(token, await sessionToken());
}
