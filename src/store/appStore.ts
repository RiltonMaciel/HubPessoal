"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DecisionMode } from "@/lib/types";

type PeriodFilter = "7" | "15" | "30" | "all";
type ThemeMode = "dark" | "light";

export type DatasetMeta = {
  totalGames: number;
  leagues: string[];
  dateMin?: string;
  dateMax?: string;
  lastImportAt?: string;
  datasetSizeLabel: string;
};

type AppState = {
  theme: ThemeMode;
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  currentDatasetMeta: DatasetMeta;
  league: string;
  period: PeriodFilter;
  recencyOn: boolean;
  line: number;
  decisionMode: DecisionMode;
  confidence: "all" | "alta" | "media" | "baixa";
  secureUnlocked: boolean;
  secureKey: CryptoKey | null;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setDatasetMeta: (meta: Partial<DatasetMeta>) => void;
  setLeague: (league: string) => void;
  setPeriod: (period: PeriodFilter) => void;
  setRecencyOn: (value: boolean) => void;
  setLine: (line: number) => void;
  setDecisionMode: (mode: DecisionMode) => void;
  setConfidence: (confidence: "all" | "alta" | "media" | "baixa") => void;
  resetFilters: () => void;
  unlockSecure: (key: CryptoKey) => void;
  lockSecure: () => void;
};

const initialMeta: DatasetMeta = {
  totalGames: 0,
  leagues: [],
  datasetSizeLabel: "Sem dataset",
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarOpen: false,
      commandPaletteOpen: false,
      currentDatasetMeta: initialMeta,
      league: "all",
      period: "all",
      recencyOn: true,
      line: 6.5,
      decisionMode: "conservador",
      confidence: "all",
      secureUnlocked: false,
      secureKey: null,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setDatasetMeta: (meta) =>
        set((state) => ({
          currentDatasetMeta: {
            ...state.currentDatasetMeta,
            ...meta,
          },
        })),
      setLeague: (league) => set({ league }),
      setPeriod: (period) => set({ period }),
      setRecencyOn: (recencyOn) => set({ recencyOn }),
      setLine: (line) => set({ line }),
      setDecisionMode: (decisionMode) => set({ decisionMode }),
      setConfidence: (confidence) => set({ confidence }),
      resetFilters: () =>
        set({
          league: "all",
          period: "all",
          recencyOn: true,
          line: 6.5,
          decisionMode: "conservador",
          confidence: "all",
        }),
      unlockSecure: (secureKey) => set({ secureUnlocked: true, secureKey }),
      lockSecure: () => set({ secureUnlocked: false, secureKey: null }),
    }),
    {
      name: "hubpessoal-ui-store",
      partialize: (state) => ({
        theme: state.theme,
        league: state.league,
        period: state.period,
        recencyOn: state.recencyOn,
        line: state.line,
        decisionMode: state.decisionMode,
        confidence: state.confidence,
      }),
    }
  )
);
