import { z } from "zod";

/** Details the student agreed the agent may type into forms. Nothing else is ever typed. */
export const Details = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  city: z.string().trim().max(60).optional(),
  state: z.string().trim().max(40).optional(),
  age: z.string().trim().max(3).optional(),
  listingUrl: z.string().trim().url().max(500).optional(),
});
export type Details = z.infer<typeof Details>;

/** One clickable or fillable thing on the page. Password and hidden fields are never listed. */
export const PageElement = z.object({
  i: z.number().int().min(0),
  tag: z.string().max(20),
  type: z.string().max(20).optional(),
  role: z.string().max(20).optional(),
  label: z.string().max(120),
  value: z.string().max(60).optional(),
  checked: z.boolean().optional(),
  href: z.string().max(200).optional(),
});
export type PageElement = z.infer<typeof PageElement>;

export const PageSnapshot = z.object({
  url: z.string().max(2000),
  title: z.string().max(200),
  text: z.string().max(4000),
  elements: z.array(PageElement).max(200),
  captcha: z.boolean(),
});
export type PageSnapshot = z.infer<typeof PageSnapshot>;

export type ActionKind = "click" | "type" | "select" | "goto" | "done" | "needs_user" | "not_found" | "fail";

export interface AgentAction {
  action: ActionKind;
  index?: number;
  text?: string;
  url?: string;
  /** One plain sentence for the student: what the agent is doing or needs. */
  say: string;
  /** True when this step sends something to the site (submit, remove, confirm, save a setting). */
  submits: boolean;
}

export type TaskKind = "broker" | "settings";

export interface CleanupTask {
  id: string;
  kind: TaskKind;
  site: string;
  /** Where the agent starts. */
  startUrl: string;
  /** Hosts the agent may visit (the site and its own subdomains). */
  hosts: string[];
  /** What "done" means, in plain words, for the model. */
  goal: string;
}
