"use client";

import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { buildDashboardData } from "@/lib/analytics";
import { formatDateTimePtBr, toIsoDateTime } from "@/lib/datetime";
import type { DataQualityReport, FilterPresetRecord, MatchRecord, PlayerSummary, UpcomingRecord } from "@/lib/types";
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

  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const reloadPresets = async () => {
    setPresets(await db.presets.orderBy("updatedAt").reverse().toArray());
  };

  useEffect(() => {
    void (async () => {
      const [matchRows, upcomingRows, rawDataset] = await Promise.all([
        db.matches.toArray(),
        db.upcoming.orderBy("dateTime").toArray(),
        db.rawDatasets.get("latest"),
      ]);

      const effectiveMatches = matchRows;
      const effectiveUpcoming = upcomingRows;

      setMatches(effectiveMatches);
      setUpcoming(effectiveUpcoming);
      setQuality(rawDataset?.quality ?? null);
      await reloadPresets();

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

      setIsLoading(false);
    })();
  }, [setDatasetMeta]);

  const dashboard = useMemo(
    () => buildDashboardData({ matches, league, period, recencyOn, line, decisionMode }),
    [matches, league, period, recencyOn, line, decisionMode]
  );

  const leagues = useMemo(
    () => ["all", ...new Set(matches.map((item) => item.league).filter(Boolean))],
    [matches]
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
    matches.forEach((match) => {
      const item = grouped.get(match.league) ?? { games: 0, outliers: 0, futureDates: 0 };
      item.games += 1;
      if (match.homeGoals + match.awayGoals > 20) item.outliers += 1;
      if (new Date(match.dateTime).getTime() > nowTs) item.futureDates += 1;
      grouped.set(match.league, item);
    });
    return [...grouped.entries()].map(([leagueName, value]) => ({ leagueName, ...value }));
  }, [matches, nowTs]);

  useEffect(() => {
    const leagueGames = matches.filter((item) => league === "all" || item.league === league).length;
    setWarning(leagueGames > 0 && leagueGames < 20 ? "Liga com poucos jogos: confiabilidade rebaixada em um nível." : "");
  }, [matches, league]);

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

      {isLoading ? (
        <>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
          <Card className="stat"><CardBody><Skeleton /><div style={{ marginTop: 12 }}><Skeleton width="60%" /></div></CardBody></Card>
        </>
      ) : (
        <>
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
            <Badge tone={dashboard.decision.score >= 75 ? "good" : dashboard.decision.score >= 55 ? "warn" : "bad"}>Score: {dashboard.decision.score}</Badge>
            <Badge tone={semaphoreTone(dashboard.decision.semaphore)}>Semáforo: {dashboard.decision.semaphore.toUpperCase()}</Badge>
            <Badge tone={dashboard.decision.signal === "over" ? "good" : dashboard.decision.signal === "under" ? "warn" : "bad"}>Sinal: {decisionSignalLabel(dashboard.decision.signal)}</Badge>
            <Badge tone={confidenceTone(dashboard.decision.confidence)}>Confiança: {dashboard.decision.confidence}</Badge>
            <Badge tone={dashboard.decision.antiFalseSignalPassed ? "good" : "warn"}>Proteção: {dashboard.decision.antiFalseSignalPassed ? "Aprovada" : "Bloqueada"}</Badge>
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
                  <div className="avatar">{player.nick.slice(0, 2).toUpperCase()}</div>
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
            <Badge tone={dashboard.calibration.brierScore <= 0.2 ? "good" : dashboard.calibration.brierScore <= 0.28 ? "warn" : "bad"}>
              Brier: {dashboard.calibration.brierScore.toFixed(3)}
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
                    <div className="avatar">{item.nick.slice(0, 2).toUpperCase()}</div>
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
                <div className="left"><div className="avatar">{event.homeNick.slice(0, 1)}{event.awayNick.slice(0, 1)}</div><div className="nick"><b>{event.homeNick} vs {event.awayNick}</b><small>{event.homeTeam} x {event.awayTeam} • {formatDateTimePtBr(event.dateTime)}</small></div></div>
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
                    <td>{match.homeNick}</td>
                    <td>{match.awayNick}</td>
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
