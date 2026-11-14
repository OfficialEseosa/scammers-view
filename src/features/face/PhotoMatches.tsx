"use client";

import { useEffect, useState } from "react";
import { proxiedUrl } from "@/lib/face/image";
import { clearFaceData } from "@/lib/face/store";
import type { FaceReference, MatchResult } from "@/lib/face/types";
import type { Finding } from "@/lib/types";
import { useFaceReference, usePhotoMatches, type PhotoMatchState } from "./usePhotoMatches";

export interface PhotoMatchesProps {
  findings: Finding[];
  /** Defaults to the reference from the last passed <LivenessScan>. */
  reference?: FaceReference | null;
  threshold?: number;
  /** Wipe the reference face and captured frames when this unmounts (default true). */
  clearOnUnmount?: boolean;
  /** Show match distances (dev/lab only). */
  showDistances?: boolean;
  className?: string;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Display-only image: tries the original URL, falls back to our relay. */
function Photo({ url, alt, result }: { url: string; alt: string; result?: MatchResult }) {
  const [src, setSrc] = useState(url);
  const box = result?.matched ? result.faceBox : null;
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="block h-auto w-full"
        onError={() => {
          if (src === url && url.startsWith("https://")) setSrc(proxiedUrl(url));
        }}
      />
      {box && (
        <div
          className="pointer-events-none absolute rounded-md border-2 border-fg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
          }}
        >
          <span className="absolute -top-7 left-0 whitespace-nowrap rounded-chip bg-fg px-1.5 py-0.5 text-sm font-semibold text-canvas">
            You
          </span>
        </div>
      )}
    </div>
  );
}

function Distance({ result }: { result?: MatchResult }) {
  if (!result) return null;
  return (
    <span className="tabular-nums">
      {Number.isFinite(result.distance) ? `d=${result.distance.toFixed(3)}` : "no face"}
      {result.faceCount > 1 ? `, ${result.faceCount} faces` : ""}
    </span>
  );
}

function MatchedCard({ item, showDistances }: { item: PhotoMatchState; showDistances?: boolean }) {
  const { finding, result } = item;
  const href = safeHref(finding.sourceUrl);
  return (
    <li className="sv-card overflow-hidden">
      <Photo url={finding.imageUrl!} alt={finding.label || "Photo that shows you"} result={result} />
      <div className="flex flex-col gap-1 p-4">
        <p className="font-medium text-fg">{finding.sourceTitle || finding.label}</p>
        <p className="text-sm text-muted">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-edge underline-offset-4 hover:text-fg">
              {hostOf(finding.sourceUrl)}
            </a>
          ) : (
            hostOf(finding.sourceUrl)
          )}
          {result && result.faceCount > 1 ? ` with ${result.faceCount - 1} other ${result.faceCount === 2 ? "person" : "people"}` : ""}
        </p>
        {showDistances && (
          <p className="text-xs text-muted">
            <Distance result={result} />
          </p>
        )}
      </div>
    </li>
  );
}

export function PhotoMatches({
  findings,
  reference: referenceProp,
  threshold,
  clearOnUnmount = true,
  showDistances = false,
  className,
}: PhotoMatchesProps) {
  const stored = useFaceReference();
  const reference = referenceProp === undefined ? stored : referenceProp;
  const { items, matched, notMatched, pending, running } = usePhotoMatches(findings, reference, { threshold });

  useEffect(() => {
    if (!clearOnUnmount) return;
    return () => clearFaceData();
  }, [clearOnUnmount]);

  const failed = notMatched.filter((i) => i.result?.error);
  const checked = notMatched.filter((i) => !i.result?.error);

  return (
    <section className={`flex flex-col gap-6 ${className ?? ""}`} aria-label="Photos that show you">
      <header className="flex flex-col gap-2">
        <h2 className="sv-display text-[clamp(2rem,4vw,2.75rem)] leading-[1]">
          {!reference
            ? "Photos of you"
            : matched.length === 0 && !running
              ? "We didn't find you in these photos"
              : `You appear in ${matched.length} ${matched.length === 1 ? "photo" : "photos"}`}
        </h2>
        <p className="max-w-[62ch] text-muted" aria-live="polite">
          {!reference
            ? "Needs the live face scan."
            : running
              ? `Checking ${items.length - pending.length + 1} of ${items.length} photos on this device.`
              : items.length === 0
                ? "No photos to check."
                : "Matched on this device. Nothing uploaded."}
        </p>
      </header>

      {matched.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matched.map((item) => (
            <MatchedCard key={item.finding.id} item={item} showDistances={showDistances} />
          ))}
        </ul>
      )}

      {reference && pending.length > 0 && (
        <p className="flex items-center gap-3 text-sm text-muted">
          <span className="sv-pulse inline-block h-2 w-2 rounded-full bg-fg" aria-hidden="true" />
          {pending.length} still to check
        </p>
      )}

      {checked.length > 0 && (
        <details className="group rounded-card border border-edge">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-fg">
            Not you, or no face found ({checked.length})
          </summary>
          <ul className="grid grid-cols-3 gap-2 p-4 pt-0 sm:grid-cols-5">
            {checked.map(({ finding, result }) => (
              <li key={finding.id} className="flex flex-col gap-1">
                <div className="overflow-hidden rounded-lg opacity-60">
                  <Photo url={finding.imageUrl!} alt={finding.label || "Photo"} />
                </div>
                <span className="truncate text-sm text-muted">
                  {showDistances ? <Distance result={result} /> : hostOf(finding.sourceUrl)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {failed.length > 0 && (
        <p className="text-sm text-muted">
          {failed.length} {failed.length === 1 ? "photo" : "photos"} couldn&apos;t be checked (the site blocked it or it isn&apos;t an image).
          {showDistances && (
            <span className="block text-xs">{failed.map((f) => `${hostOf(f.finding.imageUrl!)}: ${f.result?.error}`).join("; ")}</span>
          )}
        </p>
      )}
    </section>
  );
}
