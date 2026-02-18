"use client";

import * as XLSX from "xlsx";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { getSeedMatches } from "@/lib/seed";
import type { MatchRecord } from "@/lib/types";
import { formatDateTimePtBr, toDateTimestamp, toIsoDateTime } from "@/lib/datetime";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoHint } from "@/components/ui/InfoHint";
import { Select } from "@/components/ui/Select";
import { Table } from "@/components/ui/Table";

const lines = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const lastNOptions = ["5", "10", "20", "all"] as const;
const recencyFactor = 0.9;
type H2hTab = "analise" | "excel";

type PlayerStats = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  bttsRate: number;
  overRate: number;
  avgTotal: number;
  ppg: number;
  winRate: number;
  splitHome: SideSplit;
  splitAway: SideSplit;
};

type SideSplit = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  ppg: number;
};

type OpponentStats = {
  opponent: string;
  games: number;
  points: number;
  gf: number;
  ga: number;
  totalGoals: number;
  wins: number;
  draws: number;
  losses: number;
};

type TeamPerformance = {
  team: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  ppg: number;
  winRate: number;
};

type RateInterval = {
  rate: number;
  low: number;
  high: number;
};

type H2hScore = {
  score: number;
  edgeFor: "A" | "B" | "equilibrado";
  level: "favoravel" | "cautela" | "evitar";
  reasons: string[];
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pointsFrom(gf: number, ga: number) {
  if (gf > ga) return 3;
  if (gf < ga) return 0;
  return 1;
}

function wilsonInterval(rate: number, sample: number): RateInterval {
  if (sample <= 0) return { rate: 0, low: 0, high: 0 };

  const z = 1.96;
  const p = clamp(rate, 0, 1);
  const n = sample;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));

  return {
    rate: p,
    low: clamp(center - margin, 0, 1),
    high: clamp(center + margin, 0, 1),
  };
}

function confidenceSeal(sample: number): "Alta" | "Média" | "Baixa" {
  if (sample >= 14) return "Alta";
  if (sample >= 8) return "Média";
  return "Baixa";
}

function includesText(source: string, search: string) {
  if (!search.trim()) return true;
  return source.toLowerCase().includes(search.trim().toLowerCase());
}

function getPlayerSide(match: MatchRecord, nick: string) {
  const n = normalize(nick);
  if (normalize(match.homeNick) === n) return "home" as const;
  if (normalize(match.awayNick) === n) return "away" as const;
  return null;
}

function playerMatchesTeam(match: MatchRecord, nick: string, team: string) {
  const side = getPlayerSide(match, nick);
  if (!side) return false;
  if (!team.trim()) return true;
  const teamName = side === "home" ? match.homeTeam : match.awayTeam;
  return includesText(teamName, team);
}

function buildPlayerStats(matches: MatchRecord[], nick: string, line: number): PlayerStats {
  const n = normalize(nick);
  const splitHome: SideSplit = { games: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, ppg: 0 };
  const splitAway: SideSplit = { games: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, ppg: 0 };

  const stats: PlayerStats = {
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    bttsRate: 0,
    overRate: 0,
    avgTotal: 0,
    ppg: 0,
    winRate: 0,
    splitHome,
    splitAway,
  };

  let bttsCount = 0;
  let overCount = 0;
  let totalGoalsAll = 0;

  matches.forEach((match) => {
    const isHome = normalize(match.homeNick) === n;
    const isAway = normalize(match.awayNick) === n;
    if (!isHome && !isAway) return;

    const gf = isHome ? match.homeGoals : match.awayGoals;
    const ga = isHome ? match.awayGoals : match.homeGoals;
    const total = match.homeGoals + match.awayGoals;

    stats.games += 1;
    stats.gf += gf;
    stats.ga += ga;
    totalGoalsAll += total;

    if (gf > ga) stats.wins += 1;
    else if (gf < ga) stats.losses += 1;
    else stats.draws += 1;

    const split = isHome ? splitHome : splitAway;
    split.games += 1;
    split.gf += gf;
    split.ga += ga;
    if (gf > ga) split.wins += 1;
    else if (gf < ga) split.losses += 1;
    else split.draws += 1;

    if (match.homeGoals > 0 && match.awayGoals > 0) bttsCount += 1;
    if (total > line) overCount += 1;
  });

  if (stats.games > 0) {
    stats.bttsRate = bttsCount / stats.games;
    stats.overRate = overCount / stats.games;
    stats.avgTotal = totalGoalsAll / stats.games;
    stats.ppg = (stats.wins * 3 + stats.draws) / stats.games;
    stats.winRate = stats.wins / stats.games;
  }

  if (splitHome.games > 0) {
    splitHome.ppg = (splitHome.wins * 3 + splitHome.draws) / splitHome.games;
  }
  if (splitAway.games > 0) {
    splitAway.ppg = (splitAway.wins * 3 + splitAway.draws) / splitAway.games;
  }

  return stats;
}

function aggregateAgainstOpponents(
  matches: MatchRecord[],
  nick: string,
  excludedNick: string,
  teamFilter: string
) {
  const excluded = normalize(excludedNick);
  const map = new Map<string, OpponentStats>();

  matches.forEach((match) => {
    const side = getPlayerSide(match, nick);
    if (!side) return;
    if (!playerMatchesTeam(match, nick, teamFilter)) return;

    const opponent = side === "home" ? match.awayNick : match.homeNick;
    if (normalize(opponent) === excluded) return;

    const gf = side === "home" ? match.homeGoals : match.awayGoals;
    const ga = side === "home" ? match.awayGoals : match.homeGoals;
    const total = match.homeGoals + match.awayGoals;
    const key = normalize(opponent);

    const curr = map.get(key) ?? {
      opponent,
      games: 0,
      points: 0,
      gf: 0,
      ga: 0,
      totalGoals: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };

    curr.games += 1;
    curr.points += pointsFrom(gf, ga);
    curr.gf += gf;
    curr.ga += ga;
    curr.totalGoals += total;
    if (gf > ga) curr.wins += 1;
    else if (gf < ga) curr.losses += 1;
    else curr.draws += 1;

    map.set(key, curr);
  });

  return map;
}

