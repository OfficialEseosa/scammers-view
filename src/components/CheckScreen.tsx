"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { ScamCheck } from "@/features/check";
import { BrandMark } from "@/design/BrandMark";
import { ThemeToggle } from "@/design/ThemeToggle";
import { DotField, Grain } from "@/design/backgrounds";
import { WarnNote } from "@/design/states";
import { InstallHint } from "@/components/InstallHint";
import { parseSharedHash, type Shared, type ShareNote } from "@/lib/check/shared";

const NOTE: Record<ShareNote, string> = {
  paste: "We couldn't read text from that. Paste the message below instead.",
  limit: "That's a lot of checks in a short time. Try again in a little while.",
  empty: "Nothing came through with that share. Paste the message below.",
};

// Read once per page load: the fragment is cleared right after, so a reload doesn't re-check.
let shared: Shared | null | undefined;
function readShared(): Shared | null {
  if (shared === undefined) shared = parseSharedHash(window.location.hash);
  return shared;
}
const noSubscribe = () => () => {};

export function CheckScreen({ signedIn }: { signedIn: boolean }) {
  const fromShare = useSyncExternalStore(noSubscribe, readShared, () => null);

  useEffect(() => {
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pb-16 sm:px-8">
        <InstallHint />
        {fromShare?.note && <WarnNote>{NOTE[fromShare.note]}</WarnNote>}
        <ScamCheck key={fromShare?.text ?? "blank"} initialText={fromShare?.text} />
        <p className="border-t border-edge pt-8 text-muted">
          Scammers use what they can find about you.{" "}
          <Link href={signedIn ? "/scan" : "/"} className="text-fg underline underline-offset-4">
            See what they can find about you
          </Link>
        </p>
      </main>
    </div>
  );
}
