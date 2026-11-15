/** Face box in frame coordinates (0..1 across the raw camera image; values outside mean it is cut off). */
export interface FaceBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type FaceFit = "ok" | "closer" | "back";

const TOO_SMALL = 0.12;
const TOO_WIDE_LANDSCAPE = 0.85;

/**
 * Is the face a usable size before the scan starts?
 * A laptop camera is landscape, so a face that spans most of the width is too close. A phone
 * camera is portrait: a face at arm's length already spans most of the narrow frame, so there
 * only a face that runs off an edge counts as too close.
 */
export function faceFit(box: FaceBox, portrait: boolean): FaceFit {
  const width = box.x1 - box.x0;
  if (width < TOO_SMALL) return "closer";
  const cutOff = box.y0 < 0 || box.y1 > 1 || (portrait && (box.x0 < 0 || box.x1 > 1));
  if (cutOff || (!portrait && width > TOO_WIDE_LANDSCAPE)) return "back";
  return "ok";
}
