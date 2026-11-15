import { Suspense } from "react";
import { connection } from "next/server";
import { CheckScreen } from "@/components/CheckScreen";
import { getScanSubject } from "@/lib/auth/subject";

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
  const subject = await getScanSubject();
  return <CheckScreen signedIn={Boolean(subject)} />;
}
