import type { AttackChain, Finding } from "@/lib/types";
import { scoreColor } from "@/components/scan/meta";
import { maskIn } from "@/components/scan/mask";

/**
 * Seam for the attack-chain visualisation. Today: an ordered step list.
 * A graph view can replace the body without changing the props.
 */
export function ChainView({
  chain,
  findings = [],
  masked = false,
}: {
  chain: AttackChain;
  findings?: Finding[];
  masked?: boolean;
}) {
  return (
    <article className="sv-slide-in rounded-2xl border border-line bg-panel p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">How a scammer could reach</p>
          <h3 className="font-display text-xl font-semibold">{chain.target}</h3>
        </div>
        <span
          className="shrink-0 rounded-full border px-3 py-0.5 text-sm"
          style={{ borderColor: scoreColor(chain.severity * 10), color: scoreColor(chain.severity * 10) }}
        >
          Severity {chain.severity}/10
        </span>
      </header>
      <ol className="mt-4 space-y-3">
        {chain.steps.map((s, i) => (
          <li key={s.id} className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-paper font-display text-sm font-semibold text-ink">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{maskIn(s.title, findings, masked)}</p>
              <p className="text-muted">{maskIn(s.description, findings, masked)}</p>
              {s.enables && <p className="mt-1 text-sm text-amber">Unlocks: {maskIn(s.enables, findings, masked)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
