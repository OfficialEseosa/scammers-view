import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/design/BrandMark";

export const LEGAL_UPDATED = "November 14, 2026";
export const CONTACT_URL = "https://github.com/OfficialEseosa/scammers-view/issues";

/** Shared frame for the privacy policy and the terms. */
export function LegalPage({ title, other, children }: { title: string; other: { href: string; label: string }; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-edge">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <Link href="/" aria-label="Scammer's View home">
            <BrandMark size={30} />
          </Link>
          <Link href={other.href} className="text-sm text-muted underline underline-offset-4 hover:text-fg">
            {other.label}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-14 sm:px-8 sm:py-20">
        <p className="font-mono text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
        <h1 className="sv-display mt-3 text-[clamp(2.4rem,7vw,4.25rem)] leading-[0.95]">{title}</h1>
        <div className="mt-12 flex flex-col gap-12">{children}</div>
      </main>
      <footer className="border-t border-edge">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-8">
          <Link href="/" className="underline underline-offset-4 hover:text-fg">
            Back to Scammer&apos;s View
          </Link>
          <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-fg">
            Contact
          </a>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4 text-lg leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}
