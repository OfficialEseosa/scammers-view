import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { allowedUrl } from "./sites";
import type { AgentAction, CleanupTask, PageSnapshot } from "./types";

/*
 * The server's invisible browser for students who don't want to watch. One private browser
 * context per session (no shared cookies), memory only, closed after 5 idle minutes. It only
 * ever opens the task's own site.
 */

const IDLE_MS = 5 * 60 * 1000;
const MAX_SESSIONS = 3;
const VIEWPORT = { width: 1100, height: 820 };

interface Session {
  id: string;
  owner: string;
  task: CleanupTask;
  context: BrowserContext;
  page: Page;
  lastUsed: number;
}

type State = { browser?: Promise<Browser>; sessions: Map<string, Session>; sweeper?: ReturnType<typeof setInterval> };
const g = globalThis as unknown as { __svCleanupBrowser?: State };
const state: State = (g.__svCleanupBrowser ??= { sessions: new Map() });

const CHROME_PATHS = [
  process.env.CLEANUP_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function chromePath(): string | undefined {
  return CHROME_PATHS.find((p): p is string => Boolean(p && existsSync(p)));
}

export function serverBrowserAvailable(): boolean {
  return process.env.CLEANUP_SERVER_BROWSER !== "off" && Boolean(chromePath());
}

async function browser(): Promise<Browser> {
  if (!state.browser) {
    const executablePath = chromePath();
    if (!executablePath) throw new Error("No Chrome found for the server browser");
    const { chromium } = await import("playwright-core");
    state.browser = chromium.launch({ executablePath, headless: true, args: ["--disable-blink-features=AutomationControlled"] }).catch((e) => {
      state.browser = undefined;
      throw e;
    });
  }
  const b = await state.browser;
  if (!b.isConnected()) {
    state.browser = undefined;
    return browser();
  }
  return b;
}

function sweep(now = Date.now()) {
  for (const [id, s] of state.sessions) {
    if (now - s.lastUsed > IDLE_MS) void closeSession(id);
  }
}

function pageScript(): string {
  return path.join(process.cwd(), "extension", "agent-page.js");
}

export async function openSession(owner: string, task: CleanupTask): Promise<{ id: string } | { error: string }> {
  sweep();
  for (const s of state.sessions.values()) if (s.owner === owner) await closeSession(s.id);
  if (state.sessions.size >= MAX_SESSIONS) return { error: "The server browser is busy. Try again in a minute, or watch it in your Chrome." };
  if (!allowedUrl(task.startUrl, task.hosts)) return { error: "Unknown site." };
  const b = await browser();
  const context = await b.newContext({ viewport: VIEWPORT, locale: "en-US" });
  await context.addInitScript({ path: pageScript() });
  const page = await context.newPage();
  const id = randomBytes(12).toString("base64url");
  state.sessions.set(id, { id, owner, task, context, page, lastUsed: Date.now() });
  state.sweeper ??= setInterval(() => sweep(), 60_000);
  state.sweeper.unref?.();
  await page.goto(task.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  return { id };
}

function get(id: string, owner: string): Session | null {
  const s = state.sessions.get(id);
  if (!s || s.owner !== owner) return null;
  s.lastUsed = Date.now();
  return s;
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
}

export async function snapshotSession(id: string, owner: string): Promise<{ page: PageSnapshot; image: string } | null> {
  const s = get(id, owner);
  if (!s) return null;
  await settle(s.page);
  const snap = (await s.page.evaluate(() => (window as unknown as { __svxAgent: { snapshot: () => unknown } }).__svxAgent.snapshot())) as PageSnapshot;
  const shot = await s.page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null);
  return { page: snap, image: shot ? `data:image/jpeg;base64,${shot.toString("base64")}` : "" };
}

export async function actSession(id: string, owner: string, step: AgentAction): Promise<{ ok: boolean; error?: string }> {
  const s = get(id, owner);
  if (!s) return { ok: false, error: "This browser session ended." };
  try {
    if (step.action === "goto") {
      if (!step.url || !allowedUrl(step.url, s.task.hosts)) return { ok: false, error: "Refused: another website." };
      await s.page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return { ok: true };
    }
    const target = s.page.locator(`[data-svx="${step.index}"]`).first();
    if (step.action === "click") await target.click({ timeout: 8000 });
    else if (step.action === "type") await target.fill(step.text ?? "", { timeout: 8000 });
    else if (step.action === "select") {
      const res = (await s.page.evaluate(
        (st) => (window as unknown as { __svxAgent: { act: (x: unknown) => unknown } }).__svxAgent.act(st),
        step,
      )) as { ok: boolean; error?: string };
      if (!res.ok) return res;
    } else return { ok: false, error: "Unsupported step." };
    await settle(s.page);
    return { ok: true };
  } catch {
    return { ok: false, error: "That step didn't work on the page." };
  }
}

/** Opens a confirmation link from the student's email inside the same private session. */
export async function visitSession(id: string, owner: string, url: string): Promise<{ ok: boolean }> {
  const s = get(id, owner);
  if (!s || !allowedUrl(url, s.task.hosts)) return { ok: false };
  try {
    await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function closeSession(id: string): Promise<void> {
  const s = state.sessions.get(id);
  if (!s) return;
  state.sessions.delete(id);
  await s.context.close().catch(() => {});
}

export async function closeOwnerSessions(owner: string): Promise<void> {
  for (const s of [...state.sessions.values()]) if (s.owner === owner) await closeSession(s.id);
}
