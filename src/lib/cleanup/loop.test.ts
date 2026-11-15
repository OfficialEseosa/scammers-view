import { test } from "node:test";
import assert from "node:assert/strict";
import { runTask } from "@/features/cleanup/loop";
import type { Hands } from "@/features/cleanup/hands";
import { BROKER_SITES, brokerTask } from "./sites";
import type { AgentAction, Details, PageSnapshot } from "./types";

const details: Details = { name: "Alex Rivera", email: "alex@school.edu", listingUrl: "https://www.spokeo.com/Alex-Rivera/example" };
const task = brokerTask(BROKER_SITES[0], details.listingUrl);
const page: PageSnapshot = { url: task.startUrl, title: "Opt out", text: "", captcha: false, elements: [{ i: 0, tag: "button", label: "Submit" }] };

type Snap = Awaited<ReturnType<Hands["snapshot"]>>;

/** Scripted hands and a scripted step route; nothing leaves the process. */
function rig(steps: AgentAction[], opts: { answers?: (string | undefined)[]; snaps?: Snap[] } = {}) {
  const acted: AgentAction[] = [];
  const asked: string[] = [];
  const sent: { history: string[] }[] = [];
  const answers = [...(opts.answers ?? [])];
  const snaps = [...(opts.snaps ?? [])];
  const queue = [...steps];
  const hands: Hands = {
    kind: "extension",
    open: async () => {},
    snapshot: async () => snaps.shift() ?? { page },
    act: async (s) => {
      acted.push(s);
      return { ok: true };
    },
    highlight: async () => {},
    status: async () => {},
    ask: async (text) => {
      asked.push(text);
      return answers.shift() as string;
    },
    visit: async () => true,
    finish: async () => {},
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? "{}") as { history: string[] });
    const action = queue.shift() ?? { action: "done", say: "All set.", submits: false };
    return new Response(JSON.stringify({ action }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const run = (copilot = false) =>
    runTask({ task, details, hands, copilot, signal: new AbortController().signal, onEvent: () => {} }).finally(() => {
      globalThis.fetch = realFetch;
    });
  return { run, acted, asked, sent };
}

const submit: AgentAction = { action: "click", index: 0, say: "Submitting the removal request.", submits: true };

test("runTask: a submit step waits for an explicit yes", async () => {
  const yes = rig([submit], { answers: ["ok"] });
  assert.equal((await yes.run()).outcome, "done");
  assert.equal(yes.acted.length, 1);

  const skip = rig([submit], { answers: ["skip"] });
  assert.equal((await skip.run()).outcome, "done");
  assert.equal(skip.acted.length, 0);
  assert.match(skip.sent[1].history[0], /said no/);
});

test("runTask: a question that comes back with no answer never submits", async () => {
  const lost = rig([submit], { answers: [undefined] });
  const res = await lost.run();
  assert.equal(res.outcome, "stopped");
  assert.equal(lost.acted.length, 0);
});

test("runTask: a tab on another website waits for the student instead of failing", async () => {
  const r = rig([{ action: "done", say: "Your details are hidden.", submits: false }], {
    snaps: [{ away: "accounts.google.com" }],
    answers: ["continue"],
  });
  const res = await r.run(true);
  assert.equal(res.outcome, "done");
  assert.match(r.asked[0], /accounts\.google\.com/);
  assert.match(r.sent[0].history[0], /brought it back/);

  const stop = rig([], { snaps: [{ away: "accounts.google.com" }], answers: ["stop"] });
  assert.equal((await stop.run(true)).outcome, "needs_user");
  assert.equal(stop.sent.length, 0);
});

test("runTask: history lines stay within what the step route accepts", async () => {
  const long: AgentAction = { action: "goto", url: "https://www.spokeo.com/" + "a".repeat(600), say: "Opening the form.", submits: false };
  const r = rig([long]);
  await r.run();
  assert.ok(r.sent[1].history.every((h) => h.length <= 300));
});
