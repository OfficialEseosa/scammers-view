"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GMAIL_PROMISE, GmailButton, ReportedBox } from "@/features/check";
import { BrandMark } from "@/design/BrandMark";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { LoadingDots } from "@/design/LoadingDots";
import { ThemeToggle } from "@/design/ThemeToggle";
import { DotField, Grain } from "@/design/backgrounds";
import { EmptyState, ErrorState } from "@/design/states";
import { cn } from "@/design/utils";
import type { EmailVerdict, InboxResults } from "@/lib/gmail/store";

const ERRORS: Record<string, string> = {
  setup: "Gmail checks aren't set up on this server yet.",
  signin: "Sign in with Google first, then check your Gmail.",
  busy: "That's a lot of checks in a short time. Try again in a little while.",
  expired: "That took too long, or didn't start here. Start again.",
  denied: "Gmail access wasn't allowed, so nothing was read.",
  account: "That Gmail account isn't the one you signed in with. Only your own email can be checked, and nothing was read.",
  gmail: "Couldn't reach Gmail. Nothing was kept. Try again in a minute.",
};

// Kept in this tab only (gone when it closes); the server deletes its copy when it sends it.
const SAVED = "sv-inbox-results";
const POLL_MS = 1500;

type View =
  | { status: "loading" }
  | { status: "working" }
  | { status: "none" }
  | { status: "error"; message: string }
  | { status: "done"; results: InboxResults };

function readSaved(): InboxResults | null {
  try {
    const raw = sessionStorage.getItem(SAVED);
    return raw ? (JSON.parse(raw) as InboxResults) : null;
  } catch {
    return null;
  }
}

async function poll(): Promise<View> {
  const saved = readSaved();
  if (saved) return { status: "done", results: saved };
  try {
    const res = await fetch("/api/gmail/results", { method: "POST" });
    const data = (await res.json()) as { status: string; message?: string; results?: InboxResults };
    if (data.status === "done" && data.results) {
      try {
        sessionStorage.setItem(SAVED, JSON.stringify(data.results));
      } catch {
        /* still shown, just not kept across a reload */
      }
      return { status: "done", results: data.results };
    }
    if (data.status === "working") return { status: "working" };
    if (data.status === "error") return { status: "error", message: data.message ?? "The check didn't finish." };
    return { status: "none" };
  } catch {
    return { status: "error", message: "Couldn't reach the server." };
  }
}

const LEVEL: Record<EmailVerdict["level"], { label: string; className: string }> = {
  high: { label: "Several warning signs", className: "border-danger text-danger-fg" },
  some: { label: "Some warning signs", className: "border-warn text-warn-fg" },
  low: { label: "Nothing obvious", className: "border-edge-strong text-muted" },
};

