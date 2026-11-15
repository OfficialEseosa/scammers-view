import { CONTACT_URL, LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata = {
  title: "Privacy Policy - Scammer's View",
  description: "What Scammer's View collects, where it goes, how long it is kept and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" other={{ href: "/terms", label: "Terms of Service" }}>
      <LegalSection title="The short version">
        <ul>
          <li>You can only scan yourself. The person scanned is always the Google account you signed in with.</li>
          <li>The scan reads public information only. It never logs in to your accounts and never sends a message to anyone.</li>
          <li>Your results are saved encrypted, tied to your account, and deleted when you end your session.</li>
          <li>We do not sell your data, show ads or use your data to train models.</li>
        </ul>
      </LegalSection>

      <LegalSection title="What we collect">
        <p>
          <strong>From Google sign-in:</strong> your name, email address and profile picture. We ask Google for nothing else. They tell the scan who you are.
        </p>
        <p>
          <strong>From the scan:</strong> public facts about you found on the open web and on public social profiles, such as usernames, schools, employers, places and public posts. The app turns these into an
          exposure score, attack paths and a list of fixes.
        </p>
        <p>
          <strong>Things you choose to add:</strong> photos you upload for analysis, a short voice recording for the voice check, and camera frames for the face check. Each of these is optional.
        </p>
        <p>
          <strong>Usage count:</strong> how many scans you ran today, stored against a one-way hash of your email so the record does not contain your address.
        </p>
      </LegalSection>

      <LegalSection title="How it is used">
        <p>Only to show you your own exposure and help you reduce it. Nothing is shared with other users, and nothing found about you is published.</p>
      </LegalSection>

      <LegalSection title="Services that process your data">
        <p>Running a scan sends data to these providers, each under its own terms:</p>
        <ul>
          <li>
            <strong>Google</strong>: sign-in, the Gemini API (web search, reasoning, photo analysis) and Google Maps (turning place names into map locations).
          </li>
          <li>
            <strong>Apify</strong>: reads public Instagram, TikTok and X profiles that match your name or usernames.
          </li>
          <li>
            <strong>ElevenLabs</strong>: builds a temporary copy of your voice for the voicemail practice. The app asks ElevenLabs to delete that voice as soon as the audio is made.
          </li>
          <li>
            <strong>Supabase</strong>: holds your encrypted saved scan and the daily scan count.
          </li>
          <li>
            <strong>Vercel</strong>: hosts the site and keeps standard request logs.
          </li>
        </ul>
        <p>Face matching and voice comparison run in your browser. Camera frames and face measurements are not uploaded to our servers.</p>
      </LegalSection>

      <LegalSection title="What is kept, and for how long">
        <ul>
          <li>
            <strong>Saved scan:</strong> one copy per account on our server, compressed and encrypted with a key derived for your account, plus a copy in your browser. Both are erased when you choose End session. A
            new scan replaces the old one.
          </li>
          <li>
            <strong>Face and voice data:</strong> kept in your browser only and cleared when you end your session.
          </li>
          <li>
            <strong>Daily scan count:</strong> one small record per day with no email address in it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your choices">
        <ul>
          <li>End session deletes your saved scan from our server and from your browser.</li>
          <li>
            You can remove the app&apos;s access to your Google account at any time at{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
              myaccount.google.com/permissions
            </a>
            .
          </li>
          <li>
            To ask a question or request deletion, <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">contact us</a>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Google user data">
        <p>
          Scammer&apos;s View&apos;s use of information received from Google APIs follows the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Your Google name, email and picture are used only to identify you inside the app.
        </p>
      </LegalSection>

      <LegalSection title="Age">
        <p>Scammer&apos;s View is for people aged 13 and over. It is not meant for younger children.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>If this policy changes, the date at the top changes with it.</p>
      </LegalSection>
    </LegalPage>
  );
}
