import type { CalibrationSummary } from "@/lib/types";
import { computeMetrics, type PredictionPoint } from "@/lib/evaluation";

export type CalibrationSample = {
  pRaw: number;
  outcome: 0 | 1;
};

export type PlattModel = {
  method: "platt";
  a: number;
  b: number;
  sampleSize: number;
};

export type IdentityModel = {
  method: "identity";
  sampleSize: number;
};

export type CalibratorModel = PlattModel | IdentityModel;

const EPSILON = 1e-6;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

export function fitCalibrator(samples: CalibrationSample[]): CalibratorModel {
  if (samples.length < 40) {
    return {
      method: "identity",
      sampleSize: samples.length,
    };
  }

  let a = 1;
  let b = 0;
  const learningRate = 0.35;
  const iterations = 450;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let gradA = 0;
    let gradB = 0;

    for (const sample of samples) {
      const raw = Math.min(1 - EPSILON, Math.max(EPSILON, sample.pRaw));
      const logit = Math.log(raw / (1 - raw));
      const predicted = sigmoid(a * logit + b);
      const error = predicted - sample.outcome;
      gradA += error * logit;
      gradB += error;
    }

    gradA /= samples.length;
    gradB /= samples.length;

    a -= learningRate * gradA;
    b -= learningRate * gradB;
  }

  return {
    method: "platt",
    a,
    b,
    sampleSize: samples.length,
  };
}

export function applyCalibrator(model: CalibratorModel, pRaw: number) {
  const raw = clamp01(pRaw);
  if (model.method === "identity") return raw;
  const clipped = Math.min(1 - EPSILON, Math.max(EPSILON, raw));
  const logit = Math.log(clipped / (1 - clipped));
  return clamp01(sigmoid(model.a * logit + model.b));
}

export function summarizeCalibration(samples: CalibrationSample[], model: CalibratorModel): CalibrationSummary {
  const rawPoints: PredictionPoint[] = samples.map((sample) => ({
    dateTime: "",
    probability: sample.pRaw,
    outcome: sample.outcome,
  }));
  const calibratedPoints: PredictionPoint[] = samples.map((sample) => ({
    dateTime: "",
    probability: applyCalibrator(model, sample.pRaw),
    outcome: sample.outcome,
  }));

  const rawMetrics = computeMetrics(rawPoints);
  const calibratedMetrics = computeMetrics(calibratedPoints);

  return {
    method: model.method,
    sampleSize: samples.length,
    brierRaw: rawMetrics.brierScore,
    brierScore: calibratedMetrics.brierScore,
    logLossRaw: rawMetrics.logLoss,
    logLoss: calibratedMetrics.logLoss,
    byBin: calibratedMetrics.reliabilityBins,
  };
}
