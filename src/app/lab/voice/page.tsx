import type { Finding } from "@/lib/types";
import { VoiceDemo } from "@/features/voice/VoiceDemo";

// Dev harness. Fictional data only.
const now = "2026-01-01T00:00:00.000Z";
const base = { sourceType: "other", anchor: "email", confidence: 0.9, riskWeight: 7, foundAt: now } as const;

const findings: Finding[] = [
  { ...base, id: "f1", category: "relative", label: "Mom's name", value: "Dana", sourceType: "instagram", sourceUrl: "https://example.com/ava/photos", sourceTitle: "Instagram tagged photo" },
  { ...base, id: "f2", category: "school", label: "Current school", value: "Fairview High", sourceType: "school", sourceUrl: "https://example.com/fairview/roster", sourceTitle: "Fairview High roster" },
  { ...base, id: "f3", category: "pet", label: "Dog's name", value: "Biscuit", sourceType: "instagram", sourceUrl: "https://example.com/ava/biscuit", sourceTitle: "Instagram post" },
  { ...base, id: "f4", category: "location", label: "Hometown", value: "Maple Falls", sourceType: "web", sourceUrl: "https://example.com/ava/about", sourceTitle: "Personal site" },
];

export default function VoiceLab() {
  return (
    <main className="px-4 py-10">
      <VoiceDemo findings={findings} subjectName="Ava Example" masked={false} />
    </main>
  );
}
