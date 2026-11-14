import Anthropic from "@anthropic-ai/sdk";
import type { ScanSubject } from "@/lib/types";
import { FindingCategory, IdentityAnchor, SourceType as SourceTypeEnum } from "@/lib/types";
import type { FindingCollector } from "./findings";
import type { Limiter } from "./limit";
import type { PageReader } from "./pageReader";
import { SEARCH_SYSTEM, subjectBlock } from "./prompts";

/**
 * One search = one small Claude call with the server-side web_search tool and a
 * client `report_findings` tool. The worker stops as soon as the report block
 * completes (no second round trip), so findings stream out per search.
 */

const REPORT_TOOL = {
  name: "report_findings",
  description: "Record what the search showed about the subject, and which result pages are worth reading in full. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: FindingCategory.exclude(["video"]).options },
            label: { type: "string", description: "Short label, e.g. \"Dog's name\", \"High school\", \"Instagram handle\"." },
            value: { type: "string", description: "The specific fact itself, e.g. \"Biscuit\". Not a description." },
            sourceType: { type: "string", enum: SourceTypeEnum.options, description: "Kind of site the result is on." },
            sourceUrl: { type: "string", description: "Exact URL of the result that shows the fact." },
            sourceTitle: { type: "string" },
            snippet: { type: "string", description: "Short quote (under 200 chars) from the result." },
            anchor: { type: "string", enum: IdentityAnchor.options.filter((a) => a !== "face") },
            confidence: { type: "number" },
            riskWeight: { type: "number" },
          },
          required: ["category", "label", "value", "sourceType", "sourceUrl", "anchor", "confidence", "riskWeight"],
        },
      },
      pages: {
        type: "array",
        description: "Up to 5 result URLs clearly about the subject that are worth reading in full.",
        items: {
          type: "object",
          properties: { url: { type: "string" }, why: { type: "string" } },
          required: ["url", "why"],
        },
      },
    },
    required: ["findings", "pages"],
  },
};

export interface WorkerResult {
  accepted: number;
  searches: number;
  input: number;
  output: number;
  cacheRead: number;
}

export async function runSearchWorker(
  query: string,
  hint: string,
  agentId: string,
  ctx: {
    subject: ScanSubject;
    collector: FindingCollector;
    reader: PageReader;
    client: Anthropic;
    model: string;
    limiter: Limiter;
    signal: AbortSignal;
    knownAnchors: () => string;
  },
): Promise<WorkerResult> {
  const out: WorkerResult = { accepted: 0, searches: 0, input: 0, output: 0, cacheRead: 0 };
  return ctx.limiter.run(async () => {
    if (ctx.signal.aborted) return out;
    const local = new AbortController();
    const stop = () => local.abort();
    ctx.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 45_000);
    let reported = false;
    const adds: Promise<void>[] = [];
    try {
      const stream = ctx.client.beta.messages.stream(
        {
          model: ctx.model,
          max_tokens: 8000,
          system: [{ type: "text", text: SEARCH_SYSTEM, cache_control: { type: "ephemeral" } }],
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }, REPORT_TOOL],
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages: [
            {
              role: "user",
              content: `Subject (the signed-in user; the only person you may research):\n${subjectBlock(ctx.subject)}\nAlready confirmed about them: ${ctx.knownAnchors() || "(nothing yet)"}\n\nYour search query: ${query}\nWhat to look for: ${hint}`,
            },
          ],
        },
        { signal: local.signal },
      );
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") out.searches++;
        if (block.type === "tool_use" && block.name === "report_findings" && !reported) {
          reported = true;
          const input = block.input as { findings?: unknown[]; pages?: { url?: string; why?: string }[] };
          for (const f of Array.isArray(input.findings) ? input.findings : []) {
            adds.push(ctx.collector.add(f, agentId).then((r) => { if (r.ok) out.accepted++; }));
          }
          for (const p of Array.isArray(input.pages) ? input.pages.slice(0, 5) : []) {
            if (typeof p?.url === "string") ctx.reader.enqueue({ url: p.url, why: p.why ?? "", depth: 0 });
          }
        }
      });
      // The turn ends right after report_findings (stop_reason tool_use); no second round trip.
      const msg = await stream.finalMessage();
      out.input += msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0);
      out.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
      out.output += msg.usage.output_tokens;
      if (process.env.SCAN_DEBUG === "1") console.log(`[scan:${agentId}] worker stop=${msg.stop_reason} reported=${reported} searches=${out.searches}`);
      await Promise.allSettled(adds);
    } catch (e) {
      await Promise.allSettled(adds);
      if (!ctx.signal.aborted) console.warn(`[scan:${agentId}] worker failed:`, e instanceof Error ? e.message.slice(0, 160) : e);
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", stop);
    }
    return out;
  });
}
