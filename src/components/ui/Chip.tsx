import type { PropsWithChildren } from "react";

export function Chip({ active = false, onClick, children }: PropsWithChildren<{ active?: boolean; onClick?: () => void }>) {
  return (
    <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
