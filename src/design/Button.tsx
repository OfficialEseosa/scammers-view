import type { ComponentProps } from "react";
import { cn } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "md" | "lg" | "sm";

const BASE =
  "sv-press inline-flex items-center justify-center gap-2 rounded-control font-sans font-semibold whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-40";

const VARIANT: Record<ButtonVariant, string> = {
  // Inverse of the page: white on black, black on white.
  primary: "bg-accent text-on-accent hover:opacity-90",
  secondary: "border border-edge-strong text-fg hover:border-fg",
  destructive: "border border-danger text-danger-fg hover:bg-danger hover:text-black",
  ghost: "text-muted hover:text-fg",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-7 text-lg",
};

/** Class string for links and other elements that should look like a button. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
