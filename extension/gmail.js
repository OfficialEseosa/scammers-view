// Gmail warning banner. Registered only after the student turns it on in the popup.
// Reads the open email's text, asks the background worker to check it, and shows a small
// banner above the email for "some" or "high" warning levels. If Gmail's layout changes and
// the selectors stop matching, it simply does nothing.
(() => {
  const BODY = [".a3s.aiL", ".ii.gt .a3s", "div[role='listitem'] .a3s"];
  const SUBJECT = ["h2.hP", "h2[data-thread-perm-id]"];
  const MAX = 4000;
  let lastKey = "";
  let timer = 0;

  const first = (sels, root = document) => {
    for (const s of sels) {
      const n = root.querySelectorAll(s);
      if (n.length) return n[n.length - 1];
    }
    return null;
  };

  function scan() {
    try {
      const body = first(BODY);
      if (!body || body.closest(".svx-banner")) return;
      const subject = first(SUBJECT)?.innerText?.trim() ?? "";
      const text = `${subject}\n${body.innerText ?? ""}`.trim().slice(0, MAX);
      const key = text.slice(0, 300);
      if (!text || key === lastKey) return;
      lastKey = key;
      chrome.runtime.sendMessage({ type: "check", text }, (res) => {
        if (chrome.runtime.lastError || !res || res.status !== "ready") return;
        if (key !== lastKey) return;
        show(body, res.data);
      });
    } catch {
      /* never break Gmail */
    }
  }

  function show(body, data) {
    document.querySelectorAll(".svx-banner").forEach((n) => n.remove());
    if (data.level !== "high" && data.level !== "some") return;
    const best = data.matches?.[0];

    const banner = document.createElement("div");
    banner.className = `svx-banner svx-${data.level}`;
    banner.setAttribute("role", "status");

    const msg = document.createElement("span");
    msg.className = "svx-text";
    const strong = document.createElement("strong");
    strong.textContent = data.level === "high" ? "Several scam warning signs" : "Some scam warning signs";
    const reported = (data.reported?.links?.length ?? 0) + (data.reported?.numbers?.length ?? 0);
    const note = reported ? ` · ${reported === 1 ? "a link or number in it was" : "links or numbers in it were"} reported as scams` : best ? ` · looks like: ${best.name}` : "";
    msg.append(strong, document.createTextNode(note));

    const details = document.createElement("button");
    details.type = "button";
    details.textContent = "Details";
    details.addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-panel" }));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "svx-close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", () => banner.remove());

    const brand = document.createElement("span");
    brand.className = "svx-brand";
    brand.textContent = "Scammer's View";

    banner.append(brand, msg, details, close);
    body.parentElement?.insertBefore(banner, body);
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, 700);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => {
    lastKey = "";
    schedule();
  });
  schedule();
})();
