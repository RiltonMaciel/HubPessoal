import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  defaultConfig,
  type DashboardData,
  type DecisionMode,
  type MatchRecord,
  type PlayerSummary,
  type RateInterval,
} from "@/lib/types";

type BuildArgs = {
  matches: MatchRecord[];
  league: string;
  period: "7" | "15" | "30" | "all";
  recencyOn: boolean;
  line: number;
  decisionMode: DecisionMode;
  recencyFactor?: number;
  shrinkK?: number;
};

type PlayerAccum = {
  nick: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  gf: number;
  ga: number;
  weightedGames: number;
  weightedGamesSq: number;
  weightedBtts: number;
  weightedOverByLine: Record<number, number>;
};

const lines = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];

function emptyAccum(nick: string): PlayerAccum {
  return {
    nick,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    gf: 0,
    ga: 0,
    weightedGames: 0,
    weightedGamesSq: 0,
    weightedBtts: 0,
    weightedOverByLine: Object.fromEntries(lines.map((line) => [line, 0])) as Record<number, number>,
  };
}

function effectiveSample(sumW: number, sumW2: number) {
  if (!sumW || !sumW2) return 0;
  return (sumW * sumW) / sumW2;
}

function wilsonInterval(rate: number, sample: number): RateInterval {
  if (sample <= 0) {
    return { rate: 0, low: 0, high: 0, effectiveSample: 0 };
  }

  const z = 1.96;
  const n = sample;
  const p = Math.max(0, Math.min(1, rate));
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));

  return {
    rate: p,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    effectiveSample: n,
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function buildDashboardData({
  matches,
  league,
  period,
  recencyOn,
  line,
  decisionMode,
  recencyFactor = defaultConfig.recencyFactor,
  shrinkK = defaultConfig.shrinkK,
}: BuildArgs): DashboardData {
  const now = new Date();
  const sorted = [...matches].sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime));

  const filtered = sorted.filter((match) => {
    if (league !== "all" && match.league !== league) return false;
    if (period === "all") return true;
    const days = Number(period);
    return differenceInCalendarDays(now, parseISO(match.dateTime)) <= days;
  });

  const chronological = [...filtered].reverse();

  const totalGames = filtered.length;
  const leagueTotals = {
    goals: 0,
    weightedGames: 0,
    weightedGamesSq: 0,
    weightedBtts: 0,
    weightedOverByLine: Object.fromEntries(lines.map((value) => [value, 0])) as Record<number, number>,
  };

  const players = new Map<string, PlayerAccum>();

  filtered.forEach((match, index) => {
    const totalGoals = match.homeGoals + match.awayGoals;
    const btts = match.homeGoals > 0 && match.awayGoals > 0;
    const weight = recencyOn ? Math.pow(recencyFactor, index) : 1;

    leagueTotals.goals += totalGoals;
    leagueTotals.weightedGames += weight;
    leagueTotals.weightedGamesSq += weight * weight;
    if (btts) leagueTotals.weightedBtts += weight;

    lines.forEach((lineRef) => {
      if (totalGoals > lineRef) {
        leagueTotals.weightedOverByLine[lineRef] += weight;
      }
    });

    const home = players.get(match.homeNick) ?? emptyAccum(match.homeNick);
    const away = players.get(match.awayNick) ?? emptyAccum(match.awayNick);

    home.games += 1;
    away.games += 1;
    home.gf += match.homeGoals;
    home.ga += match.awayGoals;
    away.gf += match.awayGoals;
    away.ga += match.homeGoals;
    home.weightedGames += weight;
    away.weightedGames += weight;
    home.weightedGamesSq += weight * weight;
    away.weightedGamesSq += weight * weight;

    if (btts) {
      home.weightedBtts += weight;
      away.weightedBtts += weight;
    }

    lines.forEach((lineRef) => {
      if (totalGoals > lineRef) {
        home.weightedOverByLine[lineRef] += weight;
        away.weightedOverByLine[lineRef] += weight;
      }
    });

    if (match.homeGoals > match.awayGoals) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.homeGoals < match.awayGoals) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }

    players.set(home.nick, home);
    players.set(away.nick, away);
  });

  const leagueAvgGoals = totalGames ? leagueTotals.goals / totalGames : 0;
  const leagueBttsRate = leagueTotals.weightedGames
    ? leagueTotals.weightedBtts / leagueTotals.weightedGames
    : 0;

  const leagueOverLines = Object.fromEntries(
    lines.map((lineRef) => [
      lineRef,
      leagueTotals.weightedGames
        ? leagueTotals.weightedOverByLine[lineRef] / leagueTotals.weightedGames
        : 0,
    ])
  ) as Record<number, number>;

  const leagueEffectiveSample = effectiveSample(leagueTotals.weightedGames, leagueTotals.weightedGamesSq);
  const leagueBttsInterval = wilsonInterval(leagueBttsRate, leagueEffectiveSample);
  const selectedOverInterval = wilsonInterval(leagueOverLines[line] ?? 0, leagueEffectiveSample);

  const allPlayers = [...players.values()];
  const leaguePpg =
    allPlayers.length > 0
      ? allPlayers.reduce((acc, value) => acc + value.points / Math.max(value.games, 1), 0) /
        allPlayers.length
      : 0;

  const playerSummaries: PlayerSummary[] = allPlayers.map((player) => {
    const ppg = player.points / Math.max(player.games, 1);
    const ppgFinal = (ppg * player.games + leaguePpg * shrinkK) / (player.games + shrinkK);


    const overRates = Object.fromEntries(
      lines.map((lineRef) => {
        const playerLineRate = player.weightedGames
          ? player.weightedOverByLine[lineRef] / player.weightedGames
          : 0;
        const finalRate =
          (playerLineRate * player.games + leagueOverLines[lineRef] * shrinkK) /
          (player.games + shrinkK);
        return [lineRef, finalRate];
      })
    ) as Record<number, number>;

    const nEff = effectiveSample(player.weightedGames, player.weightedGamesSq);
    const overIntervals = Object.fromEntries(
      lines.map((lineRef) => [lineRef, wilsonInterval(overRates[lineRef] ?? 0, nEff)])
    ) as Record<number, RateInterval>;
    const bttsInterval = wilsonInterval(
      player.weightedGames ? player.weightedBtts / player.weightedGames : 0,
      nEff
    );

    let confidence: PlayerSummary["confidence"] = "alta";
    if (player.games < 5) confidence = "baixa";
    else if (player.games < 10) confidence = "media";
    if (totalGames < 30 && confidence === "alta") confidence = "media";
    if (totalGames < 15 && confidence === "media") confidence = "baixa";

    return {
      nick: player.nick,
      games: player.games,
      effectiveGames: nEff,
      wins: player.wins,
      draws: player.draws,
      losses: player.losses,
      ppg,
      ppgFinal,
      gfPerGame: player.gf / Math.max(player.games, 1),
      gaPerGame: player.ga / Math.max(player.games, 1),
      totalPerGame: (player.gf + player.ga) / Math.max(player.games, 1),
      bttsRate: player.weightedGames ? player.weightedBtts / player.weightedGames : 0,
      bttsInterval,
      overRates,
      overIntervals,
      confidence,
    };
  });

  const fragileEdgePlayers = playerSummaries
    .filter((player) => Math.abs((player.overRates[line] ?? 0) - (leagueOverLines[line] ?? 0)) < 0.05)
    .slice(0, 5)
    .map((player) => player.nick);

  const topBacktestPlayers = [...playerSummaries]
    .sort((a, b) => (b.overRates[line] ?? 0) - (a.overRates[line] ?? 0))
    .slice(0, 3)
    .map((item) => item.nick);

  const recentBacktestSample = filtered.slice(0, 40);
  let attempts = 0;
  let hits = 0;
  let baselineLeagueHits = 0;
  const leaguePredictOver = (leagueOverLines[line] ?? 0) >= 0.5;

  recentBacktestSample.forEach((match) => {
    const involved = topBacktestPlayers.includes(match.homeNick) || topBacktestPlayers.includes(match.awayNick);
    if (!involved) return;
    attempts += 1;
    const isOver = match.homeGoals + match.awayGoals > line;
    if (isOver) {
      hits += 1;
    }
    if ((leaguePredictOver && isOver) || (!leaguePredictOver && !isOver)) {
      baselineLeagueHits += 1;
    }
  });

  const hitRate = attempts ? hits / attempts : 0;
  const baselineLeagueHitRate = attempts ? baselineLeagueHits / attempts : 0;
  const baselineRandomHitRate = attempts ? 0.5 : 0;

  const minTrainGames = decisionMode === "conservador" ? 12 : 8;
  let walkForwardAttempts = 0;
  let walkForwardHits = 0;
  let walkForwardBaselineLeagueHits = 0;

  for (let i = minTrainGames; i < chronological.length; i += 1) {
    const train = chronological.slice(0, i);
    const evalMatch = chronological[i];
    if (!evalMatch) continue;

    const trainOverRate = train.length
      ? train.filter((item) => item.homeGoals + item.awayGoals > line).length / train.length
      : 0;

    const trainEdgeVsNeutral = Math.abs(trainOverRate - 0.5);
    const thresholdBase = decisionMode === "conservador" ? 0.08 : 0.06;
    const samplePenalty = i < 20 ? 0.02 : i < 35 ? 0.01 : 0;
    const threshold = thresholdBase + samplePenalty;

    let wfSignal: "over" | "under" | "neutro" = "neutro";
    if (trainOverRate >= 0.5 + threshold) wfSignal = "over";
    else if (trainOverRate <= 0.5 - threshold) wfSignal = "under";

    if (wfSignal === "neutro" || trainEdgeVsNeutral < threshold) continue;

    const isOver = evalMatch.homeGoals + evalMatch.awayGoals > line;
    const hit = (wfSignal === "over" && isOver) || (wfSignal === "under" && !isOver);
    if (hit) walkForwardHits += 1;
    walkForwardAttempts += 1;

    const baselineSignal: "over" | "under" = trainOverRate >= 0.5 ? "over" : "under";
    const baselineHit = (baselineSignal === "over" && isOver) || (baselineSignal === "under" && !isOver);
    if (baselineHit) walkForwardBaselineLeagueHits += 1;
  }

  const walkForwardHitRate = walkForwardAttempts ? walkForwardHits / walkForwardAttempts : 0;
  const walkForwardBaselineLeagueHitRate = walkForwardAttempts
    ? walkForwardBaselineLeagueHits / walkForwardAttempts
    : 0;

  const edgeMagnitude = clamp01(Math.abs((leagueOverLines[line] ?? 0) - 0.5) / 0.2);
  const edgeVsNeutral = Math.abs((leagueOverLines[line] ?? 0) - 0.5);
  const intervalWidth = selectedOverInterval.high - selectedOverInterval.low;
  const certaintyScore = clamp01(1 - intervalWidth / 0.45);
  const sampleScore = clamp01(leagueEffectiveSample / 35);
  const backtestScore = clamp01((hitRate - 0.45) / 0.25);

  const adaptiveBase = decisionMode === "conservador" ? 0.08 : 0.06;
  const uncertaintyPenalty = clamp01(intervalWidth / 0.34) * 0.04;
  const samplePenalty = leagueEffectiveSample < 12 ? 0.03 : leagueEffectiveSample < 20 ? 0.015 : 0;
  const walkForwardPenalty =
    walkForwardAttempts >= 8 && walkForwardHitRate < walkForwardBaselineLeagueHitRate ? 0.02 : 0;
  const adaptiveEdgeThreshold = clamp(
    adaptiveBase + uncertaintyPenalty + samplePenalty + walkForwardPenalty,
    0.05,
    0.18
  );

  const modeWeights =
    decisionMode === "conservador"
      ? { edge: 0.28, certainty: 0.36, sample: 0.22, backtest: 0.14 }
      : { edge: 0.45, certainty: 0.2, sample: 0.1, backtest: 0.25 };

  const decisionScore = Math.round(
    100 *
      (edgeMagnitude * modeWeights.edge +
        certaintyScore * modeWeights.certainty +
        sampleScore * modeWeights.sample +
        backtestScore * modeWeights.backtest)
  );

  let decisionSignal: "over" | "under" | "neutro" = "neutro";
  let rawDecisionSignal: "over" | "under" | "neutro" = "neutro";
  if (decisionMode === "conservador") {
    if (selectedOverInterval.low >= 0.55) rawDecisionSignal = "over";
    else if (selectedOverInterval.high <= 0.45) rawDecisionSignal = "under";
  } else {
    if ((leagueOverLines[line] ?? 0) >= 0.54) rawDecisionSignal = "over";
    else if ((leagueOverLines[line] ?? 0) <= 0.46) rawDecisionSignal = "under";
  }

  const antiFalseSignalPassed =
    decisionScore >= (decisionMode === "conservador" ? 62 : 55) &&
    leagueEffectiveSample >= (decisionMode === "conservador" ? 12 : 9) &&
    intervalWidth <= (decisionMode === "conservador" ? 0.24 : 0.3) &&
    edgeVsNeutral >= adaptiveEdgeThreshold &&
    (walkForwardAttempts < 8 || walkForwardHitRate >= walkForwardBaselineLeagueHitRate) &&
    hitRate >= baselineLeagueHitRate;

  decisionSignal = antiFalseSignalPassed ? rawDecisionSignal : "neutro";

  let decisionConfidence: PlayerSummary["confidence"] = "baixa";
  if (decisionScore >= 75) decisionConfidence = "alta";
  else if (decisionScore >= 55) decisionConfidence = "media";

  const isBettable = antiFalseSignalPassed && decisionSignal !== "neutro";

  const executiveSummary = [
    `Sinal final: ${decisionSignal.toUpperCase()} (${decisionMode}).`,
    `Score ${decisionScore}/100 com n efetivo ${leagueEffectiveSample.toFixed(1)}.`,
    `IC95% Over ${line}: ${(selectedOverInterval.low * 100).toFixed(1)}–${(selectedOverInterval.high * 100).toFixed(1)}%.`,
    `Backtest ${(hitRate * 100).toFixed(1)}% vs liga ${(baselineLeagueHitRate * 100).toFixed(1)}%.`,
    `Walk-forward ${(walkForwardHitRate * 100).toFixed(1)}% vs baseline ${(walkForwardBaselineLeagueHitRate * 100).toFixed(1)}% (${walkForwardAttempts} sinais).`,
    isBettable
      ? "Cenário apostável no filtro atual."
      : "Cenário não apostável: critérios de proteção ativos.",
  ];

  const getTop = <T,>(arr: T[], score: (item: T) => number, ascending = false) => {
    const copy = [...arr].sort((a, b) => (ascending ? score(a) - score(b) : score(b) - score(a)));
    return copy.slice(0, 10);
  };

  return {
    totalGames,
    avgGoals: leagueAvgGoals,
    bttsRate: leagueBttsRate,
    bttsInterval: leagueBttsInterval,
    selectedOverRate: leagueOverLines[line] ?? 0,
    selectedOverInterval,
    effectiveGames: leagueEffectiveSample,
    leagueOverLines,
    rankings: {
      topBest: getTop(playerSummaries, (item) => item.ppgFinal),
      topWorst: getTop(playerSummaries, (item) => item.ppgFinal, true),
      topOver: getTop(playerSummaries, (item) => item.overRates[line] ?? 0),
      topUnder: getTop(playerSummaries, (item) => item.overRates[line] ?? 0, true),
      topBtts: getTop(playerSummaries, (item) => item.bttsRate),
      topNoBtts: getTop(playerSummaries, (item) => item.bttsRate, true),
    },
    players: playerSummaries,
    recentMatches: filtered.slice(0, 20),
    backtest: {
      line,
      attempts,
      hits,
      hitRate,
      baselineRandomHitRate,
      baselineLeagueHitRate,
      upliftVsRandom: hitRate - baselineRandomHitRate,
      upliftVsLeague: hitRate - baselineLeagueHitRate,
      walkForwardAttempts,
      walkForwardHits,
      walkForwardHitRate,
      walkForwardBaselineLeagueHitRate,
      walkForwardUpliftVsLeague: walkForwardHitRate - walkForwardBaselineLeagueHitRate,
    },
    decision: {
      mode: decisionMode,
      score: decisionScore,
      signal: decisionSignal,
      confidence: decisionConfidence,
      antiFalseSignalPassed,
      isBettable,
      adaptiveEdgeThreshold,
      edgeVsNeutral,
      reasons: [
        `Edge da linha ${line}: ${((leagueOverLines[line] ?? 0) * 100).toFixed(1)}%`,
        `IC95% Over ${line}: ${(selectedOverInterval.low * 100).toFixed(1)}–${(selectedOverInterval.high * 100).toFixed(1)}%`,
        `Backtest: ${(hitRate * 100).toFixed(1)}% (liga ${(baselineLeagueHitRate * 100).toFixed(1)}%)`,
        `Walk-forward: ${(walkForwardHitRate * 100).toFixed(1)}% (baseline ${(walkForwardBaselineLeagueHitRate * 100).toFixed(1)}%)`,
        `Threshold adaptativo: ${(adaptiveEdgeThreshold * 100).toFixed(1)}pp (edge atual ${(edgeVsNeutral * 100).toFixed(1)}pp)`,
        antiFalseSignalPassed ? "Anti-falso-sinal: aprovado" : "Anti-falso-sinal: bloqueado",
      ],
    },
    executiveSummary,
    explainability: {
      fragileEdgePlayers,
    },
  };
}
