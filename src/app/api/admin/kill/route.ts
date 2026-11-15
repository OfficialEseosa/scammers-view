import { NextResponse } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import { isAdmin, killSwitchConfigured, readKill, writeKill } from "@/lib/admin/killSwitch";

const noStore = { "Cache-Control": "no-store" };

async function admin() {
  const subject = await getScanSubject();
  return subject && isAdmin(subject.email) ? subject : null;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  return NextResponse.json({ configured: killSwitchConfigured(), ...(await readKill(true)) }, { headers: noStore });
}

export async function POST(request: Request) {
  const who = await admin();
  if (!who) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const body = (await request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== "boolean") return NextResponse.json({ error: "Send { on: true | false }." }, { status: 400, headers: noStore });
  try {
    return NextResponse.json(await writeKill(body.on, "owner"), { headers: noStore });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save." }, { status: 502, headers: noStore });
  }
}
