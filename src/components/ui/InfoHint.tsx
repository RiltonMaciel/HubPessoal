"use client";

import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";

type Props = HTMLAttributes<HTMLSpanElement> & {
  text: string;
  maxWidth?: number;
};

export function InfoHint({ text, className = "", maxWidth = 420, ...props }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: "bottom" as "bottom" | "top" });

  const lines = useMemo(() => text.split("\n").filter((line) => line.trim().length > 0), [text]);
  const safeProps = { ...props };
  delete safeProps.title;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !ref.current) return;

    const updatePosition = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const roomBottom = window.innerHeight - rect.bottom;
      const placement = roomBottom < 240 ? "top" : "bottom";
      const top = placement === "bottom" ? rect.bottom + 10 : rect.top - 10;
      const left = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2));
      setCoords({ top, left, placement });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <>
      <span
        ref={ref}
        className={`infoHint ${className}`}
        aria-label={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        {...safeProps}
      >
        ?
      </span>

      {mounted && open && createPortal(
        <div
          className="infoHintPopup"
          style={{
            top: coords.top,
            left: coords.left,
            maxWidth,
            transform: coords.placement === "bottom" ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }}
          data-placement={coords.placement}
        >
          {lines.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
