import type { MatchRecord, ReliabilityBin } from "@/lib/types";

const sortedCache = new WeakMap<MatchRecord[], boolean>();

export type WalkForwardParams = {
  trainSize: number;
  testSize: number;
  stepSize?: number;
};

export type WalkForwardFold = {
  train: MatchRecord[];
  test: MatchRecord[];
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
};

export type PredictionPoint = {
  dateTime: string;
  probability: number;
  outcome: 0 | 1;
};

export type EvaluationMetrics = {
  accuracy: number;
  brierScore: number;
  logLoss: number;
  reliabilityBins: ReliabilityBin[];
};

const EPSILON = 1e-6;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function isChronologicalAsc(matches: MatchRecord[]) {
  const cached = sortedCache.get(matches);
  if (typeof cached === "boolean") return cached;

  let ordered = true;
  for (let index = 1; index < matches.length; index += 1) {
    const previous = +new Date(matches[index - 1]?.dateTime ?? 0);
    const current = +new Date(matches[index]?.dateTime ?? 0);
    if (previous > current) {
      ordered = false;
      break;
    }
  }

  sortedCache.set(matches, ordered);
  return ordered;
}

export function getHistoryBefore(matchDatetime: string, matches: MatchRecord[]) {
  if (!matches.length) return [];

  const threshold = +new Date(matchDatetime);
  if (Number.isNaN(threshold)) return [];

  if (isChronologicalAsc(matches)) {
    let left = 0;
    let right = matches.length;

    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      const middleTime = +new Date(matches[middle]?.dateTime ?? 0);
      if (middleTime < threshold) {
        left = middle + 1;
      } else {
        right = middle;
      }
    }

    return matches.slice(0, left);
  }

  return matches
    .filter((item) => +new Date(item.dateTime) < threshold)
    .sort((left, right) => +new Date(left.dateTime) - +new Date(right.dateTime));
}

export function splitWalkForward(matches: MatchRecord[], params: WalkForwardParams): WalkForwardFold[] {
  const { trainSize, testSize, stepSize = testSize } = params;
  if (trainSize <= 0 || testSize <= 0 || stepSize <= 0) return [];

  const chronological = [...matches].sort((left, right) => +new Date(left.dateTime) - +new Date(right.dateTime));
  const folds: WalkForwardFold[] = [];

  for (let start = 0; start + trainSize + testSize <= chronological.length; start += stepSize) {
    const train = chronological.slice(start, start + trainSize);
    const test = chronological.slice(start + trainSize, start + trainSize + testSize);
    if (!train.length || !test.length) continue;

    folds.push({
      train,
      test,
      trainStart: train[0]?.dateTime ?? "",
      trainEnd: train[train.length - 1]?.dateTime ?? "",
      testStart: test[0]?.dateTime ?? "",
      testEnd: test[test.length - 1]?.dateTime ?? "",
    });
  }

  return folds;
}

export function computeMetrics(points: PredictionPoint[]): EvaluationMetrics {
  if (!points.length) {
    return {
      accuracy: 0,
      brierScore: 0,
      logLoss: 0,
      reliabilityBins: [],
    };
  }

  let hits = 0;
  let brier = 0;
  let logloss = 0;

  for (const point of points) {
    const probability = clamp01(point.probability);
    const predicted = probability >= 0.5 ? 1 : 0;
    if (predicted === point.outcome) hits += 1;
    brier += (probability - point.outcome) ** 2;

    const clipped = Math.min(1 - EPSILON, Math.max(EPSILON, probability));
    logloss += -(point.outcome * Math.log(clipped) + (1 - point.outcome) * Math.log(1 - clipped));
  }

  const bins = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const reliabilityBins: ReliabilityBin[] = bins.slice(0, -1).map((start, index) => {
    const end = bins[index + 1] ?? 1.0001;
    const inBin = points.filter((point) => {
      const confidence = Math.max(point.probability, 1 - point.probability);
      return confidence >= start && confidence < end;
    });

    const predicted = safeDivide(
      inBin.reduce((acc, point) => acc + Math.max(point.probability, 1 - point.probability), 0),
      inBin.length
    );

    const observed = safeDivide(
      inBin.reduce((acc, point) => {
        const prediction = point.probability >= 0.5 ? 1 : 0;
        return acc + (prediction === point.outcome ? 1 : 0);
      }, 0),
      inBin.length
    );

    return {
      label: `${start.toFixed(1)}-${Math.min(1, end).toFixed(1)}`,
      predicted,
      observed,
      count: inBin.length,
    };
  });

  return {
    accuracy: safeDivide(hits, points.length),
    brierScore: brier / points.length,
    logLoss: logloss / points.length,
    reliabilityBins,
  };
}
