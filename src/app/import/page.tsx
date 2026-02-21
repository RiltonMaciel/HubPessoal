"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { buildDashboardData } from "@/lib/analytics";
import { buildCacheKey, normalizeKeyPart } from "@/lib/cache-keys";
import { buildDatasetVersion } from "@/lib/dataset-version";
import { resolvePendingPredictions } from "@/lib/prediction-ledger";
import { downloadTemplate, parseRawTextMatches, parseWorkbook, readWorkbook, validateWorkbook, type ParsedImportData } from "@/lib/excel";
import type { ImportSummary, MatchRecord, Odds1X2Record, OddsOuRecord, PlayerMapRecord, UpcomingRecord } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAppStore } from "@/store/appStore";

const steps = ["Upload", "Validar", "Limpar", "Concluir"];
const RAW_IMPORT_DRAFT_KEY = "hubpessoal-raw-import-draft-v1";
const IMPORT_QUALITY_KEY = "hubpessoal-import-quality-v1";

type PersistMode = "replace" | "append";

type ImportQualityGate = {
  score: number;
  level: "ok" | "warn" | "critical";
  reasons: string[];
  blockers: string[];
  sampleSize: number;
  uniquePairRatio: number;
  leagueCount: number;
  spanDays: number;
};

function evaluateImportQuality(parsed: ParsedImportData): ImportQualityGate {
  const matches = parsed.matches;
  const sampleSize = matches.length;
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 100;

  const pairSet = new Set<string>();
  const pairCounts = new Map<string, number>();
  const leagueSet = new Set<string>();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const item of matches) {
    const home = item.homeNick.trim().toLowerCase();
    const away = item.awayNick.trim().toLowerCase();
    const pair = [home, away].sort().join("|");
    pairSet.add(pair);
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    if (item.league) leagueSet.add(item.league);
    const timestamp = new Date(item.dateTime).getTime();
    if (!Number.isNaN(timestamp)) {
      if (timestamp < minTs) minTs = timestamp;
      if (timestamp > maxTs) maxTs = timestamp;
    }
  }

  const uniquePairRatio = sampleSize ? pairSet.size / sampleSize : 0;
  const maxPairCount = [...pairCounts.values()].reduce((acc, value) => Math.max(acc, value), 0);
  const maxPairShare = sampleSize ? maxPairCount / sampleSize : 0;
  const effectiveMatchups = (() => {
    if (!sampleSize) return 0;
    let sumSquares = 0;
    pairCounts.forEach((count) => {
      const p = count / sampleSize;
      sumSquares += p * p;
    });
    return sumSquares > 0 ? 1 / sumSquares : 0;
  })();
  const leagueCount = leagueSet.size;
  const spanDays = Number.isFinite(minTs) && Number.isFinite(maxTs)
    ? Math.max(0, (maxTs - minTs) / (1000 * 60 * 60 * 24))
    : 0;

  if (sampleSize < 40) {
    score -= 35;
    blockers.push("Amostra insuficiente (< 40 jogos).");
  } else if (sampleSize < 80) {
    score -= 15;
    reasons.push("Amostra curta; maior variância esperada.");
  }

  // Concentração de confrontos: repetição é normal (mesmos jogadores voltam a jogar),
  // mas a base vira frágil quando pouquíssimos confrontos dominam.
  if (pairSet.size <= 5 && sampleSize >= 40) {
    score -= 30;
    blockers.push(`Base com poucos confrontos únicos (${pairSet.size}).`);
  } else if (maxPairShare >= 0.5 && sampleSize >= 40) {
    score -= 30;
    blockers.push(`Base concentrada: o confronto mais repetido representa ${(maxPairShare * 100).toFixed(0)}% dos jogos.`);
  } else if (uniquePairRatio < 0.25 && sampleSize >= 40) {
    score -= 18;
    reasons.push(
      `Diversidade baixa: ${pairSet.size} confrontos únicos em ${sampleSize} jogos (top ${(maxPairShare * 100).toFixed(0)}%).`
    );
  } else if (maxPairShare > 0.3 && sampleSize >= 40) {
    score -= 10;
    reasons.push(`Concentração moderada: top confronto ${(maxPairShare * 100).toFixed(0)}% (matchups efetivos ${effectiveMatchups.toFixed(1)}).`);
  }

  if (spanDays < 7) {
    score -= 20;
    blockers.push("Janela temporal curta (< 7 dias). Possível sobreajuste de contexto.");
  } else if (spanDays < 21) {
    score -= 10;
    reasons.push("Janela temporal curta; risco de regime momentâneo.");
  }

  if (leagueCount === 1 && sampleSize > 120) {
    score -= 8;
    reasons.push("Concentração em uma única liga pode enviesar generalização.");
  }

  const removalRate = parsed.importSummary.linesRead ? parsed.importSummary.linesRemoved / parsed.importSummary.linesRead : 0;
  if (removalRate > 0.35) {
    score -= 12;
    reasons.push("Taxa alta de linhas descartadas na limpeza.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: ImportQualityGate["level"] = score < 55 || blockers.length ? "critical" : score < 75 ? "warn" : "ok";

  return {
    score,
    level,
    reasons,
    blockers,
    sampleSize,
    uniquePairRatio,
    leagueCount,
    spanDays,
  };
}

function matchFingerprint(match: MatchRecord) {
  return [
    match.dateTime,
    match.league,
    match.homeNick,
    match.awayNick,
    match.homeGoals,
    match.awayGoals,
  ].join("|");
}

function upcomingFingerprint(item: UpcomingRecord) {
  return [item.dateTime, item.league, item.homeNick, item.awayNick].join("|");
}

function odds1x2Fingerprint(item: Odds1X2Record) {
  return [item.dateTime, item.league, item.homeNick, item.awayNick, item.oddHome, item.oddDraw, item.oddAway].join("|");
}

function oddsOuFingerprint(item: OddsOuRecord) {
  return [item.dateTime, item.league, item.homeNick, item.awayNick, item.line, item.oddOver, item.oddUnder].join("|");
}

function playerFingerprint(item: PlayerMapRecord) {
  return item.nick.trim().toLowerCase();
}

function mergeByKey<T>(base: T[], incoming: T[], getKey: (item: T) => string) {
  const map = new Map<string, T>();
  base.forEach((item) => map.set(getKey(item), item));
  incoming.forEach((item) => map.set(getKey(item), item));
  return [...map.values()];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasDatasetVersion(payload: unknown, datasetVersion: string) {
  if (!isObjectRecord(payload)) return false;
  const value = payload.datasetVersion;
  return typeof value === "string" && value === datasetVersion;
}

export default function ImportPage() {
  const router = useRouter();
  const bumpDataRevision = useAppStore((state) => state.bumpDataRevision);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [qualityGate, setQualityGate] = useState<ImportQualityGate | null>(null);
  const [rawText, setRawText] = useState("");
  const [rawLeague, setRawLeague] = useState("eSoccer");
  const [rawYear, setRawYear] = useState(String(new Date().getFullYear()));
  const [rawPreview, setRawPreview] = useState<ParsedImportData | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(RAW_IMPORT_DRAFT_KEY);
    if (!saved) return;
    try {
      const draft = JSON.parse(saved) as { rawText?: string; rawLeague?: string; rawYear?: string };
      if (typeof draft.rawText === "string") setRawText(draft.rawText);
      if (typeof draft.rawLeague === "string" && draft.rawLeague) setRawLeague(draft.rawLeague);
      if (typeof draft.rawYear === "string" && draft.rawYear) setRawYear(draft.rawYear);
    } catch {
      window.localStorage.removeItem(RAW_IMPORT_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      RAW_IMPORT_DRAFT_KEY,
      JSON.stringify({ rawText, rawLeague, rawYear })
    );
  }, [rawText, rawLeague, rawYear]);

  useEffect(() => {
    const saved = window.localStorage.getItem(IMPORT_QUALITY_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as ImportQualityGate;
      setQualityGate(parsed);
    } catch {
      window.localStorage.removeItem(IMPORT_QUALITY_KEY);
    }
  }, []);

  const persistImportedData = async (parsed: ParsedImportData, mode: PersistMode = "replace") => {
    const baseMatches = mode === "append" ? await db.matches.toArray() : [];
    const baseUpcoming = mode === "append" ? await db.upcoming.toArray() : [];
    const baseOdds1x2 = mode === "append" ? await db.odds1x2.toArray() : [];
    const baseOddsOu = mode === "append" ? await db.oddsOu.toArray() : [];
    const basePlayers = mode === "append" ? await db.players.toArray() : [];

    const mergedMatches = mode === "append" ? mergeByKey(baseMatches, parsed.matches, matchFingerprint) : parsed.matches;
    const mergedUpcoming = mode === "append" ? mergeByKey(baseUpcoming, parsed.upcoming, upcomingFingerprint) : parsed.upcoming;
    const mergedOdds1x2 = mode === "append" ? mergeByKey(baseOdds1x2, parsed.odds1x2, odds1x2Fingerprint) : parsed.odds1x2;
    const mergedOddsOu = mode === "append" ? mergeByKey(baseOddsOu, parsed.oddsOu, oddsOuFingerprint) : parsed.oddsOu;
    const mergedPlayers = mode === "append" ? mergeByKey(basePlayers, parsed.players, playerFingerprint) : parsed.players;

    const validDates = mergedMatches
      .map((item) => new Date(item.dateTime))
      .filter((item) => !Number.isNaN(item.getTime()))
      .sort((a, b) => +a - +b);

    const mergedImportSummary: ImportSummary = {
      linesRead: parsed.importSummary.linesRead,
      linesValid: parsed.importSummary.linesValid,
      linesRemoved: parsed.importSummary.linesRemoved,
      leaguesDetected: [...new Set(mergedMatches.map((item) => item.league).filter(Boolean))],
      minDate: validDates[0]?.toISOString(),
      maxDate: validDates[validDates.length - 1]?.toISOString(),
    };
    const datasetVersion = buildDatasetVersion(mergedMatches);
    mergedImportSummary.datasetVersion = datasetVersion;

    const importedAt = new Date().toISOString();
    const dashboardCache = buildDashboardData({
      matches: mergedMatches,
      league: "all",
      period: "all",
      recencyOn: true,
      line: 6.5,
      decisionMode: "conservador",
      recencyFactor: parsed.config.recencyFactor,
      shrinkK: parsed.config.shrinkK,
      minGamesConfidence: parsed.config.minGamesConfidence ?? null,
    });
    const configWithDatasetVersion = {
      ...parsed.config,
      datasetVersion,
    };
    const presetId = "default";
    const market = "ou-6.5";
    const evalCacheKey = buildCacheKey("eval", datasetVersion, presetId, market, "all");
    const calibCacheKey = buildCacheKey("calib", datasetVersion, presetId, market, "all");
    const decisionCacheKey = buildCacheKey("decision", datasetVersion, presetId, market, "all");

    const beforeCounts = await Promise.all([
      db.matches.count(),
      db.upcoming.count(),
      db.odds1x2.count(),
      db.oddsOu.count(),
      db.players.count(),
    ]);

    await db.transaction(
      "rw",
      [db.matches, db.upcoming, db.odds1x2, db.oddsOu, db.config, db.players, db.rawDatasets, db.computedCache],
      async () => {
        await db.matches.clear();
        await db.upcoming.clear();
        await db.odds1x2.clear();
        await db.oddsOu.clear();
        await db.config.clear();
        await db.players.clear();
        await db.rawDatasets.clear();
        await db.computedCache.clear();

        await db.matches.bulkPut(mergedMatches);
        if (mergedUpcoming.length) await db.upcoming.bulkPut(mergedUpcoming);
        if (mergedOdds1x2.length) await db.odds1x2.bulkPut(mergedOdds1x2);
        if (mergedOddsOu.length) await db.oddsOu.bulkPut(mergedOddsOu);
        await db.config.add(configWithDatasetVersion);
        if (mergedPlayers.length) await db.players.bulkPut(mergedPlayers);

        await db.rawDatasets.add({
          id: "latest",
          datasetVersion,
          ...parsed,
          config: configWithDatasetVersion,
          matches: mergedMatches,
          upcoming: mergedUpcoming,
          odds1x2: mergedOdds1x2,
          oddsOu: mergedOddsOu,
          players: mergedPlayers,
          importSummary: mergedImportSummary,
          importedAt,
        });

        await db.computedCache.put({
          key: "latest",
          importedAt,
          payload: dashboardCache,
        });

        await db.computedCache.bulkPut([
          {
            key: evalCacheKey,
            importedAt,
            payload: {
              datasetVersion,
              league: "all",
              market,
              presetId,
              metrics: {
                accuracy: dashboardCache.backtest.accuracy ?? 0,
                brierScore: dashboardCache.backtest.brierScore ?? 0,
                logLoss: dashboardCache.backtest.logLoss ?? 0,
                reliabilityBins: dashboardCache.backtest.reliabilityBins ?? [],
              },
              backtest: dashboardCache.backtest,
            },
          },
          {
            key: calibCacheKey,
            importedAt,
            payload: {
              datasetVersion,
              league: "all",
              market,
              presetId,
              calibration: dashboardCache.calibration,
            },
          },
          {
            key: decisionCacheKey,
            importedAt,
            payload: {
              datasetVersion,
              league: "all",
              market,
              presetId,
              decision: dashboardCache.decision,
            },
          },
        ]);
      }
    );

    const afterCounts = await Promise.all([
      db.matches.count(),
      db.upcoming.count(),
      db.odds1x2.count(),
      db.oddsOu.count(),
      db.players.count(),
    ]);

    const expected = {
      matches: mergedMatches.length,
      upcoming: mergedUpcoming.length,
      odds1x2: mergedOdds1x2.length,
      oddsOu: mergedOddsOu.length,
      players: mergedPlayers.length,
    };

    if (
      afterCounts[0] !== expected.matches ||
      afterCounts[1] !== expected.upcoming ||
      afterCounts[2] !== expected.odds1x2 ||
      afterCounts[3] !== expected.oddsOu ||
      afterCounts[4] !== expected.players
    ) {
      throw new Error(
        `Falha de consistência pós-importação (matches ${afterCounts[0]}/${expected.matches}, upcoming ${afterCounts[1]}/${expected.upcoming}, odds1x2 ${afterCounts[2]}/${expected.odds1x2}, oddsOu ${afterCounts[3]}/${expected.oddsOu}, players ${afterCounts[4]}/${expected.players}).`
      );
    }

    const expectedKeys = ["latest", evalCacheKey, calibCacheKey, decisionCacheKey];
    const expectedNormalizedDatasetVersion = normalizeKeyPart(datasetVersion);
    const computedRows = await db.computedCache.toArray();
    const foundKeySet = new Set(computedRows.map((item) => item.key));

    const missingKeys = expectedKeys.filter((key) => !foundKeySet.has(key));
    if (missingKeys.length) {
      throw new Error(`Falha de consistência no computedCache: chaves ausentes (${missingKeys.join(", ")}).`);
    }

    const versionedRows = computedRows.filter((item) => item.key.startsWith("v1:"));
    const invalidKeyVersion = versionedRows.some((item) => !item.key.includes(`:${expectedNormalizedDatasetVersion}:`));
    if (invalidKeyVersion) {
      throw new Error("Falha de consistência no computedCache: chave versionada divergente do datasetVersion atual.");
    }

    const evalRow = computedRows.find((item) => item.key === evalCacheKey);
    const calibRow = computedRows.find((item) => item.key === calibCacheKey);
    const decisionRow = computedRows.find((item) => item.key === decisionCacheKey);

    if (!evalRow || !calibRow || !decisionRow) {
      throw new Error("Falha de consistência no computedCache: registros analíticos não encontrados.");
    }

    const payloadsAreVersioned = [evalRow.payload, calibRow.payload, decisionRow.payload].every((payload) =>
      hasDatasetVersion(payload, datasetVersion)
    );

    if (!payloadsAreVersioned) {
      throw new Error("Falha de consistência no computedCache: payload sem datasetVersion compatível.");
    }

    const ledgerResolution = await resolvePendingPredictions();

    return {
      totalMatches: mergedMatches.length,
      importSummary: mergedImportSummary,
      audit: {
        beforeMatches: beforeCounts[0],
        afterMatches: afterCounts[0],
        ledgerResolved: ledgerResolution.resolved,
        ledgerOpen: ledgerResolution.open,
      },
    };
  };

  const handleImport = async (file: File) => {
    setLoading(true);
    setMessage("");
    setStep(1);

    try {
      const workbook = await readWorkbook(file);
      setStep(2);
      const errors = validateWorkbook(workbook);
      if (errors.length) {
        setMessage(errors.join(" "));
        setLoading(false);
        return;
      }

      setStep(3);
      const parsed = parseWorkbook(workbook);
      const gate = evaluateImportQuality(parsed);
      setQualityGate(gate);
      window.localStorage.setItem(IMPORT_QUALITY_KEY, JSON.stringify(gate));
      const persisted = await persistImportedData(parsed, "replace");

      setSummary(persisted.importSummary);
      setStep(4);
      setMessage(
        gate.level === "critical"
          ? `Importação concluída com alerta de qualidade (${gate.score}/100). Base substituída: ${persisted.audit.beforeMatches} → ${persisted.audit.afterMatches} jogos.`
          : `Importação concluída. Base substituída: ${persisted.audit.beforeMatches} → ${persisted.audit.afterMatches} jogos.`
      );
      bumpDataRevision();
      setTimeout(() => router.push("/dashboard"), 900);
    } catch {
      setMessage("Falha ao importar o arquivo.");
    } finally {
      setLoading(false);
    }
  };

  const handleHardReset = async () => {
    if (!window.confirm("Isso vai apagar toda a base local (jogos, próximos, odds, players e cache). Deseja continuar?")) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const beforeMatches = await db.matches.count();

      await db.transaction(
        "rw",
        [db.matches, db.upcoming, db.odds1x2, db.oddsOu, db.config, db.players, db.rawDatasets, db.computedCache],
        async () => {
          await db.matches.clear();
          await db.upcoming.clear();
          await db.odds1x2.clear();
          await db.oddsOu.clear();
          await db.config.clear();
          await db.players.clear();
          await db.rawDatasets.clear();
          await db.computedCache.clear();
        }
      );

      const afterMatches = await db.matches.count();
      setSummary(null);
      setStep(1);
      setMessage(`Base local limpa com sucesso: ${beforeMatches} → ${afterMatches} jogos.`);
      bumpDataRevision();
    } catch {
      setMessage("Falha ao limpar a base local.");
    } finally {
      setLoading(false);
    }
  };

  const handleRawImport = async () => {
    setLoading(true);
    setMessage("");
    setStep(1);

    try {
      const parsed = parseRawTextMatches(rawText, {
        league: rawLeague,
        referenceYear: Number(rawYear),
      });

      if (!parsed.matches.length) {
        setMessage("Nenhuma linha válida encontrada. Verifique o formato do texto colado.");
        setLoading(false);
        return;
      }

      setStep(3);
      const gate = evaluateImportQuality(parsed);
      setQualityGate(gate);
      window.localStorage.setItem(IMPORT_QUALITY_KEY, JSON.stringify(gate));
      const persisted = await persistImportedData(parsed, "replace");
      setSummary(persisted.importSummary);
      setStep(4);
      setMessage(
        gate.level === "critical"
          ? `Importação por texto concluída com alerta de qualidade (${gate.score}/100). Base substituída: ${persisted.audit.beforeMatches} → ${persisted.audit.afterMatches} jogos.`
          : `Importação por texto concluída. Base substituída: ${persisted.audit.beforeMatches} → ${persisted.audit.afterMatches} jogos.`
      );
      bumpDataRevision();
      setTimeout(() => router.push("/dashboard"), 900);
    } catch {
      setMessage("Falha ao importar texto bruto.");
    } finally {
      setLoading(false);
    }
  };

  const handleRawPreview = () => {
    try {
      const parsed = parseRawTextMatches(rawText, {
        league: rawLeague,
        referenceYear: Number(rawYear),
      });

      if (!parsed.matches.length) {
        setRawPreview(null);
        setMessage("Nenhuma linha válida para prévia.");
        return;
      }

      setRawPreview(parsed);
      setMessage(`Prévia pronta: ${parsed.matches.length} jogos válidos (${parsed.importSummary.linesRemoved} removidos).`);
    } catch {
      setRawPreview(null);
      setMessage("Falha ao gerar prévia do texto bruto.");
    }
  };

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div><h3>Importar Excel (.xlsx)</h3><small>Schema V1 • Offline-first</small></div>
          <Button onClick={() => downloadTemplate()}>Baixar modelo Excel (.xlsx)</Button>
        </CardHeader>
        <CardBody>
          <div className="chips" style={{ marginBottom: 12 }}>
            {steps.map((item, index) => (
              <span key={item} className={`chip ${index + 1 <= step ? "active" : ""}`}>{index + 1}. {item}</span>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="btn primary" style={{ cursor: "pointer" }}>
              {loading ? "Processando..." : "Selecionar Arquivo"}
              <input
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                disabled={loading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImport(file);
                }}
              />
            </label>
            <Button onClick={() => void handleHardReset()} disabled={loading}>🧨 Limpeza total da base</Button>
            <Button onClick={() => router.push("/dashboard")}>Voltar ao dashboard</Button>
          </div>

          {message && <p style={{ marginTop: 12, color: "var(--muted)" }}>{message}</p>}
        </CardBody>
      </Card>

      {summary && (
        <Card className="col-12">
          <CardHeader>
            <div><h3>Import Summary</h3><small>Resultado da carga atual</small></div>
          </CardHeader>
          <CardBody>
            <div className="chips" style={{ marginBottom: 10 }}>
              <Badge>Linhas lidas: {summary.linesRead}</Badge>
              <Badge tone="good">Válidas: {summary.linesValid}</Badge>
              <Badge tone="warn">Removidas: {summary.linesRemoved}</Badge>
            </div>
            <p style={{ fontSize: 13, margin: 0, color: "var(--muted)" }}>Ligas detectadas: {summary.leaguesDetected.join(", ") || "-"}</p>
            <p style={{ fontSize: 13, marginBottom: 0, color: "var(--muted)" }}>
              Intervalo de datas: {summary.minDate ? new Date(summary.minDate).toLocaleString("pt-BR") : "-"} até {summary.maxDate ? new Date(summary.maxDate).toLocaleString("pt-BR") : "-"}
            </p>
          </CardBody>
        </Card>
      )}

      {qualityGate && (
        <Card className="col-12">
          <CardHeader>
            <div><h3>Quality Gate</h3><small>Diagnóstico semântico para assertividade da análise</small></div>
          </CardHeader>
          <CardBody>
            <div className="chips" style={{ marginBottom: 10 }}>
              <Badge tone={qualityGate.level === "ok" ? "good" : qualityGate.level === "warn" ? "warn" : "bad"}>Score: {qualityGate.score}/100</Badge>
              <Badge>Amostra: {qualityGate.sampleSize}</Badge>
              <Badge>Pair ratio: {(qualityGate.uniquePairRatio * 100).toFixed(1)}%</Badge>
              <Badge>Ligas: {qualityGate.leagueCount}</Badge>
              <Badge>Janela: {qualityGate.spanDays.toFixed(1)} dias</Badge>
            </div>

            {!!qualityGate.blockers.length && (
              <div className="list" style={{ marginBottom: 10 }}>
                {qualityGate.blockers.map((item) => (
                  <div key={item} className="row"><div className="left"><small style={{ color: "var(--danger)" }}>{item}</small></div></div>
                ))}
              </div>
            )}

            {!!qualityGate.reasons.length && (
              <div className="list">
                {qualityGate.reasons.map((item) => (
                  <div key={item} className="row"><div className="left"><small style={{ color: "var(--muted)" }}>{item}</small></div></div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="col-12">
        <CardHeader>
          <div><h3>Importar texto bruto (site)</h3><small>Cole as linhas no formato: DataHora, Home v Away, placar</small></div>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, marginBottom: 10 }}>
            <input
              className="select"
              value={rawLeague}
              onChange={(event) => setRawLeague(event.target.value)}
              placeholder="Liga"
              aria-label="Liga do texto bruto"
            />
            <input
              className="select"
              value={rawYear}
              onChange={(event) => setRawYear(event.target.value)}
              placeholder="Ano"
              aria-label="Ano base"
            />
            <div className="mini" style={{ alignSelf: "center" }}>
              Aceita: 02/18 01:16 ... 2-1
            </div>
            <Button variant="primary" disabled={loading} onClick={() => void handleRawImport()}>
              {loading ? "Importando..." : "Importar texto"}
            </Button>
            <Button disabled={loading} onClick={handleRawPreview}>Pré-visualizar</Button>
          </div>

          <div className="chips" style={{ marginBottom: 10 }}>
            <span className="chip active">Modo fixo: Substituir base</span>
            <span className="mini">Cada importação por texto zera a base anterior e mantém só os dados colados.</span>
          </div>

          <textarea
            className="select"
            rows={14}
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="Cole aqui as linhas do site (com ou sem TAB)."
            aria-label="Texto bruto para importação"
            style={{ width: "100%", resize: "vertical" }}
          />

          {rawPreview && (
            <div style={{ marginTop: 12 }}>
              <div className="chips" style={{ marginBottom: 10 }}>
                <Badge>Prévia: {rawPreview.matches.length} jogos</Badge>
                <Badge>Linhas lidas: {rawPreview.importSummary.linesRead}</Badge>
                <Badge tone="warn">Descartadas: {rawPreview.importSummary.linesRemoved}</Badge>
              </div>
              <div className="list">
                {rawPreview.matches.slice(0, 5).map((item) => (
                  <div className="row" key={item.id}>
                    <div className="left"><small>{new Date(item.dateTime).toLocaleString("pt-BR")}</small></div>
                    <div className="metric"><small>{item.homeNick} {item.homeGoals}-{item.awayGoals} {item.awayNick}</small></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
