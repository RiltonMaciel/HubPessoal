import type { MatchRecord, UpcomingRecord } from "@/lib/types";

export type DerivedSignalsMatchLike = Pick<MatchRecord, "dateTime" | "league" | "homeNick" | "awayNick" | "homeTeam" | "awayTeam"> | Pick<UpcomingRecord, "dateTime" | "league" | "homeNick" | "awayNick" | "homeTeam" | "awayTeam">;

type Side = "home" | "away";

type ValidationStatus = "ok" | "insuficiente";

export type ValidationReport = {
  status: ValidationStatus;
  sampleSize: number;
  baselineWinRate: number;
  conditionalWinRate: number;
  uplift: number;
};

export type RevengeSignal = {
  h2hGames: number;
  homeLossStreakVsAway: number;
  awayLossStreakVsHome: number;
  homeRevengeIndex: number;
  awayRevengeIndex: number;
  validation?: ValidationReport;
};

export type TiltSide = {
  games: number;
  winRateLast5: number;
  goalDiffLast5: number;
  concededLast3: number;
  winStreak: number;
  lossStreak: number;
  tiltScore: -1 | 0 | 1;
  validation?: ValidationReport;
};

export type TiltSignal = {
  home: TiltSide;
  away: TiltSide;
};

export type StyleSide = {
  games: number;
  avgTotalGoals: number;
  avgConceded: number;
  stdTotalGoals: number;
};

export type StyleMismatchSignal = {
  home: StyleSide;
  away: StyleSide;
  pace: number;
  fragility: number;
  volatility: number;
};

export type TeamAffinitySide = {
  team: string;
  gamesTeam: number;
  gamesAll: number;
  winRateTeam: number;
  winRateAll: number;
  shrunkWinRateTeam: number;
  shrunkWinRateAll: number;
  deltaWin: number;
  ouLine?: number;
  ouRateTeam?: number;
  ouRateAll?: number;
  shrunkOuRateTeam?: number;
  shrunkOuRateAll?: number;
  deltaOU?: number;
  lowSample: boolean;
};

export type TeamAffinitySignal = {
  home: TeamAffinitySide;
  away: TeamAffinitySide;
};

export type SessionSide = {
  sessionGamesCount: number;
  sessionWinRate: number;
  sessionAvgTotalGoals: number;
  sessionTrend: "melhorando" | "piorando" | "estavel";
  lowSample: boolean;
};

export type SessionFormSignal = {
  home: SessionSide;
  away: SessionSide;
};

export type SegmentDrift = {
  recentWindow: number;
  previousWindow: number;
  deltaAvgGoals: number;
  deltaOver: number;
  level: "estavel" | "atencao" | "critico";
};

export type DerivedSignals = {
  revenge: RevengeSignal;
  tilt: TiltSignal;
  style: StyleMismatchSignal;
  teamAffinity: TeamAffinitySignal;
  session: SessionFormSignal;
  drift?: SegmentDrift;
};

type IndexedMatch = MatchRecord & { __ts: number };

export type DerivedSignalIndex = {
  allChrono: IndexedMatch[];
  byLeague: Map<string, IndexedMatch[]>;
  byNick: Map<string, IndexedMatch[]>;
  byPair: Map<string, IndexedMatch[]>;
};

export type TeamAffinityTeamRow = {
  team: string;
  games: number;
  winRate: number;
  shrunkWinRate: number;
  deltaWin: number;
  ouLine?: number;
  ouRate?: number;
  shrunkOuRate?: number;
  deltaOU?: number;
  lowSample: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toTs(iso: string) {
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeNick(value: string) {
  return value.trim().toLowerCase();
}

function pairKey(a: string, b: string) {
  const aa = normalizeNick(a);
  const bb = normalizeNick(b);
  return aa < bb ? `${aa}|${bb}` : `${bb}|${aa}`;
}

function upperBoundByTs(items: IndexedMatch[], ts: number) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (items[mid].__ts <= ts) low = mid + 1;
    else high = mid;
  }
  return low;
}

function sliceBefore(items: IndexedMatch[], iso: string) {
  const ts = toTs(iso);
  const end = upperBoundByTs(items, ts - 1);
  return items.slice(0, end);
}

function takeLast<T>(items: T[], n: number) {
  if (n <= 0) return [];
  return items.slice(Math.max(0, items.length - n));
}

function isWin(match: MatchRecord, nick: string) {
  const n = normalizeNick(nick);
  const home = normalizeNick(match.homeNick);
  const away = normalizeNick(match.awayNick);
  if (n === home) return match.homeGoals > match.awayGoals;
  if (n === away) return match.awayGoals > match.homeGoals;
  return false;
}

