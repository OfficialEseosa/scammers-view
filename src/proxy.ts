import { NextResponse, type NextRequest } from "next/server";
import { readKill } from "@/lib/admin/killSwitch";

/**
 * Kill switch gate. While the owner has it on, pages show the unavailable
 * screen and API routes answer 503. The admin screen and sign-in stay
 * reachable so the owner can turn it back off.
 */
const OPEN = ["/killed", "/admin", "/api/admin", "/api/auth"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const { on } = await readKill();
  if (!on) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Scammer's View is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/killed";
  url.search = "";
  return NextResponse.rewrite(url, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // Everything except build assets and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|icons3d/|brand/|icons/|models/|fixtures/).*)"],
};
