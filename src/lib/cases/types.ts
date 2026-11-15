import { z } from "zod";
import { FindingCategory } from "@/lib/types";

/** Real, published scam reports (FBI IC3, FTC). Reference documents only: nothing about any user is indexed. */

export interface CaseDoc {
  id: string;
  source: "FBI IC3" | "FTC";
  url: string;
  year: number;
  title: string;
  summary: string;
  scam_type: string;
  /** One plain line on how this kind of scam works. */
  how: string;
  /** How it reaches you: phone, text, email, social, web, mail, in_person. */
  channels: string[];
  /** Public facts the scam relies on, as finding categories. */
  needs: FindingCategory[];
}

export const CaseHit = z.object({
  id: z.string(),
  source: z.enum(["FBI IC3", "FTC"]),
  url: z.string(),
  year: z.number(),
  title: z.string(),
  summary: z.string(),
  scam_type: z.string(),
  how: z.string(),
  channels: z.array(z.string()),
  needs: z.array(FindingCategory),
  /** 0..1, comparable within one query only. */
  score: z.number(),
});
export type CaseHit = z.infer<typeof CaseHit>;

/** One search per query (an attack chain, a practice scenario). The text is used for ranking and never stored. */
export const CaseRequest = z
  .object({
    exposed: z.array(FindingCategory).max(20),
    queries: z.array(z.object({ id: z.string().max(80), text: z.string().trim().min(1).max(600) })).min(1).max(8),
    limit: z.number().int().min(1).max(12).optional(),
  })
  .strict();
export type CaseRequest = z.infer<typeof CaseRequest>;

export const CaseResponse = z.object({
  engine: z.enum(["typesense", "local"]),
  byQuery: z.record(z.string(), z.array(CaseHit)),
});
export type CaseResponse = z.infer<typeof CaseResponse>;
