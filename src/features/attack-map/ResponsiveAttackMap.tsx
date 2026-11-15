"use client";

import dynamic from "next/dynamic";
import { Component, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AttackMapProps } from "./AttackMap";
import { FlowMap } from "./FlowMap";
import { StepsList } from "./StepsList";
import "./graph3d.css";

// WebGL only exists in the browser.
const Graph3D = dynamic(() => import("./Graph3D").then((m) => m.Graph3D), {
  ssr: false,
  loading: () => <div className="g3-root g3-loading" aria-hidden />,
});

const QUERY = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

let webglOk: boolean | null = null;
function hasWebGL() {
  if (webglOk === null) {
    try {
      const c = document.createElement("canvas");
      webglOk = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webglOk = false;
    }
  }
  return webglOk;
}
const noop = () => () => {};

/** If the 3D view fails to start (lost context, old GPU), fall back to the steps. */
class GraphBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Opens on the 3D footprint graph ("Your web"), with a switch to the step by
 * step chain view ("Ways in"). Wide screens get the left-to-right flow; phones
 * get a vertical timeline. Small side panels go straight to the flow, and
 * devices without WebGL go straight to the steps.
 */
export function ResponsiveAttackMap(props: AttackMapProps) {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  const webgl = useSyncExternalStore(noop, hasWebGL, () => true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"web" | "steps">("web");
  const [startChain, setStartChain] = useState<string | null>(null);

  if (props.compact && !narrow) return <FlowMap {...props} />;

  const canWeb = webgl && !failed;
  const shown = canWeb ? view : "steps";
  const steps = narrow ? (
    <StepsList {...props} className="" autoplay={canWeb}startChain={startChain} />
  ) : (
    <FlowMap {...props} className="" autoplay startChain={startChain} />
  );

  return (
    <div className={`am-switch-wrap ${props.className ?? ""}`}>
      {canWeb && (
        <div className="am-switch" role="group" aria-label="Map view">
          <button
            type="button"
            aria-pressed={shown === "web"}
            onClick={() => {
              setStartChain(null);
              setView("web");
            }}
          >
            Your web
          </button>
          <button type="button" aria-pressed={shown === "steps"} data-ways={shown === "web" ? "" : undefined} onClick={() => setView("steps")}>
            Ways in
          </button>
        </div>
      )}
      <div key={shown} className="am-view">
        {shown === "web" ? (
          <GraphBoundary onFail={() => setFailed(true)}>
            <Graph3D
              {...props}
              className=""
              onTarget={(id) => {
                setStartChain(id);
                setView("steps");
              }}
            />
          </GraphBoundary>
        ) : (
          steps
        )}
      </div>
    </div>
  );
}
