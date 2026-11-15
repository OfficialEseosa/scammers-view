"use client";

import { Icon3D, type Icon3DName } from "@/design/Icon3D";
import type { ResultsTab } from "@/state/session";

/** Fired when "Analyze pictures" is pressed; the photo section runs its analysis when it hears it. */
export const ANALYSE_PHOTOS_EVENT = "sv:analyse-photos";

interface Action {
  id: string;
  icon: Icon3DName;
  label: string;
  hint: string;
  run: () => void;
}

/** One-tap actions at the top of the results: each opens a section and starts its work. */
export function QuickActions({
  onOpen,
  onRescan,
  photos,
  videos,
}: {
  onOpen: (tab: ResultsTab) => void;
  onRescan: () => void;
  photos: number;
  videos: number;
}) {
  const actions: Action[] = [
    {
      id: "photos",
      icon: "camera",
      label: "Analyze pictures",
      hint: photos ? `${photos} found` : "None found yet",
      run: () => {
        onOpen("photos");
        // The section mounts lazily; give it a moment before asking it to start.
        window.setTimeout(() => window.dispatchEvent(new Event(ANALYSE_PHOTOS_EVENT)), 900);
      },
    },
    { id: "map", icon: "compass", label: "Open my web", hint: "3D map", run: () => onOpen("map") },
    { id: "voice", icon: "mic", label: "Check my voice", hint: videos ? `${videos} videos` : "Voicemail demo", run: () => onOpen("practice") },
    { id: "places", icon: "pin", label: "Where I can be found", hint: "Map", run: () => onOpen("places") },
    { id: "rescan", icon: "bell", label: "Scan again", hint: "Fresh results", run: onRescan },
  ];
  return (
    <nav aria-label="Actions" className="mb-5 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:px-0">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={a.run}
          className="sv-press flex min-h-16 shrink-0 items-center gap-3 rounded-2xl border border-edge-strong bg-surface py-2 pl-2.5 pr-4 text-left transition-colors hover:border-fg"
        >
          <span className="grid size-11 place-items-center rounded-xl border border-edge bg-elevated">
            <Icon3D name={a.icon} size={30} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold">{a.label}</span>
            <span className="text-sm text-muted">{a.hint}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
