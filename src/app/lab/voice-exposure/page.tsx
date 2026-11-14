import { notFound } from "next/navigation";
import { VoiceLab } from "@/features/voice-exposure/lab/VoiceLab";

export const metadata = { title: "Voice exposure lab" };

/** Development harness for the on-device voice match. Public-domain fixture clips only. 404 outside `next dev`. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="mb-8 font-display text-3xl font-semibold">Voice exposure lab</h1>
      <VoiceLab />
    </main>
  );
}
