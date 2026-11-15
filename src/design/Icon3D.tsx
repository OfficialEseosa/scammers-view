import { cn } from "./utils";
import type { FindingCategory, SourceType } from "@/lib/types";

/** 3D icons: 3dicons.co "clay" renders, dynamic angle (CC0). Files live in /public/icons3d. */
export const ICON3D = [
  "shield", "lock", "key", "mail", "phone", "pin", "camera", "mic", "compass", "bag", "pet", "gift",
  "person", "chat", "call", "file", "folder", "picture", "computer", "clock", "calendar", "chart",
  "target", "tick", "bell", "link", "wallet", "card", "fire", "flag", "trash", "safe", "briefcase",
] as const;
export type Icon3DName = (typeof ICON3D)[number];

export const CATEGORY_ICON: Record<FindingCategory, Icon3DName> = {
  school: "file",
  employer: "briefcase",
  email: "mail",
  phone: "phone",
  location: "pin",
  relative: "person",
  pet: "pet",
  birthday: "gift",
  handle: "chat",
  photo: "camera",
  schedule: "calendar",
  interest: "flag",
  other: "folder",
  video: "mic",
  connection: "person",
};

export const SOURCE_ICON: Record<SourceType, Icon3DName> = {
  web: "compass",
  github: "computer",
  linkedin: "briefcase",
  instagram: "camera",
  x: "chat",
  bluesky: "chat",
  tiktok: "picture",
  school: "file",
  broker: "folder",
  personal_site: "link",
  news: "bell",
  other: "folder",
};

/**
 * One 3D icon. Decorative by default (alt=""), pass `alt` when it carries meaning on its own.
 * `motion`: "float" bobs gently (paused for reduced motion); "hover" tilts when its
 * `.sv-icon-host` ancestor is hovered.
 */
export function Icon3D({
  name,
  size = 48,
  alt = "",
  className,
  motion,
  priority,
}: {
  name: Icon3DName;
  size?: number;
  alt?: string;
  className?: string;
  motion?: "float" | "hover";
  priority?: boolean;
}) {
  const src = `/icons3d/${name}-${size > 96 ? 384 : 160}.webp`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static WebP, sized explicitly
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cn("sv-icon3d inline-block shrink-0 select-none", motion === "float" && "sv-float", className)}
      style={{ width: size, height: size }}
    />
  );
}
