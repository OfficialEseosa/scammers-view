import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "../BrandMark";
import { ThemeToggle } from "../ThemeToggle";
import { DotField, Grain } from "../backgrounds";
import { Hero } from "./Hero";
import { ChainDemo } from "./ChainDemo";
import { ScrollFx } from "./ScrollFx";
import { Compare, FeatureStrip, FinalCta, SectionHead, StatBand } from "./Sections";

/**
 * The landing page. `cta` is the sign-in block (server-rendered by the page),
 * `endCta` the closing button. Each section is roughly one screen on desktop;
 * scroll choreography lives in ./landing.css.
 */
export function Landing({ cta, endCta }: { cta: ReactNode; endCta: ReactNode }) {
  return (
    <div className="relative isolate flex flex-1 flex-col">
      <ScrollFx />
      <Grain />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotField gap={28} fade="radial" />
      </div>
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <BrandMark size={30} />
        <nav aria-label="Page" className="flex items-center gap-2 sm:gap-6">
          <Link href="#how" className="text-muted hover:text-fg max-sm:hidden">
            How it works
          </Link>
          <Link href="#compare" className="text-muted hover:text-fg max-md:hidden">
            Compare
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main id="top" className="relative flex flex-1 flex-col">
        <Hero cta={cta} />

        <section
          id="how"
          aria-label="How a scammer chains it"
          className="mx-auto flex w-full max-w-7xl scroll-mt-8 flex-col justify-center px-4 py-16 sm:px-8 sm:py-24 lg:min-h-svh"
        >
          <SectionHead>Three posts. One account.</SectionHead>
          <ChainDemo />
        </section>

        <StatBand />
        <FeatureStrip />
        <section id="compare" aria-label="Compare" className="scroll-mt-8">
          <Compare />
        </section>
        <FinalCta cta={endCta} />
      </main>

      <footer className="relative border-t border-edge bg-canvas">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-8">
          <BrandMark size={30} />
          <span>Every example on this page is fictional.</span>
        </div>
      </footer>
    </div>
  );
}
