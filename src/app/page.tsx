import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { GoogleMark } from "@/components/GoogleMark";
import { googleConfigured } from "@/lib/auth/config";
import { getDevSubject, getSessionSubject } from "@/lib/auth/subject";
import { leave, signInWithGoogle } from "@/app/actions";
import { Landing } from "@/design/landing/Landing";
import { buttonClass } from "@/design/Button";

export default function Home() {
  return (
    <Landing
      cta={
        <Suspense fallback={<div className="sv-skeleton h-14 w-72 rounded-control" aria-hidden="true" />}>
          <SignInPanel />
        </Suspense>
      }
      endCta={
        <Link href="#top" className="sv-press inline-flex min-h-14 items-center rounded-control bg-[var(--on-accent)] px-7 text-lg font-semibold text-[var(--accent)] hover:opacity-90">
          Scan me
        </Link>
      }
    />
  );
}

async function SignInPanel() {
  await connection();
  const session = await getSessionSubject();
  const dev = getDevSubject();

  if (session) {
    return (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link href="/consent" className={buttonClass("primary", "lg", "max-w-full whitespace-normal py-2 text-left")}>
          Continue as {session.name}
        </Link>
        <form action={leave}>
          <button type="submit" className="min-h-11 text-muted underline underline-offset-4 hover:text-fg">
            Not you? Sign out
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {googleConfigured ? (
        <form action={signInWithGoogle}>
          <button type="submit" className={buttonClass("primary", "lg")}>
            <GoogleMark />
            Sign in with Google
          </button>
        </form>
      ) : dev ? null : (
        <p className="rounded-control border border-edge px-4 py-3 text-muted">Google sign-in isn&apos;t configured.</p>
      )}
      {dev && (
        <Link href="/consent" className={buttonClass(googleConfigured ? "secondary" : "primary", "lg", "max-w-full whitespace-normal py-2 text-left")}>
          Scan me as {dev.name}
          <span className="rounded-chip border border-current px-1.5 py-0.5 text-sm font-medium opacity-70">Dev</span>
        </Link>
      )}
    </div>
  );
}
