"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import type { PredictionLedgerRecord, RecommendationStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoHint } from "@/components/ui/InfoHint";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table } from "@/components/ui/Table";

type RouteContext = PredictionLedgerRecord["routeContext"];

type ResolvedView = {
  resolved: boolean;
  label: string;
};

const resolvedViews: ResolvedView[] = [
  { resolved: false, label: "Todos" },
  { resolved: true, label: "Somente resolvidos" },
];

const HELP = {
  page:
    "Esta página é uma auditoria OFFLINE das previsões geradas pelo app.\n\nO que você consegue medir aqui:\n- Quantas previsões foram feitas (Total).\n- Quantas já têm resultado conhecido (Resolvidos).\n- Performance real: Hit-rate e Brier (apenas nos pontuáveis).\n\nRegras importantes:\n- Hit-rate e Brier só fazem sentido quando há 'outcome' (resultado) salvo no ledger.\n- 'pCal' é a probabilidade calibrada (0..1).\n- Threshold atual para virar 'Sim' vs 'Não': pCal >= 0.50.\n\nExemplo rápido:\n- Mercado ou6.5, pCal=0.72 => previsão 'Over'.\n- Resultado total=8 => hit=✓.\n- Resultado total=4 => hit=✗.",
  context:
    "Contexto (Ctx) indica de onde a previsão foi gerada:\n- dashboard: recomendações do Command Center\n- h2h: confronto direto\n- aovivo: monitor ao vivo\n- analise-jogos: jogos colados manualmente\n\nExemplo: se você filtra 'aovivo', você avalia somente decisões tomadas ao vivo.",
  decision:
    "Decisão é a classificação final do sistema para aquela previsão:\n- APOSTAVEL: passou gates (amostra, edge, drift, confiabilidade, etc.)\n- CAUTELA: sinal existe, mas é frágil (stake menor / aguardar)\n- EVITAR: sinal bloqueado (risco alto / ruído / baixa confiabilidade)\n- SEM_SINAL: neutro\n\nDica: a auditoria fica mais honesta filtrando 'APOSTAVEL' e comparando com o resto.",
  market:
    "Mercado é o alvo binário que a previsão tentou acertar.\n\nFormatos comuns:\n- btts: ambas marcam (Sim/Não)\n- ou6.5, ou2.5, ou8.5...: Over/Under por linha\n\nComo vira 0/1 internamente:\n- btts => 1 se outcome.btts=true\n- ouL => 1 se (homeGoals+awayGoals) > L\n\nExemplos:\n- ou6.5 com total=7 => outcome=1 (Over)\n- ou6.5 com total=6 => outcome=0 (Under)",
  league:
    "Liga permite segmentar performance por competição.\n\nExemplo: uma liga de 8 mins pode ter média de gols diferente de outra.\nSe o Brier piora muito numa liga, considere:\n- reimportar/limpar dados\n- reduzir agressividade\n- usar recortes mais robustos.",
  dateRange:
    "Filtro de datas usa o campo createdAt (quando a previsão foi registrada).\n\nExemplo: De=2026-02-01 Até=2026-02-21 pega somente previsões criadas nesse intervalo.",
  resolvedOnly:
    "Resolvidos = itens que têm resolvedAt + outcome preenchidos (resultado conhecido).\n\nSomente resolvidos é o filtro correto para medir Hit-rate e Brier.\n\nAtenção: se você estiver com muitos 'Em aberto', a auditoria ainda é útil para volume, mas não para performance.",
  total:
    "Total = quantidade de previsões após aplicar os filtros.\n\nExemplo: se você filtra mercado=ou6.5 e decisão=APOSTAVEL, o Total vira o tamanho dessa amostra.",
  resolved:
    "Resolvidos = previsões que já têm um resultado (outcome) registrado.\nEssas são as únicas que entram em métricas de performance.",
  unresolved:
    "Em aberto = previsões sem outcome (ainda não foi possível resolver/registrar o placar).\n\nCausas comuns:\n- previsão era para jogo futuro\n- faltou import de resultado\n- item foi gerado no AoVivo mas não foi fechado/resolvido.",
  scored:
    "Pontuáveis = resolvidos que o sistema consegue transformar em 0/1 (binário) para medir hit-rate e Brier.\n\nExemplo: mercados não-binários (se existirem) podem ficar fora.",
  hit:
    "Hit-rate = % de acertos no recorte.\n\nComo calculamos:\n- predicted = (pCal >= 0.5) ? 1 : 0\n- outcome = 1 (aconteceu) ou 0 (não aconteceu)\n- hit = 1 se predicted == outcome\n\nExemplos:\n1) ou6.5, pCal=0.72 => predicted=1 (Over)\n   total=8 => outcome=1 => hit=✓\n2) btts, pCal=0.61 => predicted=1 (BTTS Sim)\n   outcome.btts=false => outcome=0 => hit=✗\n\nInterpretação:\n- 58%+ tende a ser bom para decisões binárias, mas depende da qualidade do recorte.",
  brier:
    "Brier Score mede qualidade PROBABILÍSTICA (não só acerto).\n\nFórmula:\nBrier = média de (pCal - outcome)^2\n\nExemplos:\n- pCal=0.90 e outcome=1 => erro=(0.9-1)^2=0.01 (excelente)\n- pCal=0.60 e outcome=0 => erro=(0.6-0)^2=0.36 (ruim)\n\nLeitura:\n- menor é melhor\n- valores perto de 0.25 indicam algo próximo de 'chutar moeda' em cenário balanceado\n- não compare Brier entre mercados muito diferentes sem cuidado.",
  pcal:
    "Prob. mostra a probabilidade do LADO previsto (0..1).\n\nRegras:\n- Para mercados OU: o evento é 'Over'.\n  - Se pCal>=0.5 => Prev=Over e Prob=pCal\n  - Se pCal<0.5  => Prev=Under e Prob=(1-pCal)\n- Para BTTS: o evento é 'BTTS Sim'.\n  - Se pCal>=0.5 => Prev=Sim e Prob=pCal\n  - Se pCal<0.5  => Prev=Não e Prob=(1-pCal)\n\nIsso evita confusão quando pCal é baixo: um pCal=0.32 quer dizer 68% para o lado oposto.",
  status:
    "Res. (resultado) mostra se o item já foi resolvido:\n- ✓ = resolvido (tem outcome)\n- … = em aberto (sem outcome)",
} as const;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeMarket(market: string) {
  const trimmed = market.trim();
  if (!trimmed) return trimmed;
  // normaliza legado: ou-6.5 -> ou6.5
  return trimmed.replace(/^ou-/, "ou");
}

