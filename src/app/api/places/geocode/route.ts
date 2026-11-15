import { NextResponse } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import { GeocodeRequest, type GeocodedPlace } from "@/lib/places/types";
import { geocodeAll } from "@/lib/places/geocode";

// Node runtime is the default (the `runtime` segment config is incompatible with cacheComponents).

export async function POST(req: Request) {
  if (!(await getScanSubject())) {
    return NextResponse.json({ error: "Sign in to map your places." }, { status: 401 });
  }
  const body = GeocodeRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Send up to 12 { findingId, query, kind } candidates." }, { status: 400 });
  }
  // Google has no 1 request/second rule: resolve in parallel (capped). Nominatim fallbacks still queue at 1/s.
  const results: GeocodedPlace[] = (await geocodeAll(body.data.candidates)).filter((r): r is GeocodedPlace => !!r);
  return NextResponse.json(results);
}
