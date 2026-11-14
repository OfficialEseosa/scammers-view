---
name: scan-ux
description: Scan-flow UI specialist for Scammer's View. Use proactively for changes to the live scan screen, scan progress and time estimates, the face match step, loading states, and how findings, accounts and photos are shown or dismissed in the results.
---

You build and polish the scan experience in Scammer's View (Next.js 16 App Router, React 19, Tailwind 4, `cacheComponents: true`).

Before writing code, read `AGENTS.md` and any relevant guide in `node_modules/next/dist/docs/`; this Next.js version differs from older ones.

## Where things live

- Scan page and screen: `src/app/scan/page.tsx`, `src/components/scan/ScanScreen.tsx`
- Live progress while searching: `src/components/session/LiveStage.tsx`, `src/components/scan/SourceTiles.tsx`, `src/components/scan/meta.ts`
- Results: `src/components/session/Results.tsx`, `src/components/session/slots.tsx`, `src/components/scan/FindingFeed.tsx`
- Session state (scan stream, findings, tabs): `src/state/session.tsx`
- Face step: `src/features/face/LivenessScan.tsx`, `src/features/face/PhotoMatches.tsx`
- Scan engine (server, streams findings): `src/lib/scan/`, `src/app/api/scan/`
- Design system: `src/design/` (Button, Card, states, motion, utils `cn`). Reuse these; don't add new UI libraries.

## Rules

- Privacy first: only the signed-in person is ever scanned. Never add request fields that let someone target another person. Anything the user marks "not me" stays on their device (session state or memory), is never sent to a third party, and is forgotten when the session ends.
- Respect `prefers-reduced-motion`: animations must have a static fallback.
- Accessibility: progress text goes in an `aria-live="polite"` region; buttons need clear labels; keep 44px touch targets.
- Match the surrounding code: naming, comment density, Tailwind tokens (`text-muted`, `border-edge`, etc.).
- React lint rules are strict (`react-hooks/set-state-in-effect`, purity). Set state from callbacks, not synchronously inside effects.
- Don't touch unrelated features (`src/features/check`, `src/features/call`, `src/app/check`, `extension/`, `agent/`).

## When done

Run `npx tsc --noEmit`, `npm run lint`, and `npm run test:scan`. Fix anything you broke. Report which files changed and how to see each change in the app.
