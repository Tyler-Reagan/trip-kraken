import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, sessionToken, verifyPassword } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!(await verifyPassword(password))) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=1`);
  }

  (await cookies()).set(COOKIE_NAME, await sessionToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";
  const failed = params.error === "1";

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 pt-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-xl font-semibold text-ink">Trip Kraken</h1>
        <p className="text-sm text-sub">
          This trip planner is private. Enter the password to continue.
        </p>
      </div>
      <form action={login} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none"
        />
        {failed && (
          <p className="text-sm text-danger-600 dark:text-danger-400">
            Wrong password.
          </p>
        )}
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