function isLoss(match: MatchRecord, nick: string) {
  const n = normalizeNick(nick);
  const home = normalizeNick(match.homeNick);
  const away = normalizeNick(match.awayNick);
  if (n === home) return match.homeGoals < match.awayGoals;
  if (n === away) return match.awayGoals < match.homeGoals;
  return false;
}

function goalsFor(match: MatchRecord, nick: string) {
  const n = normalizeNick(nick);
  if (n === normalizeNick(match.homeNick)) return match.homeGoals;
  if (n === normalizeNick(match.awayNick)) return match.awayGoals;
  return 0;
}

function goalsAgainst(match: MatchRecord, nick: string) {
  const n = normalizeNick(nick);
  if (n === normalizeNick(match.homeNick)) return match.awayGoals;
  if (n === normalizeNick(match.awayNick)) return match.homeGoals;
  return 0;
}

function teamForSide(match: MatchRecord, nick: string) {
  const n = normalizeNick(nick);
  if (n === normalizeNick(match.homeNick)) return match.homeTeam;
  if (n === normalizeNick(match.awayNick)) return match.awayTeam;
  return "";
}

export function buildDerivedSignalIndex(matches: MatchRecord[]): DerivedSignalIndex {
  const allChrono: IndexedMatch[] = matches
    .map((match) => ({ ...match, __ts: toTs(match.dateTime) }))
    .sort((a, b) => a.__ts - b.__ts);

  const byLeague = new Map<string, IndexedMatch[]>();
  const byNick = new Map<string, IndexedMatch[]>();
  const byPair = new Map<string, IndexedMatch[]>();

  const push = (map: Map<string, IndexedMatch[]>, key: string, item: IndexedMatch) => {
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  };

  for (const match of allChrono) {
    push(byLeague, match.league || "all", match);
    push(byNick, normalizeNick(match.homeNick), match);
    push(byNick, normalizeNick(match.awayNick), match);
    push(byPair, pairKey(match.homeNick, match.awayNick), match);
  }

  return { allChrono, byLeague, byNick, byPair };
}

function computeRevenge(match: DerivedSignalsMatchLike, index: DerivedSignalIndex): RevengeSignal {
  const key = pairKey(match.homeNick, match.awayNick);
  const pairMatches = sliceBefore(index.byPair.get(key) ?? [], match.dateTime);

  const lossStreak = (player: string, opponent: string) => {
    const playerN = normalizeNick(player);
    const oppN = normalizeNick(opponent);
    let streak = 0;
    for (let i = pairMatches.length - 1; i >= 0; i -= 1) {
      const item = pairMatches[i];
      const homeN = normalizeNick(item.homeNick);
      const awayN = normalizeNick(item.awayNick);
      const involves = (playerN === homeN && oppN === awayN) || (playerN === awayN && oppN === homeN);
      if (!involves) continue;
      if (isLoss(item, player)) {
        streak += 1;
        continue;
      }
      break;
    }
    return streak;
  };

  const homeLossStreakVsAway = lossStreak(match.homeNick, match.awayNick);
  const awayLossStreakVsHome = lossStreak(match.awayNick, match.homeNick);

  return {
    h2hGames: pairMatches.length,
    homeLossStreakVsAway,
    awayLossStreakVsHome,
    homeRevengeIndex: clamp(homeLossStreakVsAway, 0, 5),
    awayRevengeIndex: clamp(awayLossStreakVsHome, 0, 5),
  };
}

