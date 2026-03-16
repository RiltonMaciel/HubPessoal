/**
 * prediction-engine.ts — Motor v3: 10 melhorias cirúrgicas de assertividade
 *
 *  1. Auto-calibração de pesos via mini regressão logística
 *  2. Sigmoid com β auto-calculado
 *  3. Draw prior bayesiano (par + liga)
 *  4. Bayesian shrinkage nos expected goals
 *  5. Log-linear pooling no blend modelo/odds
 *  6. Fator de covariância Dixon-Coles simplificado
 *  7. Recency weighting
 *  8. Sinais derivados integrados ao score composto
 *  9. Changepoint detection (descarta regime antigo)
 * 10. Platt scaling auto-treinado
 */

import type { MatchRecord } from "./types";

/* ─── helpers ─── */

export function clampV3(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sigmoidV3(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function poissonPmfV3(lambda: number, k: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function normalizeText(v: string): string {
  return v.trim().replace(/\s+/g, " ").toUpperCase();
}

/* ─── 7. Recency weight ─── */

export function recencyWeight(matchDateIso: string, refDate: Date, lambda = 0.07): number {
  const diff = Math.abs(refDate.getTime() - new Date(matchDateIso).getTime()) / 86_400_000;
  return Math.exp(-lambda * diff);
}

/**
 * Computa stats ponderados por recência para um nick.
 * Retorna médias ponderadas de GF, GA, winRate, bttsRate, overRates.
 */
export function weightedPlayerStats(
  matches: MatchRecord[],
  nick: string,
  refDate: Date,
  lambda = 0.07,
) {
  const target = normalizeText(nick);

  const relevant = matches
    .filter((m) => normalizeText(m.homeNick) === target || normalizeText(m.awayNick) === target)
    .sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime));

  let wSum = 0;
  let wGf = 0;
  let wGa = 0;
  let wWins = 0;
  let wBtts = 0;
  const wOverCounts: Record<string, number> = {};
  const overLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
  for (const l of overLines) wOverCounts[l] = 0;

  const recentForm: number[] = []; // 1=win, 0.5=draw, 0=loss (últimos 10)

  for (const m of relevant) {
    const w = recencyWeight(m.dateTime, refDate, lambda);
    const isHome = normalizeText(m.homeNick) === target;
    const gf = isHome ? m.homeGoals : m.awayGoals;
    const ga = isHome ? m.awayGoals : m.homeGoals;
    const total = gf + ga;

    wSum += w;
    wGf += gf * w;
    wGa += ga * w;
    if (gf > ga) wWins += w;
    if (gf > 0 && ga > 0) wBtts += w;
    for (const l of overLines) {
      if (total > l) wOverCounts[l] += w;
    }

    if (recentForm.length < 10) {
      recentForm.push(gf > ga ? 1 : gf === ga ? 0.5 : 0);
    }
  }

  const safe = Math.max(wSum, 0.001);

  return {
    games: relevant.length,
    effectiveN: wSum,
    wGf: wGf / safe,
    wGa: wGa / safe,
    wWinRate: wWins / safe,
    wBttsRate: wBtts / safe,
    wOverRates: Object.fromEntries(overLines.map((l) => [l, wOverCounts[l] / safe])),
    recentForm,
  };
}

/* ─── 9. Changepoint detection (CUSUM simplificado) ─── */

/**
 * Retorna o índice a partir do qual usar os jogos (descarta regime antigo).
 * Se não detecta mudança, retorna 0.
 */
export function detectChangepointIndex(
  values: number[],
  minSegment = 5,
  threshold = 1.8,
): number {
  if (values.length < minSegment * 2) return 0;

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;

  let bestDiff = 0;
  let bestIdx = 0;

  for (let i = minSegment; i <= values.length - minSegment; i++) {
    const before = values.slice(0, i);
    const after = values.slice(i);
    const mBefore = before.reduce((s, v) => s + v, 0) / before.length;
    const mAfter = after.reduce((s, v) => s + v, 0) / after.length;
    const diff = Math.abs(mAfter - mBefore) / std;
    if (diff > bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return bestDiff >= threshold ? bestIdx : 0;
}

/**
 * Aplica changepoint detection nos jogos de um nick.
 * Retorna os jogos do regime mais recente.
 */
export function applyChangepoint(
  matches: MatchRecord[],
  nick: string,
  minSegment = 5,
  threshold = 1.8,
): { detected: boolean; effectiveMatches: MatchRecord[]; oldMean: number; newMean: number } {
  const target = normalizeText(nick);
  const relevant = matches
    .filter((m) => normalizeText(m.homeNick) === target || normalizeText(m.awayNick) === target)
    .sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime)); // cronológico

  if (relevant.length < minSegment * 2) {
    return { detected: false, effectiveMatches: matches, oldMean: 0, newMean: 0 };
  }

  const goals = relevant.map((m) => m.homeGoals + m.awayGoals);
  const idx = detectChangepointIndex(goals, minSegment, threshold);

  if (idx === 0) {
    const globalMean = goals.reduce((s, v) => s + v, 0) / goals.length;
    return { detected: false, effectiveMatches: matches, oldMean: globalMean, newMean: globalMean };
  }

  const oldGoals = goals.slice(0, idx);
  const newGoals = goals.slice(idx);
  const oldMean = oldGoals.reduce((s, v) => s + v, 0) / oldGoals.length;
  const newMean = newGoals.reduce((s, v) => s + v, 0) / newGoals.length;

  // IDs dos jogos do regime novo
  const newRegimeIds = new Set(relevant.slice(idx).map((m) => m.id));
  // Manter jogos do regime novo + jogos de OUTROS jogadores
  const filtered = matches.filter(
    (m) =>
      newRegimeIds.has(m.id) ||
      (normalizeText(m.homeNick) !== target && normalizeText(m.awayNick) !== target),
  );

  return { detected: true, effectiveMatches: filtered, oldMean, newMean };
}

/* ─── 4. Bayesian shrinkage on expected goals ─── */

export function shrinkGoals(observed: number, n: number, prior: number, k = 6): number {
  return (observed * n + prior * k) / (n + k);
}

/* ─── 3. Bayesian draw prior ─── */

export function bayesianDrawPrior(
  h2hDrawRate: number,
  h2hN: number,
  leagueDrawRate: number,
): number {
  const prior = leagueDrawRate > 0 ? leagueDrawRate : 0.22;
  if (h2hN === 0) return prior;
  // Quanto mais H2H, mais peso pro H2H (satura em ~20 jogos)
  const h2hW = Math.min(h2hN / 20, 1) * 0.6;
  const leagueW = 1 - h2hW;
  const bayesian = (h2hDrawRate * h2hW + prior * leagueW) / (h2hW + leagueW);
  return clampV3(bayesian, 0.06, 0.42);
}

/* ─── 5. Log-linear pooling ─── */

export function logLinearPool(
  model: [number, number, number],
  odds: [number, number, number],
  w = 0.65,
): [number, number, number] {
  const ow = 1 - w;
  const raw = model.map((mp, i) => {
    const op = odds[i];
    if (mp <= 0 || op <= 0) return 0.001;
    return Math.pow(mp, w) * Math.pow(op, ow);
  });
  const sum = raw.reduce((s, v) => s + v, 0) || 1;
  return raw.map((v) => clampV3(v / sum, 0.01, 0.98)) as [number, number, number];
}

/* ─── 6. Dixon-Coles: corrige probabilidades de placares baixos ─── */

/**
 * Retorna a grid corrigida de probabilidades H x A.
 * rho tipicamente entre -0.05 e 0.05 (negativo = menos 0-0 e 1-1 que independência).
 */
export function dixonColesGrid(
  lambdaH: number,
  lambdaA: number,
  rho = -0.03,
  maxGoals = 10,
): number[][] {
  const grid: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    grid[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      let p = poissonPmfV3(lambdaH, h) * poissonPmfV3(lambdaA, a);

      // Dixon-Coles tau correction para 0-0, 1-0, 0-1, 1-1
      if (h === 0 && a === 0) p *= 1 - rho * lambdaH * lambdaA;
      else if (h === 1 && a === 0) p *= 1 + rho * lambdaA;
      else if (h === 0 && a === 1) p *= 1 + rho * lambdaH;
      else if (h === 1 && a === 1) p *= 1 - rho;

      grid[h][a] = Math.max(p, 0);
    }
  }

  // Normalizar
  const total = grid.reduce((s, row) => s + row.reduce((rs, v) => rs + v, 0), 0) || 1;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      grid[h][a] /= total;
    }
  }

  return grid;
}

