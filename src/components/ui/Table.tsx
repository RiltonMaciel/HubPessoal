import type { PropsWithChildren } from "react";

export function Table({ children }: PropsWithChildren) {
  return <table className="table">{children}</table>;
}
