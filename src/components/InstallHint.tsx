"use client";

import { useEffect, useState } from "react";
import { Button } from "@/design/Button";

/** Chrome's install event; not in the DOM typings yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Add to home screen" on Android Chrome, shown only when the browser says the app can be
 * installed. Once installed, the app shows up in the share sheet of every other app.
 */
export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (!/Android/i.test(navigator.userAgent)) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-edge bg-surface p-4">
      <p className="min-w-0 flex-1 text-muted">
        Add Scammer&apos;s View to your home screen, then share any odd text, link or screenshot to it from other apps.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice;
          setPrompt(null);
        }}
      >
        Add to home screen
      </Button>
    </div>
  );
}