/**
 * Calcula probabilidades Over, Under, BTTS, 1X2 a partir da grid Dixon-Coles.
 */
export function probsFromGrid(grid: number[][], maxGoals = 10) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let btts = 0;
  const overProbs: Record<number, number> = {};
  const underProbs: Record<number, number> = {};

  const overLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
  const underLines = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
  for (const l of overLines) overProbs[l] = 0;
  for (const l of underLines) underProbs[l] = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = grid[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;

      if (h > 0 && a > 0) btts += p;

      const total = h + a;
      for (const l of overLines) {
        if (total > l) overProbs[l] += p;
      }
      for (const l of underLines) {
        if (total < l) underProbs[l] += p;
      }
    }
  }

  return { homeWin, draw, awayWin, btts, overProbs, underProbs };
}

/* ─── 8. Derived signals → score adjustment ─── */

export interface DerivedSignals {
  tiltDiff: number;        // -1 a +1 (home - away tilt)
  revengeFactor: number;   // 0 a 0.04 (home adjustment)
  styleMismatch: number;   // 0 a 1
  sessionDrift: number;    // -1 a +1 (home perspective)
  totalAdj: number;        // soma ponderada para score
}

export function computeDerivedSignals(
  homeForm: number[],
  awayForm: number[],
  homeAvgGf: number,
  awayAvgGf: number,
  homeAvgGa: number,
  awayAvgGa: number,
  revengeSig: string,
): DerivedSignals {
  // Tilt: últimos 5 resultados com peso decrescente
  const w5 = [0.35, 0.25, 0.20, 0.12, 0.08];
  let homeTilt = 0;
  let awayTilt = 0;
  for (let i = 0; i < 5; i++) {
    homeTilt += ((homeForm[i] ?? 0.5) - 0.5) * 2 * (w5[i] || 0.05);
    awayTilt += ((awayForm[i] ?? 0.5) - 0.5) * 2 * (w5[i] || 0.05);
  }
  const tiltDiff = clampV3(homeTilt - awayTilt, -1, 1);

  // Revenge
  let revengeFactor = 0;
  if (revengeSig === "vingança forte") revengeFactor = 0.035;
  else if (revengeSig === "vingança moderada") revengeFactor = 0.015;

  // Style mismatch
  const offDiff = Math.abs(homeAvgGf - awayAvgGf);
  const defDiff = Math.abs(homeAvgGa - awayAvgGa);
  const styleMismatch = clampV3((offDiff + defDiff) / 4, 0, 1);

  // Session drift: forma recente vs anterior
  const hRecent = homeForm.slice(0, 5);
  const hOlder = homeForm.slice(5, 10);
  const aRecent = awayForm.slice(0, 5);
  const aOlder = awayForm.slice(5, 10);
  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0.5;
  const sessionDrift = clampV3((avg(hRecent) - avg(hOlder)) - (avg(aRecent) - avg(aOlder)), -1, 1);

  // Soma ponderada para ajuste no score
  const totalAdj =
    tiltDiff * 0.06 +
    revengeFactor +
    styleMismatch * 0.02 +
    sessionDrift * 0.03;

  return { tiltDiff, revengeFactor, styleMismatch, sessionDrift, totalAdj };
}