function validateRevengeEffect(leagueHistory: IndexedMatch[]): ValidationReport {
  // Para cada jogador, rastreia streak de derrotas vs oponente ANTES de cada jogo.
  // Usa somente leagueHistory (já é histórico anterior a t) => anti-leak.
  const streak = new Map<string, number>();

  const baseline = { wins: 0, total: 0 };
  const conditional = { wins: 0, total: 0 };

  const streakKey = (player: string, opponent: string) => `${normalizeNick(player)}|${normalizeNick(opponent)}`;

  for (const match of leagueHistory) {
    const home = match.homeNick;
    const away = match.awayNick;

    const homeStreak = streak.get(streakKey(home, away)) ?? 0;
    const awayStreak = streak.get(streakKey(away, home)) ?? 0;

    // Baseline: evento de "jogador ganhar" em uma partida (exclui empates do numerador, mas conta no total)
    baseline.total += 2;
    baseline.wins += isWin(match, home) ? 1 : 0;
    baseline.wins += isWin(match, away) ? 1 : 0;

    if (homeStreak >= 2) {
      conditional.total += 1;
      conditional.wins += isWin(match, home) ? 1 : 0;
    }
    if (awayStreak >= 2) {
      conditional.total += 1;
      conditional.wins += isWin(match, away) ? 1 : 0;
    }

    // Atualiza streaks após o resultado
    if (isLoss(match, home)) {
      streak.set(streakKey(home, away), homeStreak + 1);
    } else {
      streak.set(streakKey(home, away), 0);
    }

    if (isLoss(match, away)) {
      streak.set(streakKey(away, home), awayStreak + 1);
    } else {
      streak.set(streakKey(away, home), 0);
    }
  }

  const baselineWinRate = baseline.total ? baseline.wins / baseline.total : 0;
  const conditionalWinRate = conditional.total ? conditional.wins / conditional.total : 0;
  const uplift = conditionalWinRate - baselineWinRate;

  const sampleSize = conditional.total;
  return {
    status: sampleSize >= 100 ? "ok" : "insuficiente",
    sampleSize,
    baselineWinRate,
    conditionalWinRate,
    uplift,
  };
}

function computeTiltSide(nick: string, history: IndexedMatch[]): TiltSide {
  const last5 = takeLast(history, 5);
  const last3 = takeLast(history, 3);
  const games = last5.length;

  let wins = 0;
  let goalDiff = 0;
  for (const match of last5) {
    if (isWin(match, nick)) wins += 1;
    goalDiff += goalsFor(match, nick) - goalsAgainst(match, nick);
  }

  let concededLast3 = 0;
  for (const match of last3) concededLast3 += goalsAgainst(match, nick);

  // Streaks (considerando toda a história disponível, mas só até antes do match)
  let winStreak = 0;
  let lossStreak = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const match = history[i];
    if (isWin(match, nick)) {
      if (lossStreak > 0) break;
      winStreak += 1;
    } else if (isLoss(match, nick)) {
      if (winStreak > 0) break;
      lossStreak += 1;
    } else {
      break;
    }
  }

  const winRateLast5 = games ? wins / games : 0;

  const onFire = winStreak >= 2 && goalDiff > 0;
  const tilted = lossStreak >= 2 && concededLast3 >= 6;

  const tiltScore: -1 | 0 | 1 = onFire ? 1 : tilted ? -1 : 0;

  return {
    games,
    winRateLast5,
    goalDiffLast5: goalDiff,
    concededLast3,
    winStreak,
    lossStreak,
    tiltScore,
  };
}

export function computeTiltFromHistory(params: { nick: string; history: MatchRecord[]; }): TiltSide {
  const indexed = params.history
    .map((m) => ({ ...m, __ts: toTs(m.dateTime) }))
    .sort((a, b) => a.__ts - b.__ts);
  return computeTiltSide(params.nick, indexed);
}

function validateTiltEffect(leagueHistory: IndexedMatch[]): ValidationReport {
  // Valida se "lossStreak>=2" está associado a queda de winrate (ou vice-versa).
  // Faz um scan único, mantendo win/loss streak simples por jogador.
  const winStreak = new Map<string, number>();
  const lossStreak = new Map<string, number>();

  const baseline = { wins: 0, total: 0 };
  const conditional = { wins: 0, total: 0 };

  const key = (nick: string) => normalizeNick(nick);

  for (const match of leagueHistory) {
    const home = key(match.homeNick);
    const away = key(match.awayNick);

    const homeLoss = lossStreak.get(home) ?? 0;
    const awayLoss = lossStreak.get(away) ?? 0;

    baseline.total += 2;
    baseline.wins += isWin(match, match.homeNick) ? 1 : 0;
    baseline.wins += isWin(match, match.awayNick) ? 1 : 0;

    // Condicional: tilt (loss streak >=2) antes do jogo
    if (homeLoss >= 2) {
      conditional.total += 1;
      conditional.wins += isWin(match, match.homeNick) ? 1 : 0;
    }
    if (awayLoss >= 2) {
      conditional.total += 1;
      conditional.wins += isWin(match, match.awayNick) ? 1 : 0;
    }

    // Atualiza streaks após o jogo
    const homeWon = isWin(match, match.homeNick);
    const awayWon = isWin(match, match.awayNick);
    const homeLost = isLoss(match, match.homeNick);
    const awayLost = isLoss(match, match.awayNick);

    winStreak.set(home, homeWon ? (winStreak.get(home) ?? 0) + 1 : 0);
    winStreak.set(away, awayWon ? (winStreak.get(away) ?? 0) + 1 : 0);

    lossStreak.set(home, homeLost ? (lossStreak.get(home) ?? 0) + 1 : 0);
    lossStreak.set(away, awayLost ? (lossStreak.get(away) ?? 0) + 1 : 0);
  }

  const baselineWinRate = baseline.total ? baseline.wins / baseline.total : 0;
  const conditionalWinRate = conditional.total ? conditional.wins / conditional.total : 0;
  const uplift = conditionalWinRate - baselineWinRate;

  const sampleSize = conditional.total;
  return {
    status: sampleSize >= 100 ? "ok" : "insuficiente",
    sampleSize,
    baselineWinRate,
    conditionalWinRate,
    uplift,
  };
}

