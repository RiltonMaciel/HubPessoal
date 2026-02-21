"use client";

import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { buildDashboardData } from "@/lib/analytics";
import { applyAliasesToMatches, getAliasMap, upsertAlias } from "@/lib/aliases";
import { buildCacheKey } from "@/lib/cache-keys";
import { formatDateTimePtBr, toIsoDateTime } from "@/lib/datetime";
import { logPrediction, getPerformanceSummary, resolvePendingPredictions } from "@/lib/prediction-ledger";
import { addWatchlist, inWatchlist, listWatchlist, removeWatchlist } from "@/lib/watchlist";
import type { DataQualityReport, FilterPresetRecord, MatchRecord, PerformanceSummary, PlayerSummary, UpcomingRecord, WatchlistRecord } from "@/lib/types";
import { useAppStore } from "@/store/appStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoHint } from "@/components/ui/InfoHint";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table } from "@/components/ui/Table";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { buildDerivedSignalIndex, computeDerivedSignals } from "@/lib/derived-signals";
import { findOdds1x2, findOddsOu, implied1x2FromOdds, impliedOuFromOdds } from "@/lib/odds";

const lines = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
type TabKey = "best" | "worst" | "over" | "under" | "btts";

const HELP = {
  leagueChip: "Liga selecionada para análise.\nMostra somente partidas dessa competição no dashboard.\nUse 'Todas' para visão global e comparação geral.",
  periodChip: "Janela de tempo do cálculo analítico.\n7/15/30 dias focam no curto prazo.\n'Tudo' usa todo o histórico disponível.",
  recencyChip: "Recência ON aplica peso maior aos jogos mais recentes.\nRecência OFF trata todos os jogos com o mesmo peso.\nÚtil para alternar entre tendência e estabilidade.",
  lineChip: "Linha de gols ativa para mercado Over/Under.\nImpacta rankings, sinal, backtest e score de decisão.\nClique para alternar entre 2.5 e 7.5.",
  bettableChip: "Filtro de qualidade para picks apostáveis.\nMantém apenas cenários com amostra mínima, intervalo aceitável e edge consistente.\nReduz ruído e falsos positivos.",
  modeSelect: "Modo Conservador exige mais evidência para liberar sinal.\nModo Agressivo reage mais rápido a tendência recente.\nEscolha conforme seu perfil de risco.",
  confidenceSelect: "Filtra jogadores por confiabilidade estatística.\nAlta: base mais robusta.\nBaixa: maior chance de oscilação.",
  gamesKpi: "Total de partidas válidas no filtro atual.\nQuanto maior a amostra, mais estável tende a ser a leitura.\nAmostra muito baixa aumenta risco de ruído.",
  avgGoalsKpi: "Média de gols por jogo no recorte selecionado.\nAjuda a identificar ritmo ofensivo da liga.\nUse junto com n efetivo para evitar superinterpretação.",
  overKpi: "Probabilidade estimada de Over na linha atual.\nO IC95% mostra faixa provável da taxa real.\nFaixa larga = maior incerteza.",
  bttsKpi: "Probabilidade estimada de BTTS (ambas marcam).\nTambém usa intervalo de confiança para transparência.\nCompare com Over para confirmar cenário.",
  leagueLines: "Distribuição de Over por linha da liga filtrada.\nBarras maiores indicam maior frequência de over na linha.\nServe para mapear comportamento estrutural do mercado.",
  actionDay: "Resumo da recomendação atual do sistema.\nCombina score, intervalo, amostra e backtest.\nAnti-falso-sinal bloqueia entradas frágeis.",
  adaptiveThreshold: "Threshold adaptativo ajusta automaticamente a exigência mínima de edge.\nAumenta a régua quando há mais incerteza ou amostra fraca.\nReduz entradas de baixa qualidade.",
  walkForward: "Walk-forward testa o método em ordem temporal real (passado -> futuro).\nEvita vazamento de informação e mede robustez fora da amostra.\nQuanto maior o uplift vs baseline, melhor.",
  execSummary: "Leitura executiva em poucas linhas.\nFoca no que muda decisão prática agora.\nIdeal para revisão rápida antes de agir.",
  rankings: "Classificação dos jogadores por aba selecionada.\nPode alternar entre PPG, Over, Under e BTTS.\nUse com filtro Apostáveis para reduzir ruído.",
  upcoming: "Partidas futuras importadas na aba PROXIMOS.\nNão entram no histórico de resultado.\nServem para monitoramento e preparação de entrada.",
  recentGames: "Tabela dos jogos recentes do recorte atual.\nPermite auditoria visual do padrão de resultados.\nCSV exporta essa visão para análise externa.",
  backtest: "Teste retrospectivo dos picks recentes do modelo.\nCompara taxa de acerto com baseline aleatório e baseline da liga.\nUplift positivo sugere vantagem no recorte.",
  quality: "Qualidade da importação e consistência dos dados.\nMostra remoções por regra e possíveis problemas por liga.\nUse para validar se o dataset está confiável.",
  calibration: "Calibração compara probabilidade prevista vs resultado real.\nBrier Score mais baixo indica melhor qualidade probabilística.\nBins mostram se o modelo está super/ subestimando.",
  drift: "Drift detecta mudança de regime entre janelas recentes e anteriores.\nSe o drift estiver crítico, sinais antigos podem perder validade.\nUse para evitar decisões em cenário instável.",
  bias: "Diagnóstico de viés mede concentração e diversidade de confrontos.\nConcentração alta pode inflar falso sinal.\nUse junto do semáforo para bloquear entradas frágeis.",
  sensitivity: "Sensibilidade testa estabilidade do Over ao variar recencyFactor.\nSpread baixo indica recomendação robusta.\nSpread alto exige cautela extra.",
  history: "Histórico de decisões ajuda auditar consistência do processo.\nCada snapshot salva contexto e sinal do momento.\nIdeal para aprender com acertos e erros.",
  contrarian: "Explicação contrária lista motivos para não entrar no mercado.\nReduz viés de confirmação e melhora disciplina.\nSempre valide este bloco antes de decidir.",
} as const;

function confidenceTone(conf: PlayerSummary["confidence"]) {
  if (conf === "alta") return "good" as const;
  if (conf === "media") return "warn" as const;
  return "bad" as const;
}

function decisionModeLabel(mode: "conservador" | "agressivo") {
  return mode === "conservador" ? "Conservador" : "Agressivo";
}

function decisionSignalLabel(signal: "over" | "under" | "neutro") {
  if (signal === "over") return "Tendência Over";
  if (signal === "under") return "Tendência Under";
  return "Sem sinal";
}

function semaphoreTone(semaphore: "verde" | "amarelo" | "vermelho") {
  if (semaphore === "verde") return "good" as const;
  if (semaphore === "amarelo") return "warn" as const;
  return "bad" as const;
}

function simplifyDecisionReason(reason: string) {
  if (reason.startsWith("Edge da linha")) {
    return reason.replace("Edge da linha", "Força da linha");
  }
  if (reason.startsWith("IC95% Over")) {
    return reason.replace("IC95%", "Faixa de confiança (95%)");
  }
  if (reason.startsWith("Prob. crua")) {
    return reason.replace("Prob. crua", "Probabilidade (raw)").replace("calibrada", "calibrada");
  }
  if (reason.startsWith("Backtest:")) {
    return reason.replace("Backtest:", "Teste recente:");
  }
  if (reason.startsWith("Walk-forward:")) {
    return reason.replace("Walk-forward:", "Validação temporal:");
  }
  if (reason.startsWith("Threshold adaptativo:")) {
    return reason
      .replace("Threshold adaptativo:", "Régua dinâmica:")
      .replace("edge atual", "força atual");
  }
  if (reason.includes("Anti-falso-sinal: aprovado")) {
    return "Filtro de proteção: aprovado.";
  }
  if (reason.includes("Anti-falso-sinal: bloqueado")) {
    return "Filtro de proteção: bloqueado (evita entrada fraca).";
  }
  return reason;
}

