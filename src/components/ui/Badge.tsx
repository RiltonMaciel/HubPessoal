import type { PropsWithChildren } from "react";

export function Badge({ tone = "neutral", children }: PropsWithChildren<{ tone?: "neutral" | "good" | "warn" | "bad" }>) {
  const className = tone === "neutral" ? "badge" : `badge ${tone}`;
  return <span className={className}>{children}</span>;
}