function computeStyleSide(nick: string, history: IndexedMatch[], window = 30): StyleSide {
  const slice = takeLast(history, window);
  const totals = slice.map((m) => m.homeGoals + m.awayGoals);

  const avgTotalGoals = slice.length ? totals.reduce((acc, v) => acc + v, 0) / slice.length : 0;
  const avgConceded = slice.length
    ? slice.reduce((acc, m) => acc + goalsAgainst(m, nick), 0) / slice.length
    : 0;

  const mean = avgTotalGoals;
  const stdTotalGoals = totals.length > 1
    ? Math.sqrt(totals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (totals.length - 1))
    : 0;

  return {
    games: slice.length,
    avgTotalGoals,
    avgConceded,
    stdTotalGoals,
  };
}

export function computeStyleFromHistory(params: { nick: string; history: MatchRecord[]; window?: number; }): StyleSide {
  const indexed = params.history
    .map((m) => ({ ...m, __ts: toTs(m.dateTime) }))
    .sort((a, b) => a.__ts - b.__ts);
  return computeStyleSide(params.nick, indexed, params.window);
}

function shrinkRate(hit: number, total: number, globalRate: number, k = 12) {
  const w = total / (total + k);
  return w * (total ? hit / total : 0) + (1 - w) * globalRate;
}

export function summarizeTeamAffinity(params: {
  nick: string;
  history: MatchRecord[];
  ouLine?: number;
  minGamesPerTeam?: number;
  topN?: number;
}): TeamAffinityTeamRow[] {
  const minGamesPerTeam = Math.max(1, Math.floor(params.minGamesPerTeam ?? 4));
  const topN = Math.max(1, Math.floor(params.topN ?? 3));
  const nick = params.nick;
  const ouLine = params.ouLine;

  const gamesAll = params.history.length;
  let winsAll = 0;
  let ouAll = 0;
  for (const match of params.history) {
    if (isWin(match, nick)) winsAll += 1;
    if (ouLine != null && match.homeGoals + match.awayGoals > ouLine) ouAll += 1;
  }

  const winRateAll = gamesAll ? winsAll / gamesAll : 0;
  const ouRateAll = ouLine != null && gamesAll ? ouAll / gamesAll : undefined;

  const byTeam = new Map<string, { games: number; wins: number; ouHit: number }>();
  for (const match of params.history) {
    const team = teamForSide(match, nick);
    if (!team) continue;
    const row = byTeam.get(team) ?? { games: 0, wins: 0, ouHit: 0 };
    row.games += 1;
    if (isWin(match, nick)) row.wins += 1;
    if (ouLine != null && match.homeGoals + match.awayGoals > ouLine) row.ouHit += 1;
    byTeam.set(team, row);
  }

  const rows: TeamAffinityTeamRow[] = [];
  byTeam.forEach((value, team) => {
    if (value.games < minGamesPerTeam) return;
    const winRate = value.games ? value.wins / value.games : 0;
    const shrunkWinRate = shrinkRate(value.wins, value.games, winRateAll, 14);

    const ouRate = ouLine != null && value.games ? value.ouHit / value.games : undefined;
    const shrunkOuRate = ouLine != null && ouRate != null && ouRateAll != null
      ? shrinkRate(value.ouHit, value.games, ouRateAll, 14)
      : undefined;

    rows.push({
      team,
      games: value.games,
      winRate,
      shrunkWinRate,
      deltaWin: shrunkWinRate - winRateAll,
      ouLine,
      ouRate,
      shrunkOuRate,
      deltaOU: shrunkOuRate != null && ouRateAll != null ? shrunkOuRate - ouRateAll : undefined,
      lowSample: value.games < 6,
    });
  });

  return rows
    .sort((a, b) => (b.deltaWin - a.deltaWin) || (b.games - a.games))
    .slice(0, topN);
}