function simplifyExecutiveSummary(item: string) {
  if (item.startsWith("Sinal final:")) {
    return item
      .replace("Sinal final:", "Leitura final:")
      .replace("OVER", "Tendência Over")
      .replace("UNDER", "Tendência Under")
      .replace("NEUTRO", "Sem sinal")
      .replace("(conservador)", "(modo conservador)")
      .replace("(agressivo)", "(modo agressivo)");
  }
  if (item.includes("n efetivo")) {
    return item.replace("n efetivo", "amostra efetiva");
  }
  if (item.startsWith("IC95% Over")) {
    return item.replace("IC95%", "Faixa de confiança (95%)");
  }
  if (item.startsWith("Backtest")) {
    return item.replace("Backtest", "Teste recente");
  }
  if (item.startsWith("Walk-forward")) {
    return item
      .replace("Walk-forward", "Validação temporal")
      .replace("baseline", "base");
  }
  return item;
}

export default function DashboardPage() {
  const {
    league,
    period,
    recencyOn,
    line,
    decisionMode,
    confidence,
    dataRevision,
    setLeague,
    setPeriod,
    setRecencyOn,
    setLine,
    setDecisionMode,
    setConfidence,
    resetFilters,
    setDatasetMeta,
  } = useAppStore();

  const [isLoading, setIsLoading] = useState(true);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingRecord[]>([]);
  const [quality, setQuality] = useState<DataQualityReport | null>(null);
  const [warning, setWarning] = useState("");
  const [rankTab, setRankTab] = useState<TabKey>("best");
  const [presets, setPresets] = useState<FilterPresetRecord[]>([]);
  const [showQuality, setShowQuality] = useState(true);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [nowTs] = useState(() => Date.now());
  const [bettableOnly, setBettableOnly] = useState(false);
  const [showRankingFull, setShowRankingFull] = useState(false);
  const [showUpcomingFull, setShowUpcomingFull] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [decisionHistory, setDecisionHistory] = useState<Array<{ at: string; score: number; signal: string; semaphore: string; league: string; line: number }>>([]);
  const [datasetVersion, setDatasetVersion] = useState<string | null>(null);
  const [importedAt, setImportedAt] = useState<string | null>(null);
  const [minGamesConfidence, setMinGamesConfidence] = useState<number | null>(null);
  const [importRemovalRate, setImportRemovalRate] = useState(0);
  const [aliasMap, setAliasMap] = useState<Map<string, string>>(new Map());
  const [aliasRows, setAliasRows] = useState<Array<{ original: string; canonico: string }>>([]);
  const [aliasOriginal, setAliasOriginal] = useState("");
  const [aliasCanonico, setAliasCanonico] = useState("");
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRecord[]>([]);
  const [watchlistInput, setWatchlistInput] = useState("");
  const [performance, setPerformance] = useState<PerformanceSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [contextOdds1x2, setContextOdds1x2] = useState<null | { implied: ReturnType<typeof implied1x2FromOdds>; edgeFav: number | null }>(null);
  const [contextOddsOu, setContextOddsOu] = useState<null | { implied: ReturnType<typeof impliedOuFromOdds>; edgeOver: number | null }>(null);

  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const reloadPresets = async () => {
    setPresets(await db.presets.orderBy("updatedAt").reverse().toArray());
  };

  const reloadAliases = async () => {
    const map = await getAliasMap();
    setAliasMap(map);
    setAliasRows([...map.entries()].map(([original, canonico]) => ({ original, canonico })));
  };

  const reloadWatchlist = async () => {
    setWatchlistRows(await listWatchlist());
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setLoadError("");

      try {
        const [matchRows, upcomingRows, rawDataset] = await Promise.all([
          db.matches.toArray(),
          db.upcoming.orderBy("dateTime").toArray(),
          db.rawDatasets.get("latest"),
        ]);
        const config = await db.config.toCollection().last();

        if (cancelled) return;

        const effectiveMatches = matchRows;
        const effectiveUpcoming = upcomingRows;

        setMatches(effectiveMatches);
        setUpcoming(effectiveUpcoming);
        setQuality(rawDataset?.quality ?? null);
        setImportRemovalRate(rawDataset?.importSummary.linesRead
          ? (rawDataset.importSummary.linesRemoved / rawDataset.importSummary.linesRead)
          : 0);
        setDatasetVersion(rawDataset?.datasetVersion ?? config?.datasetVersion ?? null);
        setImportedAt(rawDataset?.importedAt ?? null);
        setMinGamesConfidence(config?.minGamesConfidence ?? null);

        await resolvePendingPredictions();
        await reloadAliases();
        await reloadWatchlist();
        await reloadPresets();

        if (cancelled) return;

        const leagues = [...new Set(effectiveMatches.map((item) => item.league).filter(Boolean))];
        const validDates = effectiveMatches
          .map((item) => new Date(item.dateTime))
          .filter((item) => !Number.isNaN(item.getTime()))
          .sort((a, b) => +a - +b);

        setDatasetMeta({
          totalGames: effectiveMatches.length,
          leagues,
          dateMin: validDates[0]?.toISOString(),
          dateMax: validDates[validDates.length - 1]?.toISOString(),
          lastImportAt: rawDataset?.importedAt,
          datasetSizeLabel: `${effectiveMatches.length.toLocaleString("pt-BR")} jogos`,
        });

        // Se o usuário manteve filtros antigos (persistidos) e a nova base não bate,
        // o dashboard pode parecer "não carregou" (0 jogos). Auto-corrige para defaults.
        if (effectiveMatches.length > 0) {
          const leagueSet = new Set(leagues);
          if (league !== "all" && !leagueSet.has(league)) {
            setLeague("all");
          }

          if (period !== "all") {
            const now = Date.now();
            const windowDays = Number(period);
            const windowMs = Number.isFinite(windowDays) ? windowDays * 24 * 60 * 60 * 1000 : 0;
            const minTs = windowMs ? now - windowMs : Number.NEGATIVE_INFINITY;

            const candidateMatches = effectiveMatches.filter((m) => (league === "all" ? true : m.league === league));
            const inWindow = candidateMatches.filter((m) => {
              const ts = new Date(m.dateTime).getTime();
              return Number.isFinite(ts) && ts >= minTs;
            });

            if (!inWindow.length) {
              setPeriod("all");
            }
          }
        }
      } catch (error) {
        console.error("[dashboard] falha ao carregar base local", error);
        if (cancelled) return;
        setMatches([]);
        setUpcoming([]);
        setQuality(null);
        setImportRemovalRate(0);
        setDatasetVersion(null);
        setImportedAt(null);
        setMinGamesConfidence(null);
        setDatasetMeta({
          totalGames: 0,
          leagues: [],
          datasetSizeLabel: "Sem dataset",
          lastImportAt: undefined,
          dateMin: undefined,
          dateMax: undefined,
        });

        const message = error instanceof Error ? error.message : String(error);
        setLoadError(
          "Não foi possível carregar os dados locais (IndexedDB). " +
          "Se isso começou após uma atualização, vá em /import e use 'Limpeza total da base' e importe novamente. " +
          `Detalhe: ${message}`
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setDatasetMeta, dataRevision]);

  const aliasedMatches = useMemo(
    () => applyAliasesToMatches(matches, aliasMap),
    [matches, aliasMap]
  );

  const derivedIndex = useMemo(() => buildDerivedSignalIndex(aliasedMatches), [aliasedMatches]);

  const contextUpcomingMatch = useMemo(() => {
    if (!upcoming.length) return null;
    const filteredByLeague = upcoming.filter((item) => league === "all" || item.league === league);
    return filteredByLeague[0] ?? upcoming[0] ?? null;
  }, [upcoming, league]);

  const contextSignals = useMemo(() => {
    if (!contextUpcomingMatch) return null;
    if (!aliasedMatches.length) return null;
    return computeDerivedSignals({
      match: contextUpcomingMatch,
      index: derivedIndex,
      ouLine: line,
      sessionGapMinutes: 45,
      validateLeague: true,
    });
  }, [contextUpcomingMatch, aliasedMatches.length, derivedIndex, line]);

  const dashboard = useMemo(
    () => buildDashboardData({ matches: aliasedMatches, league, period, recencyOn, line, decisionMode, minGamesConfidence }),
    [aliasedMatches, league, period, recencyOn, line, decisionMode, minGamesConfidence]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setContextOdds1x2(null);
      setContextOddsOu(null);
      if (!contextUpcomingMatch) return;

      try {
        const [odds1x2Rows, oddsOuRows] = await Promise.all([
          db.odds1x2.toArray(),
          db.oddsOu.toArray(),
        ]);

        if (cancelled) return;

        const odds1x2 = findOdds1x2(odds1x2Rows, {
          league: contextUpcomingMatch.league,
          dateTime: contextUpcomingMatch.dateTime,
          homeNick: contextUpcomingMatch.homeNick,
          awayNick: contextUpcomingMatch.awayNick,
        });

        if (odds1x2) {
          const implied = implied1x2FromOdds(odds1x2.oddHome, odds1x2.oddDraw, odds1x2.oddAway);
          setContextOdds1x2({ implied, edgeFav: null });
        }

        const oddsOu = findOddsOu(oddsOuRows, {
          league: contextUpcomingMatch.league,
          dateTime: contextUpcomingMatch.dateTime,
          homeNick: contextUpcomingMatch.homeNick,
          awayNick: contextUpcomingMatch.awayNick,
          line,
        });

        if (oddsOu) {
          const implied = impliedOuFromOdds(oddsOu.oddOver, oddsOu.oddUnder);
          const pModel = dashboard.decision.probabilityCalibrated ?? dashboard.calibration.currentCalibrated ?? null;
          const edgeOver = implied && pModel != null ? pModel - implied.over : null;
          setContextOddsOu({ implied, edgeOver });
        }
      } catch (error) {
        console.warn("[dashboard] falha ao buscar odds no IndexedDB", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contextUpcomingMatch, line, dashboard.decision.probabilityCalibrated, dashboard.calibration.currentCalibrated]);

  useEffect(() => {
    if (!datasetVersion || !importedAt || !dashboard.totalGames) return;
    const presetId = selectedPresetId || "adhoc";
    const market = `ou${line}`;

    void db.computedCache.bulkPut([
      {
        key: buildCacheKey("eval", datasetVersion, presetId, market, league),
        importedAt,
        payload: {
          datasetVersion,
          league,
          market,
          presetId,
          metrics: {
            accuracy: dashboard.backtest.accuracy ?? 0,
            brierScore: dashboard.backtest.brierScore ?? 0,
            logLoss: dashboard.backtest.logLoss ?? 0,
            reliabilityBins: dashboard.backtest.reliabilityBins ?? [],
          },
          backtest: dashboard.backtest,
        },
      },
      {
        key: buildCacheKey("calib", datasetVersion, presetId, market, league),
        importedAt,
        payload: {
          datasetVersion,
          league,
          market,
          presetId,
          calibration: dashboard.calibration,
        },
      },
      {
        key: buildCacheKey("decision", datasetVersion, presetId, market, league),
        importedAt,
        payload: {
          datasetVersion,
          league,
          market,
          presetId,
          decision: dashboard.decision,
        },
      },
    ]);
  }, [datasetVersion, importedAt, dashboard, selectedPresetId, line, league]);

  useEffect(() => {
    if (!datasetVersion || !importedAt) return;
    if (!contextUpcomingMatch || !contextSignals) return;
    const presetId = selectedPresetId || "adhoc";
    const market = `ou${line}`;

    void db.computedCache.put({
      key: buildCacheKey("derived", datasetVersion, presetId, market, league),
      importedAt,
      payload: {
        datasetVersion,
        presetId,
        market,
        league,
        target: {
          dateTime: contextUpcomingMatch.dateTime,
          league: contextUpcomingMatch.league,
          homeNick: contextUpcomingMatch.homeNick,
          awayNick: contextUpcomingMatch.awayNick,
          homeTeam: contextUpcomingMatch.homeTeam,
          awayTeam: contextUpcomingMatch.awayTeam,
        },
        signals: contextSignals,
        createdAt: new Date().toISOString(),
      },
    });
  }, [datasetVersion, importedAt, selectedPresetId, line, league, contextUpcomingMatch, contextSignals]);

  const leagues = useMemo(
    () => ["all", ...new Set(aliasedMatches.map((item) => item.league).filter(Boolean))],
    [aliasedMatches]
  );

  const players = useMemo(() => {
    const byConfidence = confidence === "all"
      ? dashboard.players
      : dashboard.players.filter((item) => item.confidence === confidence);
    if (!bettableOnly) return byConfidence;

    return byConfidence.filter((item) => {
      const interval = item.overIntervals[line];
      const intervalWidth = (interval?.high ?? 1) - (interval?.low ?? 0);
      const edgeVsLeague = Math.abs((item.overRates[line] ?? 0) - (dashboard.leagueOverLines[line] ?? 0));
      return item.effectiveGames >= 8 && intervalWidth <= 0.35 && edgeVsLeague >= 0.05 && item.confidence !== "baixa";
    });
  }, [dashboard.players, confidence, bettableOnly, line, dashboard.leagueOverLines]);

  const leagueQuality = useMemo(() => {
    const grouped = new Map<string, { games: number; outliers: number; futureDates: number }>();
    aliasedMatches.forEach((match) => {
      const item = grouped.get(match.league) ?? { games: 0, outliers: 0, futureDates: 0 };
      item.games += 1;
      if (match.homeGoals + match.awayGoals > 20) item.outliers += 1;
      if (new Date(match.dateTime).getTime() > nowTs) item.futureDates += 1;
      grouped.set(match.league, item);
    });
    return [...grouped.entries()].map(([leagueName, value]) => ({ leagueName, ...value }));
  }, [aliasedMatches, nowTs]);

  useEffect(() => {
    const leagueGames = aliasedMatches.filter((item) => league === "all" || item.league === league).length;
    if (loadError) {
      setWarning("");
      return;
    }
    setWarning(leagueGames > 0 && leagueGames < 20 ? "Liga com poucos jogos: confiabilidade rebaixada em um nível." : "");
  }, [aliasedMatches, league]);

  useEffect(() => {
    const presetId = selectedPresetId || "adhoc";
    void getPerformanceSummary({
      presetId,
      market: `ou${line}`,
      league: league === "all" ? undefined : league,
    }).then(setPerformance);
  }, [selectedPresetId, line, league, dashboard.decision.recommendation]);

  useEffect(() => {
    if (!datasetVersion || !upcoming.length) return;
    const target = upcoming.find((item) => league === "all" || item.league === league) ?? upcoming[0];
    if (!target) return;

    void logPrediction({
      datasetVersion,
      modelVersion: "model:v1",
      presetId: selectedPresetId || "adhoc",
      routeContext: "dashboard",
      match: target,
      market: `ou${line}`,
      pRaw: dashboard.calibration.currentRaw ?? dashboard.selectedOverRate,
      pCalibrated: dashboard.calibration.currentCalibrated ?? dashboard.selectedOverRate,
      decision: dashboard.decision.recommendation,
      confidence: dashboard.decision.confidence,
      reasons: dashboard.decision.reasons,
      contraReasons: dashboard.decision.contrarianReasons,
      inputSnapshot: { league, period, recencyOn, line, decisionMode, confidence },
    });
  }, [datasetVersion, upcoming, league, selectedPresetId, line, dashboard, period, recencyOn, decisionMode, confidence]);

  useEffect(() => {
    const raw = localStorage.getItem("hubpessoal-decision-history-v1");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Array<{ at: string; score: number; signal: string; semaphore: string; league: string; line: number }>;
      setDecisionHistory(parsed.slice(0, 12));
    } catch {
      localStorage.removeItem("hubpessoal-decision-history-v1");
    }
  }, []);

  useEffect(() => {
    if (isLoading || !dashboard.totalGames) return;
    const item = {
      at: new Date().toISOString(),
      score: dashboard.decision.score,
      signal: dashboard.decision.signal,
      semaphore: dashboard.decision.semaphore,
      league,
      line,
    };
    setDecisionHistory((prev) => {
      const next = [item, ...prev]
        .filter((value, index, arr) => index === arr.findIndex((x) => x.at === value.at))
        .slice(0, 20);
      localStorage.setItem("hubpessoal-decision-history-v1", JSON.stringify(next));
      return next;
    });
  }, [dashboard.decision.score, dashboard.decision.signal, dashboard.decision.semaphore, league, line, isLoading]);

  const topPicks = useMemo(() => [...players].sort((a, b) => b.ppgFinal - a.ppgFinal).slice(0, 3), [players]);

  const rankingList = useMemo(() => {
    if (rankTab === "best") return [...players].sort((a, b) => b.ppgFinal - a.ppgFinal).slice(0, 5);
    if (rankTab === "worst") return [...players].sort((a, b) => a.ppgFinal - b.ppgFinal).slice(0, 5);
    if (rankTab === "over") return [...players].sort((a, b) => (b.overRates[line] ?? 0) - (a.overRates[line] ?? 0)).slice(0, 5);
    if (rankTab === "under") return [...players].sort((a, b) => (a.overRates[line] ?? 0) - (b.overRates[line] ?? 0)).slice(0, 5);
    return [...players].sort((a, b) => b.bttsRate - a.bttsRate).slice(0, 5);
  }, [players, rankTab, line]);

  const rankingVisible = useMemo(
    () => (showRankingFull ? rankingList : rankingList.slice(0, 5)),
    [rankingList, showRankingFull]
  );

  const upcomingVisible = useMemo(
    () => (showUpcomingFull ? upcoming : upcoming.slice(0, 5)),
    [upcoming, showUpcomingFull]
  );

  const exportRecentCsv = () => {
    const headers = ["DataHora", "Liga", "HomeNick", "AwayNick", "HomeGoals", "AwayGoals", "Total", `OU${line}`, "BTTS"];
    const rows = dashboard.recentMatches.map((match) => {
      const total = match.homeGoals + match.awayGoals;
      return [
        toIsoDateTime(match.dateTime),
        match.league,
        match.homeNick,
        match.awayNick,
        String(match.homeGoals),
        String(match.awayGoals),
        String(total),
        total > line ? "Over" : "Under",
        match.homeGoals > 0 && match.awayGoals > 0 ? "Yes" : "No",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((col) => `"${String(col).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard-recentes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pinCurrentScenario = () => {
    const payload = {
      at: new Date().toISOString(),
      league,
      period,
      line,
      recencyOn,
      confidence,
      decisionMode,
      decision: dashboard.decision,
    };
    localStorage.setItem("hubpessoal-dashboard-pin", JSON.stringify(payload));
    setActionNote("Cenário atual fixado no navegador.");
  };

  const getRankMetric = (item: PlayerSummary) => {
    if (rankTab === "best" || rankTab === "worst") return { value: item.ppgFinal.toFixed(2), label: "PPG" };
    if (rankTab === "over") return { value: `${((item.overRates[line] ?? 0) * 100).toFixed(1)}%`, label: `Over ${line}` };
    if (rankTab === "under") return { value: `${(100 - (item.overRates[line] ?? 0) * 100).toFixed(1)}%`, label: `Under ${line}` };
    return { value: `${(item.bttsRate * 100).toFixed(1)}%`, label: "BTTS" };
  };

  const savePreset = async () => {
    const name = presetName.trim() || `Preset ${new Date().toLocaleTimeString("pt-BR")}`;
    const now = new Date().toISOString();
    await db.presets.put({
      id: uuidv4(),
      name,
      league,
      period,
      recencyOn,
      line,
      decisionMode,
      confidence,
      createdAt: now,
      updatedAt: now,
    });
    setPresetName("");
    await reloadPresets();
  };

  const applyPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setLeague(preset.league);
    setPeriod(preset.period);
    setRecencyOn(preset.recencyOn);
    setLine(preset.line);
    setDecisionMode(preset.decisionMode ?? "conservador");
    setConfidence(preset.confidence);
  };

  const renamePreset = async () => {
    if (!selectedPresetId) return;
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    const name = window.prompt("Novo nome do preset", preset.name);
    if (!name?.trim()) return;
    await db.presets.update(selectedPresetId, { name: name.trim(), updatedAt: new Date().toISOString() });
    await reloadPresets();
  };

  const deletePreset = async () => {
    if (!selectedPresetId) return;
    await db.presets.delete(selectedPresetId);
    setSelectedPresetId("");
    await reloadPresets();
  };

  const addAliasMapping = async () => {
    const from = aliasOriginal.trim();
    const to = aliasCanonico.trim();
    if (!from || !to) return;
    await upsertAlias(from, to);
    setAliasOriginal("");
    setAliasCanonico("");
    await reloadAliases();
  };

  const addLeagueWatch = async () => {
    if (!watchlistInput.trim()) return;
    await addWatchlist("league", watchlistInput);
    setWatchlistInput("");
    await reloadWatchlist();
  };

  const removeWatch = async (id: string) => {
    await removeWatchlist(id);
    await reloadWatchlist();
  };

  const baseHealth = useMemo(() => {
    const byFingerprint = new Set<string>();
    let duplicates = 0;
    let outOfOrder = 0;
    let outliers = 0;

    for (let index = 0; index < aliasedMatches.length; index += 1) {
      const item = aliasedMatches[index];
      if (!item) continue;

      const fp = [item.dateTime, item.league, item.homeNick, item.awayNick, item.homeGoals, item.awayGoals].join("|");
      if (byFingerprint.has(fp)) duplicates += 1;
      byFingerprint.add(fp);

      const previous = aliasedMatches[index - 1];
      if (previous && new Date(previous.dateTime).getTime() > new Date(item.dateTime).getTime()) {
        outOfOrder += 1;
      }

      if (item.homeGoals + item.awayGoals > 20) outliers += 1;
    }

    return {
      duplicates,
      outOfOrder,
      outliers,
      importRemovalRate,
    };
  }, [aliasedMatches, importRemovalRate]);

  const hasWatchlistAlert = useMemo(() => {
    if (!watchlistRows.length) return false;
    if (dashboard.decision.recommendation !== "APOSTAVEL") return false;
    if (dashboard.decision.confidence !== "alta") return false;

    const leagueOnWatch = inWatchlist("league", league === "all" ? "" : league, watchlistRows);
    const pickOnWatch = topPicks.some((item) => inWatchlist("nick", item.nick, watchlistRows));
    return leagueOnWatch || pickOnWatch;
  }, [watchlistRows, dashboard.decision.recommendation, dashboard.decision.confidence, league, topPicks]);

  return (
    <section className="pageGrid" aria-label="Dashboard premium">
      <Card className="filterBar">
        <div className="chips">
          <Chip active>Liga: {league === "all" ? "Todas" : league}<InfoHint text={HELP.leagueChip} /></Chip>
          <Chip>Período: {period === "all" ? "Tudo" : `${period} dias`}<InfoHint text={HELP.periodChip} /></Chip>
          <Chip active={recencyOn} onClick={() => setRecencyOn(!recencyOn)}>Recência: {recencyOn ? "ON" : "OFF"}<InfoHint text={HELP.recencyChip} /></Chip>
          <Chip onClick={() => setLine(lines[(lines.indexOf(line) + 1) % lines.length])}>Linha OU: {line}<InfoHint text={HELP.lineChip} /></Chip>
          <Chip active={bettableOnly} onClick={() => setBettableOnly(!bettableOnly)}>Apostáveis: {bettableOnly ? "ON" : "OFF"}<InfoHint text={HELP.bettableChip} /></Chip>
          <Select value={decisionMode} onChange={(event) => setDecisionMode(event.target.value as typeof decisionMode)} aria-label="Modo de decisão">
            <option value="conservador">Modo: Conservador</option>
            <option value="agressivo">Modo: Agressivo</option>
          </Select>
          <InfoHint text={HELP.modeSelect} />
          <Select value={confidence} onChange={(event) => setConfidence(event.target.value as typeof confidence)} aria-label="Filtrar confiabilidade">
            <option value="all">Confiabilidade: Todas</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </Select>
          <InfoHint text={HELP.confidenceSelect} />
          <Select value={league} onChange={(event) => setLeague(event.target.value)} aria-label="Filtrar liga">
            {leagues.map((item) => <option key={item} value={item}>{item === "all" ? "Todas as ligas" : item}</option>)}
          </Select>
          <InfoHint text="Aplica filtro por liga em todo o dashboard." />
          <Select value={period} onChange={(event) => setPeriod(event.target.value as "7" | "15" | "30" | "all")} aria-label="Filtrar período">
            <option value="7">7 dias</option>
            <option value="15">15 dias</option>
            <option value="30">30 dias</option>
            <option value="all">Tudo</option>
          </Select>
          <InfoHint text="Define o período histórico considerado nos cálculos." />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="select"
            aria-label="Nome do preset"
            placeholder="Nome do preset"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
          <Button onClick={() => void savePreset()}>💾 Salvar<InfoHint text="Salva a configuração atual de filtros como preset." /></Button>
          <Button onClick={() => resetFilters()}>🧹 Reset<InfoHint text="Restaura filtros para o padrão inicial." /></Button>
          <Select
            aria-label="Selecionar preset"
            value={selectedPresetId}
            onChange={(event) => {
              setSelectedPresetId(event.target.value);
              if (event.target.value) applyPreset(event.target.value);
            }}
          >
            <option value="">Presets</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </Select>
          <Button onClick={() => void renamePreset()} disabled={!selectedPresetId}>✏️ Renomear<InfoHint text="Altera o nome do preset selecionado." /></Button>
          <Button onClick={() => void deletePreset()} disabled={!selectedPresetId}>🗑️ Apagar<InfoHint text="Remove o preset selecionado do armazenamento local." /></Button>
        </div>
      </Card>

      <Card className="col-12">
        <CardHeader>
          <div><h3>Performance do Sistema</h3><small>Ledger + qualidade contínua da base + aliases/watchlist</small></div>
          {hasWatchlistAlert ? <Badge tone="good">Alerta local: sinal forte na watchlist</Badge> : <Badge>Sem alerta ativo</Badge>}
        </CardHeader>
        <CardBody>
          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge>Ledger total: {performance?.total ?? 0}</Badge>
            <Badge tone="good">Resolvidas: {performance?.resolved ?? 0}</Badge>
            <Badge tone="warn">Pendentes: {performance?.unresolved ?? 0}</Badge>
            <Badge>HitRate: {((performance?.hitRate ?? 0) * 100).toFixed(1)}%</Badge>
            <Badge>Brier ledger: {(performance?.brier ?? 0).toFixed(3)}</Badge>
            <Badge tone={baseHealth.duplicates === 0 ? "good" : "warn"}>Duplicatas: {baseHealth.duplicates}</Badge>
            <Badge tone={baseHealth.outOfOrder === 0 ? "good" : "warn"}>Datas fora de ordem: {baseHealth.outOfOrder}</Badge>
            <Badge tone={baseHealth.outliers === 0 ? "good" : "warn"}>Outliers: {baseHealth.outliers}</Badge>
            <Badge tone={baseHealth.importRemovalRate <= 0.2 ? "good" : "warn"}>Remoção import: {(baseHealth.importRemovalRate * 100).toFixed(1)}%</Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}>
            <div className="list">
              <div className="row"><div className="left"><small>Alias resolver (nickOriginal → nickCanonico)</small></div></div>
              <div className="row">
                <div className="left" style={{ display: "flex", gap: 8, width: "100%" }}>
                  <input className="select" value={aliasOriginal} onChange={(event) => setAliasOriginal(event.target.value)} placeholder="Nick original" />
                  <input className="select" value={aliasCanonico} onChange={(event) => setAliasCanonico(event.target.value)} placeholder="Nick canônico" />
                </div>
                <div className="metric"><Button onClick={() => void addAliasMapping()}>Salvar</Button></div>
              </div>
              {aliasRows.slice(0, 4).map((item) => (
                <div className="row" key={`${item.original}|${item.canonico}`}>
                  <div className="left"><small>{item.original} → {item.canonico}</small></div>
                </div>
              ))}
            </div>

            <div className="list">
              <div className="row"><div className="left"><small>Watchlist (liga)</small></div></div>
              <div className="row">
                <div className="left" style={{ display: "flex", gap: 8, width: "100%" }}>
                  <input className="select" value={watchlistInput} onChange={(event) => setWatchlistInput(event.target.value)} placeholder="Adicionar liga" />
                </div>
                <div className="metric"><Button onClick={() => void addLeagueWatch()}>Adicionar</Button></div>
              </div>
              {watchlistRows.slice(0, 4).map((item) => (
                <div className="row" key={item.id}>
                  <div className="left"><small>{item.kind}: {item.value}</small></div>
                  <div className="metric"><Button onClick={() => void removeWatch(item.id)}>Remover</Button></div>
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      {contextUpcomingMatch && contextSignals ? (
        <Card className="col-12" id="card-sinais-contextuais">
          <CardHeader>
            <div>
              <h3>Sinais Contextuais <InfoHint text="Sinais adicionais calculados sem vazamento temporal (apenas histórico ANTES do jogo alvo).\n\nEles NÃO liberam APOSTÁVEL sozinhos — servem para explicar e modular confiança.\n\nJogo alvo: o primeiro da lista 'Próximos jogos' no filtro atual." /></h3>
              <small>
                Alvo: {contextUpcomingMatch.homeNick} vs {contextUpcomingMatch.awayNick} • {contextUpcomingMatch.league} • {new Date(contextUpcomingMatch.dateTime).toLocaleString("pt-BR")}
              </small>
            </div>
          </CardHeader>
          <CardBody>
            <div className="chips" style={{ marginBottom: 10 }}>
              <Badge>
                Revenge H→A: {contextSignals.revenge.homeRevengeIndex}
                <InfoHint text="RevengeIndex = derrotas seguidas do jogador contra o mesmo oponente (0..5).\nEx.: 2 significa que ele perdeu 2x seguidas para o adversário no histórico anterior." />
              </Badge>
              <Badge>
                Revenge A→H: {contextSignals.revenge.awayRevengeIndex}
                <InfoHint text="Mesma métrica, do lado do visitante contra o mandante." />
              </Badge>
              <Badge>
                H2H jogos: {contextSignals.revenge.h2hGames}
                <InfoHint text="Quantidade de jogos anteriores já registrados entre esses dois nicks (confronto direto histórico).\nÉ calculado sem vazamento: só conta partidas anteriores ao jogo alvo." />
              </Badge>
              {contextSignals.revenge.validation ? (
                <Badge tone={contextSignals.revenge.validation.status === "ok" ? "good" : "warn"}>
                  Validação revenge: {contextSignals.revenge.validation.status} (n={contextSignals.revenge.validation.sampleSize})
                  <InfoHint text={`P(win | L_streak_vs>=2) vs baseline, usando apenas o histórico anterior ao jogo.\nBaseline ${(contextSignals.revenge.validation.baselineWinRate * 100).toFixed(1)}% • Condicional ${(contextSignals.revenge.validation.conditionalWinRate * 100).toFixed(1)}% • Uplift ${(contextSignals.revenge.validation.uplift * 100).toFixed(1)}pp`} />
                </Badge>
              ) : null}
              <Badge tone={contextSignals.tilt.home.tiltScore > 0 ? "good" : contextSignals.tilt.home.tiltScore < 0 ? "bad" : "warn"}>
                Tilt Casa: {contextSignals.tilt.home.tiltScore}
                <InfoHint text={`TiltIndex (forma curta) do mandante nos últimos 5 jogos antes do alvo.\nWinRate ${(contextSignals.tilt.home.winRateLast5 * 100).toFixed(0)}% • Saldo ${contextSignals.tilt.home.goalDiffLast5} • Sofridos(3) ${contextSignals.tilt.home.concededLast3} • Wstreak ${contextSignals.tilt.home.winStreak} • Lstreak ${contextSignals.tilt.home.lossStreak}`} />
              </Badge>
              <Badge tone={contextSignals.tilt.away.tiltScore > 0 ? "good" : contextSignals.tilt.away.tiltScore < 0 ? "bad" : "warn"}>
                Tilt Fora: {contextSignals.tilt.away.tiltScore}
                <InfoHint text={`TiltIndex (forma curta) do visitante nos últimos 5 jogos antes do alvo.\nWinRate ${(contextSignals.tilt.away.winRateLast5 * 100).toFixed(0)}% • Saldo ${contextSignals.tilt.away.goalDiffLast5} • Sofridos(3) ${contextSignals.tilt.away.concededLast3} • Wstreak ${contextSignals.tilt.away.winStreak} • Lstreak ${contextSignals.tilt.away.lossStreak}`} />
              </Badge>
              <Badge>
                Style pace {contextSignals.style.pace.toFixed(2)} • frag {contextSignals.style.fragility.toFixed(2)} • vol {contextSignals.style.volatility.toFixed(2)}
                <InfoHint text="StyleMismatch usa proxies do placar no histórico anterior:\n- pace: média de gols totais\n- fragility: média de gols sofridos\n- volatility: desvio-padrão dos gols totais\n\nÚtil para OU (linhas altas/baixas), como modulador de confiança." />
              </Badge>
              <Badge tone={Math.abs(contextSignals.teamAffinity.home.deltaWin) >= 0.08 ? "good" : "warn"}>
                Afinidade Casa×Time: {(contextSignals.teamAffinity.home.deltaWin * 100).toFixed(1)}pp
                <InfoHint text={`TeamAffinity (mandante): deltaWin = winRate(team) - winRate(all), com shrink para amostra baixa.\nTeam n=${contextSignals.teamAffinity.home.gamesTeam}/${contextSignals.teamAffinity.home.gamesAll} (${contextSignals.teamAffinity.home.team}) • lowSample=${contextSignals.teamAffinity.home.lowSample ? "sim" : "não"}`} />
              </Badge>
              <Badge tone={Math.abs(contextSignals.teamAffinity.away.deltaWin) >= 0.08 ? "good" : "warn"}>
                Afinidade Fora×Time: {(contextSignals.teamAffinity.away.deltaWin * 100).toFixed(1)}pp
                <InfoHint text={`TeamAffinity (visitante): deltaWin = winRate(team) - winRate(all), com shrink para amostra baixa.\nTeam n=${contextSignals.teamAffinity.away.gamesTeam}/${contextSignals.teamAffinity.away.gamesAll} (${contextSignals.teamAffinity.away.team}) • lowSample=${contextSignals.teamAffinity.away.lowSample ? "sim" : "não"}`} />
              </Badge>
              <Badge tone={contextSignals.session.home.lowSample ? "warn" : "good"}>
                Sessão Casa: n={contextSignals.session.home.sessionGamesCount} • {(contextSignals.session.home.sessionWinRate * 100).toFixed(0)}% • {contextSignals.session.home.sessionTrend}
                <InfoHint text="SessionForm considera uma sessão como jogos do mesmo player com gap pequeno (default 45min).\nServe como modulador de confiança (não sinal principal)." />
              </Badge>
              <Badge tone={contextSignals.session.away.lowSample ? "warn" : "good"}>
                Sessão Fora: n={contextSignals.session.away.sessionGamesCount} • {(contextSignals.session.away.sessionWinRate * 100).toFixed(0)}% • {contextSignals.session.away.sessionTrend}
                <InfoHint text="Mesma métrica de sessão para o visitante." />
              </Badge>
              {contextSignals.drift ? (
                <Badge tone={contextSignals.drift.level === "estavel" ? "good" : contextSignals.drift.level === "atencao" ? "warn" : "bad"}>
                  Drift(seg): {contextSignals.drift.level}
                  <InfoHint text={`Drift segmentado (liga/linha) usando histórico anterior: over Δ ${(contextSignals.drift.deltaOver * 100).toFixed(1)}pp • gols Δ ${contextSignals.drift.deltaAvgGoals.toFixed(2)} (rec ${contextSignals.drift.recentWindow} vs prev ${contextSignals.drift.previousWindow})`} />
                </Badge>
              ) : null}

              {contextOddsOu?.implied ? (
                <Badge tone={(contextOddsOu.edgeOver ?? 0) >= 0.02 ? "good" : "warn"}>
                  Odds OU implícita: {(contextOddsOu.implied.over * 100).toFixed(1)}% • edge {(contextOddsOu.edgeOver ?? 0) * 100 >= 0 ? "+" : ""}{((contextOddsOu.edgeOver ?? 0) * 100).toFixed(1)}pp
                  <InfoHint text="Converte odds Over/Under em probabilidade implícita normalizada (remove overround).\nEdge = prob calibrada do modelo - prob implícita.\nSó aparece quando você importou a aba ODDS_OU e ela contém este jogo (mesma liga/data/nicks/linha)." />
                </Badge>
              ) : null}
              {contextOdds1x2?.implied ? (
                <Badge>
                  Odds 1X2 impl.: H {(contextOdds1x2.implied!.home * 100).toFixed(0)}% • D {(contextOdds1x2.implied!.draw * 100).toFixed(0)}% • A {(contextOdds1x2.implied!.away * 100).toFixed(0)}%
                  <InfoHint text="Probabilidades implícitas do mercado 1X2, normalizadas (remove overround).\nMostra apenas se você importou a aba ODDS_1X2 para este jogo." />
                </Badge>
              ) : null}
            </div>

            <small style={{ color: "var(--muted)" }}>
              Observação: quando a validação estiver "insuficiente", o sinal aparece apenas como explicação (não influencia decisão).
            </small>
          </CardBody>
        </Card>
      ) : null}

      {isLoading ? (
        <>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
        </>
      ) : (
        <>
          {loadError ? (
            <Card className="col-12">
              <CardHeader><div><h3>Falha ao carregar dados</h3><small>Base local (IndexedDB/Dexie)</small></div></CardHeader>
              <CardBody>
                <p style={{ margin: 0, color: "var(--warning)", fontSize: 12, whiteSpace: "pre-wrap" }}>{loadError}</p>
              </CardBody>
            </Card>
          ) : null}
          <Card className="stat"><div className="statTop"><span style={{ display: "inline-flex", alignItems: "center" }}><Badge>Jogos</Badge><InfoHint text={HELP.gamesKpi} /></span><Badge tone={dashboard.totalGames >= 10 ? "good" : dashboard.totalGames >= 5 ? "warn" : "bad"}>{dashboard.totalGames >= 10 ? "Alta" : dashboard.totalGames >= 5 ? "Média" : "Baixa"}</Badge></div><div className="kpi">{dashboard.totalGames}</div><div className="kpiSub">Amostra no filtro atual</div></Card>
          <Card className="stat"><div className="statTop"><span style={{ display: "inline-flex", alignItems: "center" }}><Badge>Média gols</Badge><InfoHint text={HELP.avgGoalsKpi} /></span><Badge tone="warn">Oscilando</Badge></div><div className="kpi">{dashboard.avgGoals.toFixed(1)}</div><div className="kpiSub">Total por partida • n efetivo {dashboard.effectiveGames.toFixed(1)}</div></Card>
          <Card className="stat"><div className="statTop"><span style={{ display: "inline-flex", alignItems: "center" }}><Badge>%Over {line}</Badge><InfoHint text={HELP.overKpi} /></span><Badge tone="good">Forte</Badge></div><div className="kpi">{(dashboard.selectedOverRate * 100).toFixed(0)}%</div><div className="kpiSub">IC95% {(dashboard.selectedOverInterval.low * 100).toFixed(1)}–{(dashboard.selectedOverInterval.high * 100).toFixed(1)}%</div></Card>
          <Card className="stat"><div className="statTop"><span style={{ display: "inline-flex", alignItems: "center" }}><Badge>%BTTS</Badge><InfoHint text={HELP.bttsKpi} /></span><Badge>Neutro</Badge></div><div className="kpi">{(dashboard.bttsRate * 100).toFixed(0)}%</div><div className="kpiSub">IC95% {(dashboard.bttsInterval.low * 100).toFixed(1)}–{(dashboard.bttsInterval.high * 100).toFixed(1)}%</div></Card>
        </>
      )}

      <Card className="col-8" id="card-linhas">
        <CardHeader>
          <div><h3>Linhas da Liga <InfoHint text={HELP.leagueLines} /></h3><small>Over% por linha (2.5 → 7.5)</small></div>
          <a href="#card-backtest" className="btn" onClick={(event) => { event.preventDefault(); jumpTo("card-backtest"); }}>📈 Detalhar</a>
        </CardHeader>
        <CardBody>
          <div className="chartWrap">
            {lines.map((lineRef) => {
              const height = Math.max(20, Math.round((dashboard.leagueOverLines[lineRef] ?? 0) * 100));
              return <div key={lineRef} className="bar" style={{ height: `${height}%` }}><span>{lineRef}</span></div>;
            })}
          </div>
          <div className="chartLegend"><span>Maior = mais Over</span><span>Recência {recencyOn ? "ON" : "OFF"} • Shrink K=6</span></div>
        </CardBody>
      </Card>

      <Card className="col-4">
        <CardHeader><div><h3>Ação do dia <InfoHint text={HELP.actionDay} /></h3><small>Score de decisão 0–100</small></div><Badge>{decisionModeLabel(dashboard.decision.mode)}</Badge></CardHeader>
        <CardBody>
          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge tone={dashboard.decision.recommendation === "APOSTAVEL" ? "good" : dashboard.decision.recommendation === "CAUTELA" ? "warn" : "bad"}>
              Status: {dashboard.decision.recommendation}
            </Badge>
            <Badge tone={dashboard.decision.score >= 75 ? "good" : dashboard.decision.score >= 55 ? "warn" : "bad"}>Score: {dashboard.decision.score}</Badge>
            <Badge tone={semaphoreTone(dashboard.decision.semaphore)}>Semáforo: {dashboard.decision.semaphore.toUpperCase()}</Badge>
            <Badge tone={dashboard.decision.signal === "over" ? "good" : dashboard.decision.signal === "under" ? "warn" : "bad"}>Sinal: {decisionSignalLabel(dashboard.decision.signal)}</Badge>
            <Badge tone={confidenceTone(dashboard.decision.confidence)}>Confiança: {dashboard.decision.confidence}</Badge>
            <Badge tone={dashboard.decision.antiFalseSignalPassed ? "good" : "warn"}>Proteção: {dashboard.decision.antiFalseSignalPassed ? "Aprovada" : "Bloqueada"}</Badge>
            <Badge>
              Prob raw/cal: {((dashboard.decision.probabilityRaw ?? dashboard.calibration.currentRaw ?? 0) * 100).toFixed(1)}% → {((dashboard.decision.probabilityCalibrated ?? dashboard.calibration.currentCalibrated ?? 0) * 100).toFixed(1)}%
            </Badge>
            <Badge>Régua: {(dashboard.decision.adaptiveEdgeThreshold * 100).toFixed(1)}pp <InfoHint text={HELP.adaptiveThreshold} /></Badge>
            <Badge tone={dashboard.decision.isBettable ? "good" : "bad"}>Apostável: {dashboard.decision.isBettable ? "SIM" : "NÃO"}</Badge>
          </div>
          <div style={{ marginBottom: 10 }}>
            <small style={{ color: "var(--muted)" }}><b>Entrada:</b> {dashboard.decision.entryCondition}</small><br />
            <small style={{ color: "var(--muted)" }}><b>Abortar:</b> {dashboard.decision.abortCondition}</small>
          </div>
          <div className="list" style={{ marginBottom: 12 }}>
            {dashboard.decision.reasons.map((reason) => (
              <div key={reason} className="row">
                <div className="left"><small>{simplifyDecisionReason(reason)}</small></div>
              </div>
            ))}
          </div>

          {!!dashboard.decision.contrarianReasons.length && (
            <div style={{ marginBottom: 12 }}>
              <small style={{ color: "var(--warning)", display: "inline-flex", alignItems: "center" }}>
                Explicação contrária <InfoHint text={HELP.contrarian} />
              </small>
              <div className="list">
                {dashboard.decision.contrarianReasons.map((item) => (
                  <div key={item} className="row"><div className="left"><small>{item}</small></div></div>
                ))}
              </div>
            </div>
          )}

          {!topPicks.length && <EmptyState title="Sem dados" subtitle="Importe uma planilha para ver picks." />}
          <div className="list">
            {topPicks.map((player) => (
              <div key={player.nick} className="row">
                <div className="left">
                  <PlayerAvatar nick={player.nick} />
                  <div className="nick"><b>{player.nick}</b><small>PPG {player.ppgFinal.toFixed(2)} • Over {line}: {((player.overRates[line] ?? 0) * 100).toFixed(0)}%</small></div>
                </div>
                <div className="metric"><b><Badge tone={confidenceTone(player.confidence)}>{player.confidence}</Badge></b><small>n={player.games}</small></div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="col-8" id="card-assertividade">
        <CardHeader>
          <div><h3>Assertividade do modelo <InfoHint text={HELP.calibration} /></h3><small>Calibração, drift, viés e sensibilidade</small></div>
        </CardHeader>
        <CardBody>
          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge>Raw: {((dashboard.calibration.currentRaw ?? 0) * 100).toFixed(1)}%</Badge>
            <Badge tone="good">Calibrada: {((dashboard.calibration.currentCalibrated ?? 0) * 100).toFixed(1)}%</Badge>
            <Badge tone={dashboard.calibration.brierScore <= 0.2 ? "good" : dashboard.calibration.brierScore <= 0.28 ? "warn" : "bad"}>
              Brier: {dashboard.calibration.brierScore.toFixed(3)}
            </Badge>
            <Badge tone={(dashboard.calibration.logLoss ?? 1) <= 0.65 ? "good" : "warn"}>
              LogLoss: {(dashboard.calibration.logLoss ?? 0).toFixed(3)}
            </Badge>
            <Badge tone={dashboard.drift.level === "estavel" ? "good" : dashboard.drift.level === "atencao" ? "warn" : "bad"}>
              Drift: {dashboard.drift.level}
            </Badge>
            <Badge tone={dashboard.bias.level === "baixo" ? "good" : dashboard.bias.level === "medio" ? "warn" : "bad"}>
              Viés: {dashboard.bias.level}
            </Badge>
            <Badge tone={dashboard.sensitivity.stable ? "good" : "warn"}>
              Sensibilidade spread: {(dashboard.sensitivity.spread * 100).toFixed(1)}pp
            </Badge>
          </div>

          <div className="list" style={{ marginBottom: 10 }}>
            {dashboard.calibration.byBin.map((bin) => (
              <div key={bin.label} className="row">
                <div className="left"><small>{bin.label} • n={bin.count}</small></div>
                <div className="metric"><small>prev {(bin.predicted * 100).toFixed(1)}% vs obs {(bin.observed * 100).toFixed(1)}%</small></div>
              </div>
            ))}
          </div>

          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge>ΔOver: {(dashboard.drift.deltaOver * 100).toFixed(1)}pp <InfoHint text={HELP.drift} /></Badge>
            <Badge>ΔBTTS: {(dashboard.drift.deltaBtts * 100).toFixed(1)}pp</Badge>
            <Badge>ΔGols: {dashboard.drift.deltaAvgGoals.toFixed(2)}</Badge>
            <Badge>Pair ratio: {(dashboard.bias.uniquePairRatio * 100).toFixed(1)}% <InfoHint text={HELP.bias} /></Badge>
          </div>

          {!!dashboard.bias.reasons.length && (
            <div className="list">
              {dashboard.bias.reasons.map((reason) => (
                <div key={reason} className="row"><div className="left"><small>{reason}</small></div></div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="col-12" id="card-resumo">
        <CardHeader><div><h3>Resumo executivo <InfoHint text={HELP.execSummary} /></h3><small>Leitura rápida do cenário atual</small></div></CardHeader>
        <CardBody>
          <div className="list">
            {dashboard.executiveSummary.map((item) => (
              <div key={item} className="row">
                <div className="left"><small>{simplifyExecutiveSummary(item)}</small></div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="col-6" id="card-rankings">
        <CardHeader><div><h3>Rankings <InfoHint text={HELP.rankings} /></h3><small>{showRankingFull ? "Top completo" : "Top 5"}</small></div><Button onClick={() => { setShowRankingFull((prev) => !prev); jumpTo("card-rankings"); }}>{showRankingFull ? "Ver menos" : "Ver completo →"}</Button></CardHeader>
        <CardBody>
          <div className="chips" style={{ marginBottom: 12 }}>
            <Chip active={rankTab === "best"} onClick={() => setRankTab("best")}>Melhores (PPG) <InfoHint text="Top jogadores por pontos por jogo ajustado (PPG final)." /></Chip>
            <Chip active={rankTab === "worst"} onClick={() => setRankTab("worst")}>Piores <InfoHint text="Jogadores com menor PPG final no recorte atual." /></Chip>
            <Chip active={rankTab === "over"} onClick={() => setRankTab("over")}>Over <InfoHint text={`Jogadores com maior taxa de Over na linha ${line}.`} /></Chip>
            <Chip active={rankTab === "under"} onClick={() => setRankTab("under")}>Under <InfoHint text={`Jogadores com maior tendência de Under na linha ${line}.`} /></Chip>
            <Chip active={rankTab === "btts"} onClick={() => setRankTab("btts")}>BTTS <InfoHint text="Jogadores com maior frequência de ambas marcam." /></Chip>
          </div>
          <div className="list">
            {rankingVisible.map((item, index) => {
              const metric = getRankMetric(item);
              return (
                <div key={item.nick} className="row">
                  <div className="left">
                    <div className="rank">{index + 1}</div>
                    <PlayerAvatar nick={item.nick} />
                    <div className="nick"><b>{item.nick}</b><small>{metric.label}</small></div>
                  </div>
                  <div className="metric"><b>{metric.value}</b><small>{metric.label}</small></div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card className="col-6" id="card-proximos">
        <CardHeader><div><h3>Próximos jogos <InfoHint text={HELP.upcoming} /></h3><small>Aba PROXIMOS</small></div><Button onClick={() => { setShowUpcomingFull((prev) => !prev); jumpTo("card-proximos"); }}>{showUpcomingFull ? "Recolher" : "Abrir lista →"}</Button></CardHeader>
        <CardBody>
          {!upcoming.length && <EmptyState title="Sem próximos jogos" subtitle="Importe aba PROXIMOS no Excel." />}
          <div className="list">
            {upcomingVisible.map((event) => (
              <div key={event.id} className="row">
                <div className="left"><div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><PlayerAvatar nick={event.homeNick} size={28} radius={12} /><PlayerAvatar nick={event.awayNick} size={28} radius={12} /></div><div className="nick"><b>{event.homeNick} vs {event.awayNick}</b><small>{event.homeTeam} x {event.awayTeam} • {formatDateTimePtBr(event.dateTime)}</small></div></div>
                <div className="metric"><b className="badge">{event.league}</b><small>OU {line}</small></div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="col-12" id="card-jogos">
        <CardHeader><div><h3>Jogos recentes <InfoHint text={HELP.recentGames} /></h3><small>Tabela premium</small></div><div style={{ display: "flex", gap: 10 }}><Button onClick={exportRecentCsv}>⬇️ CSV<InfoHint text="Exporta os jogos recentes em CSV.\nInclui data, liga, placar, total e classificação Over/Under e BTTS.\nÚtil para auditoria externa." /></Button><Button onClick={pinCurrentScenario}>📌 Fixar<InfoHint text="Guarda snapshot local do cenário atual.\nSalva filtros, modo de decisão e status do sinal.\nPode ser usado para comparação posterior." /></Button></div></CardHeader>
        <CardBody>
          {actionNote && <p style={{ marginBottom: 10, color: "var(--muted)", fontSize: 12 }}>{actionNote}</p>}
          <Table>
            <thead><tr><th>Data/Hora</th><th>Liga</th><th>HomeNick</th><th>AwayNick</th><th className="right">Placar</th><th className="right">Total</th><th className="right">OU {line}</th><th className="right">BTTS</th></tr></thead>
            <tbody>
              {dashboard.recentMatches.slice(0, 8).map((match) => {
                const total = match.homeGoals + match.awayGoals;
                const over = total > line;
                const btts = match.homeGoals > 0 && match.awayGoals > 0;
                return (
                  <tr key={match.id}>
                    <td>{formatDateTimePtBr(match.dateTime)}</td>
                    <td>{match.league}</td>
                    <td><div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><PlayerAvatar nick={match.homeNick} size={24} radius={10} /><span>{match.homeNick}</span></div></td>
                    <td><div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><PlayerAvatar nick={match.awayNick} size={24} radius={10} /><span>{match.awayNick}</span></div></td>
                    <td className="right">{match.homeGoals}–{match.awayGoals}</td>
                    <td className="right">{total}</td>
                    <td className="right"><Badge tone={over ? "good" : "bad"}>{over ? "Over" : "Under"}</Badge></td>
                    <td className="right"><Badge tone={btts ? "good" : "bad"}>{btts ? "Yes" : "No"}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card className="col-12" id="card-backtest">
        <CardHeader><div><h3>Backtest Offline <InfoHint text={HELP.backtest} /></h3><small>Top 3 picks por Over {line} em jogos recentes</small></div></CardHeader>
        <CardBody>
          <div className="chips">
            <Badge>Tentativas: {dashboard.backtest.attempts}</Badge>
            <Badge tone="good">Acertos: {dashboard.backtest.hits}</Badge>
            <Badge tone={dashboard.backtest.hitRate >= 0.55 ? "good" : dashboard.backtest.hitRate >= 0.5 ? "warn" : "bad"}>Hit rate: {(dashboard.backtest.hitRate * 100).toFixed(1)}%</Badge>
            <Badge>Accuracy: {((dashboard.backtest.accuracy ?? 0) * 100).toFixed(1)}%</Badge>
            <Badge>Brier: {(dashboard.backtest.brierScore ?? 0).toFixed(3)}</Badge>
            <Badge>LogLoss: {(dashboard.backtest.logLoss ?? 0).toFixed(3)}</Badge>
            <Badge>Baseline rand: {(dashboard.backtest.baselineRandomHitRate * 100).toFixed(1)}%</Badge>
            <Badge>Baseline liga: {(dashboard.backtest.baselineLeagueHitRate * 100).toFixed(1)}%</Badge>
            <Badge>Baseline odds: {(dashboard.backtest.baselineOddsHitRate * 100).toFixed(1)}%</Badge>
            <Badge>Baseline rec.20: {(dashboard.backtest.baselineRecentHitRate * 100).toFixed(1)}%</Badge>
            <Badge tone={dashboard.backtest.upliftVsRandom >= 0 ? "good" : "bad"}>Δ rand: {(dashboard.backtest.upliftVsRandom * 100).toFixed(1)}pp</Badge>
            <Badge tone={dashboard.backtest.upliftVsLeague >= 0 ? "good" : "bad"}>Δ liga: {(dashboard.backtest.upliftVsLeague * 100).toFixed(1)}pp</Badge>
            <Badge tone={dashboard.backtest.upliftVsOdds >= 0 ? "good" : "bad"}>Δ odds: {(dashboard.backtest.upliftVsOdds * 100).toFixed(1)}pp</Badge>
            <Badge tone={dashboard.backtest.upliftVsRecent >= 0 ? "good" : "bad"}>Δ rec.20: {(dashboard.backtest.upliftVsRecent * 100).toFixed(1)}pp</Badge>
            <Badge>Walk-forward: {(dashboard.backtest.walkForwardHitRate * 100).toFixed(1)}% <InfoHint text={HELP.walkForward} /></Badge>
            <Badge>WF sinais: {dashboard.backtest.walkForwardAttempts}</Badge>
            <Badge tone={dashboard.backtest.walkForwardUpliftVsLeague >= 0 ? "good" : "bad"}>WF Δ liga: {(dashboard.backtest.walkForwardUpliftVsLeague * 100).toFixed(1)}pp</Badge>
          </div>
          {!!dashboard.explainability.fragileEdgePlayers.length && (
            <p style={{ marginTop: 10, color: "var(--warning)", fontSize: 12 }}>
              Edge frágil (&lt;5pp vs liga): {dashboard.explainability.fragileEdgePlayers.join(", ")}
            </p>
          )}
        </CardBody>
      </Card>

      <Card className="col-12" id="card-history">
        <CardHeader><div><h3>Histórico de decisões <InfoHint text={HELP.history} /></h3><small>Snapshots locais de contexto decisional</small></div></CardHeader>
        <CardBody>
          {!decisionHistory.length ? (
            <EmptyState title="Sem histórico" subtitle="O histórico será preenchido conforme você navega no dashboard." />
          ) : (
            <Table>
              <thead><tr><th>Data</th><th>Liga</th><th>Linha</th><th>Sinal</th><th className="right">Score</th><th className="right">Semáforo</th></tr></thead>
              <tbody>
                {decisionHistory.slice(0, 12).map((item) => (
                  <tr key={item.at}>
                    <td>{formatDateTimePtBr(item.at)}</td>
                    <td>{item.league === "all" ? "Todas" : item.league}</td>
                    <td>{item.line}</td>
                    <td>{item.signal}</td>
                    <td className="right">{item.score}</td>
                    <td className="right"><Badge tone={item.semaphore === "verde" ? "good" : item.semaphore === "amarelo" ? "warn" : "bad"}>{item.semaphore}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="col-12">
        <CardHeader><div><h3>Data Quality <InfoHint text={HELP.quality} /></h3><small>Painel de consistência da importação</small></div><Button onClick={() => setShowQuality(!showQuality)}>{showQuality ? "Recolher" : "Expandir"}</Button></CardHeader>
        {showQuality && (
          <CardBody>
            <div className="chips">
              <Badge>Ignorados Status != FINISHED: {quality?.ignoredStatusNotFinished ?? 0}</Badge>
              <Badge>Linhas sem placar: {quality?.removedMissingScore ?? 0}</Badge>
              <Badge>Duplicados removidos: {quality?.removedDuplicates ?? 0}</Badge>
              <Badge>Outliers detectados: {quality?.detectedOutliers ?? 0}</Badge>
            </div>
            {warning && <p style={{ marginTop: 12, color: "var(--warning)", fontSize: 12 }}>{warning}</p>}
            <div className="list" style={{ marginTop: 10 }}>
              {leagueQuality.slice(0, 6).map((item) => (
                <div key={item.leagueName} className="row">
                  <div className="left"><strong>{item.leagueName}</strong></div>
                  <div className="metric"><b>{item.games} jogos</b><small>Outliers: {item.outliers} • Datas futuras: {item.futureDates}</small></div>
                </div>
              ))}
            </div>
          </CardBody>
        )}
      </Card>
    </section>
  );
}
