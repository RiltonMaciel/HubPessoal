import type { PropsWithChildren } from "react";

export function Card({
  children,
  className = "",
  ...props
}: PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: PropsWithChildren) {
  return <div className="cardHeader">{children}</div>;
}

export function CardBody({ children }: PropsWithChildren) {
  return <div className="cardBody">{children}</div>;
}
