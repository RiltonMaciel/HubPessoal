"use client";

import * as XLSX from "xlsx";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { parseRawTextMatches } from "@/lib/excel";
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

const lines = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const lastNOptions = ["5", "10", "20", "all"] as const;
const recencyFactor = 0.9;
const LOCAL_EXTRA_KEY = "hubpessoal-h2h-extra-matches-v1";
type H2hTab = "analise" | "excel" | "jogador";

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

type ExtraMarkets = {
  bttsYesRate: number;
  bttsNoRate: number;
  homeOver05Rate: number;
  homeOver15Rate: number;
  awayOver05Rate: number;
  awayOver15Rate: number;
  oneXRate: number;
  xTwoRate: number;
  oneTwoRate: number;
  dnbHomeRate: number;
  dnbAwayRate: number;
  goalsRange0to2Rate: number;
  goalsRange3to4Rate: number;
  goalsRange5PlusRate: number;
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

function buildMatchFingerprint(match: MatchRecord) {
  return [
    match.dateTime,
    normalize(match.homeNick),
    normalize(match.awayNick),
    match.homeGoals,
    match.awayGoals,
    normalize(match.league),
  ].join("|");
}

function buildNickIndex(matches: MatchRecord[]) {
  const map = new Map<string, MatchRecord[]>();

  const push = (nick: string, match: MatchRecord) => {
    const key = normalize(nick);
    if (!key) return;
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(match);
      return;
    }
    map.set(key, [match]);
  };

  matches.forEach((match) => {
    push(match.homeNick, match);
    if (normalize(match.awayNick) !== normalize(match.homeNick)) {
      push(match.awayNick, match);
    }
  });

  return map;
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
  playerMatches: MatchRecord[],
  nick: string,
  excludedNick: string,
  teamFilter: string
) {
  const excluded = normalize(excludedNick);
  const map = new Map<string, OpponentStats>();

  playerMatches.forEach((match) => {
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
    }));

  const byPpg = [...rows].sort((a, b) => b.ppg - a.ppg || b.games - a.games || b.winRate - a.winRate);
  const byGames = [...rows].sort((a, b) => b.games - a.games || b.ppg - a.ppg || b.winRate - a.winRate);

  return {
    best: byPpg[0] ?? null,
    top: byPpg.slice(0, 3),
    topByGames: byGames.slice(0, 3),
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
  const [extraMatches, setExtraMatches] = useState<MatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [line, setLine] = useState(3.5);
  const [lastN, setLastN] = useState<(typeof lastNOptions)[number]>("10");
  const [activeTab, setActiveTab] = useState<H2hTab>("analise");
  const [uploadPlayer, setUploadPlayer] = useState("");
  const [uploadLeague, setUploadLeague] = useState("H2H-Extra");
  const [uploadYear, setUploadYear] = useState(String(new Date().getFullYear()));
  const [uploadText, setUploadText] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");

  useEffect(() => {
    void (async () => {
      const rows = await db.matches.toArray();
      setMatches(rows);

      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(LOCAL_EXTRA_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as MatchRecord[];
            setExtraMatches(Array.isArray(parsed) ? parsed : []);
          } catch {
            setExtraMatches([]);
          }
        }
      }

      setIsLoading(false);
    })();
  }, []);

  const allMatches = useMemo(() => {
    const dedupe = new Set<string>();
    const merged: MatchRecord[] = [];
    [...matches, ...extraMatches].forEach((item) => {
      const key = buildMatchFingerprint(item);
      if (dedupe.has(key)) return;
      dedupe.add(key);
      merged.push(item);
    });
    return merged;
  }, [matches, extraMatches]);

  const nickIndex = useMemo(() => buildNickIndex(allMatches), [allMatches]);

  const nickOptions = useMemo(() => {
    const set = new Set<string>();
    allMatches.forEach((m) => {
      if (m.homeNick) set.add(m.homeNick);
      if (m.awayNick) set.add(m.awayNick);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allMatches]);

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

    const matchesA = nickIndex.get(a) ?? [];
    const matchesB = nickIndex.get(b) ?? [];
    const setA = new Set(matchesA);
    const setB = new Set(matchesB);

    const h2hMatches = matchesA
      .filter((m) => {
        if (!setB.has(m)) return false;
        if (!playerMatchesTeam(m, playerA, teamA)) return false;
        if (!playerMatchesTeam(m, playerB, teamB)) return false;
        return true;
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    const otherA = matchesA
      .filter((m) => {
        return !setB.has(m) && playerMatchesTeam(m, playerA, teamA);
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    const otherB = matchesB
      .filter((m) => {
        return !setA.has(m) && playerMatchesTeam(m, playerB, teamB);
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

    const mapA = aggregateAgainstOpponents(matchesA, playerA, playerB, teamA);
    const mapB = aggregateAgainstOpponents(matchesB, playerB, playerA, teamB);

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
  }, [nickIndex, playerA, playerB, teamA, teamB, line]);

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
    () => buildTeamPerformance(nickIndex.get(normalize(playerA)) ?? [], playerA, teamA),
    [nickIndex, playerA, teamA]
  );

  const teamPerformanceB = useMemo(
    () => buildTeamPerformance(nickIndex.get(normalize(playerB)) ?? [], playerB, teamB),
    [nickIndex, playerB, teamB]
  );

  const overUnderMatrix = useMemo(() => {
    const games = h2hWindow.length;
    const byLine = lines.map((lineRef) => {
      const overHits = h2hWindow.filter((m) => m.homeGoals + m.awayGoals > lineRef).length;
      const underHits = games - overHits;
      return {
        line: lineRef,
        overRate: games ? overHits / games : 0,
        underRate: games ? underHits / games : 0,
      };
    });

    const maioresCount = h2hWindow.filter((m) => m.homeGoals + m.awayGoals > 7.5).length;
    const menoresCount = h2hWindow.filter((m) => m.homeGoals + m.awayGoals <= 1.5).length;

    return {
      byLine,
      maioresRate: games ? maioresCount / games : 0,
      menoresRate: games ? menoresCount / games : 0,
    };
  }, [h2hWindow]);

  const extraMarkets = useMemo<ExtraMarkets>(() => {
    const games = h2hWindow.length;
    if (!games) {
      return {
        bttsYesRate: 0,
        bttsNoRate: 0,
        homeOver05Rate: 0,
        homeOver15Rate: 0,
        awayOver05Rate: 0,
        awayOver15Rate: 0,
        oneXRate: 0,
        xTwoRate: 0,
        oneTwoRate: 0,
        dnbHomeRate: 0,
        dnbAwayRate: 0,
        goalsRange0to2Rate: 0,
        goalsRange3to4Rate: 0,
        goalsRange5PlusRate: 0,
      };
    }

    const totals = {
      bttsYes: 0,
      homeOver05: 0,
      homeOver15: 0,
      awayOver05: 0,
      awayOver15: 0,
      oneX: 0,
      xTwo: 0,
      oneTwo: 0,
      dnbHome: 0,
      dnbAway: 0,
      range0to2: 0,
      range3to4: 0,
      range5Plus: 0,
    };

    h2hWindow.forEach((m) => {
      const total = m.homeGoals + m.awayGoals;
      const homeWin = m.homeGoals > m.awayGoals;
      const awayWin = m.homeGoals < m.awayGoals;
      const draw = m.homeGoals === m.awayGoals;

      if (m.homeGoals > 0 && m.awayGoals > 0) totals.bttsYes += 1;
      if (m.homeGoals > 0) totals.homeOver05 += 1;
      if (m.homeGoals > 1) totals.homeOver15 += 1;
      if (m.awayGoals > 0) totals.awayOver05 += 1;
      if (m.awayGoals > 1) totals.awayOver15 += 1;

      if (homeWin || draw) totals.oneX += 1;
      if (awayWin || draw) totals.xTwo += 1;
      if (homeWin || awayWin) totals.oneTwo += 1;

      if (homeWin) totals.dnbHome += 1;
      if (awayWin) totals.dnbAway += 1;

      if (total <= 2) totals.range0to2 += 1;
      else if (total <= 4) totals.range3to4 += 1;
      else totals.range5Plus += 1;
    });

    const noDrawGames = h2hWindow.filter((m) => m.homeGoals !== m.awayGoals).length;

    return {
      bttsYesRate: totals.bttsYes / games,
      bttsNoRate: 1 - totals.bttsYes / games,
      homeOver05Rate: totals.homeOver05 / games,
      homeOver15Rate: totals.homeOver15 / games,
      awayOver05Rate: totals.awayOver05 / games,
      awayOver15Rate: totals.awayOver15 / games,
      oneXRate: totals.oneX / games,
      xTwoRate: totals.xTwo / games,
      oneTwoRate: totals.oneTwo / games,
      dnbHomeRate: noDrawGames ? totals.dnbHome / noDrawGames : 0,
      dnbAwayRate: noDrawGames ? totals.dnbAway / noDrawGames : 0,
      goalsRange0to2Rate: totals.range0to2 / games,
      goalsRange3to4Rate: totals.range3to4 / games,
      goalsRange5PlusRate: totals.range5Plus / games,
    };
  }, [h2hWindow]);

  const quickTip = useMemo(() => {
    if (!analysis.valid) return "Selecione os dois jogadores.";
    const over35 = overUnderMatrix.byLine.find((item) => item.line === 3.5)?.overRate ?? 0;
    const under35 = 1 - over35;
    if (h2hWindow.length < 6) return "Sem entrada: amostra fraca no H2H.";
    if (over35 >= 0.62) return "Tendência direta: Over 3.5.";
    if (under35 >= 0.62) return "Tendência direta: Under 3.5.";
    return "Sem edge claro: melhor ficar fora.";
  }, [analysis.valid, overUnderMatrix.byLine, h2hWindow.length]);

  const getOuOutcomeLabel = (total: number) => {
    if (total > 7.5) return "Maiores";
    if (total <= 1.5) return "Menores";
    return total > line ? `Over ${line}` : `Under ${line}`;
  };

  const importPlayerOnlyMatches = () => {
    setUploadMessage("");
    const nick = uploadPlayer.trim();
    if (!nick) {
      setUploadMessage("Informe o nick do jogador para filtrar os jogos enviados.");
      return;
    }

    const parsed = parseRawTextMatches(uploadText, {
      league: uploadLeague || "H2H-Extra",
      referenceYear: Number(uploadYear),
    });

    const filtered = parsed.matches.filter((item) => {
      const n = normalize(nick);
      return normalize(item.homeNick) === n || normalize(item.awayNick) === n;
    });

    if (!filtered.length) {
      setUploadMessage("Nenhum jogo encontrado para esse jogador no texto informado.");
      return;
    }

    const next = [...extraMatches, ...filtered];
    const dedupe = new Map<string, MatchRecord>();
    next.forEach((item) => dedupe.set(buildMatchFingerprint(item), item));
    const finalRows = [...dedupe.values()].sort((a, b) => toDateTimestamp(b.dateTime) - toDateTimestamp(a.dateTime));
    setExtraMatches(finalRows);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_EXTRA_KEY, JSON.stringify(finalRows));
    }

    setUploadMessage(`Importados ${filtered.length} jogo(s) para uso apenas no Confronto Direto.`);
    setUploadText("");
  };

  const clearExtraMatches = () => {
    setExtraMatches([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LOCAL_EXTRA_KEY);
    }
    setUploadMessage("Base extra do H2H removida.");
  };

  const recommendation = useMemo(() => {
    if (!analysis.valid) return "Selecione dois jogadores para analisar.";
    if (h2hScore.level === "favoravel") {
      return h2hScore.edgeFor === "A"
        ? `Entrada: favor ${playerA}.`
        : h2hScore.edgeFor === "B"
          ? `Entrada: favor ${playerB}.`
          : "Entrada leve: sem lado dominante.";
    }
    if (h2hScore.level === "cautela") return "Cautela: stake reduzida ou aguarde melhor preço.";

    if (sampleLabel === "Alta") return "Fora: sem edge mesmo com boa amostra.";
    if (sampleLabel === "Média") return "Fora: sinal instável.";
    return "Fora: amostra fraca.";
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
          <Chip active={activeTab === "jogador"} onClick={() => setActiveTab("jogador")}>Aba: Base por Jogador <InfoHint text="Use esta aba para carregar jogos avulsos de UM jogador sem alterar a base principal.\nExemplo: você tem jogos recentes do BOOM e quer testar só no H2H antes de importar no dataset oficial." /></Chip>
          <Badge>Base extra: {extraMatches.length} jogos <InfoHint text="Quantidade de jogos extras usados apenas na tela H2H.\nExemplo: se mostrar 25, esses 25 entram no confronto direto e não mudam dashboard/import principal." /></Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Select value={playerA} onChange={(e) => setPlayerA(e.target.value)} aria-label="Jogador A">
              <option value="">Jogador A</option>
              {nickOptions.map((nick) => <option key={`a-${nick}`} value={nick}>{nick}</option>)}
            </Select>
            <InfoHint text="Primeiro jogador do confronto.\nExemplo: BOOM." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Select value={playerB} onChange={(e) => setPlayerB(e.target.value)} aria-label="Jogador B">
              <option value="">Jogador B</option>
              {nickOptions.map((nick) => <option key={`b-${nick}`} value={nick}>{nick}</option>)}
            </Select>
            <InfoHint text="Segundo jogador do confronto.\nExemplo: FROST." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input className="select" placeholder="Time do Jogador A (opcional)" value={teamA} onChange={(e) => setTeamA(e.target.value)} />
            <InfoHint text="Filtra o Jogador A por time.\nExemplo: Real Madrid.\nSe deixar vazio, considera todos os times." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input className="select" placeholder="Time do Jogador B (opcional)" value={teamB} onChange={(e) => setTeamB(e.target.value)} />
            <InfoHint text="Filtra o Jogador B por time.\nExemplo: Man City.\nSe deixar vazio, considera todos os times." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Select value={String(line)} onChange={(e) => setLine(Number(e.target.value))} aria-label="Linha Over/Under">
              {lines.map((value) => <option key={value} value={value}>Linha OU {value}</option>)}
            </Select>
            <InfoHint text="Linha de decisão Over/Under usada nas leituras rápidas.\nFaixa: 1.5 a 7.5.\nExemplo: Over 3.5 = total de gols maior que 3." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Select value={lastN} onChange={(e) => setLastN(e.target.value as (typeof lastNOptions)[number])} aria-label="Últimos N confrontos">
              {lastNOptions.map((item) => <option key={item} value={item}>{item === "all" ? "H2H: Tudo" : `H2H: últimos ${item}`}</option>)}
            </Select>
            <InfoHint text="Janela de confrontos diretos usada no cálculo.\nExemplo: últimos 10 pega os 10 jogos mais recentes entre os dois." />
          </div>
          <Button onClick={exportH2hCsv}>⬇️ CSV H2H</Button>
        </div>
      </Card>

      {activeTab === "jogador" ? (
        <Card className="col-12">
          <CardHeader>
            <div>
              <h3 style={{ margin: 0 }}>Base extra por jogador <InfoHint text="Você cola partidas e o sistema importa apenas as que envolvem o nick informado.\nEsses jogos são usados só aqui no H2H e não entram no dashboard principal." /></h3>
              <small>Importa jogos só para o Confronto Direto sem alterar a base principal.</small>
            </div>
          </CardHeader>
          <CardBody>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input className="select" placeholder="Nick do jogador (obrigatório)" value={uploadPlayer} onChange={(e) => setUploadPlayer(e.target.value)} />
                <InfoHint text="Nick que será usado para filtrar os jogos importados.\nExemplo: BOOM." />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input className="select" placeholder="Liga" value={uploadLeague} onChange={(e) => setUploadLeague(e.target.value)} />
                <InfoHint text="Nome da liga salvo nesses jogos extras.\nExemplo: eSoccer Battle 8 mins." />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input className="select" placeholder="Ano base" value={uploadYear} onChange={(e) => setUploadYear(e.target.value)} />
                <InfoHint text="Ano usado quando a data do texto não vem com ano.\nExemplo: 2026 para linha '02/18 01:16'." />
              </div>
            </div>
            <textarea
              className="select"
              rows={12}
              style={{ width: "100%", resize: "vertical" }}
              placeholder="Cole as linhas de jogos do site. Ex: 02/18 01:16  Real Madrid (BOOM) v Man City (FROST)  2-1"
              value={uploadText}
              onChange={(e) => setUploadText(e.target.value)}
            />
            <div className="mini" style={{ marginTop: 8 }}>
              Exemplo válido: 02/18 01:16 Real Madrid (BOOM) v Man City (FROST) 2-1
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              <Button variant="primary" onClick={importPlayerOnlyMatches}>Importar jogos do jogador <InfoHint text="Importa somente jogos em que o nick informado aparece como mandante ou visitante.\nLinhas inválidas são descartadas automaticamente." /></Button>
              <Button onClick={clearExtraMatches}>Limpar base extra</Button>
            </div>
            {uploadMessage && <p className="mini" style={{ marginTop: 10 }}>{uploadMessage}</p>}
          </CardBody>
        </Card>
      ) : activeTab === "excel" ? (
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
          <Card className="col-3 stat"><div className="statTop"><Badge>H2H</Badge></div><div className="kpi">{h2hWindow.length}</div><div className="kpiSub">Jogos na janela</div></Card>
          <Card className="col-3 stat"><div className="statTop"><Badge>{playerA}</Badge></div><div className="kpi">{analysis.winsA}</div><div className="kpiSub">Vitórias no H2H</div></Card>
          <Card className="col-3 stat"><div className="statTop"><Badge>{playerB}</Badge></div><div className="kpi">{analysis.winsB}</div><div className="kpiSub">Vitórias no H2H</div></Card>
          <Card className="col-3 stat"><div className="statTop"><Badge>Empates</Badge></div><div className="kpi">{analysis.draws}</div><div className="kpiSub">No confronto direto</div></Card>

          <Card className="col-12">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Dica direta <InfoHint text="Resumo objetivo para ação: entrar, cautela ou ficar fora.\nExemplo de saída: 'Tendência direta: Over 3.5'." /></h3>
                <small>Fala objetiva para decisão rápida</small>
              </div>
              <Badge tone={h2hScore.level === "favoravel" ? "good" : h2hScore.level === "cautela" ? "warn" : "bad"}>{h2hScore.level}</Badge>
            </CardHeader>
            <CardBody>
              <div className="chips" style={{ marginBottom: 10 }}>
                <Badge tone={h2hScore.score >= 70 ? "good" : h2hScore.score >= 50 ? "warn" : "bad"}>Score {h2hScore.score}/100</Badge>
                <Badge>Confiança {sampleLabel}</Badge>
                <Badge>{h2hScore.edgeFor === "A" ? `Vantagem ${playerA}` : h2hScore.edgeFor === "B" ? `Vantagem ${playerB}` : "Sem vantagem clara"}</Badge>
              </div>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 700 }}>{quickTip}</p>
              <p className="mini" style={{ margin: 0 }}>{recommendation}</p>
            </CardBody>
          </Card>

          <Card className="col-8">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Mapa Over / Under <InfoHint text="Mostra taxa de acerto por linha de 1.5 até 7.5.\nAcima de 7.5 aparece como 'Maiores'.\nAté 1.5 aparece como 'Menores'." /></h3>
                <small>Faixas de 1.5 até 7.5 e extremos fora da faixa</small>
              </div>
            </CardHeader>
            <CardBody>
              <Table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th className="right">Over</th>
                    <th className="right">Under</th>
                  </tr>
                </thead>
                <tbody>
                  {overUnderMatrix.byLine.map((item) => (
                    <tr key={item.line}>
                      <td>{item.line}</td>
                      <td className="right">{(item.overRate * 100).toFixed(1)}%</td>
                      <td className="right">{(item.underRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr>
                    <td><b>Maiores (&gt; 7.5)</b></td>
                    <td className="right"><b>{(overUnderMatrix.maioresRate * 100).toFixed(1)}%</b></td>
                    <td className="right">-</td>
                  </tr>
                  <tr>
                    <td><b>Menores (≤ 1.5)</b></td>
                    <td className="right">-</td>
                    <td className="right"><b>{(overUnderMatrix.menoresRate * 100).toFixed(1)}%</b></td>
                  </tr>
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card className="col-4">
            <CardHeader><div><h3 style={{ margin: 0 }}>Comparativo vs campo <InfoHint text="Compara desempenho de cada jogador contra outros adversários (fora do H2H direto).\nExemplo: PPG 2.10 vs 1.20 indica vantagem clara de forma." /></h3><small>Forma fora do confronto direto</small></div></CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>{playerA} PPG</span><b>{analysis.statsA?.ppg.toFixed(2) ?? "0.00"}</b></div>
                <div className="row"><span>{playerB} PPG</span><b>{analysis.statsB?.ppg.toFixed(2) ?? "0.00"}</b></div>
                <div className="row"><span>{playerA} Over {line}</span><b>{(((analysis.statsA?.overRate ?? 0) * 100)).toFixed(1)}%</b></div>
                <div className="row"><span>{playerB} Over {line}</span><b>{(((analysis.statsB?.overRate ?? 0) * 100)).toFixed(1)}%</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-12">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Top 3 times mais jogados <InfoHint text="Mostra os 3 times em que cada jogador mais atuou no recorte atual.\nCritério principal: quantidade de jogos.\nCritério de desempate: PPG." /></h3>
                <small>Volume de jogos por time (jogador A e B)</small>
              </div>
            </CardHeader>
            <CardBody>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
                <div className="list">
                  <div className="row"><span>Jogador</span><b>{playerA}</b></div>
                  {!teamPerformanceA.topByGames.length ? (
                    <EmptyState title="Sem dados" subtitle="Sem jogos suficientes para montar top 3 do Jogador A." />
                  ) : (
                    teamPerformanceA.topByGames.map((item, index) => (
                      <div className="row" key={`${playerA}-${item.team}`}>
                        <span>{index + 1}. {item.team}</span>
                        <b>{item.games} jogos • PPG {item.ppg.toFixed(2)}</b>
                      </div>
                    ))
                  )}
                </div>

                <div className="list">
                  <div className="row"><span>Jogador</span><b>{playerB}</b></div>
                  {!teamPerformanceB.topByGames.length ? (
                    <EmptyState title="Sem dados" subtitle="Sem jogos suficientes para montar top 3 do Jogador B." />
                  ) : (
                    teamPerformanceB.topByGames.map((item, index) => (
                      <div className="row" key={`${playerB}-${item.team}`}>
                        <span>{index + 1}. {item.team}</span>
                        <b>{item.games} jogos • PPG {item.ppg.toFixed(2)}</b>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Mercados extras (gols)</h3>
                <small>BTTS, Team Goals e Faixas de gols</small>
              </div>
            </CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>BTTS Sim</span><b>{(extraMarkets.bttsYesRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>BTTS Não</span><b>{(extraMarkets.bttsNoRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Casa over 0.5 gol</span><b>{(extraMarkets.homeOver05Rate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Casa over 1.5 gol</span><b>{(extraMarkets.homeOver15Rate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Fora over 0.5 gol</span><b>{(extraMarkets.awayOver05Rate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Fora over 1.5 gol</span><b>{(extraMarkets.awayOver15Rate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Faixa 0-2 gols</span><b>{(extraMarkets.goalsRange0to2Rate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Faixa 3-4 gols</span><b>{(extraMarkets.goalsRange3to4Rate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>Faixa 5+ gols</span><b>{(extraMarkets.goalsRange5PlusRate * 100).toFixed(1)}%</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Mercados extras (resultado)</h3>
                <small>Dupla Chance e Draw No Bet</small>
              </div>
            </CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>1X (casa ou empate)</span><b>{(extraMarkets.oneXRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>X2 (fora ou empate)</span><b>{(extraMarkets.xTwoRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>12 (sem empate)</span><b>{(extraMarkets.oneTwoRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>DNB Casa (sem empates)</span><b>{(extraMarkets.dnbHomeRate * 100).toFixed(1)}%</b></div>
                <div className="row"><span>DNB Fora (sem empates)</span><b>{(extraMarkets.dnbAwayRate * 100).toFixed(1)}%</b></div>
              </div>
            </CardBody>
          </Card>

          <Card className="col-12">
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Common Opponents</h3><InfoHint text="Compara os dois jogadores contra os mesmos adversários.\nExemplo: BOOM 2.1 PPG vs FROST 1.4 PPG contra o mesmo oponente = vantagem BOOM." /></div><small>Comparação dos dois contra os mesmos adversários</small></div><Badge>{analysis.commonRows.length} oponentes em comum</Badge></CardHeader>
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
            <CardHeader><div><div className="chips" style={{ gap: 8, marginBottom: 4 }}><h3 style={{ margin: 0 }}>Histórico entre os dois jogadores</h3><InfoHint text="Lista dos confrontos diretos na janela atual.\nColuna 'Leitura OU' usa Over/Under da linha selecionada e marca 'Maiores/Menores' fora da faixa." /></div><small>Confrontos diretos recentes (janela ativa)</small></div></CardHeader>
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
                      <th className="right">Leitura OU</th>
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
                          <td className="right"><Badge tone={total > line ? "good" : "warn"}>{getOuOutcomeLabel(total)}</Badge></td>
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
