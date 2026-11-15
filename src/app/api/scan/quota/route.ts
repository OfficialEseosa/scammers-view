import { connection } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import { readQuota } from "@/lib/scan/quota";

/** How many fresh scans the signed-in person has left today. */
export async function GET() {
  await connection();
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await readQuota(subject.email), { headers: { "Cache-Control": "no-store" } });
}
