import type { DecisionMode, DecisionSummary } from "@/lib/types";

type DriftLevel = "estavel" | "atencao" | "critico";

type DecideInput = {
  mode: DecisionMode;
  signal: "over" | "under" | "neutro";
  score: number;
  effectiveGames: number;
  minGamesConfidence: number | null;
  intervalWidth: number;
  driftLevel: DriftLevel;
  edgeVsNeutral: number;
  adaptiveEdgeThreshold: number;
  probabilityRaw: number;
  probabilityCalibrated: number;
  oddOver?: number;
  pImplied?: number | null;
  reliabilityScore?: number | null;
  isCollectReliable?: boolean | null;
  antiFalseSignalPassed: boolean;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function toneByScore(score: number): DecisionSummary["confidence"] {
  if (score >= 75) return "alta";
  if (score >= 55) return "media";
  return "baixa";
}

function semaphoreByRecommendation(recommendation: DecisionSummary["recommendation"]): DecisionSummary["semaphore"] {
  if (recommendation === "APOSTAVEL") return "verde";
  if (recommendation === "CAUTELA") return "amarelo";
  return "vermelho";
}

function impliedProbability(odd?: number) {
  if (!odd || odd <= 1) return null;
  return 1 / odd;
}

export function decideRecommendation(input: DecideInput): DecisionSummary {
  const reasons: string[] = [];
  const contrarianReasons: string[] = [];

  const noSignal = input.signal === "neutro" || !input.antiFalseSignalPassed;
  const gateConfidencePassed =
    input.minGamesConfidence == null || input.effectiveGames >= input.minGamesConfidence;

  const gateIcPassed = input.intervalWidth <= 0.3;
  const gateDriftPassed = input.driftLevel !== "critico";
  const reliability = input.reliabilityScore ?? 100;
  const gateReliabilityPassed = (input.isCollectReliable ?? true) && reliability >= 60;

  const implied = input.pImplied ?? impliedProbability(input.oddOver);
  const edgeVsOdds = implied == null ? null : input.probabilityCalibrated - implied;
  const gateEdgePassed = implied == null ? input.edgeVsNeutral >= input.adaptiveEdgeThreshold : (edgeVsOdds ?? -1) >= 0.015;

  if (!gateConfidencePassed) {
    contrarianReasons.push("Amostra efetiva abaixo do mínimo de confiança.");
  } else {
    reasons.push("Gate CONFIDENCE aprovado.");
  }

  if (!gateIcPassed) {
    contrarianReasons.push("IC95% amplo; incerteza elevada.");
  } else {
    reasons.push("Gate IC aprovado (faixa de confiança aceitável).");
  }

  if (!gateDriftPassed) {
    contrarianReasons.push("Drift crítico no recorte atual.");
  } else if (input.driftLevel === "atencao") {
    contrarianReasons.push("Drift em atenção: reduzir agressividade.");
    reasons.push("Gate DRIFT parcial (atenção).");
  } else {
    reasons.push("Gate DRIFT aprovado.");
  }

  if (!gateEdgePassed) {
    contrarianReasons.push(
      implied == null
        ? "Edge abaixo da régua dinâmica mínima."
        : "Sem edge positivo vs odds disponíveis."
    );
  } else {
    reasons.push("Gate EDGE aprovado.");
  }

  if (!gateReliabilityPassed) {
    contrarianReasons.push("Confiabilidade de coleta baixa para entrada segura.");
  } else {
    reasons.push("Gate RELIABILITY aprovado.");
  }

  let recommendation: DecisionSummary["recommendation"] = "SEM_SINAL";

  if (noSignal) {
    recommendation = "SEM_SINAL";
  } else if (gateConfidencePassed && gateIcPassed && gateDriftPassed && gateEdgePassed && gateReliabilityPassed) {
    recommendation = "APOSTAVEL";
  } else if (gateConfidencePassed && gateEdgePassed) {
    recommendation = "CAUTELA";
  } else {
    recommendation = "EVITAR";
  }

  const confidenceBase = toneByScore(input.score);
  const confidence: DecisionSummary["confidence"] =
    recommendation === "APOSTAVEL"
      ? confidenceBase
      : confidenceBase === "alta"
        ? "media"
        : "baixa";

  const isBettable = recommendation === "APOSTAVEL";

  const edgeText = implied == null
    ? `Edge calibrado: ${(input.edgeVsNeutral * 100).toFixed(1)}pp`
    : `Edge vs odds: ${((edgeVsOdds ?? 0) * 100).toFixed(1)}pp`;

  reasons.unshift(`Prob. crua ${(clamp01(input.probabilityRaw) * 100).toFixed(1)}% → calibrada ${(clamp01(input.probabilityCalibrated) * 100).toFixed(1)}%.`);
  reasons.push(`Confiabilidade: ${Math.round(reliability)}/100`);
  reasons.push(edgeText);

  if (!noSignal && recommendation !== "APOSTAVEL") {
    const missing: string[] = [];
    if (!gateConfidencePassed) missing.push("CONFIDENCE");
    if (!gateIcPassed) missing.push("IC");
    if (!gateDriftPassed) missing.push("DRIFT");
    if (!gateEdgePassed) missing.push("EDGE");
    if (!gateReliabilityPassed) missing.push("RELIABILITY");
    if (missing.length) {
      reasons.push(`Para virar APOSTÁVEL falta: ${missing.join(" + ")}.`);
    }
  }

  return {
    mode: input.mode,
    score: input.score,
    signal: input.signal,
    recommendation,
    confidence,
    semaphore: semaphoreByRecommendation(recommendation),
    antiFalseSignalPassed: input.antiFalseSignalPassed,
    isBettable,
    gateConfidencePassed,
    gateDriftPassed,
    gateEdgePassed,
    gateIcPassed,
    gateReliabilityPassed,
    reliabilityScore: reliability,
    adaptiveEdgeThreshold: input.adaptiveEdgeThreshold,
    edgeVsNeutral: input.edgeVsNeutral,
    probabilityRaw: clamp01(input.probabilityRaw),
    probabilityCalibrated: clamp01(input.probabilityCalibrated),
    entryCondition: "Entrar somente com recomendação APOSTAVEL e todos os gates aprovados.",
    abortCondition: "Abortar com drift crítico, edge negativo ou confiança insuficiente.",
    reasons,
    contrarianReasons,
  };
}
