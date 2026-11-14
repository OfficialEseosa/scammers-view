import { buttonClass, type ButtonVariant } from "@/design/Button";

/** Starts the one-time, read-only Gmail check (a full navigation: Google shows its consent page). */
export function GmailButton({ variant = "secondary", className }: { variant?: ButtonVariant; className?: string }) {
  return (
    <a href="/api/gmail/connect" className={buttonClass(variant, "md", className)}>
      Check my Gmail
    </a>
  );
}

export const GMAIL_PROMISE = "Reads your last 25 inbox and 25 spam emails once, read-only, then forgets them and gives up access.";
