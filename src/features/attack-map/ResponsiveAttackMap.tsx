"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { AttackMap as ListMap, type AttackMapProps } from "./AttackMap";
import { FlowMap } from "./FlowMap";
import "./graph3d.css";

// WebGL only exists in the browser.
const Graph3D = dynamic(() => import("./Graph3D").then((m) => m.Graph3D), { ssr: false });

const QUERY = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Wide screens open on the 3D footprint graph, with a switch to the flat
 * step-by-step chain view. Side panels use the chain view; phones keep the list.
 */
export function ResponsiveAttackMap(props: AttackMapProps) {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  const [view, setView] = useState<"web" | "steps">("web");
  if (narrow) return <ListMap {...props} />;
  if (props.compact) return <FlowMap {...props} />;
  return (
    <div className={`am-switch-wrap ${props.className ?? ""}`}>
      <div className="am-switch" role="group" aria-label="Map view">
        <button type="button" aria-pressed={view === "web"} onClick={() => setView("web")}>
          Your web
        </button>
        <button type="button" aria-pressed={view === "steps"} className={view === "web" ? "am-rail-play" : undefined} onClick={() => setView("steps")}>
          Ways in
        </button>
      </div>
      {view === "web" ? <Graph3D {...props} className="" /> : <FlowMap {...props} className="" autoplay />}
    </div>
  );
}
