import type { SourceType } from "@/lib/types";
import type { SourceStatus } from "@/hooks/useScanStream";
import { SOURCE_LABEL, SOURCE_ORDER } from "@/components/scan/meta";

export function SourceTiles({ sources }: { sources: Partial<Record<SourceType, SourceStatus>> }) {
  // Show the standard set, plus any other source the server reports.
  const extra = (Object.keys(sources) as SourceType[]).filter((s) => !SOURCE_ORDER.includes(s));
  const list = [...SOURCE_ORDER, ...extra];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="Sources">
      {list.map((s) => {
        const st = sources[s];
        const state = st?.status ?? "idle";
        return (
          <li
            key={s}
            className={[
              "relative overflow-hidden rounded-xl border px-4 py-3 transition-colors duration-500",
              state === "idle" && "border-line bg-panel/50 text-muted",
              state === "running" && "sv-sweep border-signal/60 bg-panel-2 text-paper",
              state === "done" && "border-line bg-panel-2 text-paper",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={[
                  "size-2.5 shrink-0 rounded-full",
                  state === "idle" && "bg-line",
                  state === "running" && "sv-pulse bg-signal",
                  state === "done" && (st && st.count > 0 ? "bg-amber" : "bg-calm"),
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
              <span className="truncate">{SOURCE_LABEL[s]}</span>
            </div>
            <div className="mt-1 font-display text-3xl font-semibold leading-none tabular-nums">
              {state === "done" ? st?.count : state === "running" ? "…" : "–"}
              <span className="sr-only">
                {state === "done" ? ` findings from ${SOURCE_LABEL[s]}` : state === "running" ? ` searching ${SOURCE_LABEL[s]}` : ` ${SOURCE_LABEL[s]} not started`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