function parseOuLine(market: string) {
  const normalized = normalizeMarket(market).toLowerCase();
  if (!normalized.startsWith("ou")) return null;
  const raw = normalized.slice(2);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function resolveOutcome01(item: PredictionLedgerRecord): 0 | 1 | null {
  if (!item.outcome) return null;

  const market = normalizeMarket(item.market).toLowerCase();

  if (market === "btts") {
    return item.outcome.btts ? 1 : 0;
  }

  if (market.startsWith("ou")) {
    const line = parseOuLine(market);
    if (line == null) return null;
    const total = item.outcome.homeGoals + item.outcome.awayGoals;
    return total > line ? 1 : 0;
  }

  return null;
}

function resolveHit01(item: PredictionLedgerRecord): 0 | 1 | null {
  const outcome = resolveOutcome01(item);
  if (outcome == null) return null;
  const predicted = clamp01(item.pCalibrated) >= 0.5 ? 1 : 0;
  return predicted === outcome ? 1 : 0;
}

function resolvePredictionView(item: PredictionLedgerRecord): {
  label: string;
  prob: number;
  predicted01: 0 | 1;
} {
  const p = clamp01(item.pCalibrated);
  const predicted01: 0 | 1 = p >= 0.5 ? 1 : 0;

  const market = normalizeMarket(item.market).toLowerCase();
  if (market === "btts") {
    return {
      label: predicted01 === 1 ? "BTTS Sim" : "BTTS Não",
      prob: predicted01 === 1 ? p : 1 - p,
      predicted01,
    };
  }

  if (market.startsWith("ou")) {
    return {
      label: predicted01 === 1 ? "Over" : "Under",
      prob: predicted01 === 1 ? p : 1 - p,
      predicted01,
    };
  }

  return {
    label: predicted01 === 1 ? "Sim" : "Não",
    prob: predicted01 === 1 ? p : 1 - p,
    predicted01,
  };
}

export default function AuditoriaPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PredictionLedgerRecord[]>([]);

  const [routeContext, setRouteContext] = useState<RouteContext | "all">("all");
  const [decision, setDecision] = useState<RecommendationStatus | "all">("all");
  const [market, setMarket] = useState<string>("all");
  const [league, setLeague] = useState<string>("all");
  const [resolvedOnly, setResolvedOnly] = useState<boolean>(false);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const data = await db.predictionLedger.orderBy("createdAt").reverse().toArray();
        if (cancelled) return;
        setRows(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const markets = useMemo(() => {
    const uniq = new Set<string>();
    rows.forEach((item) => {
      const m = normalizeMarket(item.market);
      if (m) uniq.add(m);
    });
    return ["all", ...Array.from(uniq).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const leagues = useMemo(() => {
    const uniq = new Set<string>();
    rows.forEach((item) => {
      if (item.league) uniq.add(item.league);
    });
    return ["all", ...Array.from(uniq).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  const filtered = useMemo(() => {
    const fromIso = from ? new Date(from).toISOString() : null;
    const toIso = to ? new Date(`${to}T23:59:59.999`).toISOString() : null;

    return rows.filter((item) => {
      if (routeContext !== "all" && item.routeContext !== routeContext) return false;
      if (decision !== "all" && item.decision !== decision) return false;

      const itemMarket = normalizeMarket(item.market);
      if (market !== "all" && itemMarket !== market) return false;

      if (league !== "all" && (item.league ?? "") !== league) return false;

      const resolved = Boolean(item.resolvedAt && item.outcome);
      if (resolvedOnly && !resolved) return false;

      if (fromIso && item.createdAt < fromIso) return false;
      if (toIso && item.createdAt > toIso) return false;

      return true;
    });
  }, [rows, routeContext, decision, market, league, resolvedOnly, from, to]);

  const metrics = useMemo(() => {
    const resolved = filtered.filter((item) => item.resolvedAt && item.outcome);

    const scored = resolved
      .map((item) => {
        const hit = resolveHit01(item);
        const outcome = resolveOutcome01(item);
        if (hit == null || outcome == null) return null;
        return { hit, outcome, p: clamp01(item.pCalibrated) };
      })
      .filter((item): item is { hit: 0 | 1; outcome: 0 | 1; p: number } => Boolean(item));

    const total = filtered.length;
    const resolvedTotal = resolved.length;
    const unresolved = total - resolvedTotal;

    const hitRate = scored.length ? scored.reduce((acc, item) => acc + item.hit, 0) / scored.length : 0;
    const brier = scored.length ? scored.reduce((acc, item) => acc + (item.p - item.outcome) ** 2, 0) / scored.length : 0;

    const byDecision: Record<RecommendationStatus, number> = {
      APOSTAVEL: 0,
      CAUTELA: 0,
      EVITAR: 0,
      SEM_SINAL: 0,
    };

    filtered.forEach((item) => {
      byDecision[item.decision] += 1;
    });

    return {
      total,
      resolvedTotal,
      unresolved,
      scoredTotal: scored.length,
      hitRate,
      brier,
      byDecision,
    };
  }, [filtered]);

  const visibleRows = useMemo(() => filtered.slice(0, 80), [filtered]);

  const resetFilters = () => {
    setRouteContext("all");
    setDecision("all");
    setMarket("all");
    setLeague("all");
    setResolvedOnly(false);
    setFrom("");
    setTo("");
  };

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Auditoria / Performance <InfoHint text={HELP.page} /></h3>
            <small>Ledger offline de previsões (hit-rate e Brier em resolvidos)</small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={resetFilters}>Reset filtros</Button>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <small className="mini">Contexto <InfoHint text={HELP.context} /></small>
              <Select value={routeContext} onChange={(event) => setRouteContext(event.target.value as RouteContext | "all")}>
              <option value="all">Contexto: todos</option>
              <option value="dashboard">dashboard</option>
              <option value="h2h">h2h</option>
              <option value="aovivo">aovivo</option>
              <option value="analise-jogos">analise-jogos</option>
              </Select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <small className="mini">Decisão <InfoHint text={HELP.decision} /></small>
              <Select value={decision} onChange={(event) => setDecision(event.target.value as RecommendationStatus | "all")}>
              <option value="all">Decisão: todas</option>
              <option value="APOSTAVEL">APOSTAVEL</option>
              <option value="CAUTELA">CAUTELA</option>
              <option value="EVITAR">EVITAR</option>
              <option value="SEM_SINAL">SEM_SINAL</option>
              </Select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <small className="mini">Mercado <InfoHint text={HELP.market} /></small>
              <Select value={market} onChange={(event) => setMarket(event.target.value)}>
                {markets.map((item) => (
                  <option key={item} value={item}>
                    {item === "all" ? "Mercado: todos" : item}
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <small className="mini">Liga <InfoHint text={HELP.league} /></small>
              <Select value={league} onChange={(event) => setLeague(event.target.value)}>
                {leagues.map((item) => (
                  <option key={item} value={item}>
                    {item === "all" ? "Liga: todas" : item}
                  </option>
                ))}
              </Select>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <small className="mini">De <InfoHint text={HELP.dateRange} /></small>
              <input className="select" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <small className="mini">Até <InfoHint text={HELP.dateRange} /></small>
              <input className="select" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <Select value={resolvedOnly ? "resolved" : "all"} onChange={(event) => setResolvedOnly(event.target.value === "resolved")}>
              {resolvedViews.map((view) => (
                <option key={view.label} value={view.resolved ? "resolved" : "all"}>
                  {view.label}
                </option>
              ))}
            </Select>

            <InfoHint text={HELP.resolvedOnly} />

            <Badge>Total: {metrics.total} <InfoHint text={HELP.total} /></Badge>
            <Badge>Resolvidos: {metrics.resolvedTotal} <InfoHint text={HELP.resolved} /></Badge>
            <Badge>Em aberto: {metrics.unresolved} <InfoHint text={HELP.unresolved} /></Badge>
            <Badge tone={metrics.scoredTotal ? "good" : "warn"}>Pontuáveis: {metrics.scoredTotal} <InfoHint text={HELP.scored} /></Badge>
            <Badge tone={metrics.hitRate >= 0.58 ? "good" : metrics.hitRate >= 0.52 ? "warn" : "bad"}>
              Hit: {(metrics.hitRate * 100).toFixed(1)}% <InfoHint text={HELP.hit} />
            </Badge>
            <Badge tone={metrics.brier && metrics.brier <= 0.23 ? "good" : "warn"}>
              Brier: {metrics.brier.toFixed(4)} <InfoHint text={HELP.brier} />
            </Badge>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Badge>APOSTAVEL: {metrics.byDecision.APOSTAVEL}</Badge>
            <Badge>CAUTELA: {metrics.byDecision.CAUTELA}</Badge>
            <Badge>EVITAR: {metrics.byDecision.EVITAR}</Badge>
            <Badge>SEM_SINAL: {metrics.byDecision.SEM_SINAL}</Badge>
          </div>
        </CardBody>
      </Card>

      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Últimas previsões <InfoHint text={HELP.page} /></h3>
            <small>Até 80 itens (respeita filtros)</small>
          </div>
        </CardHeader>
        <CardBody>
          {loading && (
            <>
              <Skeleton />
              <div style={{ marginTop: 8 }}>
                <Skeleton width="70%" />
              </div>
            </>
          )}

          {!loading && !filtered.length && (
            <EmptyState title="Sem dados" subtitle="Nenhuma previsão encontrada com os filtros atuais." />
          )}

          {!loading && filtered.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th>Quando <InfoHint text={HELP.dateRange} /></th>
                  <th>Ctx <InfoHint text={HELP.context} /></th>
                  <th>Liga <InfoHint text={HELP.league} /></th>
                  <th>Mercado <InfoHint text={HELP.market} /></th>
                  <th>Prev. <InfoHint text={HELP.hit} /></th>
                  <th>Decisão <InfoHint text={HELP.decision} /></th>
                  <th className="right">Prob. <InfoHint text={HELP.pcal} /></th>
                  <th className="right">Res. <InfoHint text={HELP.status} /></th>
                  <th className="right">Hit <InfoHint text={HELP.hit} /></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((item) => {
                  const resolved = Boolean(item.resolvedAt && item.outcome);
                  const hit = resolveHit01(item);
                  const view = resolvePredictionView(item);
                  return (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleString("pt-BR")}</td>
                      <td>{item.routeContext}</td>
                      <td>{item.league ?? "-"}</td>
                      <td>{normalizeMarket(item.market)}</td>
                      <td>{view.label}</td>
                      <td>{item.decision}</td>
                      <td className="right">{(view.prob * 100).toFixed(1)}%</td>
                      <td className="right">{resolved ? "✓" : "…"}</td>
                      <td className="right">{hit == null ? "-" : hit === 1 ? "✓" : "✗"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
