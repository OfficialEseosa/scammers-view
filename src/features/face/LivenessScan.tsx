"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "@/lib/face/landmarker";
import { drawMesh, meshConnections, type Connection } from "@/lib/face/mesh";
import { SpinningScan, type ScanPoint } from "./SpinningScan";
import { ScanLoader } from "./ScanLoader";
import { HeadTurnChallenge, TURN_TARGET_DEG, type CaptureKind } from "@/lib/face/liveness";
import { SAME_PERSON_THRESHOLD } from "@/lib/face/match";
import { faceFit } from "@/lib/face/framing";
import { estimateYawDeg } from "@/lib/face/pose";
import { describeLargestFace, euclidean, loadRecognizer } from "@/lib/face/recognizer";
import { setFaceReference, trackCanvas, wipeCanvas } from "@/lib/face/store";
import type { LivenessResult, TurnDirection } from "@/lib/face/types";
import { buttonClass } from "@/design/Button";
import { LoadingDots } from "@/design/LoadingDots";
import { WarnNote } from "@/design/states";

type Stage =
  | { kind: "idle" }
  | { kind: "starting"; message: string; step: 0 | 1 | 2 }
  | { kind: "scanning" }
  | { kind: "verifying" }
  | { kind: "passed" }
  | { kind: "failed"; title: string; detail: string; canRetry: boolean };

interface Hint {
  tone: "info" | "warn";
  text: string;
}

export interface LivenessScanProps {
  /** Called once, only after the challenge AND the same-face check pass. */
  onComplete: (result: LivenessResult) => void;
  /** Optional: called on each failure (for analytics/UI); never carries face data. */
  onFail?: (reason: string) => void;
  className?: string;
}

const MAX_CAPTURE_WIDTH = 720;


function cameraErrorStage(err: unknown): Stage {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return {
      kind: "failed",
      title: "Camera access is blocked",
      detail:
        "Allow camera access for this site in your browser's address bar or site settings, then try again. The camera feed never leaves this device.",
      canRetry: true,
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return {
      kind: "failed",
      title: "No camera found",
      detail: "This scan needs a front-facing camera. Open this page on a phone or a laptop with a webcam.",
      canRetry: true,
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      kind: "failed",
      title: "The camera is busy",
      detail: "Another app or tab is using the camera. Close it, then try again.",
      canRetry: true,
    };
  }
  return {
    kind: "failed",
    title: "The camera didn't start",
    detail: err instanceof Error ? err.message : "Reload the page and try again.",
    canRetry: true,
  };
}

function captureFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / video.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
  trackCanvas(c);
  return c;
}

/** Mean luma (0..255) of the whole frame and of the face box. */
/** Can this browser hand out a graphics context right now? The mesh cannot run without one. */
function graphicsState(): "ok" | "none" | "lost" {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "none";
    const lost = gl.isContextLost();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return lost ? "lost" : "ok";
  } catch {
    return "none";
  }
}

function measureLight(
  video: HTMLVideoElement,
  probe: HTMLCanvasElement,
  face: { x0: number; y0: number; x1: number; y1: number } | null,
) {
  const pw = 48;
  const ph = 36;
  probe.width = pw;
  probe.height = ph;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, pw, ph);
  const { data } = ctx.getImageData(0, 0, pw, ph);
  let all = 0;
  let faceSum = 0;
  let faceN = 0;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      all += l;
      if (face && x / pw >= face.x0 && x / pw <= face.x1 && y / ph >= face.y0 && y / ph <= face.y1) {
        faceSum += l;
        faceN++;
      }
    }
  }
  return { frame: all / (pw * ph), face: faceN ? faceSum / faceN : null };
}

/** Shortest time the turning scan stays up, so it reads as a step and not a flicker. */
const MIN_VERIFY_MS = 1800;

const MATCH_MAX_SIDE = 640;
const MATCH_DEADLINE_MS = 25_000;

/** A copy of the frame no larger than MATCH_MAX_SIDE on its long side. */
function shrink(src: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, MATCH_MAX_SIDE / Math.max(src.width, src.height));
  if (scale === 1) return src;
  const out = document.createElement("canvas");
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  out.getContext("2d")?.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** Matching that never finishes becomes a clear failure instead of an endless wait. */
function withDeadline<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Matching took too long on this device. Try again.")), MATCH_DEADLINE_MS)),
  ]);
}

