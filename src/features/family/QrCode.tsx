"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** Pure client-side QR code as one SVG path. Always black on white: scanners need the contrast. */
export function QrCode({ value, size = 184, label = "QR code" }: { value: string; size?: number; label?: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      let run = -1;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c);
        if (dark && run < 0) run = c;
        if (!dark && run >= 0) {
          d += `M${run} ${r}h${c - run}v1h-${c - run}z`;
          run = -1;
        }
      }
    }
    return { path: d, count: n };
  }, [value]);

  const quiet = 4;
  const box = count + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-control"
      style={{ background: "#ffffff" }}
    >
      <path d={path} fill="#000000" />
    </svg>
  );
}
