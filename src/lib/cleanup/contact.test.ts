// Run: npx tsx --test src/lib/cleanup/contact.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageData } from "../scan/pageFetch";
import type { Fix } from "../fixes/types";
import { siteDraft } from "../fixes/optout";
import { contactPages, emailsOnPage, findSiteContact, recipientAllowed, sameSite } from "./contact";
import { cleanupForFix } from "./tasks";

const page = (url: string, text: string, extra: Partial<PageData> = {}): PageData => ({ url, title: "", description: "", text, images: [], links: [], metaOnly: false, ...extra });

test("sameSite: the site's own domain and subdomains, never a shared host or a lookalike", () => {
  assert.equal(sameSite("campus-news.example", "campus-news.example"), true);
  assert.equal(sameSite("campus-news.example", "www.campus-news.example"), true);
  assert.equal(sameSite("mail.campus-news.example", "campus-news.example"), true);
  assert.equal(sameSite("gmail.com", "campus-news.example"), false);
  assert.equal(sameSite("notcampus-news.example", "campus-news.example"), false);
  assert.equal(sameSite("github.io", "alex.github.io"), false);
});

test("emailsOnPage: privacy inbox on the site's domain first, junk and no-reply dropped", () => {
  const text = "Write to editor@campus-news.example or privacy@campus-news.example. Photo: hero@2x.png. noreply@campus-news.example. Agency: tips@gmail.com";
  const found = emailsOnPage(text, "campus-news.example", "https://campus-news.example/contact");
  assert.deepEqual(found.map((c) => c.address), ["privacy@campus-news.example", "editor@campus-news.example", "tips@gmail.com"]);
  assert.equal(found[0].sameSite, true);
  assert.equal(found[2].sameSite, false);
});

test("contactPages: linked privacy and contact pages on the same host, then common paths", () => {
  const pages = contactPages("https://campus-news.example/story/1", [
    { url: "https://campus-news.example/about/contact-us#form", text: "Contact" },
    { url: "https://other.example/privacy", text: "Privacy" },
    { url: "https://campus-news.example/sports", text: "Sports" },
  ]);
  assert.equal(pages[0], "https://campus-news.example/about/contact-us");
  assert.ok(pages.includes("https://campus-news.example/privacy"));
  assert.ok(pages.every((u) => u.startsWith("https://campus-news.example/")));
  assert.ok(pages.length <= 5);
  assert.deepEqual(contactPages("not a url"), []);
});

test("findSiteContact: reads the listing, follows to the contact page, uses mailto links", async () => {
  const site: Record<string, PageData> = {
    "https://campus-news.example/story/1": page("https://campus-news.example/story/1", "Alex Rivera wins award", {
      links: [{ url: "https://campus-news.example/contact", text: "Contact us" }],
    }),
    "https://campus-news.example/contact": page("https://campus-news.example/contact", "Reach the newsroom.", { mailto: ["newsroom@campus-news.example"] }),
  };
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    asked.push(url);
    return site[url] ?? null;
  };
  const found = await findSiteContact("https://campus-news.example/story/1", AbortSignal.timeout(1000), fetcher);
  assert.deepEqual(found.map((c) => c.address), ["newsroom@campus-news.example"]);
  assert.equal(found[0].page, "https://campus-news.example/contact");
  assert.ok(asked.length <= 6 && asked.every((u) => u.startsWith("https://campus-news.example/")));
  assert.deepEqual(await findSiteContact("https://campus-news.example/story/1", AbortSignal.timeout(1000), async () => null), []);
});

test("recipientAllowed: the site's domain or an address it publishes, nothing else", async () => {
  const listing = "https://campus-news.example/story/1";
  const fetcher = async (url: string) => (url === listing ? page(listing, "Press contact: desk@press-agency.example") : null);
  const sig = () => AbortSignal.timeout(1000);
  assert.equal(await recipientAllowed("anything@campus-news.example", listing, sig(), fetcher), true);
  assert.equal(await recipientAllowed("desk@press-agency.example", listing, sig(), fetcher), true);
  assert.equal(await recipientAllowed("stranger@elsewhere.example", listing, sig(), fetcher), false);
  assert.equal(await recipientAllowed("not-an-address", listing, sig(), fetcher), false);
});

test("a takedown on someone else's site offers the email, and the draft names the page and details", () => {
  const fix = {
    id: "fix:takedown:campus-news-example",
    kind: "takedown",
    title: "Take Award off campus-news.example",
    why: "",
    steps: [],
    removesFindingIds: ["f1"],
    scoreDrop: 1,
    breaksChainIds: [],
    effort: "15 min",
    link: "https://campus-news.example/story/1",
    contact: { site: "campus-news.example", listingUrl: "https://campus-news.example/story/1", findingIds: ["f1"] },
  } as Fix;
  assert.deepEqual(cleanupForFix(fix), { taskId: "email:campus-news.example", mode: "site-email", site: "campus-news.example" });
  assert.equal(cleanupForFix({ ...fix, contact: undefined }), null);

  const d = siteDraft({ name: "Alex Rivera", email: "alex@example.com", site: "campus-news.example", listingUrl: fix.link!, fields: [{ label: "Award", value: "Dean's list" }] });
  assert.ok(d.subject.includes("Alex Rivera"));
  assert.ok(d.body.includes("https://campus-news.example/story/1") && d.body.includes("- Award: Dean's list") && d.body.endsWith("alex@example.com"));
});
