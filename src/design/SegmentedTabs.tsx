"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./utils";

export interface SegmentItem<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  /** Extra accessible text, e.g. "locked". */
  hint?: string;
}

/**
 * Segmented control with a sliding inverse pill. Roving focus with arrow keys.
 * Pointer changes slide the pill (240ms); keyboard changes jump instantly.
 * Scrolls horizontally with snap when it doesn't fit (phones).
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  role = "tablist",
  size = "md",
  className,
  stretch,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  role?: "tablist" | "radiogroup";
  size?: "sm" | "md";
  className?: string;
  stretch?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [instant, setInstant] = useState(true);
  const id = useId();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>(`[data-seg="${CSS.escape(value)}"]`);
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value, items.length]);

  const select = (next: T, viaKeyboard: boolean) => {
    setInstant(viaKeyboard);
    onChange(next);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next];
    select(target.id, true);
    listRef.current?.querySelector<HTMLElement>(`[data-seg="${CSS.escape(target.id)}"]`)?.focus();
  };

  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <div className={cn("sv-scroll-x max-w-full", className)}>
      <div
        ref={listRef}
        role={role}
        aria-label={label}
        onKeyDown={onKey}
        className={cn("relative inline-flex min-w-max rounded-full border border-edge bg-surface p-1", stretch && "flex w-full")}
      >
        {pill && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 rounded-full bg-accent"
            style={{
              width: pill.w,
              transform: `translateX(${pill.x}px)`,
              transition: instant ? "none" : "transform 240ms var(--ease-out), width 240ms var(--ease-out)",
            }}
          />
        )}
        {items.map((it) => {
          const on = it.id === value;
          return (
            <button
              key={it.id}
              id={`${id}-${it.id}`}
              type="button"
              role={itemRole}
              data-seg={it.id}
              aria-selected={role === "tablist" ? on : undefined}
              aria-checked={role === "radiogroup" ? on : undefined}
              aria-disabled={it.disabled || undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => !it.disabled && select(it.id, false)}
              className={cn(
                "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors duration-200",
                size === "sm" ? "min-h-9 px-3.5 text-sm" : "min-h-11 px-4 text-base",
                stretch && "flex-1",
                on ? "text-on-accent" : it.disabled ? "text-subtle" : "text-muted hover:text-fg",
              )}
            >
              {it.label}
              {it.hint && <span className="sr-only">, {it.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
