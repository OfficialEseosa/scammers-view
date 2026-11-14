import type { FindingCategory, IdentityAnchor, SourceType } from "@/lib/types";

export const SOURCE_ORDER: SourceType[] = [
  "web",
  "github",
  "linkedin",
  "instagram",
  "x",
  "tiktok",
  "bluesky",
  "school",
  "broker",
  "personal_site",
  "news",
];

export const SOURCE_LABEL: Record<SourceType, string> = {
  web: "Web search",
  github: "GitHub",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
  bluesky: "Bluesky",
  school: "School sites",
  broker: "Data brokers",
  personal_site: "Personal sites",
  news: "News",
  other: "Other sources",
};

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  school: "School",
  employer: "Employer",
  email: "Email",
  phone: "Phone",
  location: "Location",
  relative: "Relative",
  pet: "Pet",
  birthday: "Birthday",
  handle: "Handle",
  photo: "Photo",
  schedule: "Schedule",
  interest: "Interest",
  other: "Other",
  video: "Video",
};

export const ANCHOR_LABEL: Record<IdentityAnchor, string> = {
  email: "Matched by your email",
  github: "Matched by GitHub",
  face: "Matched by your face",
  school: "Matched by your school",
  unconfirmed: "Unconfirmed, may be a namesake",
};

/** Hue 165 (calm) down to 8 (alarming) as exposure rises. */
export function scoreColor(score: number): string {
  const hue = Math.round(165 - (Math.max(0, Math.min(100, score)) / 100) * 157);
  return `hsl(${hue} 85% 62%)`;
}

export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
