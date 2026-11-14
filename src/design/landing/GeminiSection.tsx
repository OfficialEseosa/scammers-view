import { Icon3D, type Icon3DName } from "../Icon3D";
import { SectionHead } from "./Sections";

/**
 * "How it works" credit: where Gemini runs in the app. Facts only; each row
 * names the Gemini API capability and the code that uses it. Model names are
 * the defaults in src/lib/llm/gemini.ts (overridable per deployment).
 */

const USES: { icon: Icon3DName; title: string; does: string; api: string; model: string }[] = [
  {
    icon: "compass",
    title: "Search agents",
    does: "Parallel agents look for public pages about you and keep the sources they cite.",
    api: "Grounding with Google Search, URL context",
    model: "Gemini 3.8 Flash",
  },
  {
    icon: "file",
    title: "Structured extraction",
    does: "Each page becomes typed facts with a source and confidence. Duplicates are merged.",
    api: "Structured output (JSON Schema)",
    model: "3.8 Flash, 3.1 Flash-Lite",
  },
  {
    icon: "link",
    title: "Chain reasoning",
    does: "Links facts into the attack chains on your map and scores your exposure.",
    api: "Thinking, structured output",
    model: "Gemini 4 Argon",
  },
  {
    icon: "chat",
    title: "Practice attacks",
    does: "Writes the practice scams, quiz, voicemail script and opt-out letters from your own facts.",
    api: "Structured output",
    model: "Gemini 4 Argon, 3.8 Flash",
  },
  {
    icon: "camera",
    title: "Photo understanding",
    does: "Reads signs, logos, badges and candles off photos already matched to you. Never identifies anyone.",
    api: "Image understanding, bounding boxes",
    model: "Gemini 3.8 Flash",
  },
  {
    icon: "mic",
    title: "Video and audio",
    does: "Watches and listens to your own videos for what you said and showed. The upload is deleted after.",
    api: "Video understanding, Files API",
    model: "Gemini 3.8 Flash",
  },
];

export function GeminiSection({ id = "gemini" }: { id?: string }) {
  return (
    <section id={id} aria-label="Built on Gemini" className="mx-auto w-full max-w-7xl scroll-mt-8 px-4 py-16 sm:px-8 sm:py-24">
      <SectionHead>Built on Gemini.</SectionHead>
      <ol className="grid gap-px overflow-hidden rounded-frame border border-edge bg-edge sm:grid-cols-2 lg:grid-cols-3">
        {USES.map((u, i) => (
          <li key={u.title} className="sv-icon-host flex flex-col gap-4 bg-canvas p-6">
            <div className="flex items-start justify-between gap-4">
              <Icon3D name={u.icon} size={52} motion="hover" />
              <span className="sv-num text-sm text-subtle">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="font-display text-xl font-semibold">{u.title}</h3>
            <p className="text-muted">{u.does}</p>
            <dl className="mt-auto flex flex-col gap-1 border-t border-edge pt-4 text-sm">
              <div className="flex gap-2">
                <dt className="sr-only">Gemini API</dt>
                <dd className="flex items-center gap-1.5 font-medium">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
                    <path d="M6 0c.4 3.2 2.8 5.6 6 6-3.2.4-5.6 2.8-6 6-.4-3.2-2.8-5.6-6-6 3.2-.4 5.6-2.8 6-6Z" fill="currentColor" />
                  </svg>
                  {u.api}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="sr-only">Model</dt>
                <dd className="text-muted">{u.model}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="mt-6 max-w-[70ch] text-sm text-muted">
        Face and voice matching run on your device. Only photos already matched to you, and your own videos, go to Gemini, and only when you click.
      </p>
    </section>
  );
}
