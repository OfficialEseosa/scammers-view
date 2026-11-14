/** Signing secret for room codes. Never log or return it. */
export function campusSecret(): string | null {
  const s = process.env.CAMPUS_CODE_SECRET || process.env.AUTH_SECRET;
  if (s) return s;
  // Dev only: lets the lab work without configuring anything. Never used in production.
  return process.env.NODE_ENV === "development" ? "dev-only-campus-room-secret" : null;
}
