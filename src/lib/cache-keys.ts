export function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function buildCacheKey(
  featureFlags: "eval" | "calib" | "decision" | "derived",
  datasetVersion: string,
  presetId: string,
  market: string,
  league: string
) {
  return `v1:${normalizeKeyPart(datasetVersion)}:${normalizeKeyPart(presetId)}:${normalizeKeyPart(market)}:${normalizeKeyPart(league || "all")}:${normalizeKeyPart(featureFlags)}`;
}
