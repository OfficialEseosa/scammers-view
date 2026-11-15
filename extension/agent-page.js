// Scammer's View cleanup agent: page helper. Injected into the one tab the agent works in,
// by the extension (your Chrome) or by the server browser. It summarises the page, carries
// out one approved step, highlights what it is about to press, and shows the approval bar.
// It never reads or fills password fields.
(() => {
  if (window.__svxAgent) return;

  const SEL =
    "a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=switch],[role=radio],[role=tab],[role=menuitem],[role=option],summary,label[for]";
  const SKIP_TYPES = new Set(["password", "hidden", "file"]);
  const MAX_ELEMENTS = 150;

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  function clean(s, n) {
    return String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  }

  function labelOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria, 120);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (t.trim()) return clean(t, 120);
    }
    if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.innerText).join(" "), 120);
    const own = el.innerText || el.value || el.placeholder || el.title || el.alt || el.name || "";
    return clean(own || el.placeholder, 120);
  }

  function captchaPresent() {
    if (document.querySelector("iframe[src*='recaptcha'],iframe[src*='hcaptcha'],iframe[src*='turnstile'],iframe[src*='challenges.cloudflare'],#challenge-form,.g-recaptcha,.h-captcha,.cf-turnstile")) {
      return true;
    }
    const t = (document.body?.innerText || "").slice(0, 2000).toLowerCase();
    return /verify you are human|are you a robot|i'm not a robot|checking your browser|press and hold/.test(t);
  }

  function snapshot() {
    document.querySelectorAll("[data-svx]").forEach((n) => n.removeAttribute("data-svx"));
    const elements = [];
    let i = 0;
    for (const el of document.querySelectorAll(SEL)) {
      if (elements.length >= MAX_ELEMENTS) break;
      if (el.closest(".svx-agent-bar")) continue;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (el.tagName === "INPUT" && SKIP_TYPES.has(type)) continue;
      if (el.disabled || !visible(el)) continue;
      el.setAttribute("data-svx", String(i));
      const item = { i, tag: el.tagName.toLowerCase(), label: labelOf(el) };
      if (type) item.type = type.slice(0, 20);
      const role = el.getAttribute("role");
      if (role) item.role = role.slice(0, 20);
      if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !["checkbox", "radio"].includes(type) && el.value) item.value = clean(el.value, 60);
      if (el.tagName === "SELECT") item.value = clean(el.options[el.selectedIndex]?.text, 60);
      if (type === "checkbox" || type === "radio") item.checked = el.checked;
      const aria = el.getAttribute("aria-checked") ?? el.getAttribute("aria-pressed");
      if (aria === "true" || aria === "false") item.checked = aria === "true";
      if (el.tagName === "A") {
        try {
          const u = new URL(el.href, location.href);
          item.href = (u.origin === location.origin ? u.pathname + u.search : u.href).slice(0, 200);
        } catch {
          /* skip */
        }
      }
      elements.push(item);
      i++;
    }
    return {
      url: location.href.slice(0, 2000),
      title: clean(document.title, 200),
      text: clean(document.body?.innerText, 3500),
      elements,
      captcha: captchaPresent(),
    };
  }

  function find(index) {
    return document.querySelector(`[data-svx="${index}"]`);
  }

  function setValue(el, text) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function act(step) {
    const el = find(step.index);
    if (!el) return { ok: false, error: "That element is gone." };
    if (el.tagName === "INPUT" && SKIP_TYPES.has((el.type || "").toLowerCase())) return { ok: false, error: "Refused: password or hidden field." };
    el.scrollIntoView({ block: "center", behavior: "instant" });
    if (step.action === "click") {
      el.click();
      return { ok: true };
    }
    if (step.action === "type") {
      setValue(el, step.text);
      return { ok: true };
    }
    if (step.action === "select" && el.tagName === "SELECT") {
      const want = String(step.text).toLowerCase();
      const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ||
        [...el.options].find((o) => o.text.toLowerCase().includes(want));
      if (!opt) return { ok: false, error: "No matching option." };
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    return { ok: false, error: "Unsupported step." };
  }

  let ring = null;
  function highlight(index) {
    ring?.remove();
    ring = null;
    if (index === undefined || index === null) return;
    const el = find(index);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    ring = document.createElement("div");
    ring.className = "svx-agent-ring";
    Object.assign(ring.style, {
      position: "fixed", left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px`,
      border: "3px solid #ff5a4e", borderRadius: "10px", boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)", zIndex: 2147483646, pointerEvents: "none",
    });
    document.documentElement.append(ring);
  }

  let bar = null;
  let hud = null;
  let hudCurrent = null;
  let hudLog = null;
  const recent = [];

  /** Live step updates while the agent works (does not ask for a click). */
  function status(text, detail, logLines) {
    if (!hud) {
      hud = document.createElement("div");
      hud.className = "svx-agent-hud";
      hud.setAttribute("role", "status");
      hud.setAttribute("aria-live", "polite");
      Object.assign(hud.style, {
        position: "fixed",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483645,
        width: "min(420px, 94vw)",
        padding: "12px 14px",
        borderRadius: "14px",
        background: "#0b0b0b",
        color: "#fff",
        font: "14px/1.4 system-ui, sans-serif",
        boxShadow: "0 12px 40px rgba(0,0,0,.45)",
        border: "1px solid #333",
        pointerEvents: "none",
      });
      const brand = document.createElement("strong");
      brand.textContent = "Scammer's View · cleanup";
      brand.style.cssText = "display:block;font-size:11px;opacity:.7;margin-bottom:6px;letter-spacing:.02em";
      hudCurrent = document.createElement("div");
      hudCurrent.style.cssText = "font-weight:600;margin-bottom:6px";
      hudLog = document.createElement("ol");
      hudLog.style.cssText = "margin:0;padding-left:1.1rem;opacity:.85;font-size:12px;max-height:7.5rem;overflow:hidden";
      hud.append(brand, hudCurrent, hudLog);
      document.documentElement.append(hud);
    }
    if (text) hudCurrent.textContent = String(text).slice(0, 240);
    if (detail) {
      recent.push(String(detail).slice(0, 160));
      while (recent.length > 6) recent.shift();
    }
    const lines = Array.isArray(logLines) && logLines.length ? logLines.slice(-6).map(String) : recent.slice();
    hudLog.replaceChildren();
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line.slice(0, 160);
      li.style.marginBottom = "2px";
      hudLog.append(li);
    }
  }

  /** Shows a bar at the top of the page; resolves with the button the student pressed. */
  function ask(text, buttons) {
    bar?.remove();
    // Keep the bottom HUD as a step log; don't duplicate the full ask text there.
    status("Waiting for you…", text);
    return new Promise((resolve) => {
      bar = document.createElement("div");
      bar.className = "svx-agent-bar";
      bar.setAttribute("role", "dialog");
      Object.assign(bar.style, {
        position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483647, maxWidth: "min(640px, 94vw)",
        display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderRadius: "14px",
        background: "#0b0b0b", color: "#fff", font: "15px/1.4 system-ui, sans-serif", boxShadow: "0 12px 40px rgba(0,0,0,.45)", border: "1px solid #333",
      });
      const brand = document.createElement("strong");
      brand.textContent = "Scammer's View · your turn";
      brand.style.cssText = "font-size:12px;opacity:.7;width:100%";
      const msg = document.createElement("span");
      msg.textContent = text;
      msg.style.cssText = "flex:1 1 260px";
      bar.append(brand, msg);
      for (const b of buttons) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = b.label;
        btn.style.cssText = `font:inherit;font-weight:600;min-height:38px;padding:0 14px;border-radius:10px;cursor:pointer;border:1px solid #555;${b.primary ? "background:#fff;color:#000" : "background:transparent;color:#fff"}`;
        btn.addEventListener("click", () => {
          bar?.remove();
          bar = null;
          resolve(b.id);
        });
        bar.append(btn);
      }
      document.documentElement.append(bar);
    });
  }

  function clearUi() {
    ring?.remove();
    bar?.remove();
    hud?.remove();
    ring = bar = hud = hudCurrent = hudLog = null;
    recent.length = 0;
  }

  window.__svxAgent = { snapshot, act, highlight, ask, status, clearUi };
})();
