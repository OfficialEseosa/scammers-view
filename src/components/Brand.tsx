import { BrandMark } from "@/design/BrandMark";
import { buttonClass } from "@/design/Button";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <BrandMark compact={compact} />;
}

export const buttonPrimary = buttonClass("primary", "lg");
export const buttonQuiet = buttonClass("secondary", "md");