function buildTeamPerformance(matches: MatchRecord[], nick: string, teamFilter: string) {
  const map = new Map<string, TeamPerformance>();

  matches.forEach((match) => {
    const side = getPlayerSide(match, nick);
    if (!side) return;
    if (!playerMatchesTeam(match, nick, teamFilter)) return;

    const team = side === "home" ? match.homeTeam : match.awayTeam;
    const key = normalize(team);
    const gf = side === "home" ? match.homeGoals : match.awayGoals;
    const ga = side === "home" ? match.awayGoals : match.homeGoals;

    const current = map.get(key) ?? {
      team,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      ppg: 0,
      winRate: 0,
    };

    current.games += 1;
    current.gf += gf;
    current.ga += ga;
    if (gf > ga) current.wins += 1;
    else if (gf < ga) current.losses += 1;
    else current.draws += 1;

    map.set(key, current);
  });

  const rows = [...map.values()]
    .map((item) => ({
      ...item,
      ppg: item.games ? (item.wins * 3 + item.draws) / item.games : 0,
      winRate: item.games ? item.wins / item.games : 0,
    }))
    .sort((a, b) => b.ppg - a.ppg || b.games - a.games || b.winRate - a.winRate);

  return {
    best: rows[0] ?? null,
    top: rows.slice(0, 3),
  };
}

function buildH2hScore(args: {
  playerA: string;
  playerB: string;
  h2hGames: number;
  winsA: number;
  winsB: number;
  draws: number;
  statsA: PlayerStats;
  statsB: PlayerStats;
  commonRows: Array<{ ppgA: number; ppgB: number }>;
  overInterval: RateInterval;
}) {
  const {
    playerA,
    playerB,
    h2hGames,
    winsA,
    winsB,
    draws,
    statsA,
    statsB,
    commonRows,
    overInterval,
  } = args;

  const h2hDiff = h2hGames ? (winsA - winsB) / h2hGames : 0;
  const formDiff = clamp((statsA.ppg - statsB.ppg) / 2, -1, 1);
  const commonPpgA = commonRows.length ? commonRows.reduce((acc, row) => acc + row.ppgA, 0) / commonRows.length : 0;
  const commonPpgB = commonRows.length ? commonRows.reduce((acc, row) => acc + row.ppgB, 0) / commonRows.length : 0;
  const commonDiff = clamp((commonPpgA - commonPpgB) / 2, -1, 1);

  const strength = 0.45 * h2hDiff + 0.35 * formDiff + 0.2 * commonDiff;
  const sampleFactor = clamp((h2hGames + commonRows.length) / 24, 0, 1);
  const certainty = clamp(1 - (overInterval.high - overInterval.low), 0, 1);
  const score = Math.round(clamp(Math.abs(strength) * 60 + sampleFactor * 25 + certainty * 15, 0, 100));
  const sampleEquivalent = h2hGames + commonRows.length;
  const intervalWidth = overInterval.high - overInterval.low;

  let edgeFor: H2hScore["edgeFor"] = "equilibrado";
  if (strength > 0.12) edgeFor = "A";
  if (strength < -0.12) edgeFor = "B";

  let level: H2hScore["level"] = "evitar";
  if (score >= 70 && edgeFor !== "equilibrado") level = "favoravel";
  else if (score >= 50) level = "cautela";

  const leadName = edgeFor === "A" ? playerA : edgeFor === "B" ? playerB : "sem vantagem clara";
  const reasons = [
    `Confronto direto: ${playerA} ${winsA} vitória(s), ${playerB} ${winsB} vitória(s), ${draws} empate(s).`,
    `Força contra o campo: ${playerA} ${statsA.ppg.toFixed(2)} PPG vs ${playerB} ${statsB.ppg.toFixed(2)} PPG.`,
    `Confiabilidade: ${sampleEquivalent} sinais e faixa Over ${Math.round(intervalWidth * 100)}pp (${leadName}).`,
  ];

  return { score, edgeFor, level, reasons };
}

