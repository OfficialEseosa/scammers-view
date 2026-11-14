import { Landing } from "@/design/landing/Landing";
import { buttonClass } from "@/design/Button";

/** Dev harness: the landing page with a static CTA (no auth). */
export default function LandingLab() {
  return (
    <Landing
      cta={
        <a href="#top" className={buttonClass("primary", "lg")}>
          Sign in with Google
        </a>
      }
      endCta={
        <a href="#top" className="sv-press inline-flex min-h-14 items-center rounded-control bg-[var(--on-accent)] px-7 text-lg font-semibold text-[var(--accent)]">
          Scan me
        </a>
      }
    />
  );
}
