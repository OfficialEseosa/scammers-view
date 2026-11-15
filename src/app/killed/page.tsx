import "./killed.css";
import { LogoMark } from "@/design/brand/Logo";

export const metadata = { title: "Unavailable - Scammer's View", robots: { index: false } };

export default function KilledPage() {
  return (
    <main className="ks-root">
      <div className="ks-body">
        <span className="ks-tag">KILL SWITCH ACTIVATED</span>
        <div className="ks-logo" aria-hidden="true">
          <LogoMark size="100%" title="" className="ks-b" />
          <LogoMark size="100%" title="" className="ks-a" />
          <LogoMark size="100%" title="" className="ks-main" />
        </div>
        <h1 className="ks-title" data-text="Scammer's View is unavailable">
          Scammer&apos;s View is unavailable
        </h1>
        <p className="ks-sub">The owner has switched it off. Nothing is running.</p>
      </div>
    </main>
  );
}
