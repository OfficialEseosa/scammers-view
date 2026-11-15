import { GLYPH, type EngineStop } from "./types";

/**
 * A live pin: pulsing ring, the kind glyph, a name tag shown when selected.
 * The home area is a label chip instead of a point ("approximate").
 * Built with textContent for anything from the open web.
 */
export function pinElement(s: EngineStop, onSelect: (id: string) => void): HTMLElement {
  const home = s.kind === "home_area";
  const root = document.createElement("button");
  root.type = "button";
  root.className = `sv-gpin${home ? " is-home" : ""}`;
  root.dataset.id = s.id;
  root.setAttribute("aria-label", home ? `${s.label}, approximate` : s.label);

  const drop = document.createElement("span");
  drop.className = "sv-gpin-drop";
  root.append(drop);

  if (home) {
    const chip = document.createElement("span");
    chip.className = "sv-gpin-chip";
    const g = document.createElement("span");
    g.className = "sv-gpin-glyph";
    g.innerHTML = GLYPH.home_area;
    const t = document.createElement("span");
    t.className = "sv-gpin-chip-text";
    const name = document.createElement("span");
    name.className = "sv-gpin-name";
    name.textContent = s.label;
    const approx = document.createElement("span");
    approx.className = "sv-gpin-approx";
    approx.textContent = "approximate";
    t.append(name, approx);
    chip.append(g, t);
    drop.append(chip);
  } else {
    const ring = document.createElement("span");
    ring.className = "sv-gpin-ring";
    const disc = document.createElement("span");
    disc.className = "sv-gpin-disc";
    disc.innerHTML = GLYPH[s.kind];
    const tag = document.createElement("span");
    tag.className = "sv-gpin-tag";
    tag.textContent = s.label;
    drop.append(ring, disc, tag);
  }

  root.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(s.id);
  });
  return root;
}

export function updatePin(el: HTMLElement, s: EngineStop) {
  const home = s.kind === "home_area";
  el.setAttribute("aria-label", home ? `${s.label}, approximate` : s.label);
  const t = el.querySelector(home ? ".sv-gpin-name" : ".sv-gpin-tag");
  if (t && t.textContent !== s.label) t.textContent = s.label;
}
