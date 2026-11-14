import { Suspense } from "react";
import { connection } from "next/server";
import { InboxCheckScreen } from "@/components/InboxCheckScreen";
import { getSessionSubject } from "@/lib/auth/subject";
import { gmailConfigured } from "@/lib/gmail/oauth";

export const metadata = { title: "Your Gmail check - Scammer's View" };

/** Results of the one-time Gmail check. The results themselves are fetched (and deleted) by the client. */
export default function InboxCheckPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Getting ready…</p>}>
      <Signed searchParams={searchParams} />
    </Suspense>
  );
}

async function Signed({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const [{ error }, subject] = await Promise.all([searchParams, getSessionSubject()]);
  return <InboxCheckScreen signedIn={Boolean(subject)} configured={gmailConfigured()} error={typeof error === "string" ? error : undefined} />;
}
