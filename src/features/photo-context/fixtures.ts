import type { Finding } from "@/lib/types";
import type { PhotoResponse, VideoResponse } from "@/lib/vision/schema";
import { photoFindings, videoFindings } from "@/lib/vision/clean";

/**
 * Lab samples. Photos are fetched at runtime from Wikimedia Commons (nothing
 * stored in the repo); licences checked via the Commons API on 2026-11-14:
 *  - "3rd birthday cake (Unsplash 10b8Lvvc-4g).jpg", Annie Spratt, CC0
 *  - "Sunnyside-Garden-Arena-Way-street-sign.jpg", Mnation2, CC0
 *  - "Danish Street Names.jpg", Calettso2, CC0
 * The video (public/fixtures/vision/demo-video.mp4, 18 s, 139 KB) is our own
 * fictional render: ffmpeg drawn signs + Windows text-to-speech, no real person.
 * The canned readouts below are FIXTURES written for the UI, not model output.
 */

const commons = (file: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=960`;
const page = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;

const FOUND = "2026-11-14T00:00:00.000Z";

function photo(id: string, file: string, label: string): Finding {
  return { id, category: "photo", label, value: label, sourceType: "web", sourceUrl: page(file), sourceTitle: "Wikimedia Commons (CC0)", imageUrl: commons(file), anchor: "face", confidence: 1, riskWeight: 3, foundAt: FOUND };
}

export const LAB_PHOTOS: Finding[] = [
  photo("lab-cake", "3rd_birthday_cake_(Unsplash_10b8Lvvc-4g).jpg", "Birthday photo"),
  photo("lab-corner", "Sunnyside-Garden-Arena-Way-street-sign.jpg", "Street corner"),
  photo("lab-signs", "Danish_Street_Names.jpg", "Holiday photo"),
];

export const LAB_VIDEOS: Finding[] = [
  {
    id: "lab-video",
    category: "video",
    label: "Your video",
    value: "18 s, original sound",
    sourceType: "tiktok",
    sourceUrl: "https://www.tiktok.com/@example/video/1",
    sourceTitle: "Fictional demo clip",
    imageUrl: "/fixtures/vision/demo-cover.jpg",
    mediaUrl: "/fixtures/vision/demo-video.mp4",
    durationSec: 18.4,
    soundOriginal: true,
    anchor: "email",
    confidence: 1,
    riskWeight: 4,
    foundAt: FOUND,
  },
];

const fact = (kind: PhotoResponse["readout"]["facts"][number]["kind"], label: string, value: string, evidence: string, risk: number, box: number[] = [], fromVisibleText = true) => ({
  kind,
  label,
  value,
  evidence,
  fromVisibleText,
  risk,
  confidence: 0.85,
  box,
});

function photoRes(p: Finding, readout: PhotoResponse["readout"]): PhotoResponse {
  return { findingId: p.id, readout, findings: photoFindings(readout, { findingId: p.id, sourceUrl: p.sourceUrl, sourceTitle: p.sourceTitle, now: FOUND }), usage: { model: "fixture", ms: 0 } };
}

export const LAB_PHOTO_FIXTURE: Record<string, PhotoResponse> = {
  "lab-cake": photoRes(LAB_PHOTOS[0], {
    facts: [
      fact("birthday", "Age on the cake", "Turning 3", "Number 3 candle on the cake.", 6, [210, 290, 592, 416]),
      fact("event", "Birthday party", "Birthday celebration", "Cake with a lit candle and decorations.", 3, [], false),
    ],
    otherPeople: { count: 0, relationshipGuess: null },
    scammerLearns: "An age and a birthday. Pair it with the post date and they have a birth date.",
  }),
  "lab-corner": photoRes(LAB_PHOTOS[1], {
    facts: [
      fact("place", "Street corner", "45 St and Queens Blvd", "Two street name signs on one pole.", 7, [423, 300, 495, 540]),
      fact("landmark", "Co-named street", "Sunnyside Garden Arena Way", "Green co-naming sign under 45 St.", 6, [483, 300, 570, 660]),
      fact("place", "Neighbourhood", "Sunnyside, Queens, New York", "The co-named sign only exists in Sunnyside.", 6, [292, 0, 442, 250], false),
    ],
    otherPeople: { count: 0, relationshipGuess: null },
    scammerLearns: "The exact corner you stood on. If it's near home, that's your neighbourhood.",
  }),
  "lab-signs": photoRes(LAB_PHOTOS[2], {
    facts: [
      fact("place", "Street sign", "Dronningens Gade (Main Street)", "Sign reads Main Street, Dronningens Gade.", 5, [177, 70, 466, 464]),
      fact("place", "Cross street", "Raadets Gade", "Second sign on the same pole.", 5, [180, 506, 460, 950]),
      fact("routine", "Travel", "Charlotte Amalie, St. Thomas", "These two streets meet in Charlotte Amalie.", 4, [], false),
    ],
    otherPeople: { count: 0, relationshipGuess: null },
    scammerLearns: "Where you travelled. A 'stuck abroad, send money' story writes itself.",
  }),
};

const vfact = (channel: "speech" | "screen" | "scene", at: string, kind: PhotoResponse["readout"]["facts"][number]["kind"], label: string, value: string, evidence: string, risk: number) => ({
  kind,
  label,
  value,
  evidence,
  fromVisibleText: true,
  risk,
  confidence: 0.85,
  channel,
  at,
});

const videoReadout: VideoResponse["readout"] = {
  hasSpeech: true,
  facts: [
    vfact("speech", "00:01", "name", "Your name", "Alex", "Introduces themself as Alex.", 4),
    vfact("speech", "00:03", "school", "School", "Lakeview High", "Says they just finished practice at Lakeview High.", 8),
    vfact("speech", "00:06", "routine", "Gym schedule", "Riverside Gym, Tue and Thu 7am", "Says where and when they train.", 8),
    vfact("speech", "00:12", "pet", "Pet's name", "Biscuit", "Mentions Biscuit says hi.", 8),
    vfact("speech", "00:14", "birthday", "Pet's birthday", "March 14", "Says Biscuit turns three on March 14.", 6),
    vfact("screen", "00:05", "routine", "Caption", "tues + thurs 7am riverside gym", "On-screen caption repeats the schedule.", 7),
    vfact("scene", "00:00", "place", "Street sign", "Elm St, 300 block", "Green street sign at the top of the frame.", 6),
    vfact("scene", "00:00", "school", "Team shirt", "Lakeview Hawks #21", "Shirt print reads LAKEVIEW HAWKS 21.", 7),
  ],
  scammerLearns: "Your school, team number, pet's name and where you'll be at 7am on Tuesday.",
};

export const LAB_VIDEO_FIXTURE: Record<string, VideoResponse> = {
  "lab-video": {
    findingId: "lab-video",
    readout: videoReadout,
    findings: videoFindings(videoReadout, { findingId: "lab-video", sourceUrl: LAB_VIDEOS[0].sourceUrl, anchor: "email", now: FOUND }),
    analysedSec: 18.4,
    usage: { model: "fixture", ms: 0 },
  },
};
