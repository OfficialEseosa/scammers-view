/** 128 short, common, easy-to-say words. A power of two, so a random byte maps without bias. */
export const WORDS = [
  "amber", "anchor", "apple", "arrow", "aspen", "badger", "banjo", "basil", "beacon", "birch",
  "biscuit", "blanket", "bridge", "bronze", "bucket", "button", "cactus", "candle", "canyon", "carpet",
  "cedar", "cherry", "clover", "cobalt", "comet", "copper", "cotton", "cricket", "daisy", "delta",
  "dolphin", "dragon", "ember", "falcon", "feather", "fiddle", "forest", "fossil", "garden", "ginger",
  "glacier", "granite", "hammer", "harbor", "hazel", "heron", "honey", "island", "ivory", "jasmine",
  "jigsaw", "juniper", "kettle", "kitten", "ladder", "lantern", "lemon", "lilac", "lizard", "magnet",
  "maple", "marble", "meadow", "mitten", "monsoon", "mustard", "nickel", "noodle", "oatmeal", "olive",
  "orchid", "otter", "paddle", "pebble", "pepper", "pickle", "pillow", "planet", "pocket", "poplar",
  "pretzel", "pumpkin", "quartz", "quilt", "rabbit", "raisin", "river", "robin", "saddle", "saffron",
  "salmon", "sesame", "shovel", "sparrow", "spruce", "sundial", "tablet", "teapot", "thimble", "thunder",
  "tiger", "timber", "tomato", "trumpet", "tulip", "turnip", "umbrella", "velvet", "violet", "walnut",
  "wagon", "willow", "window", "winter", "yellow", "yogurt", "zebra", "zipper", "acorn", "bagel",
  "cocoa", "dune", "fern", "gravel", "hickory", "iris", "jelly", "koala",
] as const;

/**
 * Three random words, e.g. "copper-lantern-otter". 21 bits: enough for a spoken check
 * where a caller gets one or two tries. `random` returns bytes, injectable for tests.
 */
export function generateSafeWord(
  random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  count = 3,
): string {
  const picks: string[] = [];
  const bytes = random(count * 4);
  let i = 0;
  while (picks.length < count && i < bytes.length) {
    const w = WORDS[bytes[i++] % WORDS.length];
    if (!picks.includes(w)) picks.push(w);
  }
  for (let k = 0; picks.length < count; k++) {
    const w = WORDS[(k * 7 + picks.length) % WORDS.length];
    if (!picks.includes(w)) picks.push(w);
  }
  return picks.join("-");
}
