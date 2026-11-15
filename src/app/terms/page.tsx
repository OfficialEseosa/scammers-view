import Link from "next/link";
import { CONTACT_URL, LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata = {
  title: "Terms of Service - Scammer's View",
  description: "The rules for using Scammer's View.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" other={{ href: "/privacy", label: "Privacy Policy" }}>
      <LegalSection title="What this is">
        <p>
          Scammer&apos;s View shows you what a scammer could learn about you from public information, and how to reduce it. It was built as a student project for a hackathon. By using it you agree to these
          terms.
        </p>
      </LegalSection>

      <LegalSection title="You may only scan yourself">
        <p>The scan runs on the Google account you sign in with. You agree to:</p>
        <ul>
          <li>sign in with your own account, not someone else&apos;s;</li>
          <li>not use the app, or anything it shows you, to look up, track, harass or deceive another person;</li>
          <li>not try to get around the limits that keep a scan tied to the signed-in person.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Practice scams are for practice">
        <p>
          The practice messages and the voicemail in your own voice exist so you can recognise an attack aimed at you. They are shown only to you. You agree not to send them to anyone or use them to mislead
          anyone.
        </p>
      </LegalSection>

      <LegalSection title="What the results are, and are not">
        <ul>
          <li>Results come from automated search and AI. They can be wrong, incomplete or about a different person with a similar name. Mark anything that is not you.</li>
          <li>A low score does not mean you are safe, and a finished fix does not guarantee an account cannot be taken over.</li>
          <li>This is education, not professional security, legal or financial advice.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Limits and availability">
        <p>
          Each account gets a small number of scans per day. The service may be slow, change or be switched off without notice. Please do not overload it, scrape it or probe it for weaknesses without asking
          first.
        </p>
      </LegalSection>

      <LegalSection title="Other services">
        <p>
          Links to settings pages and opt-out forms go to sites we do not control. Scans rely on outside providers listed in the <Link href="/privacy">Privacy Policy</Link>, and their terms apply to their part.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          The app is provided as is, with no warranty of any kind. To the extent the law allows, its makers are not liable for loss or damage that comes from using it or relying on its results.
        </p>
      </LegalSection>

      <LegalSection title="Ending use">
        <p>
          You can stop at any time. End session deletes your saved scan. We may block access for anyone who breaks these terms.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If these terms change, the date at the top changes with it. Questions go{" "}
          <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
            here
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
