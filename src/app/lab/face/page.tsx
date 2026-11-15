import { notFound } from "next/navigation";
import { FaceLab } from "@/features/face/lab/FaceLab";
import { ScanLoader } from "@/features/face/ScanLoader";

export const metadata = { title: "Face lab" };

/** Development harness for liveness + photo matching. 404 outside `next dev`. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="mb-8 font-display text-3xl font-semibold">Face lab</h1>
      <section className="mb-10" aria-label="Loading screen preview">
        <div className="relative flex aspect-[3/4] w-full max-w-md items-center justify-center overflow-hidden rounded-frame border border-edge-strong bg-surface p-8 text-center">
          <ScanLoader step={1} message="Loading the face mesh on this device" />
        </div>
      </section>
      <FaceLab />
    </main>
  );
}