/* ─── 1 + 2. Auto-calibração de pesos + β via regressão logística ─── */

export interface TrainPoint {
  features: number[];
  outcome: number; // 1 = home win, 0 = away win
}

export interface CalibratedWeights {
  raw: number[];
  normalized: number[];
  beta: number;
  intercept: number;
  source: "optimized" | "default";
}

export const DEFAULT_WEIGHTS = {
  normalized: [0.28, 0.18, 0.14, 0.14, 0.10, 0.06, 0.04, 0.03, 0.03],
  beta: 2.4,
  intercept: 0,
  source: "default" as const,
};

/**
 * Treina pesos via gradient descent logístico.
 * Features: [formDiff, winDiff, attackDiff, defenseDiff, h2hDiff, tiltDiff, revenge, style, drift]
 */
export function trainWeights(
  data: TrainPoint[],
  minSamples = 30,
): CalibratedWeights {
  if (data.length < minSamples) {
    return {
      raw: DEFAULT_WEIGHTS.normalized,
      ...DEFAULT_WEIGHTS,
    };
  }

  const nF = data[0].features.length || 9;
  const w = new Float64Array(nF).fill(0);
  let b = 0;
  const lr = 0.05;
  const epochs = 200;
  const n = data.length;
  const lambda = 0.01; // L2 regularization

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Float64Array(nF).fill(0);
    let gradB = 0;

    for (const pt of data) {
      const z = pt.features.reduce((s, f, i) => s + f * w[i], 0) + b;
      const pred = sigmoidV3(z);
      const err = pred - pt.outcome;
      for (let i = 0; i < nF; i++) gradW[i] += err * pt.features[i];
      gradB += err;
    }

    for (let i = 0; i < nF; i++) {
      w[i] -= lr * (gradW[i] / n + lambda * w[i]);
    }
    b -= lr * (gradB / n);
  }

  const absSum = Array.from(w).reduce((s, v) => s + Math.abs(v), 0) || 1;
  const normalized = Array.from(w).map((v) => Math.abs(v) / absSum);
  const beta = clampV3(absSum * 1.5, 1.2, 5.0);

  return {
    raw: Array.from(w),
    normalized,
    beta,
    intercept: b,
    source: "optimized",
  };
}

/**
 * Constrói dados de treino walk-forward a partir do histórico.
 * Cada jogo é uma observação onde features são calculadas com dados ANTES dele.
 */
