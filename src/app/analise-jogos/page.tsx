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

type PlayerDeepSummary = {
  recent: RecentSummary;
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
    };
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gf = 0;
  let ga = 0;

  for (const row of rows) {
    const isHome = normalizeText(row.homeNick) === normalizedNick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;

    gf += goalsFor;
    ga += goalsAgainst;

    if (goalsFor > goalsAgainst) wins += 1;
    else if (goalsFor === goalsAgainst) draws += 1;
    else losses += 1;
  }

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
    const overAlertActive = homeCurrentConceded >= profile.overAlertGaThreshold && awayCurrentConceded >= profile.overAlertGaThreshold;
    const overAlertReason = overAlertActive
      ? `Ambos cedem muitos gols no time atual (${homeCurrentConceded.toFixed(2)} e ${awayCurrentConceded.toFixed(2)} GA/j).`
      : `Sem gatilho forte de over pelos times atuais (${homeCurrentConceded.toFixed(2)} e ${awayCurrentConceded.toFixed(2)} GA/j).`;

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
    for (const row of h2hRows) {
      const homeIsHomeSide = normalizeText(row.homeNick) === homeNickNorm;
      const homeGoals = homeIsHomeSide ? row.homeGoals : row.awayGoals;
      const awayGoals = homeIsHomeSide ? row.awayGoals : row.homeGoals;
      if (homeGoals > awayGoals) homeH2hPoints += 3;
      else if (homeGoals < awayGoals) awayH2hPoints += 3;
      else {
        homeH2hPoints += 1;
        awayH2hPoints += 1;
      }
    }

    const formDiff = (home.ppg - away.ppg) / 3;
    const winDiff = home.winRate - away.winRate;
    const attackDiff = (home.gf - away.gf) / 4;
    const defenseDiff = (away.ga - home.ga) / 4;
    const h2hDiff = h2hRows.length ? (homeH2hPoints - awayH2hPoints) / Math.max(1, h2hRows.length * 3) : 0;

    const score =
      formDiff * 0.35 +
      winDiff * 0.2 +
      attackDiff * 0.15 +
      defenseDiff * 0.15 +
      h2hDiff * 0.15;

    const drawWeight = clamp(0.2 + (1 - Math.min(1, Math.abs(score) * 1.7)) * 0.12, 0.12, 0.34);
    const winBudget = 1 - drawWeight;

    let homeProb = winBudget * sigmoid(score * 2.4);
    let awayProb = winBudget - homeProb;
    let drawProb = drawWeight;

    const implied = impliedFromOdds(fixture.oddHome, fixture.oddDraw, fixture.oddAway);
    if (implied) {
      homeProb = homeProb * 0.72 + implied.home * 0.28;
      drawProb = drawProb * 0.72 + implied.draw * 0.28;
      awayProb = awayProb * 0.72 + implied.away * 0.28;
    }

    const norm = homeProb + drawProb + awayProb || 1;
    homeProb /= norm;
    drawProb /= norm;
    awayProb /= norm;

    const expectedHomeGoals = clamp((home.gf + away.ga) / 2, 0.45, 5.2);
    const expectedAwayGoals = clamp((away.gf + home.ga) / 2, 0.45, 5.2);
    const expectedGoals = expectedHomeGoals + expectedAwayGoals;

    const over25 = 1 - poissonCdf(expectedGoals, 2);
    const over35 = 1 - poissonCdf(expectedGoals, 3);
    const under35 = poissonCdf(expectedGoals, 3);
    const bttsProb = 1 - Math.exp(-expectedHomeGoals) - Math.exp(-expectedAwayGoals) + Math.exp(-(expectedHomeGoals + expectedAwayGoals));

    const markets: MarketInsight[] = [
      {
        market: "Over 2.5",
        probability: clamp(over25, 0, 1),
        fairOdd: 1 / Math.max(0.01, clamp(over25, 0, 1)),
        signal: over25 >= 0.5 ? "over" : "under",
      },
      {
        market: "Over 3.5",
        probability: clamp(over35, 0, 1),
        fairOdd: 1 / Math.max(0.01, clamp(over35, 0, 1)),
        signal: over35 >= 0.5 ? "over" : "under",
      },
      {
        market: "Under 3.5",
        probability: clamp(under35, 0, 1),
        fairOdd: 1 / Math.max(0.01, clamp(under35, 0, 1)),
        signal: under35 >= 0.5 ? "under" : "over",
      },
      {
        market: "BTTS (Sim)",
        probability: clamp(bttsProb, 0, 1),
        fairOdd: 1 / Math.max(0.01, clamp(bttsProb, 0, 1)),
        signal: bttsProb >= 0.5 ? "over" : "under",
      },
    ];

    const ordered = [
      { key: "Casa" as const, value: homeProb },
      { key: "Empate" as const, value: drawProb },
      { key: "Fora" as const, value: awayProb },
    ].sort((left, right) => right.value - left.value);

    const top = ordered[0];
    const second = ordered[1];
    const edge = top.value - (second?.value ?? 0);
    const coverage = Math.min(home.games, away.games) / sampleWindow;
    const confidenceScore = edge * 100 * 0.7 + clamp(coverage, 0, 1) * 30;

    let confidence: "baixa" | "media" | "alta" = "baixa";
    if (confidenceScore >= profile.confidenceHigh) confidence = "alta";
    else if (confidenceScore >= profile.confidenceMedium) confidence = "media";

    const pickOdd = top.key === "Casa" ? fixture.oddHome : top.key === "Empate" ? fixture.oddDraw : fixture.oddAway;
    const impliedPick = pickOdd && pickOdd > 1 ? 1 / pickOdd : null;
    const valueEdgePp = impliedPick == null ? null : (top.value - impliedPick) * 100;
    const isValueBet = valueEdgePp != null && valueEdgePp >= profile.minValueEdgePp;

    const reasons = [
      `Forma recente ${fixture.homeNick} ${home.ppg.toFixed(2)} PPG vs ${fixture.awayNick} ${away.ppg.toFixed(2)} PPG.`,
      `Amostra: ${home.games} jogos (${fixture.homeNick}) e ${away.games} jogos (${fixture.awayNick}) na base local.`,
      `H2H recente: ${h2hRows.length} partidas usadas para ajuste de confronto direto.`,
      `Últimos ${sampleWindow}: ${fixture.homeNick} ${homeDeep.recent.points} pts (${homeDeep.recent.wins}V/${homeDeep.recent.draws}E/${homeDeep.recent.losses}D) vs ${fixture.awayNick} ${awayDeep.recent.points} pts (${awayDeep.recent.wins}V/${awayDeep.recent.draws}E/${awayDeep.recent.losses}D).`,
      overAlertReason,
      `Média esperada de gols: ${expectedGoals.toFixed(2)}.`,
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
  const [analysisMatches, setAnalysisMatches] = useState<MatchRecord[]>([]);

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

  return (
    <div className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Análise por Texto Colado</h3>
            <small>Cole os jogos no formato BetsAPI e o sistema cruza com seu IndexedDB para sugerir vencedor e mercados.</small>
          </div>
          <Badge tone="warn">Módulo experimental</Badge>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gap: 10 }}>
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
                {loading ? "Analisando..." : "Analisar jogos"}
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
                }}
              >
                Limpar
              </Button>
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
              <h3>Resultado da análise</h3>
              <small>Probabilidades, confiança e mercados derivados para cada jogo colado.</small>
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
                  <th>Pick</th>
                  <th>Confiança</th>
                  <th className="right">Score</th>
                  <th>Value</th>
                  <th className="right">xG Total</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {insights.map((item) => (
                  <tr key={item.fixture.id}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <strong>{item.fixture.homeTeam} x {item.fixture.awayTeam}</strong>
                        <span className="mini">{item.fixture.homeNick} vs {item.fixture.awayNick}</span>
                      </div>
                    </td>
                    <td>{item.fixture.labelTime}</td>
                    <td className="right">{(item.homeProb * 100).toFixed(1)}%</td>
                    <td className="right">{(item.drawProb * 100).toFixed(1)}%</td>
                    <td className="right">{(item.awayProb * 100).toFixed(1)}%</td>
                    <td>
                      <Badge tone={item.pick === "Empate" ? "warn" : "good"}>{item.pick}</Badge>
                      {item.overAlert.active && <span className="badge warn" style={{ marginLeft: 6 }}>OVER ALERTA</span>}
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
                        <span className="badge good">VALUE +{item.valueEdgePp.toFixed(1)}pp</span>
                      ) : (
                        <span className="badge">{item.valueEdgePp.toFixed(1)}pp</span>
                      )}
                    </td>
                    <td className="right">{item.expectedGoals.toFixed(2)}</td>
                    <td>
                      <Button onClick={() => setDetailItem(item)}>Detalhes</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {!!insights.length && (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3>Mercados sugeridos</h3>
              <small>Over/Under e BTTS com probabilidade estimada e odd justa.</small>
            </div>
          </CardHeader>
          <CardBody>
            <div className="list">
              {insights.map((item) => (
                <div key={`${item.fixture.id}-markets`} className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 240 }}>
                    <strong>{item.fixture.homeNick} x {item.fixture.awayNick}</strong>
                    <div className="mini">Amostra {item.sampleHome}/{item.sampleAway} (H2H {item.sampleH2h})</div>
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
              <h3>Raio-X jogadores (últimos 10 + melhores times)</h3>
              <small>Para cada confronto: forma dos últimos {sampleWindow} jogos e os times em que cada jogador mais pontua.</small>
            </div>
          </CardHeader>
          <CardBody>
            <div className="list">
              {insights.map((item) => (
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
          <div
            className="card"
            style={{ width: "min(980px, 100%)", maxHeight: "90vh", overflow: "auto", padding: 16 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{detailItem.fixture.homeNick} x {detailItem.fixture.awayNick}</h3>
                <small className="mini">Recorte atual: últimos {sampleWindow} jogos</small>
              </div>
              <Button onClick={() => setDetailItem(null)}>Fechar</Button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">Pick: {detailItem.pick}</span>
                <span className="badge">Score: {Math.round(detailItem.confidenceScore)}</span>
                <span className={`badge ${detailItem.isValueBet ? "good" : "warn"}`}>
                  {detailItem.valueEdgePp == null ? "Value: sem odd" : `Value: ${detailItem.valueEdgePp.toFixed(1)}pp`}
                </span>
                <span className={`badge ${detailItem.overAlert.active ? "warn" : "neutral"}`}>{detailItem.overAlert.active ? "OVER ALERTA" : "Sem over alerta"}</span>
              </div>

              <div className="row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <strong>{detailItem.fixture.homeNick}</strong>
                  <div className="mini">{detailItem.homeDeep.recent.wins}V/{detailItem.homeDeep.recent.draws}E/{detailItem.homeDeep.recent.losses}D • {detailItem.homeDeep.recent.points} pts • PPG {detailItem.homeDeep.recent.ppg.toFixed(2)}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <strong>{detailItem.fixture.awayNick}</strong>
                  <div className="mini">{detailItem.awayDeep.recent.wins}V/{detailItem.awayDeep.recent.draws}E/{detailItem.awayDeep.recent.losses}D • {detailItem.awayDeep.recent.points} pts • PPG {detailItem.awayDeep.recent.ppg.toFixed(2)}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="card" style={{ padding: 10 }}>
                  <strong>Últimos 5 jogos — {detailItem.fixture.homeNick}</strong>
                  <div className="list" style={{ marginTop: 8 }}>
                    {getLastFivePlayerGames(detailItem.fixture.homeNick).map((game) => (
                      <div key={game.id} className="row" style={{ padding: "8px 10px" }}>
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
                      <div key={game.id} className="row" style={{ padding: "8px 10px" }}>
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

              <div>
                <strong>Curiosidades e leitura assertiva</strong>
                <ul style={{ margin: "8px 0 0 18px", padding: 0, display: "grid", gap: 6 }}>
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
        </div>
      )}

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
