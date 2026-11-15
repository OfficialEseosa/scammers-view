// Run: npx tsx --test src/lib/face/framing.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { faceFit } from "./framing";

test("laptop (landscape): small is closer, most of the width is back", () => {
  assert.equal(faceFit({ x0: 0.45, y0: 0.4, x1: 0.55, y1: 0.6 }, false), "closer");
  assert.equal(faceFit({ x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.8 }, false), "ok");
  assert.equal(faceFit({ x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }, false), "back");
});

test("phone (portrait): a face filling the narrow frame is fine at arm's length", () => {
  assert.equal(faceFit({ x0: 0.05, y0: 0.2, x1: 0.95, y1: 0.75 }, true), "ok");
  assert.equal(faceFit({ x0: 0.45, y0: 0.4, x1: 0.55, y1: 0.6 }, true), "closer");
});

test("a face cut off by an edge is too close on either", () => {
  assert.equal(faceFit({ x0: -0.05, y0: 0.2, x1: 0.9, y1: 0.8 }, true), "back");
  assert.equal(faceFit({ x0: 0.1, y0: 0.2, x1: 1.04, y1: 0.8 }, true), "back");
  assert.equal(faceFit({ x0: 0.2, y0: -0.02, x1: 0.8, y1: 0.9 }, true), "back");
  assert.equal(faceFit({ x0: 0.3, y0: 0.3, x1: 0.7, y1: 1.05 }, false), "back");
});
