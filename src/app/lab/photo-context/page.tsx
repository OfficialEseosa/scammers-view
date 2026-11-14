import { notFound } from "next/navigation";
import { PhotoContextLab } from "@/features/photo-context/lab/PhotoContextLab";

export const metadata = { title: "Photo and video reading lab" };

/** Development harness for Gemini photo and video reading. CC0 / fictional samples only. 404 outside `next dev`. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="mb-8 font-display text-3xl font-semibold">Photo and video reading lab</h1>
      <PhotoContextLab />
    </main>
  );
}