/** Hands the page back for a moment so the animation keeps moving between heavy steps. */
function breathe(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves after the browser has painted, so heavy work doesn't block a pending frame. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

const PROMPT: Record<TurnDirection, string> = {
  left: "Turn your head to your left",
  right: "Turn your head to your right",
};

export function LivenessScan({ onComplete, onFail, className }: LivenessScanProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const delegateRef = useRef<"GPU" | "CPU">("GPU");
  const rafRef = useRef<number>(0);
  const runIdRef = useRef(0);
  const capturesRef = useRef<Partial<Record<CaptureKind, HTMLCanvasElement>>>({});
  const passedRef = useRef(false);
  // The front capture's mesh, kept in memory to show as a turning 3D scan while frames are matched.
  const scanModelRef = useRef<{ points: ScanPoint[]; tess: Connection[]; contours: Connection[]; aspect: number } | null>(null);
  const [scanModel, setScanModel] = useState<typeof scanModelRef.current>(null);
  const onCompleteRef = useRef(onComplete);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onFailRef.current = onFail;
  });

  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [prompt, setPrompt] = useState("Look straight at the camera");
  const [direction, setDirection] = useState<TurnDirection | null>(null);
  const [yaw, setYaw] = useState(0);
  const [stepsDone, setStepsDone] = useState(0);
  const [hint, setHint] = useState<Hint | null>(null);
  /** Diagnostics line, shown on localhost or with ?facedebug in the address. */
  const [debug, setDebug] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }, []);

  const discardCaptures = useCallback(() => {
    for (const c of Object.values(capturesRef.current)) if (c) wipeCanvas(c);
    capturesRef.current = {};
  }, []);

  const fail = useCallback(
    (title: string, detail: string) => {
      runIdRef.current++;
      stopCamera();
      discardCaptures();
      setHint(null);
      setSecondsLeft(null);
      setStage({ kind: "failed", title, detail, canRetry: true });
      onFailRef.current?.(title);
    },
    [stopCamera, discardCaptures],
  );

  const verify = useCallback(
    async (runId: number, order: [TurnDirection, TurnDirection]) => {
      setScanModel(scanModelRef.current);
      setStage({ kind: "verifying" });
      const startedAt = performance.now();
      // Matching is heavy. Let the turning scan get on screen and move before it starts, and between frames.
      await nextPaint();
      await breathe(450);
      const { front, left, right } = capturesRef.current;
      if (!front || !left || !right) {
        fail("The scan didn't finish", "Some frames were missing. Try again.");
        return;
      }
      try {
        // Smaller frames match just as well and several times faster.
        const t0 = performance.now();
        const f = await withDeadline(describeLargestFace(shrink(front)));
        await breathe(200);
        const l = await withDeadline(describeLargestFace(shrink(left)));
        await breathe(200);
        const r = await withDeadline(describeLargestFace(shrink(right)));
        console.info(`[face] matched 3 frames in ${Math.round(performance.now() - t0)} ms`);
        // Keep the scan on screen long enough to register.
        const shown = performance.now() - startedAt;
        if (shown < MIN_VERIFY_MS) await new Promise((res) => setTimeout(res, MIN_VERIFY_MS - shown));
        if (runId !== runIdRef.current) return;
        if (!f) {
          fail("We couldn't read your face", "Face a light source and hold the camera at eye level. If your glasses catch a glare, take them off, then try again.");
          return;
        }
        if (!l || !r) {
          fail(
            "We lost your face while you turned",
            "Turn just far enough for the bar to fill, and keep your whole face in the frame.",
          );
          return;
        }
        const consistency = { left: euclidean(f.descriptor, l.descriptor), right: euclidean(f.descriptor, r.descriptor) };
        if (consistency.left > SAME_PERSON_THRESHOLD || consistency.right > SAME_PERSON_THRESHOLD) {
          for (const d of [f, l, r]) d.descriptor.fill(0);
          fail(
            "The face changed during the scan",
            "Every frame has to show the same person. Make sure only you are in front of the camera.",
          );
          return;
        }
        const reference = { descriptors: [f.descriptor, l.descriptor, r.descriptor], createdAt: Date.now() };
        setFaceReference(reference);
        passedRef.current = true;
        stopCamera();
        setStage({ kind: "passed" });
        onCompleteRef.current({
          passed: true,
          reference,
          frames: { front, left, right },
          order,
          consistency,
        });
      } catch (err) {
        if (runId !== runIdRef.current) return;
        fail("The face check couldn't run", err instanceof Error ? err.message : "Reload and try again.");
      }
    },
    [fail, stopCamera],
  );

  const start = useCallback(async () => {
    const runId = ++runIdRef.current;
    passedRef.current = false;
    discardCaptures();
    setHint(null);
    setStepsDone(0);
    setDirection(null);
    setYaw(0);
    setPrompt("Look straight at the camera");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const title = "Camera isn't available here";
      setStage({
        kind: "failed",
        title,
        detail: window.isSecureContext ? "This browser can't use the camera. Try the latest Chrome or Safari." : "The camera needs the https address of this site.",
        canRetry: false,
      });
      onFailRef.current?.(title);
      return;
    }

    setStage({ kind: "starting", message: "Opening the camera", step: 0 });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
    } catch (err) {
      if (runId === runIdRef.current) {
        const s = cameraErrorStage(err);
        setStage(s);
        if (s.kind === "failed") onFailRef.current?.(s.title);
      }
      return;
    }
    if (runId !== runIdRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current!;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* autoplay with muted+playsInline normally succeeds */
    }

    if (graphicsState() !== "ok") {
      fail("Your browser's graphics are switched off", "The face scan needs them. Close every window of this browser, open it again, and try once more.");
      return;
    }
    setStage({ kind: "starting", message: "Loading the face mesh on this device", step: 1 });
    // Start the recogniser now; it is awaited below, before the scan begins.
    const recognizerReady = loadRecognizer().then(
      () => true,
      () => false,
    );
    let vision: Awaited<ReturnType<typeof createFaceLandmarker>>["vision"];
    try {
      if (!landmarkerRef.current) {
        const made = await createFaceLandmarker("VIDEO");
        landmarkerRef.current = made.landmarker;
        delegateRef.current = made.delegate;
        vision = made.vision;
      } else {
        vision = await import("@mediapipe/tasks-vision");
      }
    } catch (err) {
      if (runId === runIdRef.current) {
        fail("The face model didn't load", err instanceof Error ? err.message : "Check your connection and try again.");
      }
      return;
    }
    if (runId !== runIdRef.current) return;

    // Compiling the matcher freezes the page for a moment. Do it here, behind the loading
    // screen, so the head-turn scan that follows stays smooth. Capped: a slow device moves on.
    setStage({ kind: "starting", message: "Warming up the matcher", step: 2 });
    await Promise.race([recognizerReady, new Promise((r) => setTimeout(r, 12_000))]);
    if (runId !== runIdRef.current) return;

    const { tess, contours, irises } = meshConnections(vision);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const probe = document.createElement("canvas");
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let landmarker = landmarkerRef.current!;
    const challenge = new HeadTurnChallenge(performance.now());
    const order = challenge.order;

    setStage({ kind: "scanning" });
    // On a phone the page may be scrolled past the camera frame; bring it back before the directions start.
    if (window.innerWidth < 640) sectionRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    let lastVideoTime = -1;
    let frameNo = 0;
    let noFaceSince = performance.now();
    let lightHint: Hint | null = null;
    let lastUi = 0;
    const scanStart = performance.now();
    /**
     * Low light: the mesh model misses faces in a dim room, and misses darker skin first. When the
     * frame is dark, detection runs on a brightened copy of the frame instead of the raw video.
     * 1 means off. The person still sees the untouched camera picture.
     */
    let boost = 1;
    const enhanced = document.createElement("canvas");
    const enhancedCtx = enhanced.getContext("2d");
    let sawFace = false;
    let failures = 0;
    const debugOn = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) || window.location.search.includes("facedebug");
    let lastError = "";
    let lastLight = "";
    let lastDebug = 0;
    let frames = 0;
    const report = (faceCount: number | string) => {
      const t = performance.now();
      if (!debugOn || t - lastDebug < 400) return;
      lastDebug = t;
      const track = streamRef.current?.getVideoTracks()[0];
      setDebug(
        `gl:${graphicsState()} mesh:${delegateRef.current} rebuilds:${rebuilds} faces:${faceCount} frames:${frames} fails:${failures} boost:${boost.toFixed(1)} light:${lastLight || "?"} video:${video.videoWidth}x${video.videoHeight} cam:${(track?.label ?? "?").slice(0, 28)}${lastError ? ` err:${lastError.slice(0, 90)}` : ""}`,
      );
    };
    let swapping = false;
    /**
     * Some graphics cards and phones run the mesh without error but return nothing, or fail on
     * every frame. If the fast path has not found a face after a few seconds, rebuild it on the
     * processor instead, once. Slower, but it works everywhere.
     */
    let rebuilds = 0;
    const fallBackToCpu = (why: string) => {
      // A crashed mesh cannot recover, so it is rebuilt (up to three times), always on the processor.
      if (swapping || rebuilds >= 3) return;
      if (delegateRef.current === "CPU" && failures < 8) return;
      rebuilds++;
      swapping = true;
      console.info(`[face] switching the mesh to CPU: ${why}`);
      void createFaceLandmarker("VIDEO", "CPU")
        .then((made) => {
          if (runId !== runIdRef.current) {
            made.landmarker.close();
            return;
          }
          // The old one is left alone: closing it after a crash can take the new one's graphics context with it.
          failures = 0;
          landmarker = made.landmarker;
          landmarkerRef.current = made.landmarker;
          delegateRef.current = "CPU";
          noFaceSince = performance.now();
        })
        .catch(() => {})
        .finally(() => {
          swapping = false;
        });
    };

    const tick = () => {
      if (runId !== runIdRef.current) return;
      rafRef.current = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const now = performance.now();

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      if (swapping) return;
      let result;
      try {
        // Detection never gets the raw camera frame. A full-size frame (1280x960 on many laptops and
        // phones) made the mesh run out of memory and crash on every frame, silently. A copy at most
        // 640 wide (480 after a crash) is plenty for landmarks and a quarter of the memory.
        let source: HTMLVideoElement | HTMLCanvasElement = video;
        if (enhancedCtx && video.videoWidth) {
          const w = Math.min(rebuilds > 0 ? 480 : 640, video.videoWidth);
          const h = Math.round((w * video.videoHeight) / video.videoWidth);
          if (enhanced.width !== w || enhanced.height !== h) {
            enhanced.width = w;
            enhanced.height = h;
          }
          enhancedCtx.filter = boost > 1 ? `brightness(${boost.toFixed(2)}) contrast(1.12)` : "none";
          enhancedCtx.drawImage(video, 0, 0, w, h);
          source = enhanced;
        }
        result = landmarker.detectForVideo(source, now);
        failures = 0;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (++failures >= 8) fallBackToCpu(lastError || "detection keeps failing");
        // Rebuilt three times and still crashing: stop and say so, instead of showing a camera that never reacts.
        if (rebuilds >= 3 && failures > 40 && !swapping) {
          fail("The face scan couldn't run in this browser", "Close every window of this browser, open it again, and try once more. If it still fails, try another browser.");
        }
        report("error");
        return;
      }
      const faces = result.faceLandmarks ?? [];
      frames++;
      report(faces.length);
      if (faces.length > 0) sawFace = true;
      else if (!sawFace && now - scanStart > 3500) fallBackToCpu("no face found on the fast path");
      const scanPhase = reduceMotion ? 0.5 : (now % 1800) / 1800;
      drawMesh(ctx, faces, tess, contours, irises, scanPhase);

      let sampleYaw: number | null = null;
      let currentHint: Hint | null = null;
      let box: { x0: number; y0: number; x1: number; y1: number } | null = null;

      if (faces.length > 1) {
        currentHint = { tone: "warn", text: "Only you should be in the frame." };
      } else if (faces.length === 1) {
        const lm = faces[0];
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const p of lm) {
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
        }
        box = { x0, y0, x1, y1 };
        const matrix = result.facialTransformationMatrixes?.[0]?.data;
        const y = estimateYawDeg(lm, matrix);
        sampleYaw = y;
        noFaceSince = now;
        if (challenge.phase === "center") {
          const fit = faceFit(box, video.videoHeight > video.videoWidth);
          if (fit === "closer") {
            currentHint = { tone: "info", text: "Move a little closer." };
            sampleYaw = null;
          } else if (fit === "back") {
            currentHint = { tone: "info", text: "Move back so your whole face fits." };
            sampleYaw = null;
          }
        }
      } else if (now - noFaceSince > 2500) {
        currentHint = { tone: "warn", text: "We can't see a face. Hold the camera at eye level." };
      }

      if (frameNo++ % 15 === 0) {
        const light = measureLight(video, probe, box);
        lightHint = null;
        if (light) {
          // Aim the darkest part that matters (the face if we have it, else the frame) at a mid grey.
          lastLight = `${Math.round(light.frame)}/${light.face === null ? "-" : Math.round(light.face)}`;
          const level = light.face ?? light.frame;
          const next = level < 95 ? Math.min(3.2, Math.max(1.25, 125 / Math.max(level, 18))) : 1;
          if ((next > 1) !== (boost > 1)) console.info(`[face] low-light boost ${next > 1 ? `on (x${next.toFixed(1)}, light ${Math.round(level)})` : "off"}`);
          boost = next;
          if (light.frame < 45 || (light.face !== null && light.face < 55)) {
            lightHint = { tone: "warn", text: "It's too dark. Face a window or a lamp." };
          } else if (light.face !== null && light.frame - light.face > 60) {
            lightHint = { tone: "warn", text: "The light is behind you. Turn to face it." };
          }
        }
      }

      const update = challenge.update({ now, yaw: sampleYaw });
      if (update.capture) {
        capturesRef.current[update.capture] = captureFrame(video);
        if (update.capture === "front" && faces[0]) {
          scanModelRef.current = {
            points: faces[0].map((p) => ({ x: p.x, y: p.y, z: p.z })),
            tess,
            contours,
            aspect: video.videoWidth / Math.max(1, video.videoHeight),
          };
        }
        if (update.capture !== "front") setStepsDone((n) => n + 1);
      }
      if (update.failure) {
        fail("The scan didn't pass", `${update.failure} Try again; the directions will change.`);
        return;
      }
      if (challenge.phase === "passed") {
        cancelAnimationFrame(rafRef.current);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        void verify(runId, order);
        return;
      }

      if (now - lastUi > 80) {
        lastUi = now;
        setYaw(sampleYaw ?? 0);
        setHint(currentHint ?? lightHint);
        setSecondsLeft(challenge.phase === "center" ? null : Math.ceil(challenge.timeLeftMs(now) / 1000));
        if (challenge.phase === "center") {
          setDirection(null);
          setPrompt("Look straight at the camera");
        } else if (challenge.phase === "turn") {
          setDirection(challenge.direction);
          setPrompt(PROMPT[challenge.direction]);
        } else if (challenge.phase === "return") {
          setDirection(null);
          setPrompt("Now look back at the camera");
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [discardCaptures, fail, verify]);

  useEffect(() => {
    const captures = capturesRef;
    const runIds = runIdRef;
    return () => {
      runIds.current++;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      // Unfinished captures never outlive the component. Passed frames are
      // owned by the caller and wiped by clearFaceData().
      if (!passedRef.current) {
        for (const c of Object.values(captures.current)) if (c) wipeCanvas(c);
      }
      captures.current = {};
    };
  }, []);

  const yawClamped = Math.max(-45, Math.min(45, yaw));
  // Preview is mirrored, so the user's left is on screen-left.
  const dotLeft = 50 - (yawClamped / 45) * 50;
  const targetPct = (TURN_TARGET_DEG / 45) * 50;

  return (
    <section
      ref={sectionRef}
      className={`relative flex w-full max-w-md scroll-mt-20 flex-col gap-4 ${className ?? ""}`}
      aria-label="Live face scan"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-frame border border-edge-strong bg-surface">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
          playsInline
          muted
          autoPlay
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-cover"
          aria-hidden="true"
        />

        {/* Corner brackets frame the scan area. */}
        <span className="pointer-events-none absolute left-5 top-5 h-7 w-7 border-l-2 border-t-2 border-fg" aria-hidden="true" />
        <span className="pointer-events-none absolute right-5 top-5 h-7 w-7 border-r-2 border-t-2 border-fg" aria-hidden="true" />
        <span className="pointer-events-none absolute bottom-5 left-5 h-7 w-7 border-b-2 border-l-2 border-fg" aria-hidden="true" />
        <span className="pointer-events-none absolute bottom-5 right-5 h-7 w-7 border-b-2 border-r-2 border-fg" aria-hidden="true" />

        {/* Phones: the directions sit on the camera frame, where the eyes already are. The copy below it is off screen there. */}
        {stage.kind === "scanning" && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-canvas via-canvas/85 to-transparent px-6 pb-6 pt-14 text-center sm:hidden"
            aria-hidden="true"
          >
            <p className="sv-display text-[1.75rem] leading-tight">
              {direction === "left" && <span>&larr; </span>}
              {prompt}
              {direction === "right" && <span> &rarr;</span>}
            </p>
            {hint && <p className={hint.tone === "warn" ? "text-warn-fg" : "text-fg"}>{hint.text}</p>}
            <p className="text-sm text-muted">
              {stepsDone} of 2 turns{secondsLeft !== null ? `, ${secondsLeft}s left` : ""}
            </p>
          </div>
        )}

        {stage.kind !== "scanning" && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center ${
              stage.kind === "verifying" ? "bg-canvas" : "bg-canvas/75 backdrop-blur-sm"
            }`}
          >
            {stage.kind === "idle" && (
              <>
                <FaceGlyph />
                <p className="max-w-[24ch] text-lg">Look at the camera, then turn your head when asked</p>
                <p className="max-w-[30ch] text-sm text-muted">Glasses can stay on. Take off sunglasses, hats and masks.</p>
              </>
            )}
            {stage.kind === "starting" && <ScanLoader step={stage.step} message={stage.message} />}
            {stage.kind === "verifying" && (
              <>
                {scanModel ? (
                  <SpinningScan
                    points={scanModel.points}
                    tess={scanModel.tess}
                    contours={scanModel.contours}
                    aspect={scanModel.aspect}
                    className="h-[62%] w-full"
                  />
                ) : (
                  <span className="sv-pulse inline-block h-2.5 w-2.5 rounded-full bg-fg" aria-hidden="true" />
                )}
                <p className="text-lg" role="status">
                  Matching scan
                  <LoadingDots />
                </p>
              </>
            )}
            {stage.kind === "passed" && (
              <>
                <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
                  <circle cx="28" cy="28" r="26" fill="none" stroke="var(--safe)" strokeWidth="3" />
                  <path d="M17 29 L25 37 L40 20" fill="none" stroke="var(--safe)" strokeWidth="3.5" strokeLinecap="round" />
                </svg>
                <p className="font-display text-2xl font-semibold">Face confirmed</p>
              </>
            )}
            {stage.kind === "failed" && (
              <>
                <p className="font-display text-2xl font-semibold">{stage.title}</p>
                <p className="max-w-[32ch] text-muted">{stage.detail}</p>
              </>
            )}
          </div>
        )}
      </div>

      {stage.kind === "scanning" && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="sr-only sv-display text-[1.75rem] leading-tight sm:not-sr-only sm:text-3xl">
            {direction === "left" && <span aria-hidden="true">&larr; </span>}
            {prompt}
            {direction === "right" && <span aria-hidden="true"> &rarr;</span>}
          </p>

          {/* Yaw rail: the dot follows your head; the target lights up on the side to turn to. */}
          <div className="relative h-10" aria-hidden="true">
            <div className="absolute left-0 right-0 top-1/2 h-px bg-edge-strong" />
            <div
              className={`absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${direction === "left" ? "bg-fg" : "bg-edge-strong"}`}
              style={{ left: `${50 - targetPct}%` }}
            />
            <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-muted" />
            <div
              className={`absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${direction === "right" ? "bg-fg" : "bg-edge-strong"}`}
              style={{ left: `${50 + targetPct}%` }}
            />
            <div
              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-canvas bg-fg shadow-[0_0_0_1px_var(--text)]"
              style={{ left: `${dotLeft}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-lg text-muted">
            <span>
              {stepsDone} of 2 turns{secondsLeft !== null ? `, ${secondsLeft}s left` : ""}
            </span>
            <span className="tabular-nums">{Math.round(Math.abs(yaw))}&deg;</span>
          </div>
          {hint && (
            <div role="status" className="sr-only sm:not-sr-only">
              {hint.tone === "warn" ? <WarnNote className="text-xl">{hint.text}</WarnNote> : <p className="text-xl">{hint.text}</p>}
            </div>
          )}
        </div>
      )}

      {(stage.kind === "idle" || (stage.kind === "failed" && stage.canRetry)) && (
        <button
          type="button"
          onClick={() => void start()}
          className={buttonClass("primary", "lg")}
        >
          {stage.kind === "idle" ? "Start face scan" : "Try again"}
        </button>
      )}
      {stage.kind === "starting" && stage.step === 0 && <p className="text-muted">Allow camera access when asked</p>}
      {debug && stage.kind === "scanning" && <p className="break-all font-mono text-xs text-muted">{debug}</p>}
    </section>
  );
}

function FaceGlyph() {
  return (
    <svg width="72" height="88" viewBox="0 0 72 88" aria-hidden="true" className="text-fg">
      <ellipse cx="36" cy="44" rx="30" ry="40" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" />
      <path d="M22 38 h8 M42 38 h8 M36 42 v12 M28 64 q8 6 16 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
