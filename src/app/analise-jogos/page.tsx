"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { applyAliasesToMatches, getAliasMap } from "@/lib/aliases";
import { logPrediction } from "@/lib/prediction-ledger";
import type { MatchRecord, PredictionLedgerRecord } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table } from "@/components/ui/Table";

type ParsedFixture = {
  id: string;
  labelTime: string;
  homeTeam: string;
  homeNick: string;
  awayTeam: string;
  awayNick: string;
  oddHome?: number;
  oddDraw?: number;
  oddAway?: number;
};

type MarketInsight = {
  market: string;
  probability: number;
  fairOdd: number;
  signal: "over" | "under";
};

type H2hGame = {
  dateTime: string;
  homeNick: string;
  awayNick: string;
  homeGoals: number;
  awayGoals: number;
  result: "V" | "E" | "D";
};

type MostLikelyScore = {
  home: number;
  away: number;
  probability: number;
};

type PlayerStreak = {
  winStreak: number;
  lossStreak: number;
  unbeatenStreak: number;
  scoringStreak: number;
  cleanSheetStreak: number;
};

type MatchInsight = {
  fixture: ParsedFixture;
  sampleHome: number;
  sampleAway: number;
  sampleH2h: number;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  pick: "Casa" | "Empate" | "Fora";
  confidenceScore: number;
  confidence: "baixa" | "media" | "alta";
  valueEdgePp: number | null;
  isValueBet: boolean;
  expectedGoals: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  bttsProb: number;
  markets: MarketInsight[];
  reasons: string[];
  homeDeep: PlayerDeepSummary;
  awayDeep: PlayerDeepSummary;
  overAlert: {
    active: boolean;
    homeAvgConceded: number;
    awayAvgConceded: number;
    reason: string;
  };
  h2hGames: H2hGame[];
  h2hHomeWins: number;
  h2hDraws: number;
  h2hAwayWins: number;
  h2hAvgGoals: number;
  h2hBttsRate: number;
  h2hOverRates: { line: number; rate: number }[];
  homeStreak: PlayerStreak;
  awayStreak: PlayerStreak;
  mostLikelyScores: MostLikelyScore[];
  homeIndividualStats: PlayerIndividualStats;
  awayIndividualStats: PlayerIndividualStats;
  confidenceDiag: ConfidenceDiag;
  homeBounceBack: BounceBackProfile;
  awayBounceBack: BounceBackProfile;
  revengeFactor: RevengeFactor;
  overProbs: { line: number; poisson: number; empirical: number; blended: number }[];
  consensusOver25: boolean;
  dangerZone: boolean;
};

type PlayerIndividualStats = {
  bttsRate: number;
  overRates: { line: number; rate: number }[];
  avgTotalGoals: number;
  cleanSheetRate: number;
  scoringRate: number;
};

type ConfidenceDiag = {
  sampleScore: number;
  formDiffScore: number;
  h2hScore: number;
  edgeScore: number;
  overall: number;
  reasons: string[];
};

type BounceBackProfile = {
  postLossWinRate: number;
  postLossDrawRate: number;
  postLossAvgGf: number;
  postLossAvgGa: number;
  postLossGames: number;
  postCloseDefeatWinRate: number;
  postCloseDefeatGames: number;
  postHeavyDefeatWinRate: number;
  postHeavyDefeatGames: number;
  ppgAfterLoss3: number;
  ppgOverall: number;
  momentumShift: number;
  bounceBackScore: number;
  signal: string;
};

type RevengeFactor = {
  h2hRevengeRate: number;
  h2hRevengeGames: number;
  h2hRevengeAvgGf: number;
  signal: string;
};

type PlayerWindow = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  ppg: number;
  winRate: number;
  avgTotal: number;
  bttsRate: number;
  overRates: { line: number; rate: number }[];
  cleanSheetRate: number;
  scoringRate: number;
};

type TeamPeak = {
  team: string;
  games: number;
  wins: number;
  points: number;
  ppg: number;
};

type TeamFragility = {
  team: string;
  games: number;
  concededTotal: number;
  avgConceded: number;
};

type RecentSummary = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  ppg: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
};

type RecoverySummary = {
  score: number;
  signal: boolean;
  lossStreak: number;
  goalsInLast3: number;
  ppgLast3: number;
  ppgPrev3: number;
  reason: string;
};

type PlayerDeepSummary = {
  recent: RecentSummary;
  recovery: RecoverySummary;
  topTeamsByPoints: TeamPeak[];
  worstTeamsByConceded: TeamFragility[];
  currentTeamConceded: TeamFragility | null;
};

type SavedPrediction = {
  id: string;
  createdAt: string;
  scheduledAtLabel: string;
  fixtureLabel: string;
  pick: string;
  confidence: string;
  probability: number;
};

type BacktestRow = {
  matchId: string;
  dateTime: string;
  homeNick: string;
  awayNick: string;
  actualHome: number;
  actualAway: number;
  actualResult: "Casa" | "Empate" | "Fora";
  predictedPick: "Casa" | "Empate" | "Fora";
  pickHit: boolean;
  confidence: "baixa" | "media" | "alta";
  confidenceScore: number;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  expectedGoals: number;
  actualTotal: number;
  overHits: { line: number; predicted: boolean; actual: boolean; hit: boolean }[];
  bttsPredict: boolean;
  bttsActual: boolean;
  bttsHit: boolean;
};

type BacktestSummaryData = {
  total: number;
  pickHits: number;
  pickRate: number;
  byConfidence: { level: string; total: number; hits: number; rate: number }[];
  overRates: { line: number; total: number; hits: number; rate: number }[];
  bttsTotal: number;
  bttsHits: number;
  bttsRate: number;
  rows: BacktestRow[];
};

type AnalysisMode = "conservador" | "agressivo";
type SampleWindow = 5 | 10 | 20;

type ModeProfile = {
  overAlertGaThreshold: number;
  minValueEdgePp: number;
  confidenceHigh: number;
  confidenceMedium: number;
};

const DEFAULT_INPUT = `hoje, 21:01
Liverpool (STORM)
Napoli (PEACEMAKER)
Resultado Final (1X2)

1
3.20

X
3.65

2
1.87
+13
hoje, 21:16
Atletico Madrid (EDEN)
Barcelona (BOOM)
Resultado Final (1X2)

1
1.87

X
4.10

2
2.95
+13`;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseOdd(value?: string) {
  if (!value) return undefined;
  const cleaned = value.trim().replace(",", ".");
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number <= 1) return undefined;
  return number;
}

function parseTeamLine(line: string) {
  const text = line.trim();
  const match = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) {
    return {
      team: text,
      nick: text,
    };
  }

  return {
    team: match[1]?.trim() || text,
    nick: match[2]?.trim() || text,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function poissonPmf(lambda: number, goals: number) {
  if (goals < 0) return 0;
  if (lambda <= 0) return goals === 0 ? 1 : 0;

  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return Math.exp(-lambda) * (lambda ** goals) / factorial;
}

function poissonCdf(lambda: number, maxGoals: number) {
  let total = 0;
  for (let g = 0; g <= maxGoals; g += 1) total += poissonPmf(lambda, g);
  return total;
}

function computeStreak(matches: MatchRecord[], nick: string): PlayerStreak {
  const target = normalizeText(nick);
  const rows = matches
    .filter((m) => normalizeText(m.homeNick) === target || normalizeText(m.awayNick) === target)
    .sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime));

  let winStreak = 0;
  let lossStreak = 0;
  let unbeatenStreak = 0;
  let scoringStreak = 0;
  let cleanSheetStreak = 0;
  let winDone = false;
  let lossDone = false;
  let unbeatenDone = false;
  let scoringDone = false;
  let cleanDone = false;

  for (const row of rows) {
    const isHome = normalizeText(row.homeNick) === target;
    const gf = isHome ? row.homeGoals : row.awayGoals;
    const ga = isHome ? row.awayGoals : row.homeGoals;
    const won = gf > ga;
    const drew = gf === ga;
    const lost = gf < ga;

    if (!winDone) { if (won) winStreak += 1; else winDone = true; }
    if (!lossDone) { if (lost) lossStreak += 1; else lossDone = true; }
    if (!unbeatenDone) { if (!lost) unbeatenStreak += 1; else unbeatenDone = true; }
    if (!scoringDone) { if (gf > 0) scoringStreak += 1; else scoringDone = true; }
    if (!cleanDone) { if (ga === 0) cleanSheetStreak += 1; else cleanDone = true; }

    if (winDone && lossDone && unbeatenDone && scoringDone && cleanDone) break;
  }

  return { winStreak, lossStreak, unbeatenStreak, scoringStreak, cleanSheetStreak };
}

function computeMostLikelyScores(lambdaHome: number, lambdaAway: number): MostLikelyScore[] {
  const scores: MostLikelyScore[] = [];
  for (let h = 0; h <= 6; h += 1) {
    for (let a = 0; a <= 6; a += 1) {
      scores.push({ home: h, away: a, probability: poissonPmf(lambdaHome, h) * poissonPmf(lambdaAway, a) });
    }
  }
  return scores.sort((x, y) => y.probability - x.probability).slice(0, 5);
}

function computeBounceBack(matches: MatchRecord[], nick: string): BounceBackProfile {
  const target = normalizeText(nick);
  const rows = matches
    .filter((m) => normalizeText(m.homeNick) === target || normalizeText(m.awayNick) === target)
    .sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime));

  let postLossWins = 0;
  let postLossDraws = 0;
  let postLossGf = 0;
  let postLossGa = 0;
  let postLossGames = 0;
  let postCloseWins = 0;
  let postCloseGames = 0;
  let postHeavyWins = 0;
  let postHeavyGames = 0;
  let totalPoints = 0;
  let postLossPointsIn3 = 0;
  let postLossWindowCount = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const prevIsHome = normalizeText(prev.homeNick) === target;
    const prevGf = prevIsHome ? prev.homeGoals : prev.awayGoals;
    const prevGa = prevIsHome ? prev.awayGoals : prev.homeGoals;
    const prevLost = prevGf < prevGa;
    const prevMargin = prevGa - prevGf;

    const currIsHome = normalizeText(curr.homeNick) === target;
    const currGf = currIsHome ? curr.homeGoals : curr.awayGoals;
    const currGa = currIsHome ? curr.awayGoals : curr.homeGoals;
    const currWon = currGf > currGa;
    const currDrew = currGf === currGa;
    const currPts = currWon ? 3 : currDrew ? 1 : 0;
    totalPoints += currPts;

    if (prevLost) {
      postLossGames += 1;
      postLossGf += currGf;
      postLossGa += currGa;
      if (currWon) postLossWins += 1;
      if (currDrew) postLossDraws += 1;

      if (prevMargin === 1) {
        postCloseGames += 1;
        if (currWon) postCloseWins += 1;
      } else if (prevMargin >= 2) {
        postHeavyGames += 1;
        if (currWon) postHeavyWins += 1;
      }

      // PPG nos 3 jogos seguintes à derrota
      let windowPts = 0;
      let windowCount = 0;
      for (let j = i; j < Math.min(i + 3, rows.length); j += 1) {
        const r = rows[j];
        const rIsHome = normalizeText(r.homeNick) === target;
        const rGf = rIsHome ? r.homeGoals : r.awayGoals;
        const rGa = rIsHome ? r.awayGoals : r.homeGoals;
        windowPts += rGf > rGa ? 3 : rGf === rGa ? 1 : 0;
        windowCount += 1;
      }
      if (windowCount > 0) {
        postLossPointsIn3 += windowPts / windowCount;
        postLossWindowCount += 1;
      }
    }
  }

  const ppgOverall = rows.length > 1 ? totalPoints / (rows.length - 1) : 0;
  const ppgAfterLoss3 = postLossWindowCount > 0 ? postLossPointsIn3 / postLossWindowCount : 0;
  const momentumShift = ppgAfterLoss3 - ppgOverall;

  const postLossWinRate = postLossGames > 0 ? postLossWins / postLossGames : 0;
  const postLossDrawRate = postLossGames > 0 ? postLossDraws / postLossGames : 0;

  // Bounce-back score: 0-100
  let bbs = 0;
  bbs += clamp(postLossWinRate * 50, 0, 50);
  bbs += clamp(momentumShift * 20, -10, 25);
  bbs += postLossGames >= 5 ? 15 : postLossGames >= 3 ? 8 : 0;
  bbs += postLossGf > postLossGa ? 10 : 0;
  bbs = clamp(bbs, 0, 100);

  let signal = "neutro";
  if (bbs >= 65) signal = "forte";
  else if (bbs >= 40) signal = "moderado";
  else if (postLossGames >= 3) signal = "fraco";

  return {
    postLossWinRate,
    postLossDrawRate,
    postLossAvgGf: postLossGames > 0 ? postLossGf / postLossGames : 0,
    postLossAvgGa: postLossGames > 0 ? postLossGa / postLossGames : 0,
    postLossGames,
    postCloseDefeatWinRate: postCloseGames > 0 ? postCloseWins / postCloseGames : 0,
    postCloseDefeatGames: postCloseGames,
    postHeavyDefeatWinRate: postHeavyGames > 0 ? postHeavyWins / postHeavyGames : 0,
    postHeavyDefeatGames: postHeavyGames,
    ppgAfterLoss3,
    ppgOverall,
    momentumShift,
    bounceBackScore: bbs,
    signal,
  };
}

