import { LEVEL, getSettings, reportUrl } from "./shared.js";

const root = document.getElementById("result");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const THREAT = {
  phishing: "is on Google's list of phishing sites",
  malware: "is on Google's list of sites that spread malware",
  unwanted: "is on Google's list of sites with unwanted software",
};
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Links and numbers that others reported (Google Safe Browsing, FTC complaints). */
function reportedCard(reported) {
  if (!reported) return null;
  const { links = [], numbers = [], checked = {} } = reported;
  if (!links.length && !numbers.length) {
    const looked = [checked.links ? plural(checked.links, "link") : "", checked.numbers ? plural(checked.numbers, "phone number") : ""].filter(Boolean);
    return looked.length ? el("p", { class: "muted small" }, `Looked up ${looked.join(" and ")} in public scam reports: none reported.`) : null;
  }
  const items = [
    ...links.map((l) => el("li", {}, el("strong", {}, l.url.replace(/^https?:\/\//, "").replace(/\/$/, "")), ` ${THREAT[l.threat] ?? "is on a scam list"}. Don't open it.`)),
    ...numbers.map((n) =>
      el(
        "li",
        {},
        el("strong", {}, n.display),
        ` was reported ${plural(n.reports, "time")} to the FTC in the last 10 days${n.topSubject && n.topSubject !== "Other" ? `, mostly for "${n.topSubject}"` : ""}.`,
      ),
    ),
  ];
  return el("div", { class: "card reported" }, el("p", {}, el("strong", {}, "Reported by others")), el("ul", { class: "small" }, ...items));
}

async function render(last) {
  if (!last) return;
  root.replaceChildren();
  if (last.status === "loading") {
    root.append(el("p", { class: "muted" }, "Checking…"));
    return;
  }
  if (last.status === "error") {
    root.append(el("div", { class: "card" }, el("p", {}, last.message)));
    return;
  }
  const { level, matches = [] } = last.data;
  const { appUrl } = await getSettings();
  const signs = [...new Set(matches.flatMap((m) => m.signs))];

  root.append(
    el(
      "div",
      { class: "card" },
      el("span", { class: `badge ${level}` }, LEVEL[level] ?? level),
      el("p", { class: "quote small" }, last.text),
      signs.length ? el("ul", { class: "small" }, ...signs.map((s) => el("li", {}, s))) : null,
    ),
  );

  const reported = reportedCard(last.data.reported);
  if (reported) root.append(reported);

  const best = matches[0];
  if (best) {
    root.append(
      el(
        "div",
        { class: "card" },
        el("p", { class: "muted small" }, "Closest known scam"),
        el("h2", {}, best.name),
        el("p", { class: "muted" }, best.tagline),
        el("p", { class: "small" }, el("strong", {}, "What to do: "), best.action),
      ),
    );
  } else {
    root.append(el("p", { class: "muted" }, "Nothing close in the library. If it still feels off, check with the sender on a number you already have."));
  }

  root.append(
    el(
      "a",
      { class: "button secondary", href: reportUrl(appUrl, last.text), target: "_blank", rel: "noopener" },
      best?.practice ? "Full report and practice call" : "Open the full report",
    ),
  );
}

chrome.storage.session.get("last").then(({ last }) => render(last));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.last) void render(changes.last.newValue);
});

document.getElementById("paste").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = document.getElementById("text").value.trim();
  if (text) void chrome.runtime.sendMessage({ type: "check-in-panel", text });
});