function computeTeamAffinitySide(nick: string, team: string, history: IndexedMatch[], ouLine?: number): TeamAffinitySide {
  const teamNorm = team.trim();
  const gamesAll = history.length;

  let winsAll = 0;
  let ouAllHit = 0;
  for (const match of history) {
    if (isWin(match, nick)) winsAll += 1;
    if (ouLine != null && match.homeGoals + match.awayGoals > ouLine) ouAllHit += 1;
  }

  const winRateAll = gamesAll ? winsAll / gamesAll : 0;
  const ouRateAll = ouLine != null && gamesAll ? ouAllHit / gamesAll : undefined;

  const teamHistory = history.filter((m) => teamForSide(m, nick) === teamNorm);
  const gamesTeam = teamHistory.length;

  let winsTeam = 0;
  let ouTeamHit = 0;
  for (const match of teamHistory) {
    if (isWin(match, nick)) winsTeam += 1;
    if (ouLine != null && match.homeGoals + match.awayGoals > ouLine) ouTeamHit += 1;
  }

  const winRateTeam = gamesTeam ? winsTeam / gamesTeam : 0;
  const ouRateTeam = ouLine != null && gamesTeam ? ouTeamHit / gamesTeam : undefined;

  const shrunkWinRateTeam = shrinkRate(winsTeam, gamesTeam, winRateAll, 14);
  const shrunkWinRateAll = winRateAll;

  const shrunkOuRateTeam = ouLine != null && ouRateTeam != null ? shrinkRate(ouTeamHit, gamesTeam, ouRateAll ?? 0, 14) : undefined;
  const shrunkOuRateAll = ouRateAll;

  return {
    team: teamNorm,
    gamesTeam,
    gamesAll,
    winRateTeam,
    winRateAll,
    shrunkWinRateTeam,
    shrunkWinRateAll,
    deltaWin: shrunkWinRateTeam - shrunkWinRateAll,
    ouLine,
    ouRateTeam,
    ouRateAll,
    shrunkOuRateTeam,
    shrunkOuRateAll,
    deltaOU: shrunkOuRateTeam != null && shrunkOuRateAll != null ? shrunkOuRateTeam - shrunkOuRateAll : undefined,
    lowSample: gamesTeam < 6,
  };
}

function computeSessionSide(nick: string, history: IndexedMatch[], gapMinutes = 45): SessionSide {
  if (!history.length) {
    return {
      sessionGamesCount: 0,
      sessionWinRate: 0,
      sessionAvgTotalGoals: 0,
      sessionTrend: "estavel",
      lowSample: true,
    };
  }

  const gapMs = gapMinutes * 60 * 1000;

  const session: IndexedMatch[] = [];
  let cursor = history.length - 1;
  session.push(history[cursor]);
  cursor -= 1;

  while (cursor >= 0) {
    const prev = history[cursor];
    const last = session[session.length - 1];
    if (last.__ts - prev.__ts <= gapMs) {
      session.push(prev);
      cursor -= 1;
    } else {
      break;
    }
  }

  const games = session.length;
  let wins = 0;
  let totalGoals = 0;
  for (const match of session) {
    if (isWin(match, nick)) wins += 1;
    totalGoals += match.homeGoals + match.awayGoals;
  }

  const sessionWinRate = games ? wins / games : 0;
  const sessionAvgTotalGoals = games ? totalGoals / games : 0;

  const first = session.slice(-Math.min(2, session.length));
  const last = session.slice(0, Math.min(2, session.length));
  const firstAvg = first.length ? first.reduce((acc, m) => acc + m.homeGoals + m.awayGoals, 0) / first.length : 0;
  const lastAvg = last.length ? last.reduce((acc, m) => acc + m.homeGoals + m.awayGoals, 0) / last.length : 0;
  const delta = lastAvg - firstAvg;

  const sessionTrend: SessionSide["sessionTrend"] = delta >= 0.35 ? "melhorando" : delta <= -0.35 ? "piorando" : "estavel";

  return {
    sessionGamesCount: games,
    sessionWinRate,
    sessionAvgTotalGoals,
    sessionTrend,
    lowSample: games < 3,
  };
}

