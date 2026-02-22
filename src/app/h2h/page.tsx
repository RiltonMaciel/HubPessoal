"use client";

import * as XLSX from "xlsx";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { applyAliasesToMatches, getAliasMap } from "@/lib/aliases";
import { decideRecommendation } from "@/lib/decision";
import { parseRawTextMatches } from "@/lib/excel";
import { logPrediction, resolvePendingPredictions } from "@/lib/prediction-ledger";
import type { MatchRecord } from "@/lib/types";
import { formatDateTimePtBr, toDateTimestamp, toIsoDateTime } from "@/lib/datetime";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoHint } from "@/components/ui/InfoHint";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Select } from "@/components/ui/Select";
import { Table } from "@/components/ui/Table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAppStore } from "@/store/appStore";
import { buildDerivedSignalIndex, computeDerivedSignals, summarizeTeamAffinity } from "@/lib/derived-signals";
import { inferMostRecentTeam, lastMatchesWithTeam } from "@/lib/team-history";

const lines = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const lastNOptions = ["5", "10", "20", "all"] as const;
const recencyFactor = 0.9;
const LOCAL_EXTRA_KEY = "hubpessoal-h2h-extra-matches-v1";
const H2H_LAST_SEARCH_KEY = "hubpessoal-h2h-last-search-v1";
const H2H_RECENT_SEARCHES_KEY = "hubpessoal-h2h-recent-searches-v1";
const H2H_PAGE_SIZE = 30;
type H2hTab = "analise" | "excel" | "jogador";

type H2hSearchSnapshot = {
  playerA: string;
  playerB: string;
  teamA: string;
  teamB: string;
  line: number;
  lastN: (typeof lastNOptions)[number];
  activeTab: H2hTab;
  savedAt: string;
};

function normalizeSearchPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSearchId(snapshot: Pick<H2hSearchSnapshot, "playerA" | "playerB" | "teamA" | "teamB" | "line" | "lastN">) {
  const a = normalizeSearchPart(snapshot.playerA);
  const b = normalizeSearchPart(snapshot.playerB);
  const pair = a < b ? `${a}__vs__${b}` : `${b}__vs__${a}`;
  const ta = normalizeSearchPart(snapshot.teamA || "");
  const tb = normalizeSearchPart(snapshot.teamB || "");
  return `${pair}__tA:${ta}__tB:${tb}__ou:${snapshot.line}__n:${snapshot.lastN}`;
}

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
  const dataRevision = useAppStore((state) => state.dataRevision);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [extraMatches, setExtraMatches] = useState<MatchRecord[]>([]);
  const [datasetVersion, setDatasetVersion] = useState<string | null>(null);
  const [aliasMap, setAliasMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [line, setLine] = useState(3.5);
  const [lastN, setLastN] = useState<(typeof lastNOptions)[number]>("10");
  const [h2hPage, setH2hPage] = useState(1);
  const [activeTab, setActiveTab] = useState<H2hTab>("analise");
  const [uploadPlayer, setUploadPlayer] = useState("");
  const [uploadLeague, setUploadLeague] = useState("H2H-Extra");
  const [uploadYear, setUploadYear] = useState(String(new Date().getFullYear()));
  const [uploadText, setUploadText] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const debouncedTeamA = useDebouncedValue(teamA, 250);
  const debouncedTeamB = useDebouncedValue(teamB, 250);
  const [searchStorageReady, setSearchStorageReady] = useState(false);
  const [recentSearches, setRecentSearches] = useState<Array<H2hSearchSnapshot & { id: string }>>([]);

  useEffect(() => {
    // Carrega último confronto e histórico de pesquisas.
    try {
      const rawLast = window.localStorage.getItem(H2H_LAST_SEARCH_KEY);
      if (rawLast) {
        const parsed = JSON.parse(rawLast) as Partial<H2hSearchSnapshot>;
        if (typeof parsed.playerA === "string") setPlayerA(parsed.playerA);
        if (typeof parsed.playerB === "string") setPlayerB(parsed.playerB);
        if (typeof parsed.teamA === "string") setTeamA(parsed.teamA);
        if (typeof parsed.teamB === "string") setTeamB(parsed.teamB);
        if (typeof parsed.line === "number" && Number.isFinite(parsed.line)) setLine(parsed.line);
        if (typeof parsed.lastN === "string" && (lastNOptions as readonly string[]).includes(parsed.lastN)) {
          setLastN(parsed.lastN as (typeof lastNOptions)[number]);
        }
        if (typeof parsed.activeTab === "string") {
          const safeTab = parsed.activeTab as H2hTab;
          if (safeTab === "analise" || safeTab === "excel" || safeTab === "jogador") setActiveTab(safeTab);
        }
      }

      const rawRecent = window.localStorage.getItem(H2H_RECENT_SEARCHES_KEY);
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent) as Array<Partial<H2hSearchSnapshot> & { id?: string }>;
        if (Array.isArray(parsed)) {
          const safe = parsed
            .filter((item) => item && typeof item.playerA === "string" && typeof item.playerB === "string")
            .map((item) => {
              const normalized: H2hSearchSnapshot = {
                playerA: String(item.playerA ?? ""),
                playerB: String(item.playerB ?? ""),
                teamA: String(item.teamA ?? ""),
                teamB: String(item.teamB ?? ""),
                line: typeof item.line === "number" && Number.isFinite(item.line) ? item.line : 3.5,
                lastN: (lastNOptions as readonly string[]).includes(String(item.lastN))
                  ? (String(item.lastN) as (typeof lastNOptions)[number])
                  : "10",
                activeTab: item.activeTab === "excel" || item.activeTab === "jogador" ? item.activeTab : "analise",
                savedAt: typeof item.savedAt === "string" ? item.savedAt : new Date().toISOString(),
              };
              return { ...normalized, id: item.id || buildSearchId(normalized) };
            })
            .slice(0, 10);
          setRecentSearches(safe);
        }
      }
    } catch {
      // ignore
    } finally {
      setSearchStorageReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      try {
        const [rows, rawDataset, aliases] = await Promise.all([
          db.matches.toArray(),
          db.rawDatasets.get("latest"),
          getAliasMap(),
        ]);

        if (cancelled) return;
        setMatches(rows);
        setDatasetVersion(rawDataset?.datasetVersion ?? null);
        setAliasMap(aliases);
        await resolvePendingPredictions();

        if (cancelled) return;

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
      } catch (error) {
        console.error("[h2h] falha ao carregar base local", error);
        if (cancelled) return;
        setMatches([]);
        setExtraMatches([]);
        setDatasetVersion(null);
        setAliasMap(new Map());
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataRevision]);

  useEffect(() => {
    if (!searchStorageReady) return;
    const snapshot: H2hSearchSnapshot = {
      playerA,
      playerB,
      teamA,
      teamB,
      line,
      lastN,
      activeTab,
      savedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(H2H_LAST_SEARCH_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }, [playerA, playerB, teamA, teamB, line, lastN, activeTab, searchStorageReady]);

  const allMatches = useMemo(() => {
    const dedupe = new Set<string>();
    const merged: MatchRecord[] = [];
    [...applyAliasesToMatches(matches, aliasMap), ...applyAliasesToMatches(extraMatches, aliasMap)].forEach((item) => {
      const key = buildMatchFingerprint(item);
      if (dedupe.has(key)) return;
      dedupe.add(key);
      merged.push(item);
    });
    return merged;
  }, [matches, extraMatches, aliasMap]);

  const derivedIndex = useMemo(() => buildDerivedSignalIndex(allMatches), [allMatches]);

  const contextEnabled = useMemo(() => {
    const a = playerA.trim();
    const b = playerB.trim();
    return Boolean(a && b && a.toLowerCase() !== b.toLowerCase());
  }, [playerA, playerB]);

  useEffect(() => {
    // Salva automaticamente o confronto no histórico quando houver dois jogadores.
    if (!searchStorageReady) return;
    if (!contextEnabled) return;

    const snapshot: H2hSearchSnapshot = {
      playerA,
      playerB,
      teamA,
      teamB,
      line,
      lastN,
      activeTab: "analise",
      savedAt: new Date().toISOString(),
    };
    const id = buildSearchId(snapshot);

    setRecentSearches((prev) => {
      const next = [{ ...snapshot, id }, ...prev.filter((item) => item.id !== id)].slice(0, 10);
      try {
        window.localStorage.setItem(H2H_RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [contextEnabled, playerA, playerB, teamA, teamB, line, lastN, searchStorageReady]);

  const contextSignals = useMemo(() => {
    if (!contextEnabled) return null;
    const nowIso = new Date().toISOString();
    return computeDerivedSignals({
      match: {
        dateTime: nowIso,
        league: "all",
        homeNick: playerA,
        awayNick: playerB,
        homeTeam: teamA || "(qualquer)",
        awayTeam: teamB || "(qualquer)",
      },
      index: derivedIndex,
      ouLine: line,
      sessionGapMinutes: 45,
      validateLeague: true,
    });
  }, [contextEnabled, derivedIndex, line, playerA, playerB, teamA, teamB]);

  const playerAHistory = useMemo(() => {
    if (!contextEnabled) return [];
    const a = playerA.toLowerCase();
    return allMatches
      .filter((m) => m.homeNick.toLowerCase() === a || m.awayNick.toLowerCase() === a)
      .filter((m) => !teamA || m.homeTeam === teamA || m.awayTeam === teamA)
      .sort((x, y) => +new Date(x.dateTime) - +new Date(y.dateTime));
  }, [contextEnabled, allMatches, playerA, teamA]);

  const playerBHistory = useMemo(() => {
    if (!contextEnabled) return [];
    const b = playerB.toLowerCase();
    return allMatches
      .filter((m) => m.homeNick.toLowerCase() === b || m.awayNick.toLowerCase() === b)
      .filter((m) => !teamB || m.homeTeam === teamB || m.awayTeam === teamB)
      .sort((x, y) => +new Date(x.dateTime) - +new Date(y.dateTime));
  }, [contextEnabled, allMatches, playerB, teamB]);

  const topTeamsA = useMemo(() => summarizeTeamAffinity({ nick: playerA, history: playerAHistory, ouLine: line, minGamesPerTeam: 4, topN: 3 }), [playerA, playerAHistory, line]);
  const topTeamsB = useMemo(() => summarizeTeamAffinity({ nick: playerB, history: playerBHistory, ouLine: line, minGamesPerTeam: 4, topN: 3 }), [playerB, playerBHistory, line]);

  const teamLabelA = useMemo(() => {
    if (!contextEnabled) return null;
    const raw = teamA.trim();
    return raw ? raw : inferMostRecentTeam(allMatches, playerA);
  }, [contextEnabled, teamA, allMatches, playerA]);

  const teamLabelB = useMemo(() => {
    if (!contextEnabled) return null;
    const raw = teamB.trim();
    return raw ? raw : inferMostRecentTeam(allMatches, playerB);
  }, [contextEnabled, teamB, allMatches, playerB]);

  const lastSameTeamA = useMemo(() => {
    if (!contextEnabled || !teamLabelA) return [] as MatchRecord[];
    return lastMatchesWithTeam(allMatches, playerA, teamLabelA, 5);
  }, [contextEnabled, allMatches, playerA, teamLabelA]);

  const lastSameTeamB = useMemo(() => {
    if (!contextEnabled || !teamLabelB) return [] as MatchRecord[];
    return lastMatchesWithTeam(allMatches, playerB, teamLabelB, 5);
  }, [contextEnabled, allMatches, playerB, teamLabelB]);

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
        if (!playerMatchesTeam(m, playerA, debouncedTeamA)) return false;
        if (!playerMatchesTeam(m, playerB, debouncedTeamB)) return false;
        return true;
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    const otherA = matchesA
      .filter((m) => {
        return !setB.has(m) && playerMatchesTeam(m, playerA, debouncedTeamA);
      })
      .sort((x, y) => toDateTimestamp(y.dateTime) - toDateTimestamp(x.dateTime));

    const otherB = matchesB
      .filter((m) => {
        return !setA.has(m) && playerMatchesTeam(m, playerB, debouncedTeamB);
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

    const mapA = aggregateAgainstOpponents(matchesA, playerA, playerB, debouncedTeamA);
    const mapB = aggregateAgainstOpponents(matchesB, playerB, playerA, debouncedTeamB);

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
  }, [nickIndex, playerA, playerB, debouncedTeamA, debouncedTeamB, line]);

  const h2hWindow = useMemo(() => {
    if (!analysis.valid) return [] as MatchRecord[];
    if (lastN === "all") return analysis.h2hMatches;
    return analysis.h2hMatches.slice(0, Number(lastN));
  }, [analysis, lastN]);

  useEffect(() => {
    setH2hPage(1);
  }, [playerA, playerB, debouncedTeamA, debouncedTeamB, lastN]);

  const h2hTotalPages = useMemo(
    () => Math.max(1, Math.ceil(h2hWindow.length / H2H_PAGE_SIZE)),
    [h2hWindow.length]
  );

  const h2hVisibleRows = useMemo(() => {
    const start = (h2hPage - 1) * H2H_PAGE_SIZE;
    return h2hWindow.slice(start, start + H2H_PAGE_SIZE);
  }, [h2hWindow, h2hPage]);

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
    () => buildTeamPerformance(nickIndex.get(normalize(playerA)) ?? [], playerA, debouncedTeamA),
    [nickIndex, playerA, debouncedTeamA]
  );

  const teamPerformanceB = useMemo(
    () => buildTeamPerformance(nickIndex.get(normalize(playerB)) ?? [], playerB, debouncedTeamB),
    [nickIndex, playerB, debouncedTeamB]
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

  const h2hDecision = useMemo(() => {
    const confidenceSample = h2hWindow.length + analysis.commonRows.length;
    const reliability = confidenceSample >= 12 ? 90 : confidenceSample >= 7 ? 70 : 45;
    return decideRecommendation({
      mode: "conservador",
      signal: h2hScore.edgeFor === "equilibrado" ? "neutro" : "over",
      score: h2hScore.score,
      effectiveGames: confidenceSample,
      minGamesConfidence: 8,
      intervalWidth: h2hTotals.overInterval.high - h2hTotals.overInterval.low,
      driftLevel: "estavel",
      edgeVsNeutral: Math.abs((h2hTotals.overRate ?? 0) - 0.5),
      adaptiveEdgeThreshold: 0.06,
      probabilityRaw: h2hTotals.overRate,
      probabilityCalibrated: h2hTotals.weightedOverRate,
      antiFalseSignalPassed: h2hScore.level !== "evitar",
      reliabilityScore: reliability,
      isCollectReliable: reliability >= 70,
    });
  }, [h2hWindow.length, analysis.commonRows.length, h2hScore, h2hTotals]);

  useEffect(() => {
    if (!datasetVersion || !h2hWindow.length || !analysis.valid) return;
    const target = h2hWindow[0];
    if (!target) return;

    void logPrediction({
      datasetVersion,
      modelVersion: "model:v1",
      presetId: `h2h:${playerA}:${playerB}`,
      routeContext: "h2h",
      match: target,
      market: `ou${line}`,
      pRaw: h2hTotals.overRate,
      pCalibrated: h2hTotals.weightedOverRate,
      decision: h2hDecision.recommendation,
      confidence: h2hDecision.confidence,
      reasons: [...h2hScore.reasons, ...h2hDecision.reasons],
      contraReasons: h2hDecision.contrarianReasons,
      inputSnapshot: { playerA, playerB, teamA, teamB, line, lastN },
      reliabilityScore: 80,
      isCollectReliable: true,
    });
  }, [datasetVersion, h2hWindow, analysis.valid, playerA, playerB, line, lastN, teamA, teamB, h2hTotals, h2hDecision, h2hScore.reasons]);

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

        {recentSearches.length ? (
          <div className="chips" style={{ marginTop: 10, marginBottom: 6, alignItems: "center" }}>
            <strong style={{ fontSize: 12, opacity: 0.9 }}>Histórico:</strong>
            {recentSearches.slice(0, 6).map((item) => (
              <Chip
                key={item.id}
                active={normalizeSearchPart(playerA) === normalizeSearchPart(item.playerA) && normalizeSearchPart(playerB) === normalizeSearchPart(item.playerB)}
                onClick={() => {
                  setPlayerA(item.playerA);
                  setPlayerB(item.playerB);
                  setTeamA(item.teamA);
                  setTeamB(item.teamB);
                  setLine(item.line);
                  setLastN(item.lastN);
                  setActiveTab("analise");
                }}
              >
                {item.playerA} vs {item.playerB} • OU {item.line} • {item.lastN === "all" ? "Tudo" : `N${item.lastN}`}
              </Chip>
            ))}
            <Button
              onClick={() => {
                setRecentSearches([]);
                try {
                  window.localStorage.removeItem(H2H_RECENT_SEARCHES_KEY);
                } catch {
                  // ignore
                }
              }}
            >
              Limpar histórico
            </Button>
          </div>
        ) : null}
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

          <Card className="col-6">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Últimos 5 com o mesmo time ({playerA})</h3>
                <small>
                  {teamLabelA ? `Time: ${teamLabelA}${teamA.trim() ? " (filtro)" : " (inferido)"}` : "Time não identificado"}
                </small>
              </div>
            </CardHeader>
            <CardBody>
              {!teamLabelA || !lastSameTeamA.length ? (
                <EmptyState title="Sem dados" subtitle="Não há jogos suficientes desse nick com o time atual." />
              ) : (
                <div className="list">
                  {lastSameTeamA.map((m) => (
                    <div key={m.id} className="row">
                      <div className="left">
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <PlayerAvatar nick={m.homeNick} size={24} radius={10} />
                          <PlayerAvatar nick={m.awayNick} size={24} radius={10} />
                        </div>
                        <div className="nick">
                          <b>{m.homeNick} {m.homeGoals} x {m.awayGoals} {m.awayNick}</b>
                          <small>{formatDateTimePtBr(m.dateTime)} • {m.homeNick.toLowerCase() === playerA.toLowerCase() ? m.homeTeam : m.awayTeam}</small>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="col-6">
            <CardHeader>
              <div>
                <h3 style={{ margin: 0 }}>Últimos 5 com o mesmo time ({playerB})</h3>
                <small>
                  {teamLabelB ? `Time: ${teamLabelB}${teamB.trim() ? " (filtro)" : " (inferido)"}` : "Time não identificado"}
                </small>
              </div>
            </CardHeader>
            <CardBody>
              {!teamLabelB || !lastSameTeamB.length ? (
                <EmptyState title="Sem dados" subtitle="Não há jogos suficientes desse nick com o time atual." />
              ) : (
                <div className="list">
                  {lastSameTeamB.map((m) => (
                    <div key={m.id} className="row">
                      <div className="left">
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <PlayerAvatar nick={m.homeNick} size={24} radius={10} />
                          <PlayerAvatar nick={m.awayNick} size={24} radius={10} />
                        </div>
                        <div className="nick">
                          <b>{m.homeNick} {m.homeGoals} x {m.awayGoals} {m.awayNick}</b>
                          <small>{formatDateTimePtBr(m.dateTime)} • {m.homeNick.toLowerCase() === playerB.toLowerCase() ? m.homeTeam : m.awayTeam}</small>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {contextSignals ? (
            <Card className="col-12">
              <CardHeader>
                <div>
                  <h3 style={{ margin: 0 }}>Sinais Contextuais <InfoHint text="Sinais derivados calculados com anti-leak (somente histórico ANTERIOR ao 'agora').\n\nEles modulam confiança e explicam contexto — não substituem o score H2H principal." /></h3>
                  <small>Revenge • Tilt • Sessão • Estilo • Afinidade por time</small>
                </div>
              </CardHeader>
              <CardBody>
                <div className="chips" style={{ marginBottom: 10 }}>
                  <Badge>
                    Revenge {playerA}→{playerB}: {contextSignals.revenge.homeRevengeIndex}
                    <InfoHint text="Derrotas seguidas do jogador contra o mesmo oponente (0..5)." />
                  </Badge>
                  <Badge>
                    Revenge {playerB}→{playerA}: {contextSignals.revenge.awayRevengeIndex}
                    <InfoHint text="Mesma métrica do lado oposto." />
                  </Badge>
                  <Badge>
                    H2H jogos: {contextSignals.revenge.h2hGames}
                    <InfoHint text="Quantidade total de confrontos diretos históricos entre os dois nicks (antes de agora)." />
                  </Badge>
                  {contextSignals.revenge.validation ? (
                    <Badge tone={contextSignals.revenge.validation.status === "ok" ? "good" : "warn"}>
                      Validação revenge: {contextSignals.revenge.validation.status} (n={contextSignals.revenge.validation.sampleSize})
                    </Badge>
                  ) : null}
                  <Badge tone={contextSignals.tilt.home.tiltScore > 0 ? "good" : contextSignals.tilt.home.tiltScore < 0 ? "bad" : "warn"}>
                    Tilt {playerA}: {contextSignals.tilt.home.tiltScore}
                    <InfoHint text={`Últimos 5: winrate ${(contextSignals.tilt.home.winRateLast5 * 100).toFixed(0)}% • saldo ${contextSignals.tilt.home.goalDiffLast5} • sofridos(3) ${contextSignals.tilt.home.concededLast3}`} />
                  </Badge>
                  <Badge tone={contextSignals.tilt.away.tiltScore > 0 ? "good" : contextSignals.tilt.away.tiltScore < 0 ? "bad" : "warn"}>
                    Tilt {playerB}: {contextSignals.tilt.away.tiltScore}
                    <InfoHint text={`Últimos 5: winrate ${(contextSignals.tilt.away.winRateLast5 * 100).toFixed(0)}% • saldo ${contextSignals.tilt.away.goalDiffLast5} • sofridos(3) ${contextSignals.tilt.away.concededLast3}`} />
                  </Badge>
                  <Badge>
                    Estilo: pace {contextSignals.style.pace.toFixed(2)} • frag {contextSignals.style.fragility.toFixed(2)} • vol {contextSignals.style.volatility.toFixed(2)}
                  </Badge>
                  <Badge tone={contextSignals.session.home.lowSample ? "warn" : "good"}>
                    Sessão {playerA}: n={contextSignals.session.home.sessionGamesCount} • {(contextSignals.session.home.sessionWinRate * 100).toFixed(0)}% • {contextSignals.session.home.sessionTrend}
                  </Badge>
                  <Badge tone={contextSignals.session.away.lowSample ? "warn" : "good"}>
                    Sessão {playerB}: n={contextSignals.session.away.sessionGamesCount} • {(contextSignals.session.away.sessionWinRate * 100).toFixed(0)}% • {contextSignals.session.away.sessionTrend}
                  </Badge>
                  {contextSignals.drift ? (
                    <Badge tone={contextSignals.drift.level === "estavel" ? "good" : contextSignals.drift.level === "atencao" ? "warn" : "bad"}>
                      Drift(seg): {contextSignals.drift.level}
                    </Badge>
                  ) : null}
                </div>

                <div className="list">
                  <div className="row"><span>Top times {playerA}</span><b>{topTeamsA.length ? topTeamsA.map((t) => `${t.team} (${(t.deltaWin * 100).toFixed(1)}pp, n=${t.games})`).join(" • ") : "Sem times suficientes"}</b></div>
                  <div className="row"><span>Top times {playerB}</span><b>{topTeamsB.length ? topTeamsB.map((t) => `${t.team} (${(t.deltaWin * 100).toFixed(1)}pp, n=${t.games})`).join(" • ") : "Sem times suficientes"}</b></div>
                </div>
              </CardBody>
            </Card>
          ) : null}

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
                <>
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
                      {h2hVisibleRows.map((m) => {
                        const total = m.homeGoals + m.awayGoals;
                        return (
                          <tr key={m.id}>
                            <td>{formatDateTimePtBr(m.dateTime)}</td>
                            <td>{m.league}</td>
                            <td><div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><PlayerAvatar nick={m.homeNick} size={24} radius={10} /><span>{m.homeNick} ({m.homeTeam})</span></div></td>
                            <td><div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><PlayerAvatar nick={m.awayNick} size={24} radius={10} /><span>{m.awayNick} ({m.awayTeam})</span></div></td>
                            <td className="right">
                              <Link
                                href={`/h2h/match/${encodeURIComponent(m.id)}`}
                                style={{ textDecoration: "underline" }}
                                aria-label={`Abrir detalhes: ${m.homeNick} ${m.homeGoals}-${m.awayGoals} ${m.awayNick}`}
                              >
                                {m.homeGoals}–{m.awayGoals}
                              </Link>
                            </td>
                            <td className="right">{total}</td>
                            <td className="right"><Badge tone={total > line ? "good" : "warn"}>{getOuOutcomeLabel(total)}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                  {h2hWindow.length > H2H_PAGE_SIZE && (
                    <div className="chips" style={{ marginTop: 10 }}>
                      <Button onClick={() => setH2hPage((prev) => Math.max(1, prev - 1))} disabled={h2hPage <= 1}>← Anterior</Button>
                      <Badge>Página {h2hPage} de {h2hTotalPages}</Badge>
                      <Button onClick={() => setH2hPage((prev) => Math.min(h2hTotalPages, prev + 1))} disabled={h2hPage >= h2hTotalPages}>Próxima →</Button>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </section>
  );
}
