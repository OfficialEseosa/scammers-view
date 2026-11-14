/** One risk scale for the whole app: 0–39 safe, 40–69 warn, 70–100 danger. */
export type RiskLevel = "safe" | "warn" | "danger";

export function riskLevel(score: number): RiskLevel {
  if (score >= 70) return "danger";
  if (score >= 40) return "warn";
  return "safe";
}

/** CSS colour (a token) for a 0–100 score. Use for marks, arcs, dots and bars. */
export function riskColor(score: number): string {
  return `var(--${riskLevel(score)})`;
}

/** Text-safe colour (AA on surfaces and on the matching tint). */
export function riskTextColor(score: number): string {
  return `var(--${riskLevel(score)}-fg)`;
}

/** Findings carry a 0–10 risk weight; map it onto the same scale. */
export function weightLevel(weight: number): RiskLevel {
  return riskLevel(weight * 10);
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  safe: "Low risk",
  warn: "Medium risk",
  danger: "High risk",
};