function computeRevengeFactor(
  matches: MatchRecord[],
  nickA: string,
  nickB: string,
): RevengeFactor {
  const targetA = normalizeText(nickA);
  const targetB = normalizeText(nickB);

  const h2hRows = matches
    .filter((m) => {
      const h = normalizeText(m.homeNick);
      const a = normalizeText(m.awayNick);
      return (h === targetA && a === targetB) || (h === targetB && a === targetA);
    })
    .sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime));

  let revengeWins = 0;
  let revengeGames = 0;
  let revengeGf = 0;

  for (let i = 1; i < h2hRows.length; i += 1) {
    const prev = h2hRows[i - 1];
    const curr = h2hRows[i];
    const prevIsHomeA = normalizeText(prev.homeNick) === targetA;
    const prevGfA = prevIsHomeA ? prev.homeGoals : prev.awayGoals;
    const prevGaA = prevIsHomeA ? prev.awayGoals : prev.homeGoals;
    const aLostPrev = prevGfA < prevGaA;

    const currIsHomeA = normalizeText(curr.homeNick) === targetA;
    const currGfA = currIsHomeA ? curr.homeGoals : curr.awayGoals;
    const currGaA = currIsHomeA ? curr.awayGoals : curr.homeGoals;
    const aWonCurr = currGfA > currGaA;

    if (aLostPrev) {
      revengeGames += 1;
      revengeGf += currGfA;
      if (aWonCurr) revengeWins += 1;
    }
  }

  const rate = revengeGames > 0 ? revengeWins / revengeGames : 0;
  let signal = "sem dados";
  if (revengeGames >= 3 && rate >= 0.6) signal = "vingança forte";
  else if (revengeGames >= 2 && rate >= 0.5) signal = "vingança moderada";
  else if (revengeGames >= 2) signal = "sem padrão claro";

  return {
    h2hRevengeRate: rate,
    h2hRevengeGames: revengeGames,
    h2hRevengeAvgGf: revengeGames > 0 ? revengeGf / revengeGames : 0,
    signal,
  };
}

function impliedFromOdds(oddHome?: number, oddDraw?: number, oddAway?: number) {
  if (!oddHome || !oddDraw || !oddAway) return null;

  const invHome = 1 / oddHome;
  const invDraw = 1 / oddDraw;
  const invAway = 1 / oddAway;
  const sum = invHome + invDraw + invAway;
  if (!sum) return null;

  return {
    home: invHome / sum,
    draw: invDraw / sum,
    away: invAway / sum,
  };
}

function parseFixtures(rawText: string): ParsedFixture[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) return [];

  const timeRegex = /^(hoje|amanh[ãa]|ontem)?\s*,?\s*\d{1,2}:\d{2}$/i;
  const startIndexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (timeRegex.test(lines[index])) startIndexes.push(index);
  }

  if (!startIndexes.length) startIndexes.push(0);

  const fixtures: ParsedFixture[] = [];

  for (let blockIndex = 0; blockIndex < startIndexes.length; blockIndex += 1) {
    const start = startIndexes[blockIndex];
    const end = blockIndex + 1 < startIndexes.length ? startIndexes[blockIndex + 1] : lines.length;
    const block = lines.slice(start, end);
    if (block.length < 3) continue;

    const labelTime = block[0];
    const teamLineCandidates = block.filter((line) => /\(.+\)/.test(line));
    const homeLine = teamLineCandidates[0] ?? block[1];
    const awayLine = teamLineCandidates[1] ?? block[2];
    if (!homeLine || !awayLine) continue;

    const home = parseTeamLine(homeLine);
    const away = parseTeamLine(awayLine);

    let oddHome: number | undefined;
    let oddDraw: number | undefined;
    let oddAway: number | undefined;

    for (let i = 0; i < block.length; i += 1) {
      const token = block[i];
      if (token === "1") oddHome = parseOdd(block[i + 1]);
      if (token.toUpperCase() === "X") oddDraw = parseOdd(block[i + 1]);
      if (token === "2") oddAway = parseOdd(block[i + 1]);
    }

    fixtures.push({
      id: `${normalizeText(home.nick)}::${normalizeText(away.nick)}::${labelTime}::${blockIndex}`,
      labelTime,
      homeTeam: home.team,
      homeNick: home.nick,
      awayTeam: away.team,
      awayNick: away.nick,
      oddHome,
      oddDraw,
      oddAway,
    });
  }

  return fixtures;
}