export function computeSessionFromHistory(params: { nick: string; history: MatchRecord[]; gapMinutes?: number; }): SessionSide {
  const indexed = params.history
    .map((m) => ({ ...m, __ts: toTs(m.dateTime) }))
    .sort((a, b) => a.__ts - b.__ts);
  return computeSessionSide(params.nick, indexed, params.gapMinutes ?? 45);
}

export function computeSegmentDrift(params: { leagueHistory: MatchRecord[]; line: number; recentWindow?: number; previousWindow?: number; }): SegmentDrift {
  const recentWindow = Math.max(10, Math.floor(params.recentWindow ?? 50));
  const previousWindow = Math.max(10, Math.floor(params.previousWindow ?? 50));

  const chronological = [...params.leagueHistory].sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime));
  const recent = chronological.slice(-recentWindow);
  const prev = chronological.slice(-(recentWindow + previousWindow), -recentWindow);

  const overRecent = recent.length ? recent.filter((m) => m.homeGoals + m.awayGoals > params.line).length / recent.length : 0;
  const overPrev = prev.length ? prev.filter((m) => m.homeGoals + m.awayGoals > params.line).length / prev.length : 0;

  const avgGoalsRecent = recent.length ? recent.reduce((acc, m) => acc + m.homeGoals + m.awayGoals, 0) / recent.length : 0;
  const avgGoalsPrev = prev.length ? prev.reduce((acc, m) => acc + m.homeGoals + m.awayGoals, 0) / prev.length : 0;

  const driftMagnitude = Math.max(Math.abs(overRecent - overPrev), Math.abs(avgGoalsRecent - avgGoalsPrev) / 2);
  const level: SegmentDrift["level"] = driftMagnitude >= 0.18 ? "critico" : driftMagnitude >= 0.1 ? "atencao" : "estavel";

  return {
    recentWindow: recent.length,
    previousWindow: prev.length,
    deltaAvgGoals: avgGoalsRecent - avgGoalsPrev,
    deltaOver: overRecent - overPrev,
    level,
  };
}

export function computeDerivedSignals(params: {
  match: DerivedSignalsMatchLike;
  index: DerivedSignalIndex;
  ouLine?: number;
  sessionGapMinutes?: number;
  validateLeague?: boolean;
}): DerivedSignals {
  const match = params.match;
  const leagueKey = match.league || "all";

  const leagueMatches = params.validateLeague
    ? sliceBefore(params.index.byLeague.get(leagueKey) ?? [], match.dateTime)
    : [];

  const revenge = computeRevenge(match, params.index);
  if (params.validateLeague) {
    revenge.validation = validateRevengeEffect(leagueMatches);
  }

  const homeHistory = sliceBefore(params.index.byNick.get(normalizeNick(match.homeNick)) ?? [], match.dateTime);
  const awayHistory = sliceBefore(params.index.byNick.get(normalizeNick(match.awayNick)) ?? [], match.dateTime);

  const tiltHome = computeTiltSide(match.homeNick, homeHistory);
  const tiltAway = computeTiltSide(match.awayNick, awayHistory);

  if (params.validateLeague) {
    const tiltValidation = validateTiltEffect(leagueMatches);
    tiltHome.validation = tiltValidation;
    tiltAway.validation = tiltValidation;
  }

  const styleHome = computeStyleSide(match.homeNick, homeHistory);
  const styleAway = computeStyleSide(match.awayNick, awayHistory);

  const style: StyleMismatchSignal = {
    home: styleHome,
    away: styleAway,
    pace: (styleHome.avgTotalGoals + styleAway.avgTotalGoals) / 2,
    fragility: (styleHome.avgConceded + styleAway.avgConceded) / 2,
    volatility: (styleHome.stdTotalGoals + styleAway.stdTotalGoals) / 2,
  };

  const ouLine = params.ouLine;
  const teamAffinity: TeamAffinitySignal = {
    home: computeTeamAffinitySide(match.homeNick, match.homeTeam, homeHistory, ouLine),
    away: computeTeamAffinitySide(match.awayNick, match.awayTeam, awayHistory, ouLine),
  };

  const gap = params.sessionGapMinutes ?? 45;
  const session: SessionFormSignal = {
    home: computeSessionSide(match.homeNick, homeHistory, gap),
    away: computeSessionSide(match.awayNick, awayHistory, gap),
  };

  const drift = params.validateLeague && leagueMatches.length
    ? computeSegmentDrift({ leagueHistory: leagueMatches, line: ouLine ?? 6.5 })
    : undefined;

  return {
    revenge,
    tilt: { home: tiltHome, away: tiltAway },
    style,
    teamAffinity,
    session,
    drift,
  };
}
