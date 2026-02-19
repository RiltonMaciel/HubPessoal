import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { buildMatchKey } from "@/lib/match-key";
import type {
  Confidence,
  ConfidenceUpper,
  MatchRecord,
  PerformanceSummary,
  PredictionLedgerRecord,
  RecommendationStatus,
  UpcomingRecord,
} from "@/lib/types";

function normalizeConfidence(confidence: Confidence): ConfidenceUpper {
  if (confidence === "alta") return "ALTA";
  if (confidence === "media") return "MEDIA";
  return "BAIXA";
}

function resolveOutcomeByMarket(match: MatchRecord, market: string) {
  const total = match.homeGoals + match.awayGoals;
  const isHome = match.homeGoals > match.awayGoals;
  const isAway = match.homeGoals < match.awayGoals;

  return {
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    result1x2: isHome ? "home" : isAway ? "away" : "draw",
    overByLine: {
      "ou2.5": total > 2.5,
      "ou3.5": total > 3.5,
      "ou4.5": total > 4.5,
      "ou5.5": total > 5.5,
      "ou6.5": total > 6.5,
      [market]: /ou\d+(\.\d+)?/i.test(market) ? total > Number(market.replace("ou", "")) : false,
    },
    btts: match.homeGoals > 0 && match.awayGoals > 0,
  } as const;
}

export type LogPredictionArgs = {
  datasetVersion?: string | null;
  modelVersion?: string;
  presetId: string;
  routeContext: PredictionLedgerRecord["routeContext"];
  match: Pick<MatchRecord, "dateTime" | "league" | "homeNick" | "awayNick"> | Pick<UpcomingRecord, "dateTime" | "league" | "homeNick" | "awayNick">;
  market: string;
  pRaw: number;
  pCalibrated: number;
  decision: RecommendationStatus;
  confidence: Confidence;
  reasons: string[];
  contraReasons: string[];
  inputSnapshot?: unknown;
  reliabilityScore?: number | null;
  isCollectReliable?: boolean | null;
};

export async function logPrediction(args: LogPredictionArgs) {
  const createdAt = new Date().toISOString();
  const matchKey = buildMatchKey(args.match);

  const duplicate = await db.predictionLedger
    .where("matchKey")
    .equals(matchKey)
    .and((item) =>
      item.market === args.market &&
      item.routeContext === args.routeContext &&
      item.decision === args.decision &&
      item.resolvedAt == null
    )
    .first();

  if (duplicate) return duplicate;

  const row: PredictionLedgerRecord = {
    id: uuidv4(),
    createdAt,
    resolvedAt: null,
    datasetVersion: args.datasetVersion ?? null,
    modelVersion: args.modelVersion ?? "model:v1",
    presetId: args.presetId,
    routeContext: args.routeContext,
    matchKey,
    league: args.match.league,
    market: args.market,
    pRaw: args.pRaw,
    pCalibrated: args.pCalibrated,
    decision: args.decision,
    confidence: normalizeConfidence(args.confidence),
    reasons: args.reasons,
    contraReasons: args.contraReasons,
    inputSnapshot: args.inputSnapshot,
    reliabilityScore: args.reliabilityScore ?? null,
    isCollectReliable: args.isCollectReliable ?? null,
    outcome: null,
  };

  await db.predictionLedger.put(row);
  return row;
}

export async function resolvePendingPredictions() {
  // Dexie não aceita `null` como key em equals(); como armazenamos `resolvedAt: null` para pendentes,
  // usamos filter() (in-memory) para evitar "Invalid key provided".
  const open = await db.predictionLedger
    .filter((item) => item.resolvedAt == null)
    .toArray();

  if (!open.length) return { resolved: 0, open: 0 };

  const matches = await db.matches.toArray();
  const byMatchKey = new Map<string, MatchRecord>();
  matches.forEach((match) => {
    byMatchKey.set(buildMatchKey(match), match);
  });

  let resolved = 0;
  for (const item of open) {
    const match = byMatchKey.get(item.matchKey);
    if (!match) continue;

    await db.predictionLedger.update(item.id, {
      resolvedAt: new Date().toISOString(),
      outcome: resolveOutcomeByMarket(match, item.market),
    });
    resolved += 1;
  }

  return { resolved, open: open.length - resolved };
}

export async function getOpenPredictions() {
  return db.predictionLedger.filter((item) => item.resolvedAt == null).toArray();
}

export async function getLedgerByPreset(params: {
  presetId?: string;
  market?: string;
  league?: string;
  from?: string;
  to?: string;
}) {
  const rows = await db.predictionLedger.toArray();
  return rows.filter((item) => {
    if (params.presetId && item.presetId !== params.presetId) return false;
    if (params.market && item.market !== params.market) return false;
    if (params.league && item.league !== params.league) return false;
    if (params.from && item.createdAt < params.from) return false;
    if (params.to && item.createdAt > params.to) return false;
    return true;
  });
}

function resolveHit(item: PredictionLedgerRecord) {
  if (!item.outcome) return null;

  if (item.market.toLowerCase().startsWith("ou")) {
    const key = item.market.toLowerCase();
    const marketResult = item.outcome.overByLine[key];
    if (typeof marketResult !== "boolean") return null;

    if (item.pCalibrated >= 0.5) return marketResult ? 1 : 0;
    return !marketResult ? 1 : 0;
  }

  if (item.market.toLowerCase() === "btts") {
    if (item.pCalibrated >= 0.5) return item.outcome.btts ? 1 : 0;
    return !item.outcome.btts ? 1 : 0;
  }

  return null;
}

export async function getPerformanceSummary(params?: {
  presetId?: string;
  market?: string;
  league?: string;
}): Promise<PerformanceSummary> {
  const rows = await getLedgerByPreset({
    presetId: params?.presetId,
    market: params?.market,
    league: params?.league,
  });

  const resolved = rows.filter((item) => !!item.resolvedAt && !!item.outcome);
  const hits = resolved
    .map((item) => resolveHit(item))
    .filter((value): value is 0 | 1 => value === 0 || value === 1);

  const brier = resolved.length
    ? resolved.reduce((acc, item) => {
        const hit = resolveHit(item);
        if (hit == null) return acc;
        return acc + (item.pCalibrated - hit) ** 2;
      }, 0) / resolved.length
    : 0;

  const byDecision: PerformanceSummary["byDecision"] = {
    APOSTAVEL: 0,
    CAUTELA: 0,
    EVITAR: 0,
    SEM_SINAL: 0,
  };

  rows.forEach((item) => {
    byDecision[item.decision] += 1;
  });

  return {
    total: rows.length,
    resolved: resolved.length,
    unresolved: rows.length - resolved.length,
    hitRate: hits.length ? hits.reduce<number>((acc, value) => acc + value, 0) / hits.length : 0,
    brier,
    byDecision,
  };
}
