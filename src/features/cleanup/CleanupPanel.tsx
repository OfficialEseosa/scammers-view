"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import type { Fix } from "@/lib/fixes/types";
import { Button, buttonClass } from "@/design/Button";
import { Card } from "@/design/Card";
import { LoadingDots } from "@/design/LoadingDots";
import { WarnNote } from "@/design/states";
import { BROKER_SITES } from "@/lib/cleanup/sites";
import { mailtoHref } from "@/lib/fixes/optout";
import { cleanupForFix, taskFor, type CleanupMode } from "@/lib/cleanup/tasks";
import type { Details } from "@/lib/cleanup/types";
import { callExtension, detectExtension, extensionHands, onExtensionHello, serverBrowserAvailable, serverHands, type AskButton, type Hands } from "./hands";
import { runTask, type RunEvent } from "./loop";

type Phase = "idle" | "running" | "waiting" | "done";

interface Props {
  fix: Fix;
  findings: Finding[];
  name: string;
  email: string;
  onDone?: () => void;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function CleanupPanel({ fix, findings, name, email, onDone }: Props) {
  const help = useMemo(() => cleanupForFix(fix), [fix]);
  if (!help) return null;
  // Broker forms need a contact email; settings / prepare / GitHub can run without one.
  if ((help.mode === "broker-form" || help.mode === "broker-email" || help.mode === "site-email") && !email.trim()) return null;
  if (help.mode === "prepare" || help.mode === "site-email") return <Panel fix={fix} findings={findings} name={name} email={email} help={help} onDone={onDone} />;
  return (
    <WithExtension>
      <Panel fix={fix} findings={findings} name={name} email={email} help={help} onDone={onDone} />
    </WithExtension>
  );
}

/**
 * The agent needs the companion Chrome extension. Without it there is nothing
 * it can do, so the offer stays hidden and the fix shows its plain steps and link.
 */
let extensionSeen: Promise<boolean> | null = null;

function WithExtension({ children }: { children: React.ReactNode }) {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    let alive = true;
    extensionSeen ??= detectExtension().then((v) => v !== null);
    void extensionSeen.then((ok) => {
      if (alive && ok) setPresent(true);
    });
    const stop = onExtensionHello(() => {
      if (alive) setPresent(true);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return present ? <>{children}</> : null;
}

function Panel({
  fix,
  findings,
  name,
  email,
  help,
  onDone,
}: Props & { help: { taskId: string; mode: CleanupMode; site: string } }) {
  const [open, setOpen] = useState(false);
  const isGithub = help.taskId === "settings:github-email";
  const isProfile = help.taskId.startsWith("profile:");
  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {help.mode === "prepare" ? "Prepare this for me" : help.mode === "site-email" ? "Email the site for me" : "Clean this up for me"}
        </Button>
        <span className="text-sm text-muted">
          {help.mode === "settings"
            ? isGithub
              ? "Opens GitHub Emails in your Chrome and turns on both privacy checkboxes. You press Do it."
              : isProfile
                ? "Opens your listing in Chrome. You press Do it for each edit."
                : "Opens the settings page in your Chrome. You click Do it for each step."
            : help.mode === "prepare"
              ? "Opens the page and suggests what to enter. You make the change."
              : help.mode === "site-email"
                ? "Finds the site's contact address and writes the request. You approve it before it sends."
              : "Asks before every submit. Never stores passwords."}
        </span>
      </div>
    );
  }
  if (help.mode === "prepare") return <PrepareOnly fix={fix} onClose={() => setOpen(false)} />;
  if (help.mode === "site-email") {
    return <SiteEmail fix={fix} findings={findings} name={name} email={email} site={help.site} onDone={onDone} onClose={() => setOpen(false)} />;
  }
  if (help.mode === "broker-email") {
    return <EmailRemoval fix={fix} findings={findings} name={name} email={email} site={help.site} onDone={onDone} onClose={() => setOpen(false)} />;
  }
  return (
    <AgentRun
      fix={fix}
      findings={findings}
      name={name}
      email={email}
      taskId={help.taskId}
      mode={help.mode}
      site={help.site}
      onDone={onDone}
      onClose={() => setOpen(false)}
      githubFollowUp={isGithub}
    />
  );
}

/* ------------------------------ agent run ------------------------------ */

function AgentRun({
  fix,
  findings,
  name,
  email,
  taskId,
  mode,
  site,
  onDone,
  onClose,
  githubFollowUp = false,
}: {
  fix: Fix;
  findings: Finding[];
  name: string;
  email: string;
  taskId: string;
  mode: CleanupMode;
  site: string;
  onDone?: () => void;
  onClose: () => void;
  /** After GitHub settings succeed, show the local git-config tip + optional token fallback. */
  githubFollowUp?: boolean;
}) {
  const [ext, setExt] = useState<string | null | undefined>(undefined);
  const [serverOk, setServerOk] = useState(false);
  const [handsChoice, setHandsChoice] = useState<"extension" | "server" | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [say, setSay] = useState("Ready when you are.");
  const [image, setImage] = useState<string>("");
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);
  const [ask, setAsk] = useState<{ text: string; buttons: AskButton[]; resolve: (id: string) => void } | null>(null);
  const [gmailOn, setGmailOn] = useState(false);
  const [githubDone, setGithubDone] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const live = useRef<Hands | null>(null);

