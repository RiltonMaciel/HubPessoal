"use client";

import { useEffect } from "react";

type HotkeyHandler = (event: KeyboardEvent) => void;

export function useHotkeys(bindings: Array<{ combo: string; handler: HotkeyHandler }>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      bindings.forEach(({ combo, handler }) => {
        const comboLower = combo.toLowerCase();
        const ctrlOrCmd = comboLower.includes("ctrl") || comboLower.includes("cmd");
        const requiresShift = comboLower.includes("shift");
        const mainKey = comboLower.split("+").pop();

        const ctrlOk = ctrlOrCmd ? event.ctrlKey || event.metaKey : true;
        const shiftOk = requiresShift ? event.shiftKey : true;
        const keyOk = mainKey === key;

        if (ctrlOk && shiftOk && keyOk) {
          event.preventDefault();
          handler(event);
        }
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings]);
}
