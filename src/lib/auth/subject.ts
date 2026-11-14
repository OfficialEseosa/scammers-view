import { ScanSubject } from "@/lib/types";
import { auth } from "@/lib/auth/config";

/** Verified signed-in person from the Auth.js session, or null. */
export async function getSessionSubject(): Promise<ScanSubject | null> {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return null;
    const name = session.user?.name?.trim() || email.split("@")[0];
    return { name, email };
  } catch {
    return null;
  }
}

/** Development-only stand-in from DEV_SCAN_SUBJECT. Always null outside `next dev`. */
export function getDevSubject(): ScanSubject | null {
  if (process.env.NODE_ENV !== "development") return null;
  const raw = process.env.DEV_SCAN_SUBJECT;
  if (!raw) return null;
  try {
    const parsed = ScanSubject.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The only identity a scan may target: the signed-in person.
 * Never build a ScanSubject from request input (body, query, headers).
 *
 * Session first; the DEV_SCAN_SUBJECT fallback applies only when
 * NODE_ENV === 'development' and there is no session.
 */
export async function getScanSubject(): Promise<ScanSubject | null> {
  return (await getSessionSubject()) ?? getDevSubject();
}
