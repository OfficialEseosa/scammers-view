import { LogoLockup, LogoMark, LogoTile } from "@/design/brand/Logo";

const SIZES = [16, 24, 32, 64, 128, 512] as const;

function Row({ label, render }: { label: string; render: (size: number) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase tracking-widest opacity-60">{label}</div>
      <div className="flex flex-wrap items-end gap-6">
        {SIZES.map((s) => (
          <div key={s} className="flex flex-col items-center gap-2">
            {render(s)}
            <span className="text-[10px] opacity-50">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Board({ dark }: { dark: boolean }) {
  return (
    <section
      className="flex flex-col gap-10 p-8"
      style={{ background: dark ? "#000" : "#fff", color: dark ? "#fff" : "#000" }}
    >
      <h2 className="text-sm font-semibold">{dark ? "On black" : "On white"}</h2>
      <Row label="LogoMark (auto: simple glyph at 24 and below)" render={(s) => <LogoMark size={s} />} />
      <Row label="LogoMark full geometry" render={(s) => <LogoMark size={s} simple={false} />} />
      <Row label="LogoTile black" render={(s) => <span style={{ outline: "1px dashed #777", borderRadius: s * 0.22, lineHeight: 0 }}><LogoTile variant="black" size={s} /></span>} />
      <Row label="LogoTile white" render={(s) => <span style={{ outline: "1px dashed #777", borderRadius: s * 0.22, lineHeight: 0 }}><LogoTile variant="white" size={s} /></span>} />
      <div className="flex flex-col gap-4">
        <div className="text-xs uppercase tracking-widest opacity-60">LogoLockup</div>
        <LogoLockup size={24} />
        <LogoLockup size={40} />
        <LogoLockup size={64} />
      </div>
    </section>
  );
}

/** Dev harness: every logo variant at every size, on black and on white. */
export default function LogoLabPage() {
  return (
    <main className="w-full">
      <Board dark />
      <Board dark={false} />
    </main>
  );
}
