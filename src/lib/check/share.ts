import { MAX_CHECK_CHARS } from "./shared";

/** Biggest screenshot we read; phone screenshots are usually 0.5 to 3 MB. */
export const MAX_SHOT_BYTES = 6 * 1024 * 1024;

export interface ShareInput {
  text: string;
  shot?: File;
}

/**
 * Android's share sheet sends title, text and url as separate fields, and apps fill them
 * inconsistently (a link can arrive in `text`, a subject in `title`). Join them once each.
 */
export function readShareForm(form: FormData): ShareInput {
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const parts: string[] = [];
  for (const v of [field("title"), field("text"), field("url")]) {
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  const text = parts.join("\n").slice(0, MAX_CHECK_CHARS);

  const file = form.getAll("shot").find((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  const shot = file && file.type.startsWith("image/") && file.size > 0 && file.size <= MAX_SHOT_BYTES ? file : undefined;
  return { text, shot };
}
