import { Fragment } from "react";

/**
 * Splits a phrase into clipped word slots (`.sv-word`) so each word can rise
 * into place on scroll. Screen readers get the phrase once via the parent label.
 */
export function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <span aria-hidden>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="sv-word">
            <span style={{ "--i": i } as React.CSSProperties}>{w}</span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}
