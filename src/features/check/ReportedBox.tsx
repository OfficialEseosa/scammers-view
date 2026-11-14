import type { LinkThreat, Reported } from "@/lib/reputation";

const THREAT: Record<LinkThreat, string> = {
  phishing: "on Google's list of phishing sites",
  malware: "on Google's list of sites that spread malware",
  unwanted: "on Google's list of sites with unwanted software",
};

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** "Has this been reported?" results for the links and numbers in a message. */
export function ReportedBox({ reported }: { reported?: Reported }) {
  if (!reported) return null;
  const { links, numbers, checked } = reported;
  const looked = [checked.links ? plural(checked.links, "link") : "", checked.numbers ? plural(checked.numbers, "phone number") : ""].filter(Boolean);
  if (links.length === 0 && numbers.length === 0) {
    if (looked.length === 0) return null;
    return <p className="text-sm text-muted">Looked up {looked.join(" and ")} in public scam reports: none reported.</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-control border border-danger p-4" role="status">
      <p className="font-semibold text-danger-fg">Reported by others</p>
      <ul className="flex flex-col gap-2 text-sm">
        {links.map((l) => (
          <li key={l.url} className="break-all">
            <span className="font-medium">{shortUrl(l.url)}</span> is {THREAT[l.threat]}. Don&apos;t open it.
          </li>
        ))}
        {numbers.map((n) => (
          <li key={n.number}>
            <span className="font-medium">{n.display}</span> was reported {plural(n.reports, "time")} to the FTC in the last 10 days
            {n.topSubject !== "Other" ? `, mostly for "${n.topSubject}"` : ""}
            {n.robocalls > 0 ? `, ${n.robocalls === n.reports ? "all" : n.robocalls} as robocalls` : ""}.
          </li>
        ))}
      </ul>
      <p className="text-xs text-subtle">Only the links and numbers were looked up, never the message.</p>
    </div>
  );
}
