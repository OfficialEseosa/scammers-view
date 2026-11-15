"use client";

import dynamic from "next/dynamic";
import { PanelSkeleton } from "@/design/states";

/**
 * Lazy boundaries for each feature. Every feature loads on demand and shows a
 * shaped skeleton meanwhile; swapping an implementation is a one-line change here.
 */

function Skeleton({ className = "", label }: { className?: string; label: string }) {
  return <PanelSkeleton className={className} label={label} />;
}

export const AttackMapSlot = dynamic(() => import("@/features/attack-map").then((m) => m.AttackMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[420px]" label="Drawing the map" />,
});

export const PracticeSlot = dynamic(() => import("@/features/practice").then((m) => m.PracticeAttacks), {
  ssr: false,
  loading: () => <Skeleton className="h-64" label="Loading practice attacks" />,
});

export const VoiceSlot = dynamic(() => import("@/features/voice/VoiceDemo").then((m) => m.VoiceDemo), {
  ssr: false,
  loading: () => <Skeleton className="h-64" label="Loading voicemail demo" />,
});

export const VoiceExposureSlot = dynamic(() => import("@/features/voice-exposure").then((m) => m.VoiceExposure), {
  ssr: false,
  loading: () => <Skeleton className="h-64" label="Loading voice check" />,
});

export const QuizSlot = dynamic(() => import("@/features/quiz").then((m) => m.ScamQuiz), {
  ssr: false,
  loading: () => <Skeleton className="h-64" label="Loading the quiz" />,
});

export const PhotoMatchesSlot = dynamic(() => import("@/features/face").then((m) => m.PhotoMatches), {
  ssr: false,
  loading: () => <Skeleton className="h-64" label="Loading photo check" />,
});

export const PlacesSlot = dynamic(() => import("@/features/places/PlacesMap").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] min-h-[360px]" label="Loading places" />,
});

export const CheckSlot = dynamic(() => import("@/features/check").then((m) => m.ScamCheck), {
  ssr: false,
  loading: () => <Skeleton className="h-64" label="Loading the scam check" />,
});

export const FixListSlot = dynamic(() => import("@/features/fixes/FixList").then((m) => m.FixList), {
  ssr: false,
  loading: () => <Skeleton className="h-96" label="Ranking your fixes" />,
});

export const PhotoContextSlot = dynamic(() => import("@/features/photo-context").then((m) => m.PhotoContext), {
  ssr: false,
  loading: () => <Skeleton className="h-48" label="Loading photo reading" />,
});

export const VideoContextSlot = dynamic(() => import("@/features/photo-context").then((m) => m.VideoContext), {
  ssr: false,
  loading: () => <Skeleton className="h-48" label="Loading video reading" />,
});
