import { NextResponse } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import { GeocodeRequest, type GeocodedPlace } from "@/lib/places/types";
import { geocode } from "@/lib/places/nominatim";

// Node runtime is the default (the `runtime` segment config is incompatible with cacheComponents).

export async function POST(req: Request) {
  if (!(await getScanSubject())) {
    return NextResponse.json({ error: "Sign in to map your places." }, { status: 401 });
  }
  const body = GeocodeRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Send up to 12 { findingId, query, kind } candidates." }, { status: 400 });
  }
  const results: GeocodedPlace[] = [];
  for (const c of body.data.candidates) {
    const r = await geocode(c);
    if (r) results.push(r);
  }
  return NextResponse.json(results);
}
