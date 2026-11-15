import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ConsentForm } from "@/components/ConsentForm";
import { getScanSubject } from "@/lib/auth/subject";
import { grantConsent, leave } from "@/app/actions";
import { Icon3D, type Icon3DName } from "@/design/Icon3D";
import { ThemeToggle } from "@/design/ThemeToggle";
import { DotField, Grain } from "@/design/backgrounds";

export const metadata = { title: "Before we scan - Scammer's View" };

const searched: { icon: Icon3DName; label: string }[] = [
  { icon: "compass", label: "Web search" },
  { icon: "computer", label: "Public profiles" },
  { icon: "file", label: "School and club pages" },
  { icon: "bell", label: "News" },
  { icon: "folder", label: "Data brokers" },
];

export default function ConsentPage() {
  return (
    <div className="relative isolate flex flex-1 flex-col">
      <Grain />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotField gap={26} fade="radial" />
      </div>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-8">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-6 sm:px-8 sm:pt-12">
        <Suspense fallback={<div className="sv-skeleton mt-10 h-96 rounded-card" aria-hidden="true" />}>
          <ConsentBody />
        </Suspense>
      </main>
    </div>
  );
}

async function ConsentBody() {
  await connection();
  const subject = await getScanSubject();
  if (!subject) redirect("/");

  return (
    <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
      <div>
        <h1 className="sv-display text-[clamp(2.4rem,6vw,4.75rem)] leading-[0.95]">Before we look</h1>
        <div className="mt-10">
          <ConsentForm
            action={grantConsent}
            items={[
              <span key="who">
                Scan <strong className="font-semibold">{subject.name}</strong>, the account I&apos;m signed in with
              </span>,
              <span key="public">Public sources only. No logins to my accounts</span>,
              <span key="kept">Nothing is sent to anyone. Results stay on this device and are deleted when I end the session</span>,
            ]}
          />
        </div>
        <form action={leave} className="mt-6">
          <button type="submit" className="min-h-11 text-muted underline underline-offset-4 hover:text-fg">
            Not you? Sign out
          </button>
        </form>
      </div>

      <aside aria-labelledby="searched-h" className="self-start lg:pt-3">
        <h2 id="searched-h" className="font-display text-xl font-semibold">
          Where we look
        </h2>
        <ul className="sv-card mt-4 divide-y divide-edge overflow-hidden bg-canvas/80 backdrop-blur-sm">
          {searched.map((s) => (
            <li key={s.label} className="sv-icon-host flex min-h-[4.25rem] items-center gap-4 px-4 text-lg">
              <Icon3D name={s.icon} size={44} motion="hover" />
              <span className="font-medium">{s.label}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
