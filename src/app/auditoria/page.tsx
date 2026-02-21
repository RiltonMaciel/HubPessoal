"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import type { PredictionLedgerRecord, RecommendationStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
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
            <h3>Auditoria / Performance</h3>
            <small>Ledger offline de previsões (hit-rate e Brier em resolvidos)</small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={resetFilters}>Reset filtros</Button>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            <Select value={routeContext} onChange={(event) => setRouteContext(event.target.value as RouteContext | "all")}>
              <option value="all">Contexto: todos</option>
              <option value="dashboard">dashboard</option>
              <option value="h2h">h2h</option>
              <option value="aovivo">aovivo</option>
            </Select>

            <Select value={decision} onChange={(event) => setDecision(event.target.value as RecommendationStatus | "all")}>
              <option value="all">Decisão: todas</option>
              <option value="APOSTAVEL">APOSTAVEL</option>
              <option value="CAUTELA">CAUTELA</option>
              <option value="EVITAR">EVITAR</option>
              <option value="SEM_SINAL">SEM_SINAL</option>
            </Select>

            <Select value={market} onChange={(event) => setMarket(event.target.value)}>
              {markets.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "Mercado: todos" : item}
                </option>
              ))}
            </Select>

            <Select value={league} onChange={(event) => setLeague(event.target.value)}>
              {leagues.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "Liga: todas" : item}
                </option>
              ))}
            </Select>

            <label style={{ display: "grid", gap: 6 }}>
              <small className="mini">De</small>
              <input className="select" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <small className="mini">Até</small>
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

            <Badge>Total: {metrics.total}</Badge>
            <Badge>Resolvidos: {metrics.resolvedTotal}</Badge>
            <Badge>Em aberto: {metrics.unresolved}</Badge>
            <Badge tone={metrics.scoredTotal ? "good" : "warn"}>Pontuáveis: {metrics.scoredTotal}</Badge>
            <Badge tone={metrics.hitRate >= 0.58 ? "good" : metrics.hitRate >= 0.52 ? "warn" : "bad"}>
              Hit: {(metrics.hitRate * 100).toFixed(1)}%
            </Badge>
            <Badge tone={metrics.brier && metrics.brier <= 0.23 ? "good" : "warn"}>
              Brier: {metrics.brier.toFixed(4)}
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
            <h3>Últimas previsões</h3>
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
                  <th>Quando</th>
                  <th>Ctx</th>
                  <th>Liga</th>
                  <th>Mercado</th>
                  <th>Decisão</th>
                  <th className="right">pCal</th>
                  <th className="right">Res.</th>
                  <th className="right">Hit</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((item) => {
                  const resolved = Boolean(item.resolvedAt && item.outcome);
                  const hit = resolveHit01(item);
                  return (
                    <tr key={item.id}>
                      <td>{new Date(item.createdAt).toLocaleString("pt-BR")}</td>
                      <td>{item.routeContext}</td>
                      <td>{item.league ?? "-"}</td>
                      <td>{normalizeMarket(item.market)}</td>
                      <td>{item.decision}</td>
                      <td className="right">{(clamp01(item.pCalibrated) * 100).toFixed(1)}%</td>
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
