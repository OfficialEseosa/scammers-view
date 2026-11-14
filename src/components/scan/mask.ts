import type { Finding } from "@/lib/types";

const DOT = "•";

function maskWord(w: string): string {
  if (w.length <= 1) return w;
  return w[0] + DOT.repeat(Math.min(w.length - 1, 6));
}

/** Masks a finding value for projecting, e.g. r•••••@gmail.com, B•••••. */
export function maskValue(value: string, category?: Finding["category"]): string {
  const v = value.trim();
  if (!v) return v;
  const at = v.indexOf("@");
  if (at > 0 && !v.includes(" ")) {
    return maskWord(v.slice(0, at)).padEnd(2, DOT) + v.slice(at);
  }
  if (category === "phone" || /^[+\d][\d\s().-]{6,}$/.test(v)) {
    const digits = v.replace(/\D/g, "");
    return `${DOT.repeat(3)}-${DOT.repeat(3)}-${DOT.repeat(2)}${digits.slice(-2)}`;
  }
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return `${u.hostname}/${DOT.repeat(5)}`;
    } catch {
      /* fall through */
    }
  }
  return v.split(/(\s+)/).map((p) => (/^\s+$/.test(p) ? p : maskWord(p))).join("");
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces any known finding value found inside free text with its masked form. */
export function maskIn(text: string, findings: Finding[], on: boolean): string {
  if (!on) return text;
  let out = text;
  const values = findings
    .filter((f) => f.value.trim().length >= 3)
    .sort((a, b) => b.value.length - a.value.length);
  for (const f of values) {
    out = out.replace(new RegExp(escapeRe(f.value.trim()), "gi"), maskValue(f.value, f.category));
  }
  return out;
}
