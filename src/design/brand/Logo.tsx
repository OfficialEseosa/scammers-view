import type { CSSProperties, ReactNode } from "react";

/*
 * Scammer's View mark: a hooded figure seen from across the table, sitting
 * behind an open laptop whose lid back faces the viewer. Where the laptop
 * brand would be: a horned devil head. The eyes are covered by a redaction bar.
 *
 * All geometry lives on a 64-unit grid and is drawn in a single colour
 * (currentColor). Holes are made with fill-rule="evenodd", so whatever sits
 * behind the mark (page, tile) shows through the face and the devil head.
 */

/**
 * Scale a path made only of absolute M/L/C/Z commands about (cx, cy).
 * Used to derive the small-size devil from the same drawing.
 */
function scalePath(d: string, cx: number, cy: number, k: number, dx = 0, dy = 0): string {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (n) => {
    const v = parseFloat(n);
    const out = i % 2 === 0 ? cx + (v - cx) * k + dx : cy + (v - cy) * k + dy;
    i++;
    return String(Math.round(out * 100) / 100);
  });
}

/**
 * Hooded figure: pointed hood, narrowing at the neck, shoulders sloping out
 * and down past the laptop. The lower edge follows the lid outline with a
 * 2-unit gap, so the lid reads as sitting in front of the body.
 * The face opening is punched out (evenodd).
 */
export const HOOD =
  "M32 3C41 6.5 47 13 47 21C47 25.5 45 28.8 41.5 31.2" +
  "C48.5 32.6 56.5 35.5 59.5 42.5L60.5 52H55.9L52.9 35H11.1L8.1 52H3.5L4.5 42.5" +
  "C7.5 35.5 15.5 32.6 22.5 31.2C19 28.8 17 25.5 17 21C17 13 23 6.5 32 3Z" +
  "M32 10C38 12.5 41 17 41 22.5C41 26.5 37 29.5 32 29.5C27 29.5 23 26.5 23 22.5C23 17 26 12.5 32 10Z";

/** Redaction bar across the eyes, floating inside the face opening. */
export const BAR = "M25 19H39V24H25Z";

/**
 * Open laptop from the far side: lid back (wider toward the viewer) standing
 * on the base, which shows as a slab slightly wider than the lid.
 */
const LAPTOP =
  "M14 37H50C50.9 37 51.6 37.7 51.7 38.6L53.4 54H58.5C59.3 54 60 54.7 60 55.5V56.5C60 57.6 59.1 58.5 58 58.5H6C4.9 58.5 4 57.6 4 56.5V55.5C4 54.7 4.7 54 5.5 54H10.6L12.3 38.6C12.4 37.7 13.1 37 14 37Z";

/** Devil head (horns, pointed chin) as one contour, plus angry eyes. Centred on x = 32. */
const DEVIL =
  "M29 41.4C30.8 40.9 33.2 40.9 35 41.4" +
  "C37.5 41 39.5 39.5 39 36.3C40.8 39.5 40 42.5 37.9 44" +
  "C38.9 47.5 37.5 51 32 54.5" +
  "C26.5 51 25.1 47.5 26.1 44" +
  "C24 42.5 23.2 39.5 25 36.3C24.5 39.5 26.5 41 29 41.4Z";
const DEVIL_EYES = "M26.9 44.6L31.5 46.8L30.8 49.8L27.4 48.4ZM37.1 44.6L32.5 46.8L33.2 49.8L36.6 48.4Z";

/** Laptop with the devil knocked out of the lid (its eyes stay solid). */
export const LID = LAPTOP + scalePath(DEVIL + DEVIL_EYES, 32, 45.4, 0.78, 0, 0.2);

/*
 * Small-size glyph (24 px and below, favicon): the scene becomes a padlock
 * when shrunk, so instead just the lid, filling the canvas, on its base,
 * with the devil knocked out.
 */
export const GLYPH_SMALL =
  "M10 6H54C56.2 6 58 7.8 58 10V49H61C62.1 49 63 49.9 63 51V53C63 55.2 61.2 57 59 57H5C2.8 57 1 55.2 1 53V51C1 49.9 1.9 49 3 49H6V10C6 7.8 7.8 6 10 6Z" +
  scalePath(DEVIL + DEVIL_EYES, 32, 45.4, 1.75, 0, -17.9);

/** Placement inside the 64-unit rounded tile: ~12% padding, optically centred. */
export const TILE_TRANSFORM = "translate(4.5 5.8) scale(0.86)";
export const TILE_TRANSFORM_SMALL = "translate(7 7.2) scale(0.78)";

type LogoMarkProps = {
  /** Rendered width/height in px (or any CSS length). Default 32. */
  size?: number | string;
  className?: string;
  /** Force the simplified geometry. By default it is used when size <= 24. */
  simple?: boolean;
  /** Accessible name. Pass "" to mark the logo as decorative. */
  title?: string;
  style?: CSSProperties;
};

function MarkPaths({ simple }: { simple: boolean }) {
  return simple ? (
    <>
      <path d={GLYPH_SMALL} fillRule="evenodd" />
    </>
  ) : (
    <>
      <path d={HOOD} fillRule="evenodd" />
      <path d={BAR} />
      <path d={LID} fillRule="evenodd" />
    </>
  );
}

function Svg({
  size,
  className,
  title,
  style,
  children,
}: {
  size: number | string;
  className?: string;
  title: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const decorative = title === "";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={style}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** The mark alone, in currentColor on transparent. Inverts with the surrounding text colour. */
export function LogoMark({ size = 32, className, simple, title = "Scammer's View", style }: LogoMarkProps) {
  const useSimple = simple ?? (typeof size === "number" && size <= 24);
  return (
    <Svg size={size} className={className} title={title} style={style}>
      <MarkPaths simple={useSimple} />
    </Svg>
  );
}

type LogoTileProps = {
  /** "black": black tile, white mark. "white": white tile, black mark. */
  variant?: "black" | "white";
  size?: number | string;
  className?: string;
  simple?: boolean;
  title?: string;
};

/** App-icon version: the mark on a solid rounded-square tile. */
export function LogoTile({ variant = "black", size = 64, className, simple, title = "Scammer's View" }: LogoTileProps) {
  const useSimple = simple ?? (typeof size === "number" && size <= 24);
  const tile = variant === "black" ? "#000" : "#fff";
  const ink = variant === "black" ? "#fff" : "#000";
  return (
    <Svg size={size} className={className} title={title}>
      <rect width="64" height="64" rx="14" fill={tile} />
      <g fill={ink} transform={useSimple ? TILE_TRANSFORM_SMALL : TILE_TRANSFORM}>
        <MarkPaths simple={useSimple} />
      </g>
    </Svg>
  );
}

type LogoLockupProps = {
  /** Mark height in px; the wordmark scales with it. Default 32. */
  size?: number;
  className?: string;
  /** Replace the wordmark text (e.g. for a shorter label). */
  children?: ReactNode;
};

/**
 * Horizontal lockup: mark + live-text wordmark. The wordmark inherits
 * font-family and colour from its context, so the design system controls it.
 */
export function LogoLockup({ size = 32, className, children = "Scammer's View" }: LogoLockupProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3, lineHeight: 1, color: "inherit" }}
    >
      <LogoMark size={size} title="" />
      <span style={{ fontSize: size * 0.62, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
        {children}
      </span>
    </span>
  );
}