  const details = useMemo(() => detailsFrom(fix, findings, name, email), [fix, findings, name, email]);
  const task = useMemo(() => taskFor(taskId, details.listingUrl), [taskId, details.listingUrl]);
  const broker = useMemo(() => (taskId.startsWith("broker:") ? BROKER_SITES.find((b) => b.id === taskId.slice(7)) : undefined), [taskId]);
  const handsKind: "extension" | "server" =
    handsChoice ?? (mode === "settings" || ext ? "extension" : serverOk ? "server" : "extension");

  useEffect(() => {
    let alive = true;
    void detectExtension().then((v) => {
      if (alive) setExt(v);
    });
    const stopHello = onExtensionHello((v) => {
      if (alive) setExt(v);
    });
    if (mode === "broker-form") {
      void serverBrowserAvailable().then((ok) => {
        if (alive) setServerOk(ok);
      });
    }
    return () => {
      alive = false;
      stopHello();
      abort.current?.abort();
      // Take down a question still showing in the site tab so it can't be approved later.
      void live.current?.answer?.("stop");
    };
  }, [mode]);

  async function recheckExtension() {
    setExt(undefined);
    setExt(await detectExtension(1200));
  }

  async function start() {
    if (!task) {
      setSay(`I can't open this page for you. Use the link in the steps above to open ${site} yourself.`);
      return;
    }
    if (handsKind === "extension" && !ext) {
      setSay("Reload this page after installing the extension, then press Check again.");
      return;
    }
    if (handsKind === "extension") {
      try {
        // First message after the click: opens the extension side panel when Chrome allows it.
        await callExtension("beginCleanup", { site }, 8_000);
        await callExtension("canOpen", { url: task.startUrl, hosts: task.hosts }, 8_000);
      } catch (e) {
        setPhase("idle");
        setSay(e instanceof Error ? e.message : "The extension couldn't open that site. Reload it on chrome://extensions, then refresh this page.");
        return;
      }
    }
    abort.current?.abort();
    void live.current?.answer?.("stop");
    const ac = new AbortController();
    abort.current = ac;
    setPhase("running");
    setLog([]);
    setImage("");
    setSay(`Opening ${site} in a new tab…`);

    const askUi = (text: string, buttons: AskButton[]) =>
      new Promise<string>((resolve) => {
        setPhase("waiting");
        setAsk({ text, buttons, resolve });
      });

    const hands: Hands =
      handsKind === "extension"
        ? extensionHands()
        : serverHands(async (text, buttons) => {
            const choice = await askUi(text, buttons);
            setPhase("running");
            setAsk(null);
            return choice;
          });

    // Extension asks appear in the tab; also mirror them here when we get waiting events.
    const wrapped: Hands = {
      ...hands,
      ask: async (text, buttons) => {
        setPhase("waiting");
        setSay(text);
        if (hands.kind === "server") {
          const choice = await askUi(text, buttons);
          setPhase("running");
          setAsk(null);
          return choice;
        }
        // Extension shows its own bar; the same buttons here answer it too.
        setAsk({ text, buttons, resolve: (id) => void hands.answer?.(id) });
        const choice = await hands.ask(text, buttons);
        setAsk(null);
        setPhase("running");
        return choice;
      },
    };

    const onEvent = (e: RunEvent) => {
      if (e.type === "say") setSay(e.text);
      if (e.type === "image") setImage(e.src);
      if (e.type === "waiting") {
        setPhase("waiting");
        setSay(e.text);
      }
      if (e.type === "log") setLog((prev) => [...prev, { text: e.text, ok: e.ok }].slice(-12));
    };

    live.current = wrapped;
    try {
      const result = await runTask({
        task,
        details,
        hands: wrapped,
        copilot: mode === "settings",
        signal: ac.signal,
        onEvent,
      });
      setSay(result.say);
      setPhase("done");
      await logOutcome(site, taskId, result.outcome === "done" ? "done" : result.outcome, result.say, result.outcome === "done" ? Date.now() + MONTH_MS : undefined);
      if (result.outcome === "done") {
        if (githubFollowUp) setGithubDone(true);
        onDone?.();
        if (ext) {
          void callExtension("record", {
            items: [{ site, nextCheck: Date.now() + MONTH_MS }],
          }).catch(() => {});
        }
      }
      if (result.outcome === "done" && gmailOn && broker) {
        setSay("Looking in your Gmail for a confirmation link…");
        await clickConfirmations(broker.id, wrapped);
      }
    } finally {
      await wrapped.finish().catch(() => {});
      if (live.current === wrapped) live.current = null;
    }
  }

