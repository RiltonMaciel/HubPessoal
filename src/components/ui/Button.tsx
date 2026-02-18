import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type Props = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "primary";
  }
>;

export function Button({ variant = "default", className = "", children, ...props }: Props) {
  return (
    <button className={`btn ${variant === "primary" ? "primary" : ""} ${className}`} {...props}>
      {children}
    </button>
  );
}
