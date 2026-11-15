import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PromoStage } from "./PromoStage";
import { Promo3D } from "./Promo3D";

export const metadata = { title: "Promo" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Demo-video clips, 1920x1080. Dev only: open /lab/promo?scene=1..11 and record. */
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense fallback={null}>
      <Scene searchParams={searchParams} />
    </Suspense>
  );
}

async function Scene({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.scene) ? sp.scene[0] : sp.scene;
  const n = Number(raw ?? "1");
  const scene = Number.isInteger(n) && n >= 1 && n <= 11 ? n : 1;
  return scene >= 7 ? <Promo3D scene={scene} /> : <PromoStage scene={scene} />;
}
