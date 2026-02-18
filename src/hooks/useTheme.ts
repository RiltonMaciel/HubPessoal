"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";

export function useTheme() {
  const { theme, setTheme, toggleTheme } = useAppStore();

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("hubpessoal-theme");
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
    }
  }, [setTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hubpessoal-theme", theme);
  }, [theme]);

  return { theme, toggleTheme, setTheme };
}
