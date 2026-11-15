// Run: npx tsx --test src/lib/cleanup/contact.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageData } from "../scan/pageFetch";
import type { Fix } from "../fixes/types";
import { siteDraft } from "../fixes/optout";
import { decodeCfEmail } from "../scan/pageFetch";
import { baseDomain, contactPages, emailsOnPage, findSiteContact, guessedAddresses, plainAddresses, recipientAllowed, sameSite, siteContactInfo, suggested } from "./contact";
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

test("disguised addresses are read: [at]/(dot) spellings and Cloudflare-protected ones", () => {
  assert.equal(plainAddresses("write to editor [at] campus-news [dot] example today"), "write to editor@campus-news.example today");
  assert.equal(plainAddresses("privacy(at)campus-news(dot)example"), "privacy@campus-news.example");
  const found = emailsOnPage("Newsroom: editor [at] campus-news [dot] example", "campus-news.example", "https://campus-news.example/contact");
  assert.deepEqual(found.map((c) => c.address), ["editor@campus-news.example"]);
  // key 0x2a, then each character of "a@b.co" XOR 0x2a
  const hex = "2a" + [..."a@b.co"].map((ch) => (ch.charCodeAt(0) ^ 0x2a).toString(16).padStart(2, "0")).join("");
  assert.equal(decodeCfEmail(hex), "a@b.co");
  assert.equal(decodeCfEmail("zz"), "");
  assert.equal(decodeCfEmail("2a4b"), "");
});

test("contact pages on the site's other subdomains are followed, lookalike domains are not", () => {
  assert.equal(baseDomain("news.school.example"), "school.example");
  assert.equal(baseDomain("www.paper.co.uk"), "paper.co.uk");
  const pages = contactPages("https://news.school.example/story/1", [
    { url: "https://www.school.example/contact", text: "Contact" },
    { url: "https://school.example.evil.example/contact", text: "Contact" },
    { url: "http://www.school.example/privacy", text: "Privacy" },
  ]);
  assert.equal(pages[0], "https://www.school.example/contact");
  assert.ok(!pages.some((u) => u.includes("evil.example")) && !pages.some((u) => u.startsWith("http://")));
  assert.ok(pages.includes("https://news.school.example/.well-known/security.txt"));
});

test("findSiteContact: footer links beyond the first 80 and security.txt are used", async () => {
  const listing = "https://campus-news.example/story/1";
  const site: Record<string, PageData> = {
    [listing]: page(listing, "Alex Rivera wins award", {
      links: Array.from({ length: 80 }, (_, i) => ({ url: `https://campus-news.example/tag/${i}`, text: `Tag ${i}` })),
      contactLinks: [{ url: "https://campus-news.example/masthead", text: "Masthead" }],
    }),
    "https://campus-news.example/masthead": page("https://campus-news.example/masthead", "Editor: editor@campus-news.example"),
    "https://campus-news.example/.well-known/security.txt": page("https://campus-news.example/.well-known/security.txt", "Contact: mailto:security@campus-news.example"),
  };
  const found = await findSiteContact(listing, AbortSignal.timeout(1000), async (url) => site[url] ?? null);
  assert.deepEqual(found.map((c) => c.address).sort(), ["editor@campus-news.example", "security@campus-news.example"]);
});

test("suggested: only sensible addresses on the site's own domain, role inboxes before people", () => {
  const c = (address: string, same = true) => ({ address, page: "https://campus-news.example/contact", sameSite: same });
  const list = [c("jsmith@campus-news.example"), c("ads@agency.example", false), c("privacy@campus-news.example"), c("u1234567890@campus-news.example"), c("editor@campus-news.example")];
  assert.deepEqual(suggested(list).map((x) => x.address), ["privacy@campus-news.example", "editor@campus-news.example"]);
  assert.deepEqual(suggested([c("jsmith@campus-news.example")]).map((x) => x.address), ["jsmith@campus-news.example"]);
  assert.deepEqual(suggested([c("ads@agency.example", false)]), []);
});

test("guessedAddresses: role inboxes on the domain, only when it takes mail and is not a shared host", async () => {
  const takesMail = async () => [{ exchange: "mx.campus-news.example", priority: 10 }];
  assert.deepEqual(await guessedAddresses("https://news.campus-news.example/story/1", takesMail), ["privacy@campus-news.example", "contact@campus-news.example", "info@campus-news.example"]);
  assert.deepEqual(await guessedAddresses("https://campus-news.example/story/1", async () => []), []);
  assert.deepEqual(await guessedAddresses("https://campus-news.example/story/1", async () => Promise.reject(new Error("ENOTFOUND"))), []);
  assert.deepEqual(await guessedAddresses("https://alex.github.io/about", takesMail), []);
});

test("siteContactInfo: published address, else the contact page plus guesses", async () => {
  const listing = "https://campus-news.example/story/1";
  const mx = async () => [{}];
  const withAddress = async (url: string) => (url === listing ? page(listing, "Write to editor@campus-news.example") : null);
  const a = await siteContactInfo(listing, AbortSignal.timeout(1000), withAddress, mx);
  assert.deepEqual(a.contacts.map((c) => c.address), ["editor@campus-news.example"]);
  assert.deepEqual(a.guesses, []);

  const formOnly = async (url: string) =>
    url === listing ? page(listing, "Alex Rivera wins award") : url === "https://campus-news.example/contact" ? page(url, "Use the form below.") : null;
  const b = await siteContactInfo(listing, AbortSignal.timeout(1000), formOnly, mx);
  assert.deepEqual(b.contacts, []);
  assert.equal(b.contactPage, "https://campus-news.example/contact");
  assert.equal(b.guesses[0], "privacy@campus-news.example");
  assert.equal(await recipientAllowed(b.guesses[0], listing, AbortSignal.timeout(1000), formOnly), true);

  const nothing = await siteContactInfo(listing, AbortSignal.timeout(1000), async (url) => (url === listing ? page(listing, "Alex Rivera") : null), async () => []);
  assert.deepEqual(nothing, { contacts: [], contactPage: null, guesses: [] });
});
