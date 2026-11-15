import "./scan-loader.css";

const STEPS = ["Camera", "Face mesh", "Matcher"] as const;

/**
 * Loading screen for the face scan: a head outline inside turning rings, with
 * a sweep line and three steps that tick off as each part is ready.
 *
 * Every moving part is a plain element animated with transform or opacity
 * only, so the browser keeps it running on the compositor while the face
 * models compile and the main thread is busy.
 */
export function ScanLoader({ step, message }: { step: 0 | 1 | 2; message: string }) {
  return (
    <div className="sl2-root">
      <div className="sl2-stage" aria-hidden="true">
        <span className="sl2-ring sl2-ring-a" />
        <span className="sl2-ring sl2-ring-b" />
        <span className="sl2-ring sl2-ring-c" />
        <span className="sl2-orbit">
          <i />
        </span>
        <span className="sl2-orbit sl2-orbit-b">
          <i />
        </span>
        <span className="sl2-head">
          <svg viewBox="0 0 72 88" width="100%" height="100%">
            <ellipse cx="36" cy="44" rx="27" ry="37" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M9 44h54 M12 28h48 M12 60h48 M36 7v74 M22 10q-9 34 0 68 M50 10q9 34 0 68"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
              opacity="0.45"
            />
            <path d="M22 38h8 M42 38h8 M36 42v11 M28 63q8 6 16 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="sl2-sweep" />
        </span>
      </div>

      <p className="sl2-msg" role="status">
        {message}
      </p>

      <ol className="sl2-steps" aria-hidden="true">
        {STEPS.map((label, i) => (
          <li key={label} data-state={i < step ? "done" : i === step ? "on" : "wait"}>
            <span className="sl2-pip" />
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