  function answer(id: string) {
    ask?.resolve(id);
    setAsk(null);
    setPhase("running");
  }

  function stop() {
    abort.current?.abort();
    ask?.resolve("stop");
    void live.current?.answer?.("stop");
    setAsk(null);
    setPhase("done");
    setSay("Stopped.");
  }

  return (
    <Card className="mt-4 flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">Cleanup agent · {site}</p>
          <p className="text-sm text-muted">
            {mode === "settings"
              ? "You're already signed in. The agent points; you press Do it."
              : "Only your approved details are typed. Submits wait for your Okay."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      {mode === "broker-form" && (
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="hands" checked={handsKind === "extension"} disabled={!ext} onChange={() => setHandsChoice("extension")} />
            Watch in my Chrome {ext ? `(v${ext})` : "(extension not detected)"}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="hands" checked={handsKind === "server"} disabled={!serverOk} onChange={() => setHandsChoice("server")} />
            Run on the server {serverOk ? "" : "(Chrome not found on this machine)"}
          </label>
        </div>
      )}

      {mode === "settings" && ext === null && (
        <WarnNote>
          <span className="flex flex-col items-start gap-2">
            <span>
              Extension not detected in this tab. If you already installed it, reload this page so the bridge can attach, then check again.
            </span>
            <Button variant="secondary" size="sm" onClick={() => void recheckExtension()}>
              Check again
            </Button>
          </span>
        </WarnNote>
      )}

      {mode === "broker-form" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={gmailOn} onChange={(e) => setGmailOn(e.target.checked)} className="mt-1" />
          <span>
            After submitting, look in my Gmail for a confirmation link and open it (asks permission once).{" "}
            {gmailOn && <GmailConnect />}
          </span>
        </label>
      )}

      <DetailsPreview details={details} />

      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="What the agent sees" className="max-h-64 w-full rounded-control border border-edge object-contain bg-surface" />
      )}

      <p className="text-base" role="status" aria-live="polite">
        {phase === "running" ? (
          <>
            {say}
            <LoadingDots />
          </>
        ) : (
          say
        )}
      </p>

      {ask && (
        <div className="flex flex-col gap-2 rounded-control border border-warn p-3">
          <p className="font-medium">{ask.text}</p>
          <div className="flex flex-wrap gap-2">
            {ask.buttons.map((b) => (
              <Button key={b.id} variant={b.primary ? "primary" : "secondary"} size="sm" onClick={() => answer(b.id)}>
                {b.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? "" : "text-danger-fg"}>
              {l.ok ? "·" : "!"} {l.text}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {phase === "idle" || phase === "done" ? (
          <Button onClick={() => void start()} disabled={mode === "settings" && !ext}>
            {phase === "done" ? "Try again" : "Start"}
          </Button>
        ) : (
          <Button variant="destructive" onClick={stop}>
            Stop
          </Button>
        )}
        {githubFollowUp && phase === "idle" && (
          <Button variant="ghost" size="sm" onClick={() => setShowToken((v) => !v)}>
            {showToken ? "Hide token option" : "Use a GitHub token instead"}
          </Button>
        )}
      </div>

      {githubFollowUp && showToken && phase === "idle" && (
        <GithubOneClick
          onDone={() => {
            setGithubDone(true);
            onDone?.();
          }}
          onClose={() => setShowToken(false)}
          embedded
        />
      )}

      {githubDone && <GithubGitConfigTip />}
    </Card>
  );
}

/* ------------------------------ helpers ------------------------------ */

function detailsFrom(fix: Fix, findings: Finding[], name: string, email: string): Details {
  const related = findings.filter((f) => fix.removesFindingIds.includes(f.id) || fix.optout?.findingIds.includes(f.id));
  const city = related.find((f) => /city|town|location|address/i.test(f.label))?.value;
  const state = related.find((f) => /state|province/i.test(f.label))?.value;
  const age = related.find((f) => /age|born|birth/i.test(f.label))?.value?.replace(/\D/g, "").slice(0, 3);
  let cityPart = city;
  let statePart = state;
  if (city && /,/.test(city) && !state) {
    const [c, s] = city.split(",").map((x) => x.trim());
    cityPart = c;
    statePart = s;
  }
  // A settings fix links to a help article, not a listing. Anything the step route would reject is left out.
  const listing = fix.optout?.listingUrl || (fix.kind === "takedown" ? fix.link : undefined);
  return {
    name,
    email,
    city: cityPart?.slice(0, 60),
    state: statePart?.slice(0, 40),
    age: age || undefined,
    listingUrl: listing && listing.length <= 500 && URL.canParse(listing) ? listing : undefined,
  };
}

function DetailsPreview({ details }: { details: Details }) {
  return (
    <dl className="grid gap-1 rounded-control border border-edge bg-surface p-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted">Name</dt>
        <dd>{details.name}</dd>
      </div>
      <div>
        <dt className="text-muted">Email</dt>
        <dd className="break-all">{details.email}</dd>
      </div>
      {details.city && (
        <div>
          <dt className="text-muted">City</dt>
          <dd>{details.city}</dd>
        </div>
      )}
      {details.state && (
        <div>
          <dt className="text-muted">State</dt>
          <dd>{details.state}</dd>
        </div>
      )}
      {details.listingUrl && (
        <div className="sm:col-span-2">
          <dt className="text-muted">Listing</dt>
          <dd className="break-all">{details.listingUrl}</dd>
        </div>
      )}
      <p className="sm:col-span-2 text-muted">Only these values may be typed into forms.</p>
    </dl>
  );
}

async function logOutcome(site: string, taskId: string, outcome: string, note: string, nextCheck?: number) {
  await fetch("/api/cleanup/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site, taskId, outcome, note, nextCheck }),
  }).catch(() => {});
}

function GmailConnect() {
  const [status, setStatus] = useState<"unknown" | "off" | "on">("unknown");
  useEffect(() => {
    void fetch("/api/cleanup/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "status" }) })
      .then((r) => r.json())
      .then((d: { connected?: boolean }) => setStatus(d.connected ? "on" : "off"))
      .catch(() => setStatus("off"));
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.svx !== "gmail") return;
      setStatus(e.data.result === "ok" || e.data.result === "" ? "on" : "off");
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  if (status === "on") return <span className="text-safe-fg">Gmail connected for this cleanup.</span>;
  return (
    <button
      type="button"
      className="underline underline-offset-4"
      onClick={() => window.open("/api/gmail/connect?purpose=cleanup", "sv-gmail", "width=520,height=720")}
    >
      Connect Gmail once
    </button>
  );
}

async function clickConfirmations(brokerId: string, hands: Hands) {
  const res = await fetch("/api/cleanup/mail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "confirm", brokerId }),
  });
  const data = (await res.json().catch(() => ({}))) as { links?: { url: string; subject: string }[]; error?: string };
  if (!res.ok || !data.links?.length) return;
  for (const link of data.links.slice(0, 2)) {
    const ok = await hands.visit(link.url);
    if (ok) {
      await logOutcome(brokerId, `broker:${brokerId}`, "confirmed", `Opened confirmation link from “${link.subject}”.`);
    }
  }
}

/* ------------------------------ email-only removal ------------------------------ */

function EmailRemoval({
  fix,
  findings,
  name,
  email,
  site,
  onDone,
  onClose,
}: {
  fix: Fix;
  findings: Finding[];
  name: string;
  email: string;
  site: string;
  onDone?: () => void;
  onClose: () => void;
}) {
  const broker = BROKER_SITES.find((b) => b.name.toLowerCase() === fix.optout?.broker.toLowerCase());
  const fields = findings
    .filter((f) => fix.optout?.findingIds.includes(f.id))
    .map((f) => ({ label: f.label, value: f.value }))
    .slice(0, 8);
  const [to, setTo] = useState(broker?.email ?? `privacy@${broker?.domain ?? "example.com"}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/cleanup/mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "send",
          to,
          broker: fix.optout!.broker,
          listingUrl: fix.optout!.listingUrl,
          fields: fields.length ? fields : [{ label: "Name", value: name }],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(data.error || "Couldn't send.");
        return;
      }
      setMsg(`Sent from ${email}. Check your Sent folder.`);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <p className="font-display text-lg font-semibold">Email {site} a removal request</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>
      <p className="text-sm text-muted">
        You approve the address and the text; we send it from your Gmail and forget the access afterwards.
      </p>
      <GmailConnect />
      <label className="text-sm">
        To
        <input value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-control border border-edge bg-surface px-3 py-2" />
      </label>
      <p className="text-sm text-muted">From: {email}</p>
      <Button disabled={busy} onClick={() => void send()}>
        {busy ? "Sending…" : "Send removal email"}
      </Button>
      {msg && <p className="text-sm">{msg}</p>}
    </Card>
  );
}

/* ------------------------------ email a site that is not a broker ------------------------------ */

type Contact = { address: string; page: string; sameSite: boolean };

async function mailOp<T>(body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch("/api/cleanup/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

function SiteEmail({
  fix,
  findings,
  name,
  email,
  site,
  onDone,
  onClose,
}: {
  fix: Fix;
  findings: Finding[];
  name: string;
  email: string;
  site: string;
  onDone?: () => void;
  onClose: () => void;
}) {
  const listingUrl = fix.contact!.listingUrl;
  const fields = useMemo(() => {
    const rows = findings.filter((f) => fix.contact?.findingIds.includes(f.id)).map((f) => ({ label: f.label.slice(0, 80), value: f.value.slice(0, 200) }));
    return (rows.length ? rows : [{ label: "Name", value: name }]).slice(0, 8);
  }, [findings, fix.contact, name]);

  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    void mailOp<{ contacts?: Contact[] }>({ op: "contact", listingUrl }).then(({ data }) => {
      if (!alive) return;
      const list = data.contacts ?? [];
      setContacts(list);
      setTo((cur) => cur || list[0]?.address || "");
    });
    void mailOp<{ subject?: string; body?: string }>({ op: "draftSite", site, listingUrl, fields }).then(({ data }) => {
      if (!alive) return;
      setSubject((cur) => cur || data.subject || "");
      setBody((cur) => cur || data.body || "");
    });
    return () => {
      alive = false;
    };
  }, [listingUrl, site, fields]);

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      const { ok, data } = await mailOp({ op: "sendSite", to: to.trim(), site, listingUrl, fields, subject, body });
      if (!ok) {
        setMsg(data.error || "Couldn't send.");
        return;
      }
      setSent(true);
      setMsg(`Sent from ${email}. Check your Sent folder. Look at the page again in two weeks.`);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  const ready = to.trim() && subject.trim() && body.trim();
  const input = "mt-1 w-full rounded-control border border-edge bg-surface px-3 py-2";
  return (
    <Card className="mt-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <p className="font-display text-lg font-semibold">Email {site} a removal request</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>
      {contacts === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <LoadingDots /> Looking for a contact address on {site}
        </p>
      ) : contacts.length === 0 ? (
        <WarnNote>No contact address found on {site}. Enter one from its Contact or Privacy page.</WarnNote>
      ) : (
        contacts.length > 1 && (
          <div role="radiogroup" aria-label="Addresses found" className="flex flex-wrap gap-2">
            {contacts.map((c) => (
              <button
                key={c.address}
                type="button"
                role="radio"
                aria-checked={to === c.address}
                onClick={() => setTo(c.address)}
                className={`sv-press min-h-11 rounded-full border px-4 text-sm font-medium ${to === c.address ? "border-fg text-fg" : "border-edge text-muted hover:text-fg"}`}
              >
                {c.address}
              </button>
            ))}
          </div>
        )
      )}
      <label className="text-sm">
        To
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
      </label>
      <label className="text-sm">
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
      </label>
      <label className="text-sm">
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className={`${input} font-mono text-xs leading-relaxed`} />
      </label>
      <p className="text-sm text-muted">From: {email}</p>
      <div className="text-sm">
        <GmailConnect />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || sent || !ready} onClick={() => void send()}>
          {busy ? "Sending…" : sent ? "Sent" : "Send from my Gmail"}
        </Button>
        {ready && !sent && (
          <a href={mailtoHref({ subject, body }, to.trim())} className={buttonClass("secondary", "md")}>
            Open in my mail app
          </a>
        )}
      </div>
      {msg && (
        <p className="text-sm" aria-live="polite">
          {msg}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------ GitHub token fallback + local git tip ------------------------------ */

function GithubGitConfigTip({ noreply }: { noreply?: string }) {
  const sample = noreply || "ID+username@users.noreply.github.com";
  const cmd = `git config --global user.email "${sample}"`;
  return (
    <div className="flex flex-col gap-2 rounded-control border border-edge bg-surface p-3 text-sm">
      <p className="font-medium">One step left on your computer</p>
      <p className="text-muted">
        Copy your noreply address from the GitHub Emails page{noreply ? " (filled in below)" : ""}, then run this on each machine you commit from:
      </p>
      <code className="break-all rounded-control border border-edge bg-bg px-3 py-2 font-mono text-xs">{cmd}</code>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(cmd).catch(() => {});
        }}
      >
        Copy command
      </Button>
    </div>
  );
}

function GithubOneClick({
  onDone,
  onClose,
  embedded = false,
}: {
  onDone?: () => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [noreply, setNoreply] = useState<string | undefined>();

  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/cleanup/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; noreply?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error || "That didn't work.");
        return;
      }
      setNoreply(data.noreply);
      setMsg(
        data.noreply
          ? "Primary email is private. Still turn on “Block command line pushes…” with Clean this up for me (the API can’t flip that switch)."
          : "Primary email is private. Still turn on “Block command line pushes that expose my email” on the Emails page — Clean this up for me does both.",
      );
      setToken("");
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      {!embedded && (
        <header className="flex items-start justify-between gap-3">
          <p className="font-display text-lg font-semibold">Hide your GitHub email</p>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>
      )}
      <p className="text-sm text-muted">
        Token fallback: sets email visibility only (not the push-block checkbox). Needs the <code className="text-fg">user</code> permission; used once and never stored.{" "}
        <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          Create a token
        </a>
      </p>
      <input
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_…"
        className="w-full rounded-control border border-edge bg-surface px-3 py-2 font-mono text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || token.length < 20} onClick={() => void run()}>
          {busy ? "Working…" : "Make email private"}
        </Button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      {noreply && <GithubGitConfigTip noreply={noreply} />}
    </>
  );

  if (embedded) return <div className="flex flex-col gap-3 border-t border-edge pt-3">{body}</div>;
  return <Card className="mt-4 flex flex-col gap-3">{body}</Card>;
}

/* ------------------------------ prepare-only (2FA / security questions) ------------------------------ */

function PrepareOnly({ fix, onClose }: { fix: Fix; onClose: () => void }) {
  const suggestion = useMemo(() => {
    const words = "correct-horse-battery-staple";
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map((n) => (n % 36).toString(36))
      .join("");
    return `${words}-${rand}`;
  }, []);

  return (
    <Card className="mt-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <p className="font-display text-lg font-semibold">You do this one</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>
      <p className="text-sm text-muted">
        Changing security questions or turning on two-step login has to be you. Here&apos;s a strong answer to paste if you need one — store it in your password manager, not in email.
      </p>
      <p className="rounded-control border border-edge bg-surface px-3 py-2 font-mono text-sm break-all">{suggestion}</p>
      {fix.link && (
        <a href={fix.link} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
          Open the page
        </a>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {fix.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </Card>
  );
}
