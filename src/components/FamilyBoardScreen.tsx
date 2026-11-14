"use client";

import { FamilyBoard } from "@/features/family";
import { BrandMark } from "@/design/BrandMark";
import { ThemeToggle } from "@/design/ThemeToggle";
import { DotField, Grain } from "@/design/backgrounds";

export function FamilyBoardScreen() {
  return (
    <div className="relative isolate flex flex-1 flex-col">
      <Grain />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotField gap={26} fade="radial" />
      </div>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-8">
        <BrandMark size={30} />
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-6 sm:px-8">
        <h1 className="sv-display mb-8 text-[clamp(2.2rem,5vw,3.75rem)] leading-[0.98]">Family board</h1>
        <FamilyBoard />
      </main>
    </div>
  );
}
