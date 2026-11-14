/*
 * Google Safe Browsing v4 Lookup API: one request for all links in a message.
 * https://developers.google.com/safe-browsing/v4/lookup-api
 */

export type LinkThreat = "phishing" | "malware" | "unwanted";

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const THREAT_TYPES: Record<string, LinkThreat> = {
  SOCIAL_ENGINEERING: "phishing",
  MALWARE: "malware",
  UNWANTED_SOFTWARE: "unwanted",
  POTENTIALLY_HARMFUL_APPLICATION: "malware",
};

interface MatchResponse {
  matches?: { threatType?: string; threat?: { url?: string } }[];
}

/** Map of flagged url to threat. Links not in the map are not on Google's lists. Throws on API errors. */
export async function safeBrowsingLookup(
  urls: string[],
  key: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, LinkThreat>> {
  const found = new Map<string, LinkThreat>();
  if (urls.length === 0) return found;
  const res = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      client: { clientId: "scammers-view", clientVersion: "1.0" },
      threatInfo: {
        threatTypes: Object.keys(THREAT_TYPES),
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: urls.map((url) => ({ url })),
      },
    }),
  });
  if (!res.ok) throw new Error(`Safe Browsing ${res.status}`);
  const data = (await res.json()) as MatchResponse;
  for (const m of data.matches ?? []) {
    const url = m.threat?.url;
    const threat = m.threatType ? THREAT_TYPES[m.threatType] : undefined;
    if (url && threat && !found.has(url)) found.set(url, threat);
  }
  return found;
}