function parseLabelTimeToIso(labelTime: string) {
  const now = new Date();
  const match = labelTime.trim().match(/^(hoje|amanh[ãa]|ontem)?\s*,?\s*(\d{1,2}):(\d{2})$/i);
  if (!match) return now.toISOString();

  const dayWord = (match[1] ?? "hoje").toLowerCase();
  const hour = Number(match[2]);
  const minute = Number(match[3]);

  const date = new Date(now);
  if (dayWord.startsWith("amanh")) date.setDate(date.getDate() + 1);
  if (dayWord === "ontem") date.setDate(date.getDate() - 1);

  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function inferLeagueByPair(matches: MatchRecord[], homeNick: string, awayNick: string) {
  const homeNorm = normalizeText(homeNick);
  const awayNorm = normalizeText(awayNick);

  const last = matches
    .filter((row) => {
      const h = normalizeText(row.homeNick);
      const a = normalizeText(row.awayNick);
      return (h === homeNorm && a === awayNorm) || (h === awayNorm && a === homeNorm);
    })
    .sort((left, right) => +new Date(right.dateTime) - +new Date(left.dateTime))[0];

  return last?.league?.trim() || "clipboard";
}

function mapConfidenceToDecision(confidence: "baixa" | "media" | "alta"): PredictionLedgerRecord["decision"] {
  if (confidence === "alta") return "APOSTAVEL";
  if (confidence === "media") return "CAUTELA";
  return "EVITAR";
}

function profileByMode(mode: AnalysisMode): ModeProfile {
  if (mode === "agressivo") {
    return {
      overAlertGaThreshold: 1.45,
      minValueEdgePp: 1.5,
      confidenceHigh: 52,
      confidenceMedium: 38,
    };
  }

  return {
    overAlertGaThreshold: 1.8,
    minValueEdgePp: 4,
    confidenceHigh: 65,
    confidenceMedium: 45,
  };
}

function playerWindow(matches: MatchRecord[], nick: string, limit = 25): PlayerWindow {
  const normalizedNick = normalizeText(nick);

  const rows = matches
    .filter((match) => normalizeText(match.homeNick) === normalizedNick || normalizeText(match.awayNick) === normalizedNick)
    .sort((left, right) => +new Date(right.dateTime) - +new Date(left.dateTime))
    .slice(0, limit);

  if (!rows.length) {
    return {
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      ppg: 0,
      winRate: 0,
      avgTotal: 0,
      bttsRate: 0,
      overRates: [{ line: 0.5, rate: 0 }, { line: 1.5, rate: 0 }, { line: 2.5, rate: 0 }, { line: 3.5, rate: 0 }, { line: 4.5, rate: 0 }],
      cleanSheetRate: 0,
      scoringRate: 0,
    };
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gf = 0;
  let ga = 0;
  let bttsCount = 0;
  let cleanSheetCount = 0;
  let scoringCount = 0;
  const overCounts = [0, 0, 0, 0, 0]; // 0.5, 1.5, 2.5, 3.5, 4.5

  for (const row of rows) {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    const total = goalsFor + goalsAgainst;

    gf += goalsFor;
    ga += goalsAgainst;

    if (goalsFor > goalsAgainst) wins += 1;
    else if (goalsFor === goalsAgainst) draws += 1;
    else losses += 1;

    if (goalsFor > 0 && goalsAgainst > 0) bttsCount += 1;
    if (goalsAgainst === 0) cleanSheetCount += 1;
    if (goalsFor > 0) scoringCount += 1;
    if (total > 0.5) overCounts[0] += 1;
    if (total > 1.5) overCounts[1] += 1;
    if (total > 2.5) overCounts[2] += 1;
    if (total > 3.5) overCounts[3] += 1;
    if (total > 4.5) overCounts[4] += 1;
  }

  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const points = wins * 3 + draws;
  return {
    games: rows.length,
    wins,
    draws,
    losses,
    gf: gf / rows.length,
    ga: ga / rows.length,
    ppg: points / rows.length,
    winRate: wins / rows.length,
    avgTotal: (gf + ga) / rows.length,
    bttsRate: bttsCount / rows.length,
    overRates: lines.map((line, i) => ({ line, rate: overCounts[i] / rows.length })),
    cleanSheetRate: cleanSheetCount / rows.length,
    scoringRate: scoringCount / rows.length,
  };
}

function summarizePlayerDeep(matches: MatchRecord[], nick: string, sampleWindow: SampleWindow): PlayerDeepSummary {
  const normalizedNick = normalizeText(nick);

  const rows = matches
    .filter((match) => normalizeText(match.homeNick) === normalizedNick || normalizeText(match.awayNick) === normalizedNick)
    .sort((left, right) => +new Date(right.dateTime) - +new Date(left.dateTime));

  const recentRows = rows.slice(0, sampleWindow);
  let recentWins = 0;
  let recentDraws = 0;
  let recentLosses = 0;
  let recentGoalsFor = 0;
  let recentGoalsAgainst = 0;

  for (const row of recentRows) {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;

    recentGoalsFor += goalsFor;
    recentGoalsAgainst += goalsAgainst;

    if (goalsFor > goalsAgainst) recentWins += 1;
    else if (goalsFor === goalsAgainst) recentDraws += 1;
    else recentLosses += 1;
  }

  const teamMap = new Map<string, { games: number; wins: number; points: number; concededTotal: number }>();
  for (const row of recentRows) {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const team = (isHome ? row.homeTeam : row.awayTeam)?.trim() || "Sem time";
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    const points = goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;

    const current = teamMap.get(team) ?? { games: 0, wins: 0, points: 0, concededTotal: 0 };
    current.games += 1;
    current.points += points;
    current.concededTotal += goalsAgainst;
    if (points === 3) current.wins += 1;
    teamMap.set(team, current);
  }

  const topTeamsByPoints: TeamPeak[] = [...teamMap.entries()]
    .map(([team, item]) => ({
      team,
      games: item.games,
      wins: item.wins,
      points: item.points,
      ppg: item.points / Math.max(1, item.games),
    }))
    .sort((left, right) => {
      if (right.points !== left.points) return right.points - left.points;
      if (right.ppg !== left.ppg) return right.ppg - left.ppg;
      return right.wins - left.wins;
    })
    .slice(0, 3);

  const worstTeamsByConceded: TeamFragility[] = [...teamMap.entries()]
    .map(([team, item]) => ({
      team,
      games: item.games,
      concededTotal: item.concededTotal,
      avgConceded: item.concededTotal / Math.max(1, item.games),
    }))
    .sort((left, right) => {
      if (right.avgConceded !== left.avgConceded) return right.avgConceded - left.avgConceded;
      return right.concededTotal - left.concededTotal;
    })
    .slice(0, 3);

  const findTeamFragility = (teamName: string): TeamFragility | null => {
    const key = teamName.trim().toUpperCase();
    for (const [team, item] of teamMap.entries()) {
      if (team.trim().toUpperCase() !== key) continue;
      return {
        team,
        games: item.games,
        concededTotal: item.concededTotal,
        avgConceded: item.concededTotal / Math.max(1, item.games),
      };
    }
    return null;
  };

  const lastRow = rows[0];
  const currentTeamName = lastRow
    ? normalizeText(lastRow.homeNick) === normalizedNick
      ? lastRow.homeTeam
      : lastRow.awayTeam
    : "";

  const recentPoints = recentWins * 3 + recentDraws;

  let lossStreak = 0;
  for (const row of rows) {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    if (goalsFor < goalsAgainst) {
      lossStreak += 1;
      continue;
    }
    break;
  }

  const recent3 = rows.slice(0, 3);
  const prev3 = rows.slice(3, 6);
  const recent3Points = recent3.reduce((acc, row) => {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    if (goalsFor > goalsAgainst) return acc + 3;
    if (goalsFor === goalsAgainst) return acc + 1;
    return acc;
  }, 0);
  const prev3Points = prev3.reduce((acc, row) => {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    if (goalsFor > goalsAgainst) return acc + 3;
    if (goalsFor === goalsAgainst) return acc + 1;
    return acc;
  }, 0);

  const goalsInLast3 = recent3.filter((row) => {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    return goalsFor > 0;
  }).length;

  const ppgLast3 = recent3.length ? recent3Points / recent3.length : 0;
  const ppgPrev3 = prev3.length ? prev3Points / prev3.length : 0;

  let recoveryScore = 0;
  recoveryScore += clamp(lossStreak * 20, 0, 40);
  recoveryScore += clamp(goalsInLast3 * 15, 0, 45);
  recoveryScore += ppgLast3 > ppgPrev3 ? 15 : -5;
  if (recentRows.length >= 3 && (recentGoalsFor / Math.max(1, recentRows.length)) >= 1.2) recoveryScore += 10;
  recoveryScore = clamp(recoveryScore, 0, 100);

  const recoverySignal = recoveryScore >= 60;
  const recoveryReason = recoverySignal
    ? `Recuperação provável: ${lossStreak} derrotas seguidas com reação ofensiva (${goalsInLast3}/3 jogos marcando).`
    : `Sem sinal forte de recuperação (score ${Math.round(recoveryScore)}).`;

  return {
    recent: {
      games: recentRows.length,
      wins: recentWins,
      draws: recentDraws,
      losses: recentLosses,
      points: recentPoints,
      ppg: recentRows.length ? recentPoints / recentRows.length : 0,
      avgGoalsFor: recentRows.length ? recentGoalsFor / recentRows.length : 0,
      avgGoalsAgainst: recentRows.length ? recentGoalsAgainst / recentRows.length : 0,
    },
    recovery: {
      score: recoveryScore,
      signal: recoverySignal,
      lossStreak,
      goalsInLast3,
      ppgLast3,
      ppgPrev3,
      reason: recoveryReason,
    },
    topTeamsByPoints,
    worstTeamsByConceded,
    currentTeamConceded: currentTeamName ? findTeamFragility(currentTeamName) : null,
  };
}

function buildInsights(fixtures: ParsedFixture[], allMatches: MatchRecord[], mode: AnalysisMode, sampleWindow: SampleWindow): MatchInsight[] {
  const profile = profileByMode(mode);

  return fixtures.map((fixture) => {
    const home = playerWindow(allMatches, fixture.homeNick, sampleWindow);
    const away = playerWindow(allMatches, fixture.awayNick, sampleWindow);
    const homeDeep = summarizePlayerDeep(allMatches, fixture.homeNick, sampleWindow);
    const awayDeep = summarizePlayerDeep(allMatches, fixture.awayNick, sampleWindow);

    const homeCurrentConceded = homeDeep.currentTeamConceded?.avgConceded ?? 0;
    const awayCurrentConceded = awayDeep.currentTeamConceded?.avgConceded ?? 0;
    const overAlertBase = homeCurrentConceded >= profile.overAlertGaThreshold && awayCurrentConceded >= profile.overAlertGaThreshold;
    const overAlertRecoveryBoost = homeDeep.recovery.signal || awayDeep.recovery.signal;
    const overAlertActive = overAlertBase && overAlertRecoveryBoost;
    const overAlertReason = overAlertActive
      ? `Ambos cedem muitos gols no time atual (${homeCurrentConceded.toFixed(2)} e ${awayCurrentConceded.toFixed(2)} GA/j) e há sinal de recuperação ofensiva.`
      : `Sem gatilho forte de over completo: defesa (${homeCurrentConceded.toFixed(2)} / ${awayCurrentConceded.toFixed(2)} GA/j) + recuperação.`;

    const homeNickNorm = normalizeText(fixture.homeNick);
    const awayNickNorm = normalizeText(fixture.awayNick);

    const h2hRows = allMatches
      .filter((match) => {
        const h = normalizeText(match.homeNick);
        const a = normalizeText(match.awayNick);
        return (
          (h === homeNickNorm && a === awayNickNorm) ||
          (h === awayNickNorm && a === homeNickNorm)
        );
      })
      .sort((left, right) => +new Date(right.dateTime) - +new Date(left.dateTime))
      .slice(0, 12);

    let homeH2hPoints = 0;
    let awayH2hPoints = 0;
    let h2hHomeWins = 0;
    let h2hDraws = 0;
    let h2hAwayWins = 0;
    let h2hTotalGoals = 0;
    let h2hBttsCount = 0;
    const h2hGamesList: H2hGame[] = [];

    for (const row of h2hRows) {
      const homeIsHomeSide = normalizeText(row.homeNick) === homeNickNorm;
      const homeGoals = homeIsHomeSide ? row.homeGoals : row.awayGoals;
      const awayGoals = homeIsHomeSide ? row.awayGoals : row.homeGoals;
      if (homeGoals > awayGoals) { homeH2hPoints += 3; h2hHomeWins += 1; }
      else if (homeGoals < awayGoals) { awayH2hPoints += 3; h2hAwayWins += 1; }
      else { homeH2hPoints += 1; awayH2hPoints += 1; h2hDraws += 1; }
      h2hTotalGoals += homeGoals + awayGoals;
      if (homeGoals > 0 && awayGoals > 0) h2hBttsCount += 1;
      h2hGamesList.push({
        dateTime: row.dateTime,
        homeNick: homeIsHomeSide ? fixture.homeNick : fixture.awayNick,
        awayNick: homeIsHomeSide ? fixture.awayNick : fixture.homeNick,
        homeGoals,
        awayGoals,
        result: homeGoals > awayGoals ? "V" : homeGoals === awayGoals ? "E" : "D",
      });
    }

    const h2hAvgGoals = h2hRows.length ? h2hTotalGoals / h2hRows.length : 0;
    const h2hBttsRate = h2hRows.length ? h2hBttsCount / h2hRows.length : 0;

    // H2H over rates por linha
    const h2hOverLines = [0.5, 1.5, 2.5, 3.5, 4.5];
    const h2hOverRates = h2hOverLines.map((line) => {
      if (!h2hRows.length) return { line, rate: 0 };
      const count = h2hGamesList.filter((g) => g.homeGoals + g.awayGoals > line).length;
      return { line, rate: count / h2hRows.length };
    });

    // Individual stats
    const homeIndividualStats: PlayerIndividualStats = {
      bttsRate: home.bttsRate,
      overRates: home.overRates,
      avgTotalGoals: home.avgTotal,
      cleanSheetRate: home.cleanSheetRate,
      scoringRate: home.scoringRate,
    };
    const awayIndividualStats: PlayerIndividualStats = {
      bttsRate: away.bttsRate,
      overRates: away.overRates,
      avgTotalGoals: away.avgTotal,
      cleanSheetRate: away.cleanSheetRate,
      scoringRate: away.scoringRate,
    };

    const homeStreak = computeStreak(allMatches, fixture.homeNick);
    const awayStreak = computeStreak(allMatches, fixture.awayNick);
    const homeBounceBack = computeBounceBack(allMatches, fixture.homeNick);
    const awayBounceBack = computeBounceBack(allMatches, fixture.awayNick);
    const revengeFactor = computeRevengeFactor(allMatches, fixture.homeNick, fixture.awayNick);

    // === MOTOR DE PREVISÃO v2 — Poisson + Sigmoid + Odds + Comportamental ===

    // 1. Expected goals (lambdas) — modelo composto
    let lambdaHome = home.gf * 0.55 + away.ga * 0.45;
    let lambdaAway = away.gf * 0.55 + home.ga * 0.45;

    // Ajuste por forma recente
    lambdaHome = lambdaHome * 0.70 + homeDeep.recent.avgGoalsFor * 0.30;
    lambdaAway = lambdaAway * 0.70 + awayDeep.recent.avgGoalsFor * 0.30;

    // Ajuste por H2H (3+ jogos)
    if (h2hRows.length >= 3) {
      const h2hHomeLambda = h2hGamesList.reduce((s, g) => s + g.homeGoals, 0) / h2hRows.length;
      const h2hAwayLambda = h2hGamesList.reduce((s, g) => s + g.awayGoals, 0) / h2hRows.length;
      const h2hW = Math.min(0.25, h2hRows.length * 0.04);
      lambdaHome = lambdaHome * (1 - h2hW) + h2hHomeLambda * h2hW;
      lambdaAway = lambdaAway * (1 - h2hW) + h2hAwayLambda * h2hW;
    }

    const expectedHomeGoals = clamp(lambdaHome, 0.35, 5.5);
    const expectedAwayGoals = clamp(lambdaAway, 0.35, 5.5);
    const expectedGoals = expectedHomeGoals + expectedAwayGoals;
    const mostLikelyScores = computeMostLikelyScores(expectedHomeGoals, expectedAwayGoals);

    // 2. Poisson 1X2
    let poissonHome = 0;
    let poissonDraw = 0;
    let poissonAway = 0;
    for (let h = 0; h <= 8; h += 1) {
      for (let a = 0; a <= 8; a += 1) {
        const p = poissonPmf(expectedHomeGoals, h) * poissonPmf(expectedAwayGoals, a);
        if (h > a) poissonHome += p;
        else if (h === a) poissonDraw += p;
        else poissonAway += p;
      }
    }

    // 3. Modelo estatístico (sigmoid)
    const formDiff = (home.ppg - away.ppg) / 3;
    const winDiff = home.winRate - away.winRate;
    const attackDiff = (home.gf - away.gf) / 4;
    const defenseDiff = (away.ga - home.ga) / 4;
    const h2hDiff = h2hRows.length ? (homeH2hPoints - awayH2hPoints) / Math.max(1, h2hRows.length * 3) : 0;

    const score =
      formDiff * 0.30 +
      winDiff * 0.20 +
      attackDiff * 0.15 +
      defenseDiff * 0.15 +
      h2hDiff * 0.20;

    const drawWeight = clamp(0.2 + (1 - Math.min(1, Math.abs(score) * 1.7)) * 0.12, 0.12, 0.34);
    const winBudget = 1 - drawWeight;
    const sigmoidHome = winBudget * sigmoid(score * 2.4);
    const sigmoidAway = winBudget - sigmoidHome;
    const sigmoidDraw = drawWeight;

    // 4. Ajustes comportamentais
    let homeAdj = 0;
    let awayAdj = 0;
    if (homeStreak.winStreak >= 3) homeAdj += 0.015 * Math.min(homeStreak.winStreak, 5);
    if (homeStreak.lossStreak >= 2) homeAdj -= 0.01 * Math.min(homeStreak.lossStreak, 4);
    if (awayStreak.winStreak >= 3) awayAdj += 0.015 * Math.min(awayStreak.winStreak, 5);
    if (awayStreak.lossStreak >= 2) awayAdj -= 0.01 * Math.min(awayStreak.lossStreak, 4);
    if (homeStreak.lossStreak > 0 && homeBounceBack.bounceBackScore >= 55) homeAdj += 0.025 * (homeBounceBack.bounceBackScore / 100);
    if (awayStreak.lossStreak > 0 && awayBounceBack.bounceBackScore >= 55) awayAdj += 0.025 * (awayBounceBack.bounceBackScore / 100);
    if (revengeFactor.signal === "vingança forte") homeAdj += 0.025;
    else if (revengeFactor.signal === "vingança moderada") homeAdj += 0.01;

    // 5. Blend final: Poisson (35%) + Sigmoid (25%) + Odds (40%) | sem odds: 50/50
    const implied = impliedFromOdds(fixture.oddHome, fixture.oddDraw, fixture.oddAway);
    let homeProb: number;
    let drawProb: number;
    let awayProb: number;
    if (implied) {
      homeProb = poissonHome * 0.30 + sigmoidHome * 0.25 + implied.home * 0.45;
      drawProb = poissonDraw * 0.30 + sigmoidDraw * 0.25 + implied.draw * 0.45;
      awayProb = poissonAway * 0.30 + sigmoidAway * 0.25 + implied.away * 0.45;
    } else {
      homeProb = poissonHome * 0.50 + sigmoidHome * 0.50;
      drawProb = poissonDraw * 0.50 + sigmoidDraw * 0.50;
      awayProb = poissonAway * 0.50 + sigmoidAway * 0.50;
    }
    homeProb += homeAdj;
    awayProb += awayAdj;
    drawProb -= (homeAdj + awayAdj) * 0.3;
    const rawNorm = homeProb + drawProb + awayProb || 1;
    homeProb = Math.max(0.02, homeProb / rawNorm);
    drawProb = Math.max(0.02, drawProb / rawNorm);
    awayProb = Math.max(0.02, awayProb / rawNorm);
    const norm2 = homeProb + drawProb + awayProb;
    homeProb /= norm2;
    drawProb /= norm2;
    awayProb /= norm2;

    // 6. Over probabilities com blend empírico (Poisson + dados reais + H2H)
    const overLines = [1.5, 2.5, 3.5, 4.5];
    const overProbs = overLines.map((line) => {
      const poissonOver = 1 - poissonCdf(expectedGoals, line);
      const homeOR = home.overRates.find((r) => r.line === line)?.rate ?? poissonOver;
      const awayOR = away.overRates.find((r) => r.line === line)?.rate ?? poissonOver;
      const h2hOR = h2hOverRates.find((r) => r.line === line)?.rate ?? 0;
      const empirical = (homeOR + awayOR) / 2;
      let blended: number;
      if (h2hRows.length >= 3) {
        blended = poissonOver * 0.35 + empirical * 0.40 + h2hOR * 0.25;
      } else {
        blended = poissonOver * 0.45 + empirical * 0.55;
      }
      return { line, poisson: poissonOver, empirical, blended: clamp(blended, 0, 1) };
    });

    // BTTS com blend empírico
    const poissonBtts = 1 - Math.exp(-expectedHomeGoals) - Math.exp(-expectedAwayGoals) + Math.exp(-(expectedHomeGoals + expectedAwayGoals));
    const empiricalBtts = (home.bttsRate + away.bttsRate) / 2;
    const bttsProb = h2hRows.length >= 3
      ? poissonBtts * 0.30 + empiricalBtts * 0.40 + h2hBttsRate * 0.30
      : poissonBtts * 0.40 + empiricalBtts * 0.60;

    // Consenso Over 2.5: quando Poisson, empírico e H2H concordam
    const ov25 = overProbs.find((r) => r.line === 2.5);
    const ov25H2h = h2hOverRates.find((r) => r.line === 2.5)?.rate ?? 0;
    const consensusOver25 = (ov25?.poisson ?? 0) >= 0.50 && (ov25?.empirical ?? 0) >= 0.50 && (h2hRows.length < 3 || ov25H2h >= 0.50);

    // Danger zone: jogo muito imprevisível
    const maxProb = Math.max(homeProb, drawProb, awayProb);
    const dangerZone = maxProb < 0.40 && drawProb >= 0.28;

    // Markets completos: Over 1.5, 2.5, 3.5, 4.5 + BTTS
    const markets: MarketInsight[] = overProbs.map((op) => ({
      market: `Over ${op.line}`,
      probability: op.blended,
      fairOdd: 1 / Math.max(0.01, op.blended),
      signal: (op.blended >= 0.5 ? "over" : "under") as "over" | "under",
    }));
    markets.push({
      market: "BTTS (Sim)",
      probability: clamp(bttsProb, 0, 1),
      fairOdd: 1 / Math.max(0.01, clamp(bttsProb, 0, 1)),
      signal: bttsProb >= 0.5 ? "over" : "under",
    });

    const ordered = [
      { key: "Casa" as const, value: homeProb },
      { key: "Empate" as const, value: drawProb },
      { key: "Fora" as const, value: awayProb },
    ].sort((left, right) => right.value - left.value);

    const top = ordered[0];
    const second = ordered[1];
    const edge = top.value - (second?.value ?? 0);
    const coverage = Math.min(home.games, away.games) / sampleWindow;

    // Confiança multipilar
    let confidenceScore = 0;
    confidenceScore += edge * 100 * 0.50;
    confidenceScore += clamp(coverage, 0, 1) * 25;
    confidenceScore += (h2hRows.length >= 5 ? 12 : h2hRows.length >= 3 ? 8 : h2hRows.length >= 1 ? 4 : 0);
    confidenceScore += top.value >= 0.50 ? 10 : top.value >= 0.42 ? 6 : 2;
    confidenceScore += dangerZone ? -8 : 0;
    confidenceScore += Math.abs(home.ppg - away.ppg) >= 0.8 ? 8 : Math.abs(home.ppg - away.ppg) >= 0.4 ? 4 : 0;

    let confidence: "baixa" | "media" | "alta" = "baixa";
    if (confidenceScore >= profile.confidenceHigh) confidence = "alta";
    else if (confidenceScore >= profile.confidenceMedium) confidence = "media";

    const pickOdd = top.key === "Casa" ? fixture.oddHome : top.key === "Empate" ? fixture.oddDraw : fixture.oddAway;
    const impliedPick = pickOdd && pickOdd > 1 ? 1 / pickOdd : null;
    const valueEdgePp = impliedPick == null ? null : (top.value - impliedPick) * 100;
    const isValueBet = valueEdgePp != null && valueEdgePp >= profile.minValueEdgePp;

    // Diagnóstico de confiança
    const sampleScore = clamp(Math.min(home.games, away.games) / sampleWindow * 40, 0, 40);
    const formDiffScoreDiag = clamp(Math.abs(home.ppg - away.ppg) / 3 * 25, 0, 25);
    const h2hScoreDiag = clamp(h2hRows.length >= 3 ? 15 : h2hRows.length >= 1 ? 8 : 0, 0, 15);
    const edgeScoreDiag = clamp(edge * 100 * 0.2, 0, 20);
    const overallDiag = sampleScore + formDiffScoreDiag + h2hScoreDiag + edgeScoreDiag;
    const diagReasons: string[] = [];
    if (sampleScore >= 30) diagReasons.push(`Boa amostra (${Math.min(home.games, away.games)}/${sampleWindow} jogos)`);
    else diagReasons.push(`Amostra limitada (${Math.min(home.games, away.games)}/${sampleWindow} jogos) — reduz confiança`);
    if (formDiffScoreDiag >= 15) diagReasons.push(`Diferença de forma significativa (${Math.abs(home.ppg - away.ppg).toFixed(2)} PPG)`);
    else diagReasons.push(`Forma dos jogadores semelhante — dificulta previsão`);
    if (h2hScoreDiag >= 15) diagReasons.push(`H2H robusto com ${h2hRows.length} confrontos diretos`);
    else if (h2hRows.length > 0) diagReasons.push(`H2H com apenas ${h2hRows.length} jogo(s) — peso reduzido`);
    else diagReasons.push(`Sem H2H direto — previsão baseada apenas em forma geral`);
    if (edgeScoreDiag >= 10) diagReasons.push(`Edge claro entre favorito e adversário`);
    else diagReasons.push(`Jogo equilibrado sem edge dominante`);

    const confidenceDiag: ConfidenceDiag = {
      sampleScore,
      formDiffScore: formDiffScoreDiag,
      h2hScore: h2hScoreDiag,
      edgeScore: edgeScoreDiag,
      overall: overallDiag,
      reasons: diagReasons,
    };

    const reasons = [
      `Forma recente ${fixture.homeNick} ${home.ppg.toFixed(2)} PPG vs ${fixture.awayNick} ${away.ppg.toFixed(2)} PPG.`,
      `Amostra: ${home.games} jogos (${fixture.homeNick}) e ${away.games} jogos (${fixture.awayNick}) na base local.`,
      `H2H recente: ${h2hRows.length} partidas usadas para ajuste de confronto direto.`,
      `Últimos ${sampleWindow}: ${fixture.homeNick} ${homeDeep.recent.points} pts (${homeDeep.recent.wins}V/${homeDeep.recent.draws}E/${homeDeep.recent.losses}D) vs ${fixture.awayNick} ${awayDeep.recent.points} pts (${awayDeep.recent.wins}V/${awayDeep.recent.draws}E/${awayDeep.recent.losses}D).`,
      `${fixture.homeNick} recuperação: ${Math.round(homeDeep.recovery.score)} (${homeDeep.recovery.reason})`,
      `${fixture.awayNick} recuperação: ${Math.round(awayDeep.recovery.score)} (${awayDeep.recovery.reason})`,
      overAlertReason,
      `Média esperada de gols: ${expectedGoals.toFixed(2)} (Poisson+Empírico).`,
      consensusOver25 ? `Consenso Over 2.5: Poisson, empírico e H2H convergem à favor.` : `Sem consenso Over 2.5 entre os modelos.`,
      dangerZone ? `DANGER ZONE: jogo muito equilibrado, cautela máxima.` : `Jogo com diferenciação nítida entre os lados.`,
    ];

    return {
      fixture,
      sampleHome: home.games,
      sampleAway: away.games,
      sampleH2h: h2hRows.length,
      homeProb,
      drawProb,
      awayProb,
      pick: top.key,
      confidenceScore,
      confidence,
      valueEdgePp,
      isValueBet,
      expectedGoals,
      expectedHomeGoals,
      expectedAwayGoals,
      bttsProb,
      markets,
      reasons,
      homeDeep,
      awayDeep,
      overAlert: {
        active: overAlertActive,
        homeAvgConceded: homeCurrentConceded,
        awayAvgConceded: awayCurrentConceded,
        reason: overAlertReason,
      },
      h2hGames: h2hGamesList,
      h2hHomeWins,
      h2hDraws,
      h2hAwayWins,
      h2hAvgGoals,
      h2hBttsRate,
      h2hOverRates,
      homeStreak,
      awayStreak,
      mostLikelyScores,
      homeIndividualStats,
      awayIndividualStats,
      confidenceDiag,
      homeBounceBack,
      awayBounceBack,
      revengeFactor,
      overProbs,
      consensusOver25,
      dangerZone,
    };
  });
}

export default function AnaliseJogosPage() {
  const [rawInput, setRawInput] = useState(DEFAULT_INPUT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<ParsedFixture[]>([]);
  const [insights, setInsights] = useState<MatchInsight[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [history, setHistory] = useState<SavedPrediction[]>([]);
  const [mode, setMode] = useState<AnalysisMode>("conservador");
  const [sampleWindow, setSampleWindow] = useState<SampleWindow>(10);
  const [detailItem, setDetailItem] = useState<MatchInsight | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [analysisMatches, setAnalysisMatches] = useState<MatchRecord[]>([]);
  const [confidenceFilter, setConfidenceFilter] = useState<"todos" | "alta" | "media" | "baixa">("todos");
  const [backtestData, setBacktestData] = useState<BacktestSummaryData | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestSample, setBacktestSample] = useState(50);

  const filteredInsights = useMemo(() => {
    if (confidenceFilter === "todos") return insights;
    return insights.filter((i) => i.confidence === confidenceFilter);
  }, [insights, confidenceFilter]);

  const canRun = useMemo(() => rawInput.trim().length > 0, [rawInput]);

  useEffect(() => {
    void loadHistory();
  }, []);

  async function loadHistory() {
    const rows = await db.predictionLedger.where("routeContext").equals("analise-jogos").toArray();
    const top = rows
      .filter((row) => row.market === "1x2")
      .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
      .slice(0, 40)
      .map((row) => {
        const snapshot = (row.inputSnapshot ?? {}) as {
          homeNick?: string;
          awayNick?: string;
          pick?: string;
          labelTime?: string;
          probability?: number;
        };

        return {
          id: row.id,
          createdAt: row.createdAt,
          scheduledAtLabel: row.scheduledAtLabel ?? snapshot.labelTime ?? "-",
          fixtureLabel: `${snapshot.homeNick ?? "?"} x ${snapshot.awayNick ?? "?"}`,
          pick: snapshot.pick ?? "-",
          confidence: row.confidence,
          probability: row.pCalibrated,
        };
      });

    setHistory(top);
  }

  async function runAnalysis() {
    setLoading(true);
    setError("");

    try {
      const fixtures = parseFixtures(rawInput);
      if (!fixtures.length) {
        setParsed([]);
        setInsights([]);
        setError("Não consegui identificar jogos no texto. Mantenha o bloco com horário + times + odds 1/X/2.");
        return;
      }

      const [allMatches, aliasMap] = await Promise.all([db.matches.toArray(), getAliasMap()]);
      const normalizedMatches = applyAliasesToMatches(allMatches, aliasMap);
      setAnalysisMatches(normalizedMatches);

      const normalizedFixtures = fixtures.map((fixture) => ({
        ...fixture,
        homeNick: aliasMap.get(normalizeText(fixture.homeNick).toLowerCase()) ?? fixture.homeNick,
        awayNick: aliasMap.get(normalizeText(fixture.awayNick).toLowerCase()) ?? fixture.awayNick,
      }));

      setParsed(normalizedFixtures);
      setInsights(buildInsights(normalizedFixtures, normalizedMatches, mode, sampleWindow));
    } catch {
      setError("Falha ao analisar os jogos no banco local.");
      setParsed([]);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveToHistory() {
    if (!insights.length) return;

    setSaving(true);
    setSaveMessage("");

    try {
      const allMatches = await db.matches.toArray();
      for (const item of insights) {
        const scheduledIso = parseLabelTimeToIso(item.fixture.labelTime);
        const league = inferLeagueByPair(allMatches, item.fixture.homeNick, item.fixture.awayNick);
        const probability =
          item.pick === "Casa"
            ? item.homeProb
            : item.pick === "Empate"
              ? item.drawProb
              : item.awayProb;

        await logPrediction({
          presetId: "clipboard-v1",
          routeContext: "analise-jogos",
          scheduledAtLabel: item.fixture.labelTime,
          match: {
            dateTime: scheduledIso,
            league,
            homeNick: item.fixture.homeNick,
            awayNick: item.fixture.awayNick,
          },
          market: "1x2",
          pRaw: probability,
          pCalibrated: probability,
          decision: mapConfidenceToDecision(item.confidence),
          confidence: item.confidence,
          reasons: item.reasons,
          contraReasons: [],
          inputSnapshot: {
            labelTime: item.fixture.labelTime,
            homeNick: item.fixture.homeNick,
            awayNick: item.fixture.awayNick,
            pick: item.pick,
            probability,
            homeProb: item.homeProb,
            drawProb: item.drawProb,
            awayProb: item.awayProb,
          },
        });
      }

      await loadHistory();
      setSaveMessage(`Salvo no histórico com horário de jogo: ${insights.length} previsão(ões).`);
    } catch {
      setSaveMessage("Não foi possível salvar no histórico agora.");
    } finally {
      setSaving(false);
    }
  }

  function buildCuriosities(item: MatchInsight) {
    const curiosities: string[] = [];
    if (item.isValueBet && item.valueEdgePp != null) curiosities.push(`Value identificado: +${item.valueEdgePp.toFixed(1)}pp contra a odd do pick.`);
    if (item.overAlert.active) curiosities.push("Sinal de jogo aberto: OVER ALERTA ativo nos times atuais.");
    if (item.homeDeep.recent.ppg >= 2) curiosities.push(`${item.fixture.homeNick} em fase forte no recorte (${item.homeDeep.recent.ppg.toFixed(2)} PPG).`);
    if (item.awayDeep.recent.ppg >= 2) curiosities.push(`${item.fixture.awayNick} em fase forte no recorte (${item.awayDeep.recent.ppg.toFixed(2)} PPG).`);
    if (item.homeDeep.recovery.signal) curiosities.push(`${item.fixture.homeNick} com sinal de recuperação (${Math.round(item.homeDeep.recovery.score)}/100).`);
    if (item.awayDeep.recovery.signal) curiosities.push(`${item.fixture.awayNick} com sinal de recuperação (${Math.round(item.awayDeep.recovery.score)}/100).`);
    if (item.homeBounceBack.signal === "forte" && item.homeStreak.lossStreak > 0) curiosities.push(`${item.fixture.homeNick} vem de derrota e tem bounce-back FORTE (${Math.round(item.homeBounceBack.bounceBackScore)}/100) — tende a reagir.`);
    if (item.awayBounceBack.signal === "forte" && item.awayStreak.lossStreak > 0) curiosities.push(`${item.fixture.awayNick} vem de derrota e tem bounce-back FORTE (${Math.round(item.awayBounceBack.bounceBackScore)}/100) — tende a reagir.`);
    if (item.revengeFactor.signal === "vingança forte") curiosities.push(`Fator vingança ativo: ${item.fixture.homeNick} costuma vencer após perder para ${item.fixture.awayNick} (${(item.revengeFactor.h2hRevengeRate * 100).toFixed(0)}%).`);
    if (item.consensusOver25) curiosities.push("CONSENSO Over 2.5: Poisson, empírico e H2H convergem — sinal forte de jogo com gols.");
    if (item.dangerZone) curiosities.push("DANGER ZONE: jogo extremamente equilibrado, stake mínimo recomendado.");
    if (item.homeDeep.recent.avgGoalsAgainst >= 1.8 || item.awayDeep.recent.avgGoalsAgainst >= 1.8) curiosities.push("Defesa vulnerável no recorte recente (GA/j elevado)." );
    if (!curiosities.length) curiosities.push("Sem anomalia forte; cenário mais equilibrado no recorte atual.");
    return curiosities;
  }

  function getLastFivePlayerGames(nick: string) {
    const target = normalizeText(nick);

    return analysisMatches
      .filter((match) => normalizeText(match.homeNick) === target || normalizeText(match.awayNick) === target)
      .sort((left, right) => +new Date(right.dateTime) - +new Date(left.dateTime))
      .slice(0, 5)
      .map((match) => {
        const isHome = normalizeText(match.homeNick) === target;
        const goalsFor = isHome ? match.homeGoals : match.awayGoals;
        const goalsAgainst = isHome ? match.awayGoals : match.homeGoals;
        const opponent = isHome ? match.awayNick : match.homeNick;
        const result = goalsFor > goalsAgainst ? "V" : goalsFor === goalsAgainst ? "E" : "D";

        return {
          id: match.id,
          dateTime: match.dateTime,
          team: isHome ? match.homeTeam : match.awayTeam,
          opponent,
          score: `${goalsFor}-${goalsAgainst}`,
          result,
        };
      });
  }

  function goToH2hWithDetail(item: MatchInsight) {
    const query = new URLSearchParams({
      playerA: item.fixture.homeNick,
      playerB: item.fixture.awayNick,
      teamA: item.fixture.homeTeam,
      teamB: item.fixture.awayTeam,
      tab: "analise",
    });

    const url = `/h2h?${query.toString()}`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = url;
    }
  }

  function buildDirectSummary(item: MatchInsight) {
    const homeAttack = item.homeDeep.recent.avgGoalsFor;
    const homeDefense = item.homeDeep.recent.avgGoalsAgainst;
    const awayAttack = item.awayDeep.recent.avgGoalsFor;
    const awayDefense = item.awayDeep.recent.avgGoalsAgainst;

    const attackGap = homeAttack - awayAttack;
    const defenseGap = awayDefense - homeDefense;
    const trendScore = (attackGap * 0.6 + defenseGap * 0.4) * 10;

    let bestScenario = "Jogo equilibrado";
    if (item.overAlert.active && item.expectedGoals >= 3) bestScenario = "Melhor cenário: over gols";
    else if (item.pick === "Casa" && item.homeProb >= 0.5) bestScenario = "Melhor cenário: casa com proteção";
    else if (item.pick === "Fora" && item.awayProb >= 0.5) bestScenario = "Melhor cenário: fora com proteção";
    else if (item.pick === "Empate" || item.drawProb >= 0.3) bestScenario = "Melhor cenário: evitar risco alto / empate vivo";

    return {
      attackGap,
      defenseGap,
      trendScore,
      bestScenario,
    };
  }

  function buildRiskSignal(item: MatchInsight) {
    const confidence = clamp(item.confidenceScore, 0, 100);
    const balance = 1 - Math.abs(item.homeProb - item.awayProb);
    const riskScore =
      (100 - confidence) * 0.55 +
      item.drawProb * 100 * 0.25 +
      clamp(balance, 0, 1) * 100 * 0.2;

    if (riskScore <= 33) {
      return {
        label: "Risco baixo",
        toneClass: "good",
        reason: "Leitura mais estável para esse jogo.",
      };
    }

    if (riskScore <= 66) {
      return {
        label: "Risco médio",
        toneClass: "warn",
        reason: "Jogo com sinais mistos; usar proteção.",
      };
    }

    return {
      label: "Risco alto",
      toneClass: "bad",
      reason: "Cenário bem instável; stake menor.",
    };
  }

  function buildWhySuggestion(item: MatchInsight) {
    const mainReasons = item.reasons.slice(0, 3);
    if (mainReasons.length === 3) return mainReasons;

    const fallback = [
      `Forma recente: ${item.fixture.homeNick} ${item.homeDeep.recent.ppg.toFixed(2)} PPG vs ${item.awayDeep.recent.ppg.toFixed(2)} PPG de ${item.fixture.awayNick}.`,
      `Probabilidades estimadas: Casa ${(item.homeProb * 100).toFixed(1)}% | Empate ${(item.drawProb * 100).toFixed(1)}% | Fora ${(item.awayProb * 100).toFixed(1)}%.`,
      item.overAlert.active ? "Existe sinal de jogo aberto (alerta de over ativo)." : "Sem sinal forte de over neste confronto.",
    ];

    return [...mainReasons, ...fallback].slice(0, 3);
  }

  function buildShareSummary(item: MatchInsight) {
    const risk = buildRiskSignal(item);
    const o25 = item.overProbs.find((r) => r.line === 2.5);
    return [
      `${item.fixture.homeNick} x ${item.fixture.awayNick} (${item.fixture.homeTeam} x ${item.fixture.awayTeam})`,
      `Palpite: ${item.pick} | Força: ${Math.round(item.confidenceScore)} | ${risk.label}`,
      `Prob.: Casa ${(item.homeProb * 100).toFixed(1)}% | Empate ${(item.drawProb * 100).toFixed(1)}% | Fora ${(item.awayProb * 100).toFixed(1)}%`,
      item.valueEdgePp == null ? "Vantagem: sem odd informada" : `Vantagem: ${item.valueEdgePp.toFixed(1)}pp`,
      `Over 2.5: ${((o25?.blended ?? 0) * 100).toFixed(0)}% | BTTS: ${(item.bttsProb * 100).toFixed(0)}% | xG: ${item.expectedGoals.toFixed(2)}`,
      `Cenário: ${buildDirectSummary(item).bestScenario}${item.consensusOver25 ? " | CONSENSO O2.5" : ""}${item.dangerZone ? " | DANGER ZONE" : ""}`,
    ].join("\n");
  }

  async function copyDetailSummary(item: MatchInsight) {
    try {
      await navigator.clipboard.writeText(buildShareSummary(item));
      setCopyMessage("Resumo copiado.");
    } catch {
      setCopyMessage("Não deu para copiar agora.");
    }

    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  async function runBacktest() {
    setBacktestLoading(true);
    try {
      const [rawMatches, aliasMap] = await Promise.all([db.matches.toArray(), getAliasMap()]);
      const allMatches = applyAliasesToMatches(rawMatches, aliasMap);
      const sorted = [...allMatches].sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime));

      // Pegar os N jogos mais recentes como "teste"
      const testMatches = sorted.slice(0, backtestSample);
      const rows: BacktestRow[] = [];

      for (const testMatch of testMatches) {
        const homeNick = testMatch.homeNick;
        const awayNick = testMatch.awayNick;
        const homeNickNorm = normalizeText(homeNick);
        const awayNickNorm = normalizeText(awayNick);

        // Dados históricos = todos os jogos ANTES deste jogo (treino)
        const matchDate = +new Date(testMatch.dateTime);
        const trainingData = allMatches.filter((m) => +new Date(m.dateTime) < matchDate);

        // Precisamos de pelo menos 5 jogos de cada jogador
        const homeCount = trainingData.filter((m) => normalizeText(m.homeNick) === homeNickNorm || normalizeText(m.awayNick) === homeNickNorm).length;
        const awayCount = trainingData.filter((m) => normalizeText(m.homeNick) === awayNickNorm || normalizeText(m.awayNick) === awayNickNorm).length;
        if (homeCount < 5 || awayCount < 5) continue;

        // Simular fixture
        const fixture: ParsedFixture = {
          id: testMatch.id,
          labelTime: "",
          homeTeam: testMatch.homeTeam,
          homeNick: homeNick,
          awayTeam: testMatch.awayTeam,
          awayNick: awayNick,
          oddHome: testMatch.oddHomeClose,
          oddDraw: testMatch.oddDrawClose,
          oddAway: testMatch.oddAwayClose,
        };

        const insightArr = buildInsights([fixture], trainingData, mode, sampleWindow);
        if (!insightArr.length) continue;
        const insight = insightArr[0];

        const actualTotal = testMatch.homeGoals + testMatch.awayGoals;
        const actualResult: "Casa" | "Empate" | "Fora" =
          testMatch.homeGoals > testMatch.awayGoals ? "Casa"
          : testMatch.homeGoals < testMatch.awayGoals ? "Fora" : "Empate";

        const overLines = [1.5, 2.5, 3.5, 4.5];
        const overHits = overLines.map((line) => {
          const op = insight.overProbs.find((r) => r.line === line);
          const predicted = (op?.blended ?? 0) >= 0.50;
          const actual = actualTotal > line;
          return { line, predicted, actual, hit: predicted === actual };
        });

        const bttsActual = testMatch.homeGoals > 0 && testMatch.awayGoals > 0;
        const bttsPredict = insight.bttsProb >= 0.50;

        rows.push({
          matchId: testMatch.id,
          dateTime: testMatch.dateTime,
          homeNick,
          awayNick,
          actualHome: testMatch.homeGoals,
          actualAway: testMatch.awayGoals,
          actualResult,
          predictedPick: insight.pick,
          pickHit: insight.pick === actualResult,
          confidence: insight.confidence,
          confidenceScore: insight.confidenceScore,
          homeProb: insight.homeProb,
          drawProb: insight.drawProb,
          awayProb: insight.awayProb,
          expectedGoals: insight.expectedGoals,
          actualTotal,
          overHits,
          bttsPredict,
          bttsActual,
          bttsHit: bttsPredict === bttsActual,
        });
      }

      const pickHits = rows.filter((r) => r.pickHit).length;
      const byLevels = ["alta", "media", "baixa"] as const;
      const byConfidence = byLevels.map((level) => {
        const sub = rows.filter((r) => r.confidence === level);
        const hits = sub.filter((r) => r.pickHit).length;
        return { level, total: sub.length, hits, rate: sub.length ? hits / sub.length : 0 };
      });

      const overRates = [1.5, 2.5, 3.5, 4.5].map((line) => {
        const hits = rows.filter((r) => r.overHits.find((o) => o.line === line)?.hit).length;
        return { line, total: rows.length, hits, rate: rows.length ? hits / rows.length : 0 };
      });

      const bttsHits = rows.filter((r) => r.bttsHit).length;

      setBacktestData({
        total: rows.length,
        pickHits,
        pickRate: rows.length ? pickHits / rows.length : 0,
        byConfidence,
        overRates,
        bttsTotal: rows.length,
        bttsHits,
        bttsRate: rows.length ? bttsHits / rows.length : 0,
        rows,
      });
    } catch {
      setBacktestData(null);
    } finally {
      setBacktestLoading(false);
    }
  }

  return (
    <div className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Análise simples dos jogos</h3>
            <small>Cole os jogos e o sistema mostra quem tem mais chance de ganhar e se vale olhar over/under.</small>
          </div>
          <Badge tone="warn">Em testes</Badge>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="row" style={{ alignItems: "flex-start", display: "grid", gap: 6 }}>
              <span className="mini"><strong>? Palpite</strong> = lado com maior chance (Casa, Empate ou Fora).</span>
              <span className="mini"><strong>? Força do palpite</strong> = nota de 0 a 100. Quanto maior, melhor.</span>
              <span className="mini"><strong>? Vantagem na odd</strong> = quando sua chance estimada é melhor que a odd da casa.</span>
              <span className="mini"><strong>? Alerta de over</strong> = sinal de jogo mais aberto, com chance maior de gols.</span>
            </div>

            <textarea
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="Cole aqui os jogos..."
              rows={14}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "12px",
                fontSize: 12,
                width: "100%",
                resize: "vertical",
              }}
            />

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="select"
                value={mode}
                onChange={(event) => setMode(event.target.value as AnalysisMode)}
                aria-label="Modo de análise"
              >
                <option value="conservador">Modo conservador</option>
                <option value="agressivo">Modo agressivo</option>
              </select>
              <select
                className="select"
                value={sampleWindow}
                onChange={(event) => setSampleWindow(Number(event.target.value) as SampleWindow)}
                aria-label="Janela de jogos"
              >
                <option value={5}>Últimos 5 jogos</option>
                <option value={10}>Últimos 10 jogos</option>
                <option value={20}>Últimos 20 jogos</option>
              </select>
              <Button variant="primary" disabled={!canRun || loading} onClick={runAnalysis}>
                {loading ? "Lendo e analisando..." : "Analisar jogos"}
              </Button>
              <Button disabled={!insights.length || saving} onClick={saveToHistory}>
                {saving ? "Salvando..." : "Salvar no histórico"}
              </Button>
              <Button
                onClick={() => {
                  setParsed([]);
                  setInsights([]);
                  setError("");
                  setSaveMessage("");
                  setRawInput("");
                  setConfidenceFilter("todos");
                }}
              >
                Limpar
              </Button>
              {!!insights.length && (
                <select
                  className="select"
                  value={confidenceFilter}
                  onChange={(event) => setConfidenceFilter(event.target.value as "todos" | "alta" | "media" | "baixa")}
                  aria-label="Filtro de confiança"
                >
                  <option value="todos">Todos ({insights.length})</option>
                  <option value="alta">Alta ({insights.filter((i) => i.confidence === "alta").length})</option>
                  <option value="media">Média ({insights.filter((i) => i.confidence === "media").length})</option>
                  <option value="baixa">Baixa ({insights.filter((i) => i.confidence === "baixa").length})</option>
                </select>
              )}
              <span className="mini">Jogos identificados: {parsed.length}</span>
              {!!saveMessage && <span className="mini">{saveMessage}</span>}
            </div>
          </div>
        </CardBody>
      </Card>

      {!!error && (
        <Card className="col-12">
          <CardBody>
            <EmptyState title="Não foi possível processar" subtitle={error} />
          </CardBody>
        </Card>
      )}

      {!!insights.length && (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3>Resultado dos jogos</h3>
              <small>Veja quem está mais forte no confronto e se existe vantagem na odd.</small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone="neutral">{filteredInsights.length} jogos</Badge>
              {insights.some((i) => i.dangerZone) && <Badge tone="bad">{insights.filter((i) => i.dangerZone).length} danger zone</Badge>}
              {insights.some((i) => i.consensusOver25) && <Badge tone="good">{insights.filter((i) => i.consensusOver25).length} consenso O2.5</Badge>}
            </div>
          </CardHeader>
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <th>Jogo</th>
                  <th>Horário</th>
                  <th className="right">Casa</th>
                  <th className="right">Empate</th>
                  <th className="right">Fora</th>
                  <th>Palpite</th>
                  <th>Confiança</th>
                  <th className="right">Força</th>
                  <th>Vantagem</th>
                  <th className="right">Gols esp.</th>
                  <th className="right">O 1.5</th>
                  <th className="right">O 2.5</th>
                  <th className="right">O 3.5</th>
                  <th className="right">O 4.5</th>
                  <th className="right">BTTS</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredInsights.map((item) => {
                  const o15 = item.overProbs.find((r) => r.line === 1.5);
                  const o25 = item.overProbs.find((r) => r.line === 2.5);
                  const o35 = item.overProbs.find((r) => r.line === 3.5);
                  const o45 = item.overProbs.find((r) => r.line === 4.5);
                  return (
                  <tr key={item.fixture.id} style={item.dangerZone ? { opacity: 0.7 } : undefined}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <strong>{item.fixture.homeTeam} x {item.fixture.awayTeam}</strong>
                        <span className="mini">{item.fixture.homeNick} vs {item.fixture.awayNick}</span>
                        {item.dangerZone && <span className="badge bad" style={{ fontSize: 9 }}>DANGER ZONE</span>}
                        {item.consensusOver25 && <span className="badge good" style={{ fontSize: 9 }}>CONSENSO O2.5</span>}
                      </div>
                    </td>
                    <td>{item.fixture.labelTime}</td>
                    <td className="right">{(item.homeProb * 100).toFixed(1)}%</td>
                    <td className="right">{(item.drawProb * 100).toFixed(1)}%</td>
                    <td className="right">{(item.awayProb * 100).toFixed(1)}%</td>
                    <td>
                      <Badge tone={item.pick === "Empate" ? "warn" : "good"}>{item.pick}</Badge>
                      {item.overAlert.active && <span className="badge warn" style={{ marginLeft: 6 }}>OVER</span>}
                    </td>
                    <td>
                      <Badge tone={item.confidence === "alta" ? "good" : item.confidence === "media" ? "warn" : "bad"}>
                        {item.confidence.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="right">{Math.round(item.confidenceScore)}</td>
                    <td>
                      {item.valueEdgePp == null ? (
                        <span className="mini">sem odd</span>
                      ) : item.isValueBet ? (
                        <span className="badge good">+{item.valueEdgePp.toFixed(1)}pp</span>
                      ) : (
                        <span className="badge">{item.valueEdgePp.toFixed(1)}pp</span>
                      )}
                    </td>
                    <td className="right">{item.expectedGoals.toFixed(2)}</td>
                    <td className="right"><span className={`badge ${(o15?.blended ?? 0) >= 0.65 ? "good" : (o15?.blended ?? 0) >= 0.45 ? "warn" : "bad"}`}>{((o15?.blended ?? 0) * 100).toFixed(0)}%</span></td>
                    <td className="right"><span className={`badge ${(o25?.blended ?? 0) >= 0.55 ? "good" : (o25?.blended ?? 0) >= 0.40 ? "warn" : "bad"}`}>{((o25?.blended ?? 0) * 100).toFixed(0)}%</span></td>
                    <td className="right"><span className={`badge ${(o35?.blended ?? 0) >= 0.50 ? "good" : (o35?.blended ?? 0) >= 0.35 ? "warn" : "bad"}`}>{((o35?.blended ?? 0) * 100).toFixed(0)}%</span></td>
                    <td className="right"><span className={`badge ${(o45?.blended ?? 0) >= 0.40 ? "good" : (o45?.blended ?? 0) >= 0.25 ? "warn" : "bad"}`}>{((o45?.blended ?? 0) * 100).toFixed(0)}%</span></td>
                    <td className="right"><span className={`badge ${item.bttsProb >= 0.55 ? "good" : item.bttsProb >= 0.40 ? "warn" : "bad"}`}>{(item.bttsProb * 100).toFixed(0)}%</span></td>
                    <td>
                      <Button onClick={() => setDetailItem(item)}>Detalhes</Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {!!insights.length && (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3>Painel de sinais</h3>
              <small>Visão rápida dos sinais mais relevantes de cada jogo.</small>
            </div>
          </CardHeader>
          <CardBody>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
              {filteredInsights.map((item) => {
                const risk = buildRiskSignal(item);
                const bestOver = item.overProbs.filter((o) => o.blended >= 0.50).sort((a, b) => b.blended - a.blended)[0];
                return (
                  <div key={`signal-${item.fixture.id}`} className="card" style={{ padding: 12, cursor: "pointer" }} onClick={() => setDetailItem(item)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <strong style={{ fontSize: 13 }}>{item.fixture.homeNick} x {item.fixture.awayNick}</strong>
                      <span className={`badge ${risk.toneClass}`} style={{ fontSize: 10 }}>{risk.label}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className={`badge ${item.confidence === "alta" ? "good" : item.confidence === "media" ? "warn" : "bad"}`}>
                        {item.pick} • {Math.round(item.confidenceScore)}
                      </span>
                      <span className="badge">xG {item.expectedGoals.toFixed(1)}</span>
                      <span className={`badge ${item.bttsProb >= 0.55 ? "good" : item.bttsProb >= 0.40 ? "warn" : "bad"}`}>
                        BTTS {(item.bttsProb * 100).toFixed(0)}%
                      </span>
                      {bestOver && (
                        <span className="badge good">O {bestOver.line} {(bestOver.blended * 100).toFixed(0)}%</span>
                      )}
                      {item.consensusOver25 && <span className="badge good" style={{ fontSize: 10 }}>CONSENSO</span>}
                      {item.dangerZone && <span className="badge bad" style={{ fontSize: 10 }}>PERIGO</span>}
                      {item.isValueBet && <span className="badge good" style={{ fontSize: 10 }}>VALUE</span>}
                      {item.homeStreak.lossStreak > 0 && item.homeBounceBack.bounceBackScore >= 60 && (
                        <span className="badge warn" style={{ fontSize: 10 }}>{item.fixture.homeNick} BOUNCE</span>
                      )}
                      {item.awayStreak.lossStreak > 0 && item.awayBounceBack.bounceBackScore >= 60 && (
                        <span className="badge warn" style={{ fontSize: 10 }}>{item.fixture.awayNick} BOUNCE</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {!!insights.length && (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3>Sugestões de mercado</h3>
              <small>Over 1.5 a 4.5 e BTTS com probabilidade blendada (Poisson + empírico + H2H) e odd justa.</small>
            </div>
          </CardHeader>
          <CardBody>
            <div className="list">
              {filteredInsights.map((item) => (
                <div key={`${item.fixture.id}-markets`} className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 240 }}>
                    <strong>{item.fixture.homeNick} x {item.fixture.awayNick}</strong>
                    <div className="mini">Amostra {item.sampleHome}/{item.sampleAway} (H2H {item.sampleH2h}) • xG {item.expectedGoals.toFixed(2)}</div>
                    {item.consensusOver25 && <span className="badge good" style={{ fontSize: 10, marginTop: 4 }}>CONSENSO O2.5</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {item.markets.map((market) => (
                      <span key={`${item.fixture.id}-${market.market}`} className={`badge ${market.signal === "over" ? "good" : "warn"}`}>
                        {market.market}: {(market.probability * 100).toFixed(1)}% • odd justa {market.fairOdd.toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {!!insights.length && (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3>Resumo dos jogadores</h3>
              <small>Mostra forma nos últimos {sampleWindow} jogos e em quais times cada jogador rende melhor.</small>
            </div>
          </CardHeader>
          <CardBody>
            <div className="list">
              {filteredInsights.map((item) => (
                <div key={`${item.fixture.id}-deep`} className="row" style={{ alignItems: "flex-start", gap: 16 }}>
                  <div style={{ minWidth: 220 }}>
                    <strong>{item.fixture.homeNick} x {item.fixture.awayNick}</strong>
                    <div className="mini">{item.fixture.labelTime}</div>
                  </div>

                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(2, minmax(260px, 1fr))", gap: 12 }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong>{item.fixture.homeNick}</strong>
                      <span className="mini">
                        Últ.{sampleWindow}: {item.homeDeep.recent.wins}V/{item.homeDeep.recent.draws}E/{item.homeDeep.recent.losses}D • {item.homeDeep.recent.points} pts • PPG {item.homeDeep.recent.ppg.toFixed(2)}
                      </span>
                      <span className="mini">
                        Gols: {item.homeDeep.recent.avgGoalsFor.toFixed(2)} pró • {item.homeDeep.recent.avgGoalsAgainst.toFixed(2)} contra
                      </span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.homeDeep.topTeamsByPoints.length ? item.homeDeep.topTeamsByPoints.map((team) => (
                          <span key={`${item.fixture.id}-home-${team.team}`} className="badge good">
                            {team.team}: {team.points} pts ({team.games}j | PPG {team.ppg.toFixed(2)})
                          </span>
                        )) : <span className="mini">Sem base suficiente de times.</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.homeDeep.currentTeamConceded ? (
                          <span className="badge warn">
                            Time atual ({item.homeDeep.currentTeamConceded.team}) sofre {item.homeDeep.currentTeamConceded.avgConceded.toFixed(2)} GA/j
                          </span>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.homeDeep.worstTeamsByConceded.length ? item.homeDeep.worstTeamsByConceded.map((team) => (
                          <span key={`${item.fixture.id}-home-conceded-${team.team}`} className="badge bad">
                            Sofre + gols em {team.team}: {team.avgConceded.toFixed(2)} GA/j
                          </span>
                        )) : null}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <strong>{item.fixture.awayNick}</strong>
                      <span className="mini">
                        Últ.{sampleWindow}: {item.awayDeep.recent.wins}V/{item.awayDeep.recent.draws}E/{item.awayDeep.recent.losses}D • {item.awayDeep.recent.points} pts • PPG {item.awayDeep.recent.ppg.toFixed(2)}
                      </span>
                      <span className="mini">
                        Gols: {item.awayDeep.recent.avgGoalsFor.toFixed(2)} pró • {item.awayDeep.recent.avgGoalsAgainst.toFixed(2)} contra
                      </span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.awayDeep.topTeamsByPoints.length ? item.awayDeep.topTeamsByPoints.map((team) => (
                          <span key={`${item.fixture.id}-away-${team.team}`} className="badge good">
                            {team.team}: {team.points} pts ({team.games}j | PPG {team.ppg.toFixed(2)})
                          </span>
                        )) : <span className="mini">Sem base suficiente de times.</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.awayDeep.currentTeamConceded ? (
                          <span className="badge warn">
                            Time atual ({item.awayDeep.currentTeamConceded.team}) sofre {item.awayDeep.currentTeamConceded.avgConceded.toFixed(2)} GA/j
                          </span>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.awayDeep.worstTeamsByConceded.length ? item.awayDeep.worstTeamsByConceded.map((team) => (
                          <span key={`${item.fixture.id}-away-conceded-${team.team}`} className="badge bad">
                            Sofre + gols em {team.team}: {team.avgConceded.toFixed(2)} GA/j
                          </span>
                        )) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {!!detailItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 12000,
            background: "rgba(0,0,0,.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setDetailItem(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Detalhes do jogo"
        >
          {(() => {
            const risk = buildRiskSignal(detailItem);
            const whyLines = buildWhySuggestion(detailItem);
            const implied = impliedFromOdds(detailItem.fixture.oddHome, detailItem.fixture.oddDraw, detailItem.fixture.oddAway);

            return (
          <div
            className="card"
            style={{ width: "min(1080px, 100%)", maxHeight: "90vh", overflow: "auto", padding: 16 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{detailItem.fixture.homeNick} x {detailItem.fixture.awayNick}</h3>
                <small className="mini">{detailItem.fixture.homeTeam} x {detailItem.fixture.awayTeam} • {detailItem.fixture.labelTime} • Últimos {sampleWindow} jogos</small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="primary" onClick={() => goToH2hWithDetail(detailItem)}>Ir para confronto</Button>
                <Button onClick={() => copyDetailSummary(detailItem)}>Copiar resumo</Button>
                <Button onClick={() => setDetailItem(null)}>Fechar</Button>
              </div>
            </div>

            {!!copyMessage && <div className="mini" style={{ marginBottom: 10 }}>{copyMessage}</div>}

            <div style={{ display: "grid", gap: 12 }}>

              {/* === SEÇÃO 1: Badges principais === */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">Pick: {detailItem.pick}</span>
                <span className="badge">Força: {Math.round(detailItem.confidenceScore)}</span>
                <span className={`badge ${risk.toneClass}`}>{risk.label}</span>
                <span className={`badge ${detailItem.isValueBet ? "good" : "warn"}`}>
                  {detailItem.valueEdgePp == null ? "Vantagem: sem odd" : `Vantagem: ${detailItem.valueEdgePp.toFixed(1)}pp`}
                </span>
                <span className={`badge ${detailItem.overAlert.active ? "warn" : "neutral"}`}>{detailItem.overAlert.active ? "ALERTA DE OVER" : "Sem alerta de over"}</span>
                <span className="badge">Gols esperados: {detailItem.expectedGoals.toFixed(2)}</span>
                <span className="badge">BTTS: {(detailItem.bttsProb * 100).toFixed(0)}%</span>
              </div>

              {/* === SEÇÃO 2: Probabilidades estimadas vs odds === */}
              <div className="card" style={{ padding: 10 }}>
                <strong>Probabilidades estimadas vs Odds</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                  {[
                    { label: "Casa", prob: detailItem.homeProb, odd: detailItem.fixture.oddHome, impliedProb: implied?.home },
                    { label: "Empate", prob: detailItem.drawProb, odd: detailItem.fixture.oddDraw, impliedProb: implied?.draw },
                    { label: "Fora", prob: detailItem.awayProb, odd: detailItem.fixture.oddAway, impliedProb: implied?.away },
                  ].map((col) => {
                    const edge = col.impliedProb != null ? (col.prob - col.impliedProb) * 100 : null;
                    const hasEdge = edge != null && edge > 0;
                    return (
                      <div key={col.label} style={{ textAlign: "center", padding: 8, borderRadius: 8, background: "rgba(255,255,255,.03)" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{col.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{(col.prob * 100).toFixed(1)}%</div>
                        {col.odd ? (
                          <>
                            <div className="mini">Odd: {col.odd.toFixed(2)} ({col.impliedProb != null ? `${(col.impliedProb * 100).toFixed(1)}%` : "-"})</div>
                            {edge != null && <div className={`mini ${hasEdge ? "good" : ""}`} style={{ fontWeight: hasEdge ? 700 : 400 }}>{hasEdge ? "+" : ""}{edge.toFixed(1)}pp</div>}
                          </>
                        ) : <div className="mini">Sem odd</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* === SEÇÃO 3: Comparativo direto === */}
              {(() => {
                const summary = buildDirectSummary(detailItem);
                return (
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className="mini"><strong>Comparativo direto:</strong> Ataque {detailItem.fixture.homeNick} vs {detailItem.fixture.awayNick}: {summary.attackGap >= 0 ? "+" : ""}{summary.attackGap.toFixed(2)} gol/j • Defesa: {summary.defenseGap >= 0 ? "+" : ""}{summary.defenseGap.toFixed(2)} • Tendência: {summary.trendScore >= 0 ? "favorável" : "cautela"} ({summary.trendScore.toFixed(1)})</span>
                    <span className="mini"><strong>Cenário sugerido:</strong> {summary.bestScenario}</span>
                    <span className="mini"><strong>Semáforo de risco:</strong> {risk.reason}</span>
                  </div>
                );
              })()}

              {/* === SEÇÃO 4: Placares mais prováveis === */}
              <div className="card" style={{ padding: 10 }}>
                <strong>Placares mais prováveis (Poisson)</strong>
                <div className="mini" style={{ marginBottom: 6 }}>Baseado em xG: {detailItem.fixture.homeNick} {detailItem.expectedHomeGoals.toFixed(2)} vs {detailItem.fixture.awayNick} {detailItem.expectedAwayGoals.toFixed(2)}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {detailItem.mostLikelyScores.map((sc, idx) => (
                    <span key={`score-${idx}`} className={`badge ${idx === 0 ? "good" : ""}`}>
                      {sc.home}-{sc.away} ({(sc.probability * 100).toFixed(1)}%)
                    </span>
                  ))}
                </div>
              </div>

              {/* === SEÇÃO 5: Mercados Over/Under/BTTS === */}
              <div className="card" style={{ padding: 10 }}>
                <strong>Mercados de gols</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {detailItem.markets.map((market) => (
                    <span key={market.market} className={`badge ${market.signal === "over" ? "good" : "warn"}`}>
                      {market.market}: {(market.probability * 100).toFixed(1)}% • odd justa {market.fairOdd.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>

              {/* === SEÇÃO 5b: Stats individuais dos jogadores === */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { nick: detailItem.fixture.homeNick, stats: detailItem.homeIndividualStats },
                  { nick: detailItem.fixture.awayNick, stats: detailItem.awayIndividualStats },
                ].map((player) => (
                  <div key={player.nick} className="card" style={{ padding: 10 }}>
                    <strong>{player.nick} — Perfil individual</strong>
                    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className="badge">BTTS: {(player.stats.bttsRate * 100).toFixed(0)}%</span>
                        <span className="badge">Marca: {(player.stats.scoringRate * 100).toFixed(0)}%</span>
                        <span className="badge">Clean sheet: {(player.stats.cleanSheetRate * 100).toFixed(0)}%</span>
                        <span className="badge">Média total: {player.stats.avgTotalGoals.toFixed(2)}</span>
                      </div>
                      <div className="mini" style={{ marginTop: 4 }}><strong>Over rates (últimos jogos):</strong></div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {player.stats.overRates.map((or) => (
                          <span key={`${player.nick}-over-${or.line}`} className={`badge ${or.rate >= 0.6 ? "good" : or.rate >= 0.4 ? "warn" : "bad"}`}>
                            O {or.line}: {(or.rate * 100).toFixed(0)}%
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* === SEÇÃO 5c: Diagnóstico de confiança === */}
              <div className="card" style={{ padding: 10 }}>
                <strong>Diagnóstico de confiança ({Math.round(detailItem.confidenceDiag.overall)}/100)</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 8 }}>
                  {[
                    { label: "Amostra", value: detailItem.confidenceDiag.sampleScore, max: 40 },
                    { label: "Forma", value: detailItem.confidenceDiag.formDiffScore, max: 25 },
                    { label: "H2H", value: detailItem.confidenceDiag.h2hScore, max: 15 },
                    { label: "Edge", value: detailItem.confidenceDiag.edgeScore, max: 20 },
                  ].map((item) => (
                    <div key={item.label} style={{ textAlign: "center", padding: 6, borderRadius: 8, background: "rgba(255,255,255,.03)" }}>
                      <div className="mini" style={{ fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{Math.round(item.value)}/{item.max}</div>
                      <div style={{ background: "rgba(255,255,255,.08)", borderRadius: 4, height: 6, marginTop: 4, overflow: "hidden" }}>
                        <div style={{ width: `${(item.value / item.max) * 100}%`, height: "100%", borderRadius: 4, background: item.value / item.max >= 0.7 ? "var(--badge-good-bg, #22c55e)" : item.value / item.max >= 0.4 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }} />
                      </div>
                    </div>
                  ))}
                </div>
                <ul style={{ margin: "8px 0 0 18px", padding: 0, display: "grid", gap: 3 }}>
                  {detailItem.confidenceDiag.reasons.map((reason) => (
                    <li key={reason} className="mini">{reason}</li>
                  ))}
                </ul>
              </div>

              {/* === SEÇÃO 6: H2H direto === */}
              <div className="card" style={{ padding: 10 }}>
                <strong>Confronto direto (H2H)</strong>
                {detailItem.h2hGames.length === 0 ? (
                  <div className="mini" style={{ marginTop: 6 }}>Sem confrontos diretos na base de dados.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, marginBottom: 8 }}>
                      <span className="badge">{detailItem.sampleH2h} jogos</span>
                      <span className="badge good">{detailItem.fixture.homeNick}: {detailItem.h2hHomeWins}V</span>
                      <span className="badge warn">Empates: {detailItem.h2hDraws}</span>
                      <span className="badge bad">{detailItem.fixture.awayNick}: {detailItem.h2hAwayWins}V</span>
                      <span className="badge">Média gols H2H: {detailItem.h2hAvgGoals.toFixed(2)}</span>
                      <span className="badge">BTTS no H2H: {(detailItem.h2hBttsRate * 100).toFixed(0)}%</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {detailItem.h2hOverRates.map((or) => (
                        <span key={`h2h-over-${or.line}`} className={`badge ${or.rate >= 0.6 ? "good" : or.rate >= 0.4 ? "warn" : "bad"}`}>
                          H2H O {or.line}: {(or.rate * 100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                    <div className="list">
                      {detailItem.h2hGames.slice(0, 8).map((game, idx) => (
                        <div key={`h2h-${idx}`} className="row" style={{ padding: "6px 10px" }}>
                          <div style={{ display: "grid", gap: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{game.homeNick} vs {game.awayNick}</span>
                            <span className="mini">{new Date(game.dateTime).toLocaleString("pt-BR")}</span>
                          </div>
                          <div style={{ textAlign: "right", display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{game.homeGoals}-{game.awayGoals}</span>
                            <span className={`badge ${game.result === "V" ? "good" : game.result === "E" ? "warn" : "bad"}`}>{game.result === "V" ? `${detailItem.fixture.homeNick}` : game.result === "D" ? `${detailItem.fixture.awayNick}` : "Empate"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* === SEÇÃO 7: Sequências (Streaks) === */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="card" style={{ padding: 10 }}>
                  <strong>{detailItem.fixture.homeNick} — Sequências</strong>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {detailItem.homeStreak.winStreak > 0 && <span className="badge good">{detailItem.homeStreak.winStreak}V seguidas</span>}
                    {detailItem.homeStreak.lossStreak > 0 && <span className="badge bad">{detailItem.homeStreak.lossStreak}D seguidas</span>}
                    {detailItem.homeStreak.unbeatenStreak > 1 && <span className="badge">{detailItem.homeStreak.unbeatenStreak} invicto</span>}
                    {detailItem.homeStreak.scoringStreak > 1 && <span className="badge">{detailItem.homeStreak.scoringStreak} marcando</span>}
                    {detailItem.homeStreak.cleanSheetStreak > 0 && <span className="badge">{detailItem.homeStreak.cleanSheetStreak} sem sofrer</span>}
                    {detailItem.homeStreak.winStreak === 0 && detailItem.homeStreak.lossStreak === 0 && <span className="badge">Sem sequência forte</span>}
                  </div>
                  <div className="mini" style={{ marginTop: 6 }}>
                    Forma: {detailItem.homeDeep.recent.wins}V/{detailItem.homeDeep.recent.draws}E/{detailItem.homeDeep.recent.losses}D • {detailItem.homeDeep.recent.points} pts • PPG {detailItem.homeDeep.recent.ppg.toFixed(2)}
                  </div>
                  <div className="mini">Gols: {detailItem.homeDeep.recent.avgGoalsFor.toFixed(2)} pró • {detailItem.homeDeep.recent.avgGoalsAgainst.toFixed(2)} contra</div>
                  <div className="mini">Recuperação: {Math.round(detailItem.homeDeep.recovery.score)}/100 • {detailItem.homeDeep.recovery.signal ? "sinal ativo" : "sem sinal"}</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <strong>{detailItem.fixture.awayNick} — Sequências</strong>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {detailItem.awayStreak.winStreak > 0 && <span className="badge good">{detailItem.awayStreak.winStreak}V seguidas</span>}
                    {detailItem.awayStreak.lossStreak > 0 && <span className="badge bad">{detailItem.awayStreak.lossStreak}D seguidas</span>}
                    {detailItem.awayStreak.unbeatenStreak > 1 && <span className="badge">{detailItem.awayStreak.unbeatenStreak} invicto</span>}
                    {detailItem.awayStreak.scoringStreak > 1 && <span className="badge">{detailItem.awayStreak.scoringStreak} marcando</span>}
                    {detailItem.awayStreak.cleanSheetStreak > 0 && <span className="badge">{detailItem.awayStreak.cleanSheetStreak} sem sofrer</span>}
                    {detailItem.awayStreak.winStreak === 0 && detailItem.awayStreak.lossStreak === 0 && <span className="badge">Sem sequência forte</span>}
                  </div>
                  <div className="mini" style={{ marginTop: 6 }}>
                    Forma: {detailItem.awayDeep.recent.wins}V/{detailItem.awayDeep.recent.draws}E/{detailItem.awayDeep.recent.losses}D • {detailItem.awayDeep.recent.points} pts • PPG {detailItem.awayDeep.recent.ppg.toFixed(2)}
                  </div>
                  <div className="mini">Gols: {detailItem.awayDeep.recent.avgGoalsFor.toFixed(2)} pró • {detailItem.awayDeep.recent.avgGoalsAgainst.toFixed(2)} contra</div>
                  <div className="mini">Recuperação: {Math.round(detailItem.awayDeep.recovery.score)}/100 • {detailItem.awayDeep.recovery.signal ? "sinal ativo" : "sem sinal"}</div>
                </div>
              </div>

              {/* === SEÇÃO 7b: Bounce-back (reação pós-derrota) === */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { nick: detailItem.fixture.homeNick, bb: detailItem.homeBounceBack },
                  { nick: detailItem.fixture.awayNick, bb: detailItem.awayBounceBack },
                ].map((player) => (
                  <div key={`bb-${player.nick}`} className="card" style={{ padding: 10 }}>
                    <strong>{player.nick} — Reação pós-derrota</strong>
                    {player.bb.postLossGames === 0 ? (
                      <div className="mini" style={{ marginTop: 6 }}>Sem derrotas na base para calcular reação.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <span className={`badge ${player.bb.bounceBackScore >= 65 ? "good" : player.bb.bounceBackScore >= 40 ? "warn" : "bad"}`}>
                            Bounce-back: {Math.round(player.bb.bounceBackScore)}/100 ({player.bb.signal})
                          </span>
                          <span className="badge">
                            Vence após derrota: {(player.bb.postLossWinRate * 100).toFixed(0)}% ({player.bb.postLossGames} jogos)
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <span className="badge">
                            Gols pós-derrota: {player.bb.postLossAvgGf.toFixed(2)} pró / {player.bb.postLossAvgGa.toFixed(2)} contra
                          </span>
                          {player.bb.postCloseDefeatGames > 0 && (
                            <span className={`badge ${player.bb.postCloseDefeatWinRate >= 0.5 ? "good" : "warn"}`}>
                              Após derrota apertada (1 gol): {(player.bb.postCloseDefeatWinRate * 100).toFixed(0)}% V ({player.bb.postCloseDefeatGames}j)
                            </span>
                          )}
                          {player.bb.postHeavyDefeatGames > 0 && (
                            <span className={`badge ${player.bb.postHeavyDefeatWinRate >= 0.5 ? "good" : "bad"}`}>
                              Após goleada (2+ gols): {(player.bb.postHeavyDefeatWinRate * 100).toFixed(0)}% V ({player.bb.postHeavyDefeatGames}j)
                            </span>
                          )}
                        </div>
                        <div className="mini">
                          PPG nos 3 jogos após derrota: {player.bb.ppgAfterLoss3.toFixed(2)} vs PPG geral: {player.bb.ppgOverall.toFixed(2)} •
                          Momentum: {player.bb.momentumShift >= 0 ? "+" : ""}{player.bb.momentumShift.toFixed(2)} PPG
                          {player.bb.momentumShift > 0.1 ? " (melhora após perder)" : player.bb.momentumShift < -0.1 ? " (piora após perder)" : " (estável)"}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* === SEÇÃO 7c: Revenge factor (vingança no H2H) === */}
              {detailItem.revengeFactor.h2hRevengeGames > 0 && (
                <div className="card" style={{ padding: 10 }}>
                  <strong>Fator vingança — {detailItem.fixture.homeNick} vs {detailItem.fixture.awayNick}</strong>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <span className={`badge ${detailItem.revengeFactor.h2hRevengeRate >= 0.6 ? "good" : detailItem.revengeFactor.h2hRevengeRate >= 0.4 ? "warn" : "bad"}`}>
                      {detailItem.revengeFactor.signal}
                    </span>
                    <span className="badge">
                      {detailItem.fixture.homeNick} vence após perder para {detailItem.fixture.awayNick}: {(detailItem.revengeFactor.h2hRevengeRate * 100).toFixed(0)}% ({detailItem.revengeFactor.h2hRevengeGames} situações)
                    </span>
                    <span className="badge">
                      Média de gols na vingança: {detailItem.revengeFactor.h2hRevengeAvgGf.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* === SEÇÃO 8: Últimos 5 jogos de cada === */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="card" style={{ padding: 10 }}>
                  <strong>Últimos 5 jogos — {detailItem.fixture.homeNick}</strong>
                  <div className="list" style={{ marginTop: 8 }}>
                    {getLastFivePlayerGames(detailItem.fixture.homeNick).map((game) => (
                      <div key={game.id} className="row" style={{ padding: "6px 10px" }}>
                        <div style={{ display: "grid", gap: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{game.team} vs {game.opponent}</span>
                          <span className="mini">{new Date(game.dateTime).toLocaleString("pt-BR")}</span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{game.score}</div>
                          <span className={`badge ${game.result === "V" ? "good" : game.result === "E" ? "warn" : "bad"}`}>{game.result}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card" style={{ padding: 10 }}>
                  <strong>Últimos 5 jogos — {detailItem.fixture.awayNick}</strong>
                  <div className="list" style={{ marginTop: 8 }}>
                    {getLastFivePlayerGames(detailItem.fixture.awayNick).map((game) => (
                      <div key={game.id} className="row" style={{ padding: "6px 10px" }}>
                        <div style={{ display: "grid", gap: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{game.team} vs {game.opponent}</span>
                          <span className="mini">{new Date(game.dateTime).toLocaleString("pt-BR")}</span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{game.score}</div>
                          <span className={`badge ${game.result === "V" ? "good" : game.result === "E" ? "warn" : "bad"}`}>{game.result}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* === SEÇÃO 9: Por que essa sugestão === */}
              <div style={{ display: "grid", gap: 4 }}>
                <strong>Por que essa sugestão?</strong>
                <ul style={{ margin: "4px 0 0 18px", padding: 0, display: "grid", gap: 4 }}>
                  {whyLines.map((line) => (
                    <li key={line} className="mini">{line}</li>
                  ))}
                </ul>
              </div>

              {/* === SEÇÃO 10: Leitura rápida completa === */}
              <div>
                <strong>Leitura rápida</strong>
                <ul style={{ margin: "4px 0 0 18px", padding: 0, display: "grid", gap: 4 }}>
                  {buildCuriosities(detailItem).map((note) => (
                    <li key={note} className="mini">{note}</li>
                  ))}
                  {detailItem.reasons.map((reason) => (
                    <li key={reason} className="mini">{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
            );
          })()}
        </div>
      )}

      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Backtest — Acurácia do motor</h3>
            <small>Simula as previsões nos jogos recentes da base e compara com o resultado real. Quanto mais jogos, mais confiável.</small>
          </div>
          {backtestData && <Badge tone={backtestData.pickRate >= 0.55 ? "good" : backtestData.pickRate >= 0.40 ? "warn" : "bad"}>{(backtestData.pickRate * 100).toFixed(1)}% acerto 1X2</Badge>}
        </CardHeader>
        <CardBody>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <select
              className="select"
              value={backtestSample}
              onChange={(e) => setBacktestSample(Number(e.target.value))}
              aria-label="Quantidade de jogos"
            >
              <option value={25}>Últimos 25 jogos</option>
              <option value={50}>Últimos 50 jogos</option>
              <option value={100}>Últimos 100 jogos</option>
              <option value={200}>Últimos 200 jogos</option>
            </select>
            <Button variant="primary" onClick={runBacktest} disabled={backtestLoading}>
              {backtestLoading ? "Calculando..." : "Rodar backtest"}
            </Button>
            <span className="mini">Modo: {mode} | Janela: {sampleWindow}</span>
          </div>

          {backtestData && (
            <div style={{ display: "grid", gap: 16 }}>
              {/* Resumo geral */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                <div className="card" style={{ padding: 12, textAlign: "center" }}>
                  <div className="mini" style={{ fontWeight: 700 }}>Jogos testados</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{backtestData.total}</div>
                </div>
                <div className="card" style={{ padding: 12, textAlign: "center" }}>
                  <div className="mini" style={{ fontWeight: 700 }}>Acerto 1X2</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: backtestData.pickRate >= 0.55 ? "var(--badge-good-bg, #22c55e)" : backtestData.pickRate >= 0.40 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }}>
                    {(backtestData.pickRate * 100).toFixed(1)}%
                  </div>
                  <div className="mini">{backtestData.pickHits}/{backtestData.total}</div>
                </div>
                <div className="card" style={{ padding: 12, textAlign: "center" }}>
                  <div className="mini" style={{ fontWeight: 700 }}>BTTS acerto</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: backtestData.bttsRate >= 0.60 ? "var(--badge-good-bg, #22c55e)" : backtestData.bttsRate >= 0.45 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }}>
                    {(backtestData.bttsRate * 100).toFixed(1)}%
                  </div>
                  <div className="mini">{backtestData.bttsHits}/{backtestData.bttsTotal}</div>
                </div>
              </div>

              {/* Acerto por confiança */}
              <div className="card" style={{ padding: 12 }}>
                <strong>Acerto 1X2 por nível de confiança</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
                  {backtestData.byConfidence.map((c) => (
                    <div key={c.level} style={{ textAlign: "center", padding: 10, borderRadius: 8, background: "rgba(255,255,255,.03)" }}>
                      <div className="mini" style={{ fontWeight: 700, textTransform: "uppercase" }}>{c.level}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: c.rate >= 0.60 ? "var(--badge-good-bg, #22c55e)" : c.rate >= 0.40 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }}>
                        {c.total ? `${(c.rate * 100).toFixed(1)}%` : "-"}
                      </div>
                      <div className="mini">{c.hits}/{c.total} jogos</div>
                      <div style={{ background: "rgba(255,255,255,.08)", borderRadius: 4, height: 6, marginTop: 6, overflow: "hidden" }}>
                        <div style={{ width: `${c.rate * 100}%`, height: "100%", borderRadius: 4, background: c.rate >= 0.60 ? "var(--badge-good-bg, #22c55e)" : c.rate >= 0.40 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Acerto por linha de over */}
              <div className="card" style={{ padding: 12 }}>
                <strong>Acerto de Over por linha</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 10 }}>
                  {backtestData.overRates.map((o) => (
                    <div key={o.line} style={{ textAlign: "center", padding: 10, borderRadius: 8, background: "rgba(255,255,255,.03)" }}>
                      <div className="mini" style={{ fontWeight: 700 }}>Over {o.line}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: o.rate >= 0.60 ? "var(--badge-good-bg, #22c55e)" : o.rate >= 0.40 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }}>
                        {(o.rate * 100).toFixed(1)}%
                      </div>
                      <div className="mini">{o.hits}/{o.total}</div>
                      <div style={{ background: "rgba(255,255,255,.08)", borderRadius: 4, height: 6, marginTop: 6, overflow: "hidden" }}>
                        <div style={{ width: `${o.rate * 100}%`, height: "100%", borderRadius: 4, background: o.rate >= 0.60 ? "var(--badge-good-bg, #22c55e)" : o.rate >= 0.40 ? "var(--badge-warn-bg, #facc15)" : "var(--badge-bad-bg, #ef4444)" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabela detalhada dos últimos jogos do backtest */}
              <div className="card" style={{ padding: 12 }}>
                <strong>Detalhamento jogo a jogo (últimos 20)</strong>
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <Table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Confronto</th>
                        <th>Placar real</th>
                        <th>Previsão</th>
                        <th>Real</th>
                        <th>1X2</th>
                        <th>Conf.</th>
                        <th>O 1.5</th>
                        <th>O 2.5</th>
                        <th>O 3.5</th>
                        <th>O 4.5</th>
                        <th>BTTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestData.rows.slice(0, 20).map((r) => (
                        <tr key={r.matchId}>
                          <td className="mini">{new Date(r.dateTime).toLocaleDateString("pt-BR")}</td>
                          <td>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{r.homeNick} x {r.awayNick}</span>
                          </td>
                          <td style={{ fontWeight: 700 }}>{r.actualHome}-{r.actualAway}</td>
                          <td><span className="badge">{r.predictedPick}</span></td>
                          <td><span className="badge">{r.actualResult}</span></td>
                          <td><span className={`badge ${r.pickHit ? "good" : "bad"}`}>{r.pickHit ? "OK" : "MISS"}</span></td>
                          <td><span className={`badge ${r.confidence === "alta" ? "good" : r.confidence === "media" ? "warn" : "bad"}`}>{r.confidence}</span></td>
                          {r.overHits.map((o) => (
                            <td key={o.line}><span className={`badge ${o.hit ? "good" : "bad"}`}>{o.hit ? "OK" : "X"}</span></td>
                          ))}
                          <td><span className={`badge ${r.bttsHit ? "good" : "bad"}`}>{r.bttsHit ? "OK" : "X"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {!backtestData && !backtestLoading && (
            <EmptyState title="Nenhum backtest rodado" subtitle="Clique em 'Rodar backtest' para simular previsões nos jogos recentes e ver a acurácia." />
          )}
        </CardBody>
      </Card>

      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Histórico salvo</h3>
            <small>Previsões 1X2 registradas com o horário textual para auditoria posterior.</small>
          </div>
          <Badge tone="neutral">{history.length} itens</Badge>
        </CardHeader>
        <CardBody>
          {!history.length ? (
            <EmptyState title="Sem histórico ainda" subtitle="Após analisar, clique em salvar para registrar com horário." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Registrado em</th>
                  <th>Horário do jogo</th>
                  <th>Confronto</th>
                  <th>Pick</th>
                  <th>Conf.</th>
                  <th className="right">Prob.</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString("pt-BR")}</td>
                    <td>{row.scheduledAtLabel}</td>
                    <td>{row.fixtureLabel}</td>
                    <td>{row.pick}</td>
                    <td>{row.confidence}</td>
                    <td className="right">{(row.probability * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
