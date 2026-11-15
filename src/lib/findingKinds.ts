import type { Finding } from "@/lib/types";

/**
 * Items that arrive in bulk from one account: each public post, each video,
 * each followed account. They feed the photo, voice and map views, but one
 * row apiece would bury the facts that matter, so lists leave them out and
 * the graph hangs them off a single hub.
 */
export function isBulkItem(f: Finding): boolean {
  if (f.category === "video") return true;
  if (f.category === "connection") return f.value.startsWith("@");
  if (f.category === "photo") return /^public .+ post$/i.test(f.label);
  return false;
}
