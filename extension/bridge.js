// Lets the Scammer's View app page talk to the extension (only on the app's own address).
// The page posts { svx: "req", id, type, payload }; the answer comes back as { svx: "res", id, ok, data | error }.
(() => {
  const RELOAD_MSG =
    "The extension was reloaded. Refresh this page (Ctrl+Shift+R), then try again.";

  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function version() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return null;
    }
  }

  const hello = () => {
    if (!alive()) return;
    const v = version();
    if (!v) return;
    window.postMessage({ svx: "hello", version: v }, window.location.origin);
  };

  function reply(id, out) {
    window.postMessage({ svx: "res", id, ...out }, window.location.origin);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.svx === "ping") return hello();
    if (m.svx !== "req" || typeof m.id !== "string" || typeof m.type !== "string") return;

    if (!alive()) {
      reply(m.id, { ok: false, error: RELOAD_MSG });
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: "agent", op: m.type, payload: m.payload ?? {} }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = String(err.message || "");
          reply(m.id, {
            ok: false,
            error: /invalidated|context/i.test(msg) ? RELOAD_MSG : msg || RELOAD_MSG,
          });
          return;
        }
        reply(m.id, res ?? { ok: false, error: "No answer" });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply(m.id, {
        ok: false,
        error: /invalidated|context/i.test(msg) ? RELOAD_MSG : msg || RELOAD_MSG,
      });
    }
  });

  hello();
  document.addEventListener("DOMContentLoaded", hello);
})();
