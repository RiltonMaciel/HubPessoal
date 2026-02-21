import type { Odds1X2Record, OddsOuRecord } from "@/lib/types";

export type Implied1X2 = {
  home: number;
  draw: number;
  away: number;
  overround: number;
};

export type ImpliedOU = {
  over: number;
  under: number;
  overround: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function invOdd(odd?: number) {
  if (!odd || !Number.isFinite(odd) || odd <= 1) return 0;
  return 1 / odd;
}

export function implied1x2FromOdds(oddHome?: number, oddDraw?: number, oddAway?: number): Implied1X2 | null {
  const pH = invOdd(oddHome);
  const pD = invOdd(oddDraw);
  const pA = invOdd(oddAway);
  const sum = pH + pD + pA;
  if (!sum) return null;
  return {
    home: clamp01(pH / sum),
    draw: clamp01(pD / sum),
    away: clamp01(pA / sum),
    overround: sum,
  };
}

export function impliedOuFromOdds(oddOver?: number, oddUnder?: number): ImpliedOU | null {
  const pO = invOdd(oddOver);
  const pU = invOdd(oddUnder);
  const sum = pO + pU;
  if (!sum) return null;
  return {
    over: clamp01(pO / sum),
    under: clamp01(pU / sum),
    overround: sum,
  };
}

export function findOdds1x2(rows: Odds1X2Record[], needle: { league: string; dateTime: string; homeNick: string; awayNick: string; }) {
  return rows.find((row) => row.league === needle.league && row.dateTime === needle.dateTime && row.homeNick === needle.homeNick && row.awayNick === needle.awayNick) ?? null;
}

export function findOddsOu(rows: OddsOuRecord[], needle: { league: string; dateTime: string; homeNick: string; awayNick: string; line: number; }) {
  return rows.find((row) => row.league === needle.league && row.dateTime === needle.dateTime && row.homeNick === needle.homeNick && row.awayNick === needle.awayNick && row.line === needle.line) ?? null;
}
