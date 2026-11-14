"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Share or copy a link the user chose to send. The app sends nothing itself:
 * the Web Share API hands the link to the person's own messaging app.
 */
export function useShare() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"));
    return () => {
      cancelAnimationFrame(id);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        ta.remove();
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, []);

  const share = useCallback(
    async (data: { title: string; text: string; url: string }) => {
      if (typeof navigator.share !== "function") return copy(data.url);
      try {
        await navigator.share(data);
      } catch (e) {
        if ((e as DOMException)?.name !== "AbortError") await copy(data.url);
      }
    },
    [copy],
  );

  return { canShare, copied, copy, share };
}