export default function HeadToHeadPage() {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [line, setLine] = useState(6.5);
  const [lastN, setLastN] = useState<(typeof lastNOptions)[number]>("10");
  const [activeTab, setActiveTab] = useState<H2hTab>("analise");

  useEffect(() => {
    void (async () => {
      const rows = await db.matches.toArray();
      setMatches(rows.length ? rows : getSeedMatches());
      setIsLoading(false);
    })();
  }, []);

  const nickOptions = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((m) => {
      if (m.homeNick) set.add(m.homeNick);
      if (m.awayNick) set.add(m.awayNick);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [matches]);

  const analysis = useMemo(() => {
    const a = normalize(playerA);
    const b = normalize(playerB);

    if (!a || !b || a === b) {
      return {
        valid: false,
        h2hMatches: [] as MatchRecord[],
        otherA: [] as MatchRecord[],
        otherB: [] as MatchRecord[],
        statsA: null as PlayerStats | null,
        statsB: null as PlayerStats | null,
        commonRows: [] as Array<{
          opponent: string;
          gamesA: number;
          gamesB: number;
          ppgA: number;
          ppgB: number;
          avgGoalsA: number;
          avgGoalsB: number;
        }>,
        winsA: 0,
        winsB: 0,
        draws: 0,
      };
    }

    const h2hMatches = matches
      .filter((m) => {
        const hasA = normalize(m.homeNick) === a || normalize(m.awayNick) === a;
        const hasB = normalize(m.homeNick) === b || normalize(m.awayNick) === b;
        if (!hasA || !hasB) return false;
        if (!playerMatchesTeam(m, playerA, teamA)) return false;
        if (!playerMatchesTeam(m, playerB, teamB)) return false;
        return true;
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    const otherA = matches
      .filter((m) => {
        const hasA = normalize(m.homeNick) === a || normalize(m.awayNick) === a;
        const hasB = normalize(m.homeNick) === b || normalize(m.awayNick) === b;
        return hasA && !hasB && playerMatchesTeam(m, playerA, teamA);
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    const otherB = matches
      .filter((m) => {
        const hasA = normalize(m.homeNick) === a || normalize(m.awayNick) === a;
        const hasB = normalize(m.homeNick) === b || normalize(m.awayNick) === b;
        return hasB && !hasA && playerMatchesTeam(m, playerB, teamB);
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    let winsA = 0;
    let winsB = 0;
    let draws = 0;

    h2hMatches.forEach((m) => {
      const aGoals = normalize(m.homeNick) === a ? m.homeGoals : m.awayGoals;
      const bGoals = normalize(m.homeNick) === b ? m.homeGoals : m.awayGoals;
      if (aGoals > bGoals) winsA += 1;
      else if (aGoals < bGoals) winsB += 1;
      else draws += 1;
    });

    const mapA = aggregateAgainstOpponents(matches, playerA, playerB, teamA);
    const mapB = aggregateAgainstOpponents(matches, playerB, playerA, teamB);

    const commonRows = [...mapA.keys()]
      .filter((key) => mapB.has(key))
      .map((key) => {
        const aStats = mapA.get(key)!;
        const bStats = mapB.get(key)!;
        return {
          opponent: aStats.opponent,
          gamesA: aStats.games,
          gamesB: bStats.games,
          ppgA: aStats.games ? aStats.points / aStats.games : 0,
          ppgB: bStats.games ? bStats.points / bStats.games : 0,
          avgGoalsA: aStats.games ? aStats.totalGoals / aStats.games : 0,
          avgGoalsB: bStats.games ? bStats.totalGoals / bStats.games : 0,
        };
      })
      .sort((x, y) => Math.abs((y.ppgA - y.ppgB)) - Math.abs((x.ppgA - x.ppgB)));

    return {
      valid: true,
      h2hMatches,
      otherA,
      otherB,
      statsA: buildPlayerStats(otherA, playerA, line),
      statsB: buildPlayerStats(otherB, playerB, line),
      commonRows,
      winsA,
      winsB,
      draws,
    };
  }, [matches, playerA, playerB, teamA, teamB, line]);

  const h2hWindow = useMemo(() => {
    if (!analysis.valid) return [] as MatchRecord[];
    if (lastN === "all") return analysis.h2hMatches;
    return analysis.h2hMatches.slice(0, Number(lastN));
  }, [analysis, lastN]);

  const h2hTotals = useMemo(() => {
    const totalGames = h2hWindow.length;
    if (!totalGames) {
      return {
        avgGoals: 0,
        bttsRate: 0,
        overRate: 0,
        weightedAvgGoals: 0,
        weightedBttsRate: 0,
        weightedOverRate: 0,
        bttsInterval: wilsonInterval(0, 0),
        overInterval: wilsonInterval(0, 0),
      };
    }

    let totalGoals = 0;
    let btts = 0;
    let over = 0;
    let weightSum = 0;
    let weightedGoals = 0;
    let weightedBtts = 0;
    let weightedOver = 0;

    h2hWindow.forEach((m, index) => {
      const total = m.homeGoals + m.awayGoals;
      const isBtts = m.homeGoals > 0 && m.awayGoals > 0;
      const isOver = total > line;
      const weight = Math.pow(recencyFactor, index);

      totalGoals += total;
      if (isBtts) btts += 1;
      if (isOver) over += 1;

      weightSum += weight;
      weightedGoals += total * weight;
      if (isBtts) weightedBtts += weight;
      if (isOver) weightedOver += weight;
    });

    const overRate = over / totalGames;
    const bttsRate = btts / totalGames;

    return {
      avgGoals: totalGoals / totalGames,
      bttsRate,
      overRate,
      weightedAvgGoals: weightSum ? weightedGoals / weightSum : 0,
      weightedBttsRate: weightSum ? weightedBtts / weightSum : 0,
      weightedOverRate: weightSum ? weightedOver / weightSum : 0,
      bttsInterval: wilsonInterval(bttsRate, totalGames),
      overInterval: wilsonInterval(overRate, totalGames),
    };
  }, [h2hWindow, line]);

  const splitH2H = useMemo(() => {
    const make = () => ({ games: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 });
    const aHome = make();
    const aAway = make();
    const bHome = make();
    const bAway = make();

    const a = normalize(playerA);
    const b = normalize(playerB);

    h2hWindow.forEach((m) => {
      const aIsHome = normalize(m.homeNick) === a;
      const bIsHome = normalize(m.homeNick) === b;

      const aGoals = aIsHome ? m.homeGoals : m.awayGoals;
      const bGoals = bIsHome ? m.homeGoals : m.awayGoals;

      const add = (bucket: ReturnType<typeof make>, gf: number, ga: number) => {
        bucket.games += 1;
        bucket.gf += gf;
        bucket.ga += ga;
        if (gf > ga) bucket.wins += 1;
        else if (gf < ga) bucket.losses += 1;
        else bucket.draws += 1;
      };

      add(aIsHome ? aHome : aAway, aGoals, bGoals);
      add(bIsHome ? bHome : bAway, bGoals, aGoals);
    });

    return { aHome, aAway, bHome, bAway };
  }, [h2hWindow, playerA, playerB]);

  const trendPoints = useMemo(() => {
    const chronological = [...h2hWindow].reverse();
    return chronological.map((m) => ({
      id: m.id,
      label: formatDateTimePtBr(m.dateTime, { includeTime: false, fallback: "Sem data" }),
      total: m.homeGoals + m.awayGoals,
    }));
  }, [h2hWindow]);

  const h2hScore = useMemo(() => {
    if (!analysis.valid || !analysis.statsA || !analysis.statsB) {
      return {
        score: 0,
        edgeFor: "equilibrado",
        level: "evitar",
        reasons: ["Selecione dois jogadores para calcular o score."],
      } satisfies H2hScore;
    }

    return buildH2hScore({
      playerA,
      playerB,
      h2hGames: h2hWindow.length,
      winsA: analysis.winsA,
      winsB: analysis.winsB,
      draws: analysis.draws,
      statsA: analysis.statsA,
      statsB: analysis.statsB,
      commonRows: analysis.commonRows,
      overInterval: h2hTotals.overInterval,
    });
  }, [analysis, playerA, playerB, h2hTotals.overInterval, h2hWindow.length]);

  const sampleLabel = useMemo(() => {
    const sample = h2hWindow.length + (analysis.valid ? analysis.commonRows.length : 0);
    return confidenceSeal(sample);
  }, [h2hWindow.length, analysis]);

  const teamPerformanceA = useMemo(
    () => buildTeamPerformance(matches, playerA, teamA),
    [matches, playerA, teamA]
  );

  const teamPerformanceB = useMemo(
    () => buildTeamPerformance(matches, playerB, teamB),
    [matches, playerB, teamB]
  );

  const recommendation = useMemo(() => {
    if (!analysis.valid) return "Selecione os dois jogadores para gerar recomendação.";
    if (h2hScore.level === "favoravel") {
      return h2hScore.edgeFor === "A"
        ? `Entrada possível: vantagem estatística para ${playerA}.`
        : h2hScore.edgeFor === "B"
          ? `Entrada possível: vantagem estatística para ${playerB}.`
          : "Entrada possível, mas sem vantagem clara entre os dois.";
    }
    if (h2hScore.level === "cautela") return "Entrada com cautela: existe sinal, mas ainda moderado.";

    if (sampleLabel === "Alta") {
      return "Evitar entrada agora: a amostra é robusta, mas os indicadores estão equilibrados e sem edge claro.";
    }
    if (sampleLabel === "Média") {
      return "Evitar entrada agora: há algum sinal, porém ainda sem vantagem consistente para decisão.";
    }
    return "Evitar entrada agora: amostra limitada para sustentar um edge confiável.";
  }, [analysis.valid, h2hScore, playerA, playerB, sampleLabel]);

  const exportH2hCsv = () => {
    if (!analysis.valid) return;

    const summaryRows = [
      ["secao", "metrica", "valor"],
      ["resumo", "jogador_a", playerA],
      ["resumo", "jogador_b", playerB],
      ["resumo", "time_a_filtro", teamA || "(vazio)"],
      ["resumo", "time_b_filtro", teamB || "(vazio)"],
      ["resumo", "janela_h2h", lastN],
      ["resumo", "h2h_jogos", String(h2hWindow.length)],
      ["resumo", "score_h2h", String(h2hScore.score)],
      ["resumo", "edge", h2hScore.edgeFor],
      ["resumo", "nivel", h2hScore.level],
      ["resumo", `over_${line}_rate`, (h2hTotals.overRate * 100).toFixed(2)],
      ["resumo", `over_${line}_ic95_low`, (h2hTotals.overInterval.low * 100).toFixed(2)],
      ["resumo", `over_${line}_ic95_high`, (h2hTotals.overInterval.high * 100).toFixed(2)],
      ["resumo", "btts_rate", (h2hTotals.bttsRate * 100).toFixed(2)],
      ["resumo", "btts_ic95_low", (h2hTotals.bttsInterval.low * 100).toFixed(2)],
      ["resumo", "btts_ic95_high", (h2hTotals.bttsInterval.high * 100).toFixed(2)],
      ["", "", ""],
      ["h2h", "data_hora", "liga", "home", "away", "placar", "total"],
    ];

    const h2hRows = h2hWindow.map((m) => [
      "h2h",
      toIsoDateTime(m.dateTime),
      m.league,
      `${m.homeNick} (${m.homeTeam})`,
      `${m.awayNick} (${m.awayTeam})`,
      `${m.homeGoals}-${m.awayGoals}`,
      String(m.homeGoals + m.awayGoals),
    ]);

    const commonHeader = [["", "", ""], ["common", "oponente", "ppg_a", "ppg_b", "jogos_a", "jogos_b"]];
    const commonRows = analysis.commonRows.map((row) => [
      "common",
      row.opponent,
      row.ppgA.toFixed(2),
      row.ppgB.toFixed(2),
      String(row.gamesA),
      String(row.gamesB),
    ]);

    const csvData = [...summaryRows, ...h2hRows, ...commonHeader, ...commonRows];
    const csv = csvData
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `h2h-${playerA}-vs-${playerB}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportH2hExcel = () => {
    if (!analysis.valid) return;

    const workbook = XLSX.utils.book_new();

    const summaryRows = [
      { metrica: "jogador_a", valor: playerA },
      { metrica: "jogador_b", valor: playerB },
      { metrica: "time_a_filtro", valor: teamA || "(vazio)" },
      { metrica: "time_b_filtro", valor: teamB || "(vazio)" },
      { metrica: "janela_h2h", valor: lastN },
      { metrica: "h2h_jogos", valor: h2hWindow.length },
      { metrica: "score_h2h", valor: h2hScore.score },
      { metrica: "edge", valor: h2hScore.edgeFor },
      { metrica: "nivel", valor: h2hScore.level },
      { metrica: "recomendacao", valor: recommendation },
      { metrica: `over_${line}_rate`, valor: Number((h2hTotals.overRate * 100).toFixed(2)) },
      { metrica: `over_${line}_ic95_low`, valor: Number((h2hTotals.overInterval.low * 100).toFixed(2)) },
      { metrica: `over_${line}_ic95_high`, valor: Number((h2hTotals.overInterval.high * 100).toFixed(2)) },
      { metrica: "btts_rate", valor: Number((h2hTotals.bttsRate * 100).toFixed(2)) },
      { metrica: "btts_ic95_low", valor: Number((h2hTotals.bttsInterval.low * 100).toFixed(2)) },
      { metrica: "btts_ic95_high", valor: Number((h2hTotals.bttsInterval.high * 100).toFixed(2)) },
    ];

    const h2hRows = h2hWindow.map((m) => ({
      data_hora: formatDateTimePtBr(m.dateTime),
      data_hora_iso: toIsoDateTime(m.dateTime),
      liga: m.league,
      home_nick: m.homeNick,
      home_team: m.homeTeam,
      away_nick: m.awayNick,
      away_team: m.awayTeam,
      home_goals: m.homeGoals,
      away_goals: m.awayGoals,
      total_goals: m.homeGoals + m.awayGoals,
      ou_resultado: m.homeGoals + m.awayGoals > line ? "Over" : "Under",
    }));

    const commonRows = analysis.commonRows.map((row) => ({
      oponente: row.opponent,
      ppg_a: Number(row.ppgA.toFixed(2)),
      ppg_b: Number(row.ppgB.toFixed(2)),
      jogos_a: row.gamesA,
      jogos_b: row.gamesB,
      media_gols_a: Number(row.avgGoalsA.toFixed(2)),
      media_gols_b: Number(row.avgGoalsB.toFixed(2)),
    }));

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "ResumoH2H");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(h2hRows), "Confrontos");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(commonRows), "OponentesComuns");

    XLSX.writeFile(workbook, `h2h-relatorio-${playerA}-vs-${playerB}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <section className="pageGrid" aria-label="Confronto direto">
      <Card className="col-12 filterBar">
        <div className="chips" style={{ alignItems: "center" }}>
          <strong>Confronto Direto</strong>
          <InfoHint text="Selecione dois jogadores para comparar histórico entre eles (H2H) e desempenho separado contra outros adversários.\nOs times são opcionais e servem para restringir aos jogos em que cada jogador atuou por aquele time." />
          <Chip active={activeTab === "analise"} onClick={() => setActiveTab("analise")}>Aba: Análise</Chip>
          <Chip active={activeTab === "excel"} onClick={() => setActiveTab("excel")}>Aba: Excel H2H</Chip>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, width: "100%" }}>
          <Select value={playerA} onChange={(e) => setPlayerA(e.target.value)} aria-label="Jogador A">
            <option value="">Jogador A</option>
            {nickOptions.map((nick) => <option key={`a-${nick}`} value={nick}>{nick}</option>)}
          </Select>
          <Select value={playerB} onChange={(e) => setPlayerB(e.target.value)} aria-label="Jogador B">
            <option value="">Jogador B</option>
            {nickOptions.map((nick) => <option key={`b-${nick}`} value={nick}>{nick}</option>)}
          </Select>
          <input className="select" placeholder="Time do Jogador A (opcional)" value={teamA} onChange={(e) => setTeamA(e.target.value)} />
          <input className="select" placeholder="Time do Jogador B (opcional)" value={teamB} onChange={(e) => setTeamB(e.target.value)} />
          <Select value={String(line)} onChange={(e) => setLine(Number(e.target.value))} aria-label="Linha Over/Under">
            {lines.map((value) => <option key={value} value={value}>Linha OU {value}</option>)}
          </Select>
          <Select value={lastN} onChange={(e) => setLastN(e.target.value as (typeof lastNOptions)[number])} aria-label="Últimos N confrontos">
            {lastNOptions.map((item) => <option key={item} value={item}>{item === "all" ? "H2H: Tudo" : `H2H: últimos ${item}`}</option>)}
          </Select>
          <Button onClick={exportH2hCsv}>⬇️ CSV H2H</Button>
        </div>
      </Card>

      {activeTab === "excel" ? (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3 style={{ margin: 0 }}>Exportação Excel exclusiva do H2H <InfoHint text="Este arquivo é gerado apenas com dados do Confronto Direto (H2H). Não altera dados globais, não interfere no dashboard e não impacta outras páginas." /></h3>
              <small>Arquivo XLSX com abas: ResumoH2H, Confrontos e OponentesComuns</small>
            </div>
          </CardHeader>
          <CardBody>
            {!analysis.valid ? (
              <EmptyState title="Selecione os jogadores" subtitle="Preencha Jogador A e Jogador B para habilitar a exportação Excel do H2H." />
            ) : (
              <>
                <div className="list" style={{ marginBottom: 12 }}>
                  <div className="row"><span>Escopo</span><b>Somente confronto direto (H2H)</b></div>
                  <div className="row"><span>Jogadores</span><b>{playerA} vs {playerB}</b></div>
                  <div className="row"><span>Janela</span><b>{lastN === "all" ? "Todos os confrontos" : `Últimos ${lastN}`}</b></div>
                  <div className="row"><span>Registros H2H</span><b>{h2hWindow.length}</b></div>
                </div>
                <div className="chips">
                  <Button onClick={exportH2hExcel}>⬇️ Excel H2H (.xlsx)</Button>
                  <Button onClick={exportH2hCsv}>⬇️ CSV H2H</Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : !analysis.valid ? (
        <Card className="col-12">
          <CardBody>
            {isLoading ? <p className="mini">Carregando base de jogos...</p> : <EmptyState title="Escolha dois jogadores diferentes" subtitle="Preencha Jogador A e Jogador B para ver confronto direto e análise contra outros jogadores." />}
          </CardBody>
        </Card>
      ) : (
        <>
          <Card className="col-3 stat"><div className="statTop" style={{ display: "flex", alignItems: "center", gap: 8 }}><Badge>H2H Jogos</Badge><InfoHint text="Quantidade de partidas entre os dois jogadores dentro dos filtros aplicados." /></div><div className="kpi">{analysis.h2hMatches.length}</div><div className="kpiSub">Confrontos entre {playerA} e {playerB}</div></Card>
          <Card className="col-3 stat"><div className="statTop" style={{ display: "flex", alignItems: "center", gap: 8 }}><Badge>{playerA}</Badge><InfoHint text={`Vitórias de ${playerA} no confronto direto (janela atual).`} /></div><div className="kpi">{analysis.winsA}</div><div className="kpiSub">Vitórias no confronto direto</div></Card>
          <Card className="col-3 stat"><div className="statTop" style={{ display: "flex", alignItems: "center", gap: 8 }}><Badge>{playerB}</Badge><InfoHint text={`Vitórias de ${playerB} no confronto direto (janela atual).`} /></div><div className="kpi">{analysis.winsB}</div><div className="kpiSub">Vitórias no confronto direto</div></Card>
          <Card className="col-3 stat"><div className="statTop" style={{ display: "flex", alignItems: "center", gap: 8 }}><Badge>Empates</Badge><InfoHint text="Empates no confronto direto entre os dois jogadores." /></div><div className="kpi">{analysis.draws}</div><div className="kpiSub">No confronto direto</div></Card>

          <Card className="col-12">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Score H2H Final</h3><InfoHint text="Score de 0 a 100 com confronto direto, forma contra outros, oponentes em comum e consistência estatística." /></div><small>Força de sinal no confronto</small></div><Badge tone={sampleLabel === "Alta" ? "good" : sampleLabel === "Média" ? "warn" : "bad"}>Confiança {sampleLabel}</Badge></CardHeader>
            <CardBody>
              <div className="chips" style={{ marginBottom: 12 }}>
                <Badge tone={h2hScore.score >= 70 ? "good" : h2hScore.score >= 50 ? "warn" : "bad"}>Score: {h2hScore.score}/100</Badge>
                <Badge>{h2hScore.edgeFor === "A" ? `Vantagem: ${playerA}` : h2hScore.edgeFor === "B" ? `Vantagem: ${playerB}` : "Vantagem: sem definição"}</Badge>
                <Badge tone={h2hScore.level === "favoravel" ? "good" : h2hScore.level === "cautela" ? "warn" : "bad"}>Nível: {h2hScore.level === "favoravel" ? "favorável" : h2hScore.level}</Badge>
              </div>
              <p style={{ marginTop: 0, marginBottom: 12, fontWeight: 600 }}>{recommendation}</p>
              <div className="list">
                {h2hScore.reasons.map((reason) => (
                  <div key={reason} className="row"><span>{reason}</span></div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="col-12">
            <CardHeader>
              <div>
                <div className="chips" style={{ gap: 8, marginBottom: 4 }}>
                  <h3 style={{ margin: 0 }}>Melhor time por jogador</h3>
                  <InfoHint text="Mostra em qual time cada jogador apresenta melhor desempenho no histórico filtrado, priorizando PPG e consistência de amostra." />
                </div>
                <small>Comparativo por equipe (jogador 1 e jogador 2)</small>
              </div>
            </CardHeader>
            <CardBody>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
                <div className="list">
                  <div className="row"><span>Jogador</span><b>{playerA || "—"}</b></div>
                  {!teamPerformanceA.best ? (
                    <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Melhor time <InfoHint text="Equipe em que o jogador teve melhor desempenho no recorte atual." /></span><b>Sem dados</b></div>
                  ) : (
                    <>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Melhor time <InfoHint text="Equipe em que o jogador teve melhor desempenho no recorte atual." /></span><b>{teamPerformanceA.best.team}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>PPG <InfoHint text="Pontos por jogo no time informado (3 vitória, 1 empate, 0 derrota)." /></span><b>{teamPerformanceA.best.ppg.toFixed(2)}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>W/D/L <InfoHint text="Vitórias / Empates / Derrotas nesse time." /></span><b>{teamPerformanceA.best.wins}/{teamPerformanceA.best.draws}/{teamPerformanceA.best.losses}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Jogos <InfoHint text="Quantidade de partidas consideradas para esse time." /></span><b>{teamPerformanceA.best.games}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>GF/GA <InfoHint text="Gols feitos / gols sofridos com esse time." /></span><b>{teamPerformanceA.best.gf}/{teamPerformanceA.best.ga}</b></div>
                    </>
                  )}
                </div>

                <div className="list">
                  <div className="row"><span>Jogador</span><b>{playerB || "—"}</b></div>
                  {!teamPerformanceB.best ? (
                    <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Melhor time <InfoHint text="Equipe em que o jogador teve melhor desempenho no recorte atual." /></span><b>Sem dados</b></div>
                  ) : (
                    <>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Melhor time <InfoHint text="Equipe em que o jogador teve melhor desempenho no recorte atual." /></span><b>{teamPerformanceB.best.team}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>PPG <InfoHint text="Pontos por jogo no time informado (3 vitória, 1 empate, 0 derrota)." /></span><b>{teamPerformanceB.best.ppg.toFixed(2)}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>W/D/L <InfoHint text="Vitórias / Empates / Derrotas nesse time." /></span><b>{teamPerformanceB.best.wins}/{teamPerformanceB.best.draws}/{teamPerformanceB.best.losses}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Jogos <InfoHint text="Quantidade de partidas consideradas para esse time." /></span><b>{teamPerformanceB.best.games}</b></div>
                      <div className="row"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>GF/GA <InfoHint text="Gols feitos / gols sofridos com esse time." /></span><b>{teamPerformanceB.best.gf}/{teamPerformanceB.best.ga}</b></div>
                    </>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-4">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>H2H Média</h3><InfoHint text="Métricas somente dos confrontos entre os dois jogadores. 'Recência' dá mais peso para jogos recentes." /></div><small>Somente entre os dois (com recência)</small></div></CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>Média de gols</span><b>{h2hTotals.avgGoals.toFixed(2)}</b></div>
                <div className="row"><span>Média gols (recência)</span><b>{h2hTotals.weightedAvgGoals.toFixed(2)}</b></div>
                <div className="row"><span>BTTS</span><b>{(h2hTotals.bttsRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>BTTS recência</span><b>{(h2hTotals.weightedBttsRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Over {line}</span><b>{(h2hTotals.overRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Over recência</span><b>{(h2hTotals.weightedOverRate * 100).toFixed(1)}%</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-4">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>{playerA} vs outros</h3><InfoHint text={`Desempenho de ${playerA} contra outros adversários, excluindo jogos contra ${playerB}.`} /></div><small>Sem jogos contra {playerB}</small></div></CardHeader>
            <CardBody>
              {!analysis.statsA?.games ? <EmptyState title="Sem dados" subtitle="Não há jogos do Jogador A contra outros no filtro atual." /> : (
                <div className="list">
                  <div className="row"><span>Jogos</span><b>{analysis.statsA.games}</b></div>
                  <div className="row"><span>W/D/L</span><b>{analysis.statsA.wins}/{analysis.statsA.draws}/{analysis.statsA.losses}</b></div>
                  <div className="row"><span>PPG</span><b>{analysis.statsA.ppg.toFixed(2)}</b></div>
                  <div className="row"><span>GF/GA</span><b>{analysis.statsA.gf}/{analysis.statsA.ga}</b></div>
                  <div className="row"><span>Média gols</span><b>{analysis.statsA.avgTotal.toFixed(2)}</b></div>
                  <div className="row"><span>BTTS</span><b>{(analysis.statsA.bttsRate * 100).toFixed(1)}%</b></div>
                  <div className="row"><span>Over {line}</span><b>{(analysis.statsA.overRate * 100).toFixed(1)}%</b></div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="col-4">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>{playerB} vs outros</h3><InfoHint text={`Desempenho de ${playerB} contra outros adversários, excluindo jogos contra ${playerA}.`} /></div><small>Sem jogos contra {playerA}</small></div></CardHeader>
            <CardBody>
              {!analysis.statsB?.games ? <EmptyState title="Sem dados" subtitle="Não há jogos do Jogador B contra outros no filtro atual." /> : (
                <div className="list">
                  <div className="row"><span>Jogos</span><b>{analysis.statsB.games}</b></div>
                  <div className="row"><span>W/D/L</span><b>{analysis.statsB.wins}/{analysis.statsB.draws}/{analysis.statsB.losses}</b></div>
                  <div className="row"><span>PPG</span><b>{analysis.statsB.ppg.toFixed(2)}</b></div>
                  <div className="row"><span>GF/GA</span><b>{analysis.statsB.gf}/{analysis.statsB.ga}</b></div>
                  <div className="row"><span>Média gols</span><b>{analysis.statsB.avgTotal.toFixed(2)}</b></div>
                  <div className="row"><span>BTTS</span><b>{(analysis.statsB.bttsRate * 100).toFixed(1)}%</b></div>
                  <div className="row"><span>Over {line}</span><b>{(analysis.statsB.overRate * 100).toFixed(1)}%</b></div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Split por mando ({playerA})</h3><InfoHint text="Mostra o desempenho no H2H quando joga como mandante e como visitante." /></div><small>Confronto direto no recorte atual</small></div></CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>Como mandante (W/D/L)</span><b>{splitH2H.aHome.wins}/{splitH2H.aHome.draws}/{splitH2H.aHome.losses}</b></div>
                <div className="row"><span>Como mandante (GF/GA)</span><b>{splitH2H.aHome.gf}/{splitH2H.aHome.ga}</b></div>
                <div className="row"><span>Como visitante (W/D/L)</span><b>{splitH2H.aAway.wins}/{splitH2H.aAway.draws}/{splitH2H.aAway.losses}</b></div>
                <div className="row"><span>Como visitante (GF/GA)</span><b>{splitH2H.aAway.gf}/{splitH2H.aAway.ga}</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Split por mando ({playerB})</h3><InfoHint text="Mostra o desempenho no H2H quando joga como mandante e como visitante." /></div><small>Confronto direto no recorte atual</small></div></CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>Como mandante (W/D/L)</span><b>{splitH2H.bHome.wins}/{splitH2H.bHome.draws}/{splitH2H.bHome.losses}</b></div>
                <div className="row"><span>Como mandante (GF/GA)</span><b>{splitH2H.bHome.gf}/{splitH2H.bHome.ga}</b></div>
                <div className="row"><span>Como visitante (W/D/L)</span><b>{splitH2H.bAway.wins}/{splitH2H.bAway.draws}/{splitH2H.bAway.losses}</b></div>
                <div className="row"><span>Como visitante (GF/GA)</span><b>{splitH2H.bAway.gf}/{splitH2H.bAway.ga}</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Probabilidades sugeridas</h3><InfoHint text="Estimativas de Over e BTTS no H2H, com intervalo de confiança de 95% para mostrar incerteza." /></div><small>Com faixa de confiança (IC95%)</small></div></CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>Over {line}</span><b>{(h2hTotals.overRate * 100).toFixed(1)}% • IC95% {(h2hTotals.overInterval.low * 100).toFixed(1)}–{(h2hTotals.overInterval.high * 100).toFixed(1)}%</b></div>
                <div className="row"><span>BTTS</span><b>{(h2hTotals.bttsRate * 100).toFixed(1)}% • IC95% {(h2hTotals.bttsInterval.low * 100).toFixed(1)}–{(h2hTotals.bttsInterval.high * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Tamanho amostral (H2H)</span><b>{h2hWindow.length} jogos</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Tendência H2H</h3><InfoHint text="Mini gráfico com o total de gols por jogo na ordem cronológica da janela selecionada." /></div><small>Totais de gols nos confrontos (janela atual)</small></div></CardHeader>
            <CardBody>
              {!trendPoints.length ? <EmptyState title="Sem tendência" subtitle="Não há jogos suficientes no recorte atual." /> : (
                <>
                  <div className="chartWrap" style={{ height: 140 }}>
                    {trendPoints.map((point) => {
                      const maxTotal = Math.max(...trendPoints.map((item) => item.total), 1);
                      const height = Math.max(20, Math.round((point.total / maxTotal) * 100));
                      return <div key={point.id} className="bar" style={{ height: `${height}%` }}><span>{point.total}</span></div>;
                    })}
                  </div>
                  <div className="chartLegend"><span>{trendPoints[0]?.label}</span><span>{trendPoints[trendPoints.length - 1]?.label}</span></div>
                </>
              )}
            </CardBody>
          </Card>

          <Card className="col-12">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Common Opponents</h3><InfoHint text="Compara os dois jogadores contra os mesmos adversários. PPG maior indica melhor desempenho médio." /></div><small>Comparação dos dois contra os mesmos adversários</small></div><Badge>{analysis.commonRows.length} oponentes em comum</Badge></CardHeader>
            <CardBody>
              {!analysis.commonRows.length ? <EmptyState title="Sem oponentes em comum" subtitle="Não foi possível encontrar adversários compartilhados no filtro atual." /> : (
                <Table>
                  <thead>
                    <tr>
                      <th>Oponente</th>
                      <th className="right">{playerA} PPG</th>
                      <th className="right">{playerB} PPG</th>
                      <th className="right">Jogos A/B</th>
                      <th className="right">Média gols A/B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.commonRows.slice(0, 20).map((row) => (
                      <tr key={row.opponent}>
                        <td>{row.opponent}</td>
                        <td className="right">{row.ppgA.toFixed(2)}</td>
                        <td className="right">{row.ppgB.toFixed(2)}</td>
                        <td className="right">{row.gamesA}/{row.gamesB}</td>
                        <td className="right">{row.avgGoalsA.toFixed(2)}/{row.avgGoalsB.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card className="col-12">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Histórico entre os dois jogadores</h3><InfoHint text="Lista dos confrontos diretos dentro da janela atual, com data, placar e sinal Over/Under." /></div><small>Confrontos diretos recentes (janela ativa)</small></div></CardHeader>
            <CardBody>
              {!h2hWindow.length ? <EmptyState title="Sem confronto direto" subtitle="Nenhum jogo encontrado com os filtros atuais (jogadores/times)." /> : (
                <Table>
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th>Liga</th>
                      <th>Casa</th>
                      <th>Fora</th>
                      <th className="right">Placar</th>
                      <th className="right">Total</th>
                      <th className="right">OU {line}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2hWindow.slice(0, 30).map((m) => {
                      const total = m.homeGoals + m.awayGoals;
                      return (
                        <tr key={m.id}>
                          <td>{formatDateTimePtBr(m.dateTime)}</td>
                          <td>{m.league}</td>
                          <td>{m.homeNick} ({m.homeTeam})</td>
                          <td>{m.awayNick} ({m.awayTeam})</td>
                          <td className="right">{m.homeGoals}–{m.awayGoals}</td>
                          <td className="right">{total}</td>
                          <td className="right"><Badge tone={total > line ? "good" : "bad"}>{total > line ? "Over" : "Under"}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </section>
  );
}