export function InboxCheckScreen({ signedIn, configured, error }: { signedIn: boolean; configured: boolean; error?: string }) {
  const [view, setView] = useState<View>({ status: "loading" });

  useEffect(() => {
    if (error || !signedIn) return;
    let stop = false;
    let timer = 0;
    const tick = () =>
      void poll().then((next) => {
        if (stop) return;
        setView(next);
        if (next.status === "working") timer = window.setTimeout(tick, POLL_MS);
      });
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [error, signedIn]);

  function forget() {
    try {
      sessionStorage.removeItem(SAVED);
    } catch {
      /* nothing saved */
    }
    void fetch("/api/gmail/results", { method: "DELETE" }).catch(() => {});
    setView({ status: "none" });
  }

  return (
    <div className="relative isolate flex flex-1 flex-col">
      <Grain />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotField gap={26} fade="radial" />
      </div>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
        <BrandMark size={30} />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 pb-16 sm:px-8">
        <header className="flex flex-col gap-3">
          <h1 className="sv-display text-[clamp(2rem,4.4vw,3rem)] leading-[1]">Your Gmail check</h1>
          <p className="max-w-[60ch] text-muted">{GMAIL_PROMISE}</p>
        </header>

        {error ? (
          <ErrorState
            title={ERRORS[error] ?? "The Gmail check didn't run."}
            action={signedIn && configured && error !== "setup" ? <GmailButton /> : <Link href={signedIn ? "/check" : "/"} className="underline underline-offset-4">Back</Link>}
          />
        ) : !signedIn ? (
          <EmptyState action={<Link href="/" className="text-fg underline underline-offset-4">Sign in</Link>}>{ERRORS.signin}</EmptyState>
        ) : view.status === "loading" || view.status === "working" ? (
          <Card className="flex flex-col gap-2" role="status">
            <p className="font-display text-lg font-semibold">
              Reading and checking your emails
              <LoadingDots />
            </p>
            <p className="text-muted">This takes about 20 seconds. Access to your Gmail is given up as soon as it&apos;s done.</p>
          </Card>
        ) : view.status === "error" ? (
          <ErrorState title={view.message} action={configured ? <GmailButton /> : undefined} />
        ) : view.status === "none" ? (
          <EmptyState action={configured ? <GmailButton variant="primary" /> : undefined}>
            {configured ? "No results here. They're deleted after you see them, or after 10 minutes." : ERRORS.setup}
          </EmptyState>
        ) : (
          <Results results={view.results} onForget={forget} />
        )}

        <p className="border-t border-edge pt-8 text-muted">
          Got something else, like a text or a DM?{" "}
          <Link href="/check" className="text-fg underline underline-offset-4">
            Check a message
          </Link>
        </p>
      </main>
    </div>
  );
}

function Results({ results, onForget }: { results: InboxResults; onForget: () => void }) {
  const risky = results.inbox.filter((e) => e.level !== "low");
  const calm = results.inbox.length - risky.length;
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">
          {results.revoked ? "Gmail access given up. " : "Couldn't confirm Gmail access was removed; it expires within an hour. "}
          The email text was not kept.
        </p>
        <Button variant="destructive" size="sm" className="ml-auto" onClick={onForget}>
          Forget these results
        </Button>
      </div>

      <section aria-labelledby="inbox-h" className="flex flex-col gap-4">
        <h2 id="inbox-h" className="font-display text-2xl font-semibold">
          Inbox: {risky.length === 0 ? "nothing risky" : `${risky.length} to look at`}
        </h2>
        {risky.length === 0 && (
          <p className="text-muted">None of your last {results.inbox.length} inbox emails had scam warning signs. Still check any email that asks for money, codes or a login.</p>
        )}
        {risky.map((e) => (
          <EmailCard key={e.id} email={e} />
        ))}
        {risky.length > 0 && calm > 0 && <p className="text-sm text-muted">{calm} other inbox emails had no obvious warning signs.</p>}
      </section>

      <section aria-labelledby="spam-h" className="flex flex-col gap-4">
        <h2 id="spam-h" className="font-display text-2xl font-semibold">Gmail caught these</h2>
        <p className="text-muted">These went to spam. Here&apos;s what gave them away, so you can spot the next one that gets through.</p>
        {results.spam.length === 0 && <p className="text-muted">Your spam folder is empty.</p>}
        {results.spam.map((e) => (
          <EmailCard key={e.id} email={e} lesson />
        ))}
      </section>
    </div>
  );
}

function EmailCard({ email, lesson }: { email: EmailVerdict; lesson?: boolean }) {
  const level = LEVEL[email.level];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold">{email.subject}</p>
          <p className="break-words text-sm text-muted">{email.from}</p>
        </div>
        {(!lesson || email.level !== "low") && (
          <span className={cn("shrink-0 rounded-full border px-3 py-1 text-sm font-semibold", level.className)}>{level.label}</span>
        )}
      </div>
      {email.signs.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {email.signs.map((s) => (
            <li key={s}>• {s}</li>
          ))}
        </ul>
      ) : (
        lesson && <p className="text-sm text-muted">No warning signs in the words. Gmail likely caught the sender or its links.</p>
      )}
      <ReportedBox reported={email.reported} />
      {email.match && (
        <p className="text-sm">
          <span className="text-muted">Looks like: </span>
          <span className="font-medium">{email.match.name}</span>
          {!lesson && (
            <>
              <br />
              <span className="font-semibold">What to do: </span>
              {email.match.action}
            </>
          )}
        </p>
      )}
    </Card>
  );
}
