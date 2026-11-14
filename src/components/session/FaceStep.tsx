"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/state/session";
import { Icon3D } from "@/design/Icon3D";
import { Button } from "@/design/Button";
import { WarnNote } from "@/design/states";
import { DotField } from "@/design/backgrounds";

const LivenessScan = dynamic(() => import("@/features/face").then((m) => m.LivenessScan), {
  ssr: false,
  loading: () => <div className="sv-skeleton aspect-[3/4] w-full max-w-md rounded-frame" aria-label="Loading face scan" />,
});

/** LivenessScan failure titles that mean "there is no usable camera here". */
const NO_CAMERA = ["No camera found", "Camera isn't available here", "Camera access is blocked"];
const DEV = process.env.NODE_ENV === "development";

export function FaceStep() {
  const { setFace, setStage } = useSession();
  const [noCamera, setNoCamera] = useState(false);
  const [failed, setFailed] = useState(false);
  const advance = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        if (alive && !d.some((x) => x.kind === "videoinput")) setNoCamera(true);
      })
      .catch(() => {});
    if (!navigator.mediaDevices) queueMicrotask(() => alive && setNoCamera(true));
    const t = advance;
    return () => {
      alive = false;
      clearTimeout(t.current);
    };
  }, []);

  // Never a dead end: dev with no usable camera may skip outright; anywhere, a failed scan can retry or carry on without photo matching.
  const canSkip = (DEV && noCamera) || failed;

  return (
    <div className="relative isolate mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1fr_auto] lg:gap-16">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotField gap={26} fade="radial" />
      </div>
      <div className="order-2 max-w-xl lg:order-1">
        <p className="text-muted">Step 1 of 2</p>
        <h1 className="sv-display mt-2 text-[clamp(2.4rem,6vw,4.75rem)] leading-[0.95]">Prove it&apos;s you</h1>
        <ul className="mt-8 flex flex-col divide-y divide-edge border-y border-edge">
          {[
            { icon: "camera" as const, text: "Camera stays on this device" },
            { icon: "trash" as const, text: "Face forgotten when you end the session" },
          ].map((r) => (
            <li key={r.text} className="flex min-h-16 items-center gap-4 py-2 text-lg">
              <Icon3D name={r.icon} size={44} />
              {r.text}
            </li>
          ))}
        </ul>

        {canSkip && (
          <div className="mt-8 flex flex-col items-start gap-4">
            <WarnNote className="text-lg">{noCamera ? "No usable camera here" : "The face scan didn't pass"}</WarnNote>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setFace("skipped");
                setStage("live");
              }}
            >
              Continue without face match
            </Button>
          </div>
        )}
      </div>

      <div className="order-1 mx-auto w-full max-w-md lg:order-2 lg:w-[24rem]">
        <LivenessScan
          onFail={(reason) => {
            if (NO_CAMERA.includes(reason)) setNoCamera(true);
            setFailed(true);
          }}
          onComplete={() => {
            setFace("verified");
            advance.current = window.setTimeout(() => setStage("live"), 1100);
          }}
        />
      </div>
    </div>
  );
}
