"use client";

import { RoomPresenter } from "@/features/campus";
import { BrandMark } from "@/design/BrandMark";
import { ThemeToggle } from "@/design/ThemeToggle";
import { DotField, Grain } from "@/design/backgrounds";

export function RoomScreen() {
  return (
    <div className="relative isolate flex flex-1 flex-col">
      <Grain />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotField gap={26} fade="radial" />
      </div>
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
        <BrandMark size={30} />
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 sm:px-8">
        <RoomPresenter />
      </main>
    </div>
  );
}