export function buildTrainingData(allMatches: MatchRecord[], refDate: Date, lambda = 0.07): TrainPoint[] {
  const sorted = [...allMatches]
    .filter((m) => m.homeGoals != null && m.awayGoals != null)
    .sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime));

  const points: TrainPoint[] = [];
  const minHistory = 15;

  for (let i = minHistory; i < sorted.length; i++) {
    const match = sorted[i];
    const hg = match.homeGoals;
    const ag = match.awayGoals;
    if (hg === ag) continue; // skip draws for 1X2 training

    const homeNick = match.homeNick;
    const awayNick = match.awayNick;
    if (!homeNick || !awayNick) continue;

    const prior = sorted.slice(0, i);
    const matchDate = new Date(match.dateTime);

    const hs = weightedPlayerStats(prior, homeNick, matchDate, lambda);
    const as_ = weightedPlayerStats(prior, awayNick, matchDate, lambda);

    if (hs.games < 3 || as_.games < 3) continue;

    // H2H
    const h2h = prior.filter((m) => {
      const h = normalizeText(m.homeNick);
      const a = normalizeText(m.awayNick);
      const hN = normalizeText(homeNick);
      const aN = normalizeText(awayNick);
      return (h === hN && a === aN) || (h === aN && a === hN);
    });
    const h2hHomeWins = h2h.filter((m) => {
      const isH = normalizeText(m.homeNick) === normalizeText(homeNick);
      const gf = isH ? m.homeGoals : m.awayGoals;
      const ga = isH ? m.awayGoals : m.homeGoals;
      return gf > ga;
    }).length;
    const h2hRate = h2h.length > 0 ? h2hHomeWins / h2h.length : 0.5;

    // Features
    const hFormAvg = hs.recentForm.slice(0, 5).reduce((s, v) => s + v, 0) / Math.max(hs.recentForm.length, 1);
    const aFormAvg = as_.recentForm.slice(0, 5).reduce((s, v) => s + v, 0) / Math.max(as_.recentForm.length, 1);

    const features = [
      hFormAvg - aFormAvg,             // formDiff
      hs.wWinRate - as_.wWinRate,      // winDiff
      (hs.wGf - as_.wGf) / 4,         // attackDiff
      (as_.wGa - hs.wGa) / 4,         // defenseDiff
      h2hRate - 0.5,                   // h2hDiff
      0, // tiltDiff placeholder
      0, // revenge placeholder
      (hs.wGf - as_.wGf) * 0.15,      // style
      0, // drift placeholder
    ];

    points.push({ features, outcome: hg > ag ? 1 : 0 });
  }

  return points;
}

/* ─── 10. Platt Scaling ─── */

export interface PlattParams {
  a: number;
  b: number;
  trained: boolean;
  sampleSize: number;
}

export function trainPlatt(
  preds: { prob: number; actual: number }[],
  smoothing = 1.0,
): PlattParams {
  if (preds.length < 15) {
    return { a: 1, b: 0, trained: false, sampleSize: preds.length };
  }

  let A = 0;
  let B = 0;
  const lr = 0.01;
  const epochs = 300;
  const n = preds.length;

  const nPos = preds.filter((p) => p.actual === 1).length;
  const nNeg = n - nPos;
  const hiTarget = (nPos + smoothing) / (nPos + 2 * smoothing);
  const loTarget = smoothing / (nNeg + 2 * smoothing);

  for (let epoch = 0; epoch < epochs; epoch++) {
    let gradA = 0;
    let gradB = 0;

    for (const p of preds) {
      const f = Math.log(Math.max(p.prob, 0.001) / Math.max(1 - p.prob, 0.001));
      const t = p.actual === 1 ? hiTarget : loTarget;
      const q = sigmoidV3(A * f + B);
      gradA += (q - t) * f;
      gradB += q - t;
    }

    A -= (lr * gradA) / n;
    B -= (lr * gradB) / n;
  }

  return { a: A, b: B, trained: true, sampleSize: n };
}

export function applyPlatt(prob: number, params: PlattParams): number {
  if (!params.trained) return prob;
  const f = Math.log(Math.max(prob, 0.001) / Math.max(1 - prob, 0.001));
  return clampV3(sigmoidV3(params.a * f + params.b), 0.01, 0.99);
}

/* ─── Cálculo da taxa de empate da liga ─── */

export function leagueDrawRate(allMatches: MatchRecord[]): number {
  const finished = allMatches.filter((m) => m.homeGoals != null && m.awayGoals != null);
  if (!finished.length) return 0.22;
  const draws = finished.filter((m) => m.homeGoals === m.awayGoals).length;
  return draws / finished.length;
}

/* ─── Liga average goals (prior) ─── */

export function leagueAvgGoals(allMatches: MatchRecord[]): number {
  const finished = allMatches.filter((m) => m.homeGoals != null && m.awayGoals != null);
  if (!finished.length) return 2.5;
  const total = finished.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
  return total / finished.length;
}
