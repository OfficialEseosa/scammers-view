import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getScanSubject } from "@/lib/auth/subject";
import { isAdmin, killSwitchConfigured, readKill } from "@/lib/admin/killSwitch";
import { KillPanel } from "./KillPanel";

export const metadata = { title: "Owner controls - Scammer's View", robots: { index: false } };

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16 sm:px-8">
      <Suspense fallback={<div className="sv-skeleton h-72 rounded-card" aria-hidden="true" />}>
        <Body />
      </Suspense>
    </main>
  );
}

async function Body() {
  await connection();
  const subject = await getScanSubject();
  // Anyone but the owner gets a plain 404: the page does not admit it exists.
  if (!subject || !isAdmin(subject.email)) notFound();
  const state = await readKill(true);
  return <KillPanel initialOn={state.on} initialAt={state.at ?? null} configured={killSwitchConfigured()} env={process.env.VERCEL_ENV ?? "local"} />;
}
