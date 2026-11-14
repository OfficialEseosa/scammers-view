"use client";

import { useMemo } from "react";
import { Bar, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/design/ui/chart";
import { usePrefersReducedMotion } from "@/design/motion";
import { cn } from "@/design/utils";
import { CLONE_MIN_SEC } from "@/lib/voice-exposure/verify";

const config: ChartConfig = {
  seconds: { label: "Your voice (s)", color: "var(--text)" },
  total: { label: "Running total (s)", color: "var(--text)" },
};

/** Matched seconds per video (bars) and the running total (line) crossing the clone line. */
export function ExposureChart({ points, className }: { points: { name: string; seconds: number }[]; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const data = useMemo(() => {
    const out: { name: string; seconds: number; total: number }[] = [];
    for (const p of points) out.push({ ...p, total: Math.round(((out.at(-1)?.total ?? 0) + p.seconds) * 10) / 10 });
    return out;
  }, [points]);
  const top = Math.max(CLONE_MIN_SEC * 1.4, ...data.map((d) => d.total));
  const crossed = data.length > 0 && data[data.length - 1].total >= CLONE_MIN_SEC;
  return (
    <div className={cn("w-full", className)}>
      <ChartContainer config={config} className="aspect-auto h-48 w-full text-sm" initialDimension={{ width: 320, height: 192 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis domain={[0, Math.ceil(top)]} tickLine={false} axisLine={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ReferenceLine
            y={CLONE_MIN_SEC}
            stroke="var(--danger)"
            strokeDasharray="4 4"
            label={{ value: "Enough to clone", position: "insideTopRight", fill: "var(--muted)", fontSize: 12 }}
          />
          <Bar dataKey="seconds" fill="color-mix(in srgb, var(--text) 30%, transparent)" radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
          <Line type="monotone" dataKey="total" stroke={crossed ? "var(--danger)" : "var(--text)"} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={!reduced} />
        </ComposedChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Seconds of your voice per checked video, with running total</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <th scope="row">Video {d.name}</th>
              <td>{d.seconds} s</td>
              <td>{d.total} s total</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
