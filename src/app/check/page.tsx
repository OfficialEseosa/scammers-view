import { Suspense } from "react";
import { connection } from "next/server";
import { CheckScreen } from "@/components/CheckScreen";
import { getScanSubject, getSessionSubject } from "@/lib/auth/subject";
import { gmailConfigured } from "@/lib/gmail/oauth";

export const metadata = { title: "Is this a scam? - Scammer's View" };

/** Public checker: works without sign-in. Messages shared from other apps arrive in the URL fragment. */
export default function CheckPage() {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Getting ready…</p>}>
      <Signed />
    </Suspense>
  );
}

async function Signed() {
  await connection();
  const [subject, session] = await Promise.all([getScanSubject(), getSessionSubject()]);
  // Gmail needs a real Google sign-in, never the development stand-in.
  return <CheckScreen signedIn={Boolean(subject)} gmail={Boolean(session) && gmailConfigured()} />;
}
