import { Suspense } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { getScanSubject } from "@/lib/auth/subject";
import { CONSENT_COOKIE } from "@/lib/auth/consent";

export const metadata = { title: "Your scan - Scammer's View" };

export default function ScanPage({ searchParams }: PageProps<"/scan">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<p className="p-8 text-muted">Getting ready…</p>}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<"/scan">["searchParams"] }) {
  await connection();
  const sp = await searchParams;

  // Fictional demo sequence: no identity, no network, safe without sign-in.
  if (sp.mock === "1") return <ScanScreen name="Alex Rivera" email="alex@example.edu" mock />;

  const subject = await getScanSubject();
  if (!subject) redirect("/");
  if (!(await cookies()).get(CONSENT_COOKIE)) redirect("/consent");

  return <ScanScreen name={subject.name} email={subject.email} mock={false} />;
}
