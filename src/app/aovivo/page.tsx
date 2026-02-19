"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/db";
import type { MatchRecord } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table } from "@/components/ui/Table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type LiveStatus = "live" | "upcoming" | "finished";

type LiveRow = {
  eventTime: string;
  fixture: string;
  score: string;
  status: LiveStatus;
  minute?: number;
  homeTeam: string;
  awayTeam: string;
  homeNick?: string;
  awayNick?: string;
};

type LiveResponse = {
  ok: boolean;
  updatedAt: string;
  pagesProcessed: number;
  total: number;
  rows: LiveRow[];
  statusCounts: {
    live: number;
    upcoming: number;
    finished: number;
  };
};

type PlayerStrength = {
  games: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
};

type WinnerProb = {
  home: number;
  draw: number;
  away: number;
  favorite: "home" | "away" | "draw";
  confidence: "baixa" | "media" | "alta";
};

type TeamWindowStats = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  pointsPerGame: number;
};

type MarketLine = {
  market: string;
  probability: number;
  fairOdd: number;
};

type DeepStats = {
  row: LiveRow;
  winner: WinnerProb;
  homeStats: TeamWindowStats;
  awayStats: TeamWindowStats;
  h2hGames: number;
  h2hOver65: number;
  h2hBtts: number;
  expHomeGoals: number;
  expAwayGoals: number;
  expTotalGoals: number;
  bttsProb: number;
  markets: MarketLine[];
  overCurve: Array<{ line: string; probability: number }>;
  resultBars: Array<{ label: string; probability: number }>;
};

const DEFAULT_URL = "https://betsapi.com/ls/37298/Esoccer-H2H-GG-League--8-mins-play";
const POLL_MS = 1000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function parseScore(score: string) {
  const match = score.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return {
    home: Number(match[1]),
    away: Number(match[2]),
  };
}

function normalizeNick(nick?: string) {
  return nick?.trim().toUpperCase() ?? "";
}

function buildStrengthMap(matches: MatchRecord[]) {
  const map = new Map<string, PlayerStrength>();

  const ensure = (nick: string) => {
    if (!map.has(nick)) {
      map.set(nick, { games: 0, points: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 });
    }
    return map.get(nick)!;
  };

  for (const item of matches) {
    const homeNick = normalizeNick(item.homeNick);
    const awayNick = normalizeNick(item.awayNick);
    if (!homeNick || !awayNick) continue;

    const home = ensure(homeNick);
    const away = ensure(awayNick);

    home.games += 1;
    away.games += 1;
    home.gf += item.homeGoals;
    home.ga += item.awayGoals;
    away.gf += item.awayGoals;
    away.ga += item.homeGoals;

    if (item.homeGoals > item.awayGoals) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (item.homeGoals < item.awayGoals) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return map;
}

function estimateWinnerProbability(row: LiveRow, strengths: Map<string, PlayerStrength>, leaguePpg: number): WinnerProb {
  const homeNick = normalizeNick(row.homeNick);
  const awayNick = normalizeNick(row.awayNick);
  const homeData = strengths.get(homeNick);
  const awayData = strengths.get(awayNick);

  const homeGames = homeData?.games ?? 0;
  const awayGames = awayData?.games ?? 0;
  const homePpg = homeGames ? (homeData!.points / homeGames) : leaguePpg;
  const awayPpg = awayGames ? (awayData!.points / awayGames) : leaguePpg;

  const homeShrink = (homePpg * homeGames + leaguePpg * 8) / Math.max(homeGames + 8, 1);
  const awayShrink = (awayPpg * awayGames + leaguePpg * 8) / Math.max(awayGames + 8, 1);

  const delta = homeShrink - awayShrink;
  const drawProb = clamp(0.28 - Math.abs(delta) * 0.08, 0.08, 0.28);
  const homeRaw = sigmoid(delta * 1.35);
  let homeProb = (1 - drawProb) * homeRaw;
  let awayProb = (1 - drawProb) - homeProb;
  let draw = drawProb;

  if (row.status === "live") {
    const parsed = parseScore(row.score);
    const minute = clamp(row.minute ?? 0, 0, 8);
    if (parsed) {
      const lead = parsed.home - parsed.away;
      const progress = clamp(minute / 8, 0, 1);
      const swing = clamp(Math.abs(lead) * (0.1 + progress * 0.33), 0, 0.65);

      if (lead > 0) {
        const deltaHome = swing * 0.75;
        homeProb = clamp(homeProb + deltaHome, 0.02, 0.96);
        const remainder = 1 - homeProb;
        const drawShare = clamp(0.45 - progress * 0.2, 0.15, 0.45);
        draw = remainder * drawShare;
        awayProb = remainder - draw;
      } else if (lead < 0) {
        const deltaAway = swing * 0.75;
        awayProb = clamp(awayProb + deltaAway, 0.02, 0.96);
        const remainder = 1 - awayProb;
        const drawShare = clamp(0.45 - progress * 0.2, 0.15, 0.45);
        draw = remainder * drawShare;
        homeProb = remainder - draw;
      }
    }
  }

  const sample = Math.min(homeGames, awayGames);
  const confidence: WinnerProb["confidence"] =
    sample >= 14 ? "alta" : sample >= 8 ? "media" : "baixa";

  const favorite: WinnerProb["favorite"] =
    homeProb >= awayProb && homeProb >= draw
      ? "home"
      : awayProb >= draw
        ? "away"
        : "draw";

  return {
    home: clamp(homeProb, 0, 1),
    draw: clamp(draw, 0, 1),
    away: clamp(awayProb, 0, 1),
    favorite,
    confidence,
  };
}

function statusLabel(status: LiveStatus) {
  if (status === "live") return "Ao vivo";
  if (status === "upcoming") return "Na fila";
  return "Finalizado";
}

function poissonPmf(k: number, lambda: number) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial;
}

function poissonCdf(k: number, lambda: number) {
  let sum = 0;
  for (let i = 0; i <= k; i += 1) sum += poissonPmf(i, lambda);
  return sum;
}

function roundOdd(probability: number) {
  if (probability <= 0) return 99;
  return Number((1 / probability).toFixed(2));
}

function computeTeamWindowStats(nick: string, matches: MatchRecord[], window = 12): TeamWindowStats {
  const rows = matches
    .filter((item) => normalizeNick(item.homeNick) === nick || normalizeNick(item.awayNick) === nick)
    .sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime))
    .slice(0, window);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gf = 0;
  let ga = 0;

  for (const row of rows) {
    const isHome = normalizeNick(row.homeNick) === nick;
    const goalsFor = isHome ? row.homeGoals : row.awayGoals;
    const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
    gf += goalsFor;
    ga += goalsAgainst;

    if (goalsFor > goalsAgainst) wins += 1;
    else if (goalsFor < goalsAgainst) losses += 1;
    else draws += 1;
  }

  const games = rows.length;
  const points = wins * 3 + draws;
  return {
    games,
    wins,
    draws,
    losses,
    gf,
    ga,
    avgGoalsFor: games ? gf / games : 0,
    avgGoalsAgainst: games ? ga / games : 0,
    pointsPerGame: games ? points / games : 0,
  };
}

function buildDeepStats(row: LiveRow, matches: MatchRecord[], strengths: Map<string, PlayerStrength>, leaguePpg: number): DeepStats {
  const winner = estimateWinnerProbability(row, strengths, leaguePpg);
  const homeNick = normalizeNick(row.homeNick);
  const awayNick = normalizeNick(row.awayNick);

  const homeStats = computeTeamWindowStats(homeNick, matches);
  const awayStats = computeTeamWindowStats(awayNick, matches);

  const h2h = matches.filter((item) => {
    const home = normalizeNick(item.homeNick);
    const away = normalizeNick(item.awayNick);
    return (home === homeNick && away === awayNick) || (home === awayNick && away === homeNick);
  });

  const h2hGames = h2h.length;
  const h2hOver65 = h2hGames
    ? h2h.filter((item) => item.homeGoals + item.awayGoals > 6.5).length / h2hGames
    : 0;
  const h2hBtts = h2hGames
    ? h2h.filter((item) => item.homeGoals > 0 && item.awayGoals > 0).length / h2hGames
    : 0;

  const leagueAvgGf = matches.length
    ? matches.reduce((acc, item) => acc + item.homeGoals + item.awayGoals, 0) / matches.length / 2
    : 1.8;

  const expHomeGoals = clamp((homeStats.avgGoalsFor + awayStats.avgGoalsAgainst + leagueAvgGf) / 3, 0.3, 6.5);
  const expAwayGoals = clamp((awayStats.avgGoalsFor + homeStats.avgGoalsAgainst + leagueAvgGf) / 3, 0.3, 6.5);
  const expTotalGoals = expHomeGoals + expAwayGoals;

  const bttsProb = clamp((1 - Math.exp(-expHomeGoals)) * (1 - Math.exp(-expAwayGoals)), 0, 1);

  const totalLines = [
    0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5,
  ];

  const overCurve = totalLines.map((line) => {
    const floorLine = Math.floor(line);
    const probability = clamp(1 - poissonCdf(floorLine, expTotalGoals), 0, 1);
    return { line: `Over ${line}`, probability };
  });

  const resultBars = [
    { label: "Casa", probability: winner.home },
    { label: "Empate", probability: winner.draw },
    { label: "Fora", probability: winner.away },
  ];

  const markets: MarketLine[] = [
    { market: "Casa (1)", probability: winner.home, fairOdd: roundOdd(winner.home) },
    { market: "Empate (X)", probability: winner.draw, fairOdd: roundOdd(winner.draw) },
    { market: "Fora (2)", probability: winner.away, fairOdd: roundOdd(winner.away) },
    { market: "1X", probability: clamp(winner.home + winner.draw, 0, 1), fairOdd: roundOdd(winner.home + winner.draw) },
    { market: "X2", probability: clamp(winner.away + winner.draw, 0, 1), fairOdd: roundOdd(winner.away + winner.draw) },
    { market: "12", probability: clamp(winner.home + winner.away, 0, 1), fairOdd: roundOdd(winner.home + winner.away) },
    { market: "BTTS Sim", probability: bttsProb, fairOdd: roundOdd(bttsProb) },
    { market: "BTTS Não", probability: 1 - bttsProb, fairOdd: roundOdd(1 - bttsProb) },
    ...overCurve.map((item) => ({
      market: item.line,
      probability: item.probability,
      fairOdd: roundOdd(item.probability),
    })),
  ];

  return {
    row,
    winner,
    homeStats,
    awayStats,
    h2hGames,
    h2hOver65,
    h2hBtts,
    expHomeGoals,
    expAwayGoals,
    expTotalGoals,
    bttsProb,
    markets,
    overCurve,
    resultBars,
  };
}

export default function AoVivoPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [maxPages, setMaxPages] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [selectedRow, setSelectedRow] = useState<LiveRow | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const rowsDb = await db.matches.toArray();
      setMatches(rowsDb);
    })();
  }, []);

  async function fetchLiveBoard(options?: { manual?: boolean }) {
    const manual = options?.manual ?? false;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (manual) {
      setLoading(true);
      setError("");
    }

    try {
      const response = await fetch("/api/betsapi/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, maxPages }),
      });

      const data = (await response.json()) as LiveResponse | { error: string };
      if (!response.ok) {
        setError("error" in data ? data.error : "Falha ao atualizar AoVivo.");
        return;
      }

      const payload = data as LiveResponse;
      if (payload.rows.length > 0) {
        setRows(payload.rows);
      } else if (!manual) {
        setError("Atualização sem linhas válidas no momento. Mantendo último snapshot.");
      }
      setLastSuccessAt(payload.updatedAt);
      if (payload.rows.length > 0) {
        setError("");
      }
    } catch {
      if (manual) {
        setError("Falha de rede ao consultar o BetsAPI.");
      } else {
        setError((prev) => prev || "Falha de rede ao consultar o BetsAPI.");
      }
    } finally {
      if (manual) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;
    void fetchLiveBoard({ manual: false });

    const timer = setInterval(() => {
      void fetchLiveBoard({ manual: false });
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [autoRefresh, url, maxPages]);

  const strengths = useMemo(() => buildStrengthMap(matches), [matches]);
  const leaguePpg = useMemo(() => {
    const all = [...strengths.values()];
    if (!all.length) return 1.35;
    return all.reduce((acc, item) => acc + item.points / Math.max(item.games, 1), 0) / all.length;
  }, [strengths]);

  const queueRows = useMemo(
    () => rows.filter((item) => item.status === "upcoming" || item.status === "live"),
    [rows]
  );

  const boardWithProb = useMemo(
    () => queueRows.map((row) => ({ row, prob: estimateWinnerProbability(row, strengths, leaguePpg) })),
    [queueRows, strengths, leaguePpg]
  );

  const selectedDeepStats = useMemo(() => {
    if (!selectedRow) return null;
    return buildDeepStats(selectedRow, matches, strengths, leaguePpg);
  }, [selectedRow, matches, strengths, leaguePpg]);

  const isFresh = useMemo(() => {
    if (!lastSuccessAt) return false;
    const diff = Date.now() - new Date(lastSuccessAt).getTime();
    return diff <= POLL_MS * 2.5 && !error;
  }, [lastSuccessAt, error]);

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>AoVivo (Analytics)</h3>
            <small>Importe automático a cada 1 segundo + probabilidade de vencedor para jogos na fila</small>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-label={isFresh ? "Atualizado" : "Desatualizado"}
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: isFresh ? "var(--success)" : "var(--danger)",
                boxShadow: isFresh
                  ? "0 0 0 6px rgba(46,229,157,.12)"
                  : "0 0 0 6px rgba(255,77,109,.12)",
              }}
            />
            <Badge tone={isFresh ? "good" : "bad"}>{isFresh ? "Atualizado" : "Sem atualização"}</Badge>
          </div>
        </CardHeader>

        <CardBody>
          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge tone="warn">Minuto (ex: 08') = Ao Vivo</Badge>
            <Badge tone="good">View = Próximo jogo</Badge>
            <Badge>Horários ajustados para Brasília (BRT)</Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto auto", gap: 10, marginBottom: 10 }}>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="URL da liga"
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
            />
            <input
              type="number"
              min={1}
              max={5000}
              value={maxPages}
              onChange={(event) => setMaxPages(Number(event.target.value))}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
            />
            <Button onClick={() => void fetchLiveBoard({ manual: true })} disabled={loading}>{loading ? "Atualizando..." : "Atualizar agora"}</Button>
            <Button variant={autoRefresh ? "primary" : "default"} onClick={() => setAutoRefresh((prev) => !prev)}>
              {autoRefresh ? "Auto 1s: ON" : "Auto 1s: OFF"}
            </Button>
          </div>

          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge>{`Linhas monitoradas: ${rows.length}`}</Badge>
            <Badge>{`Fila+AoVivo: ${queueRows.length}`}</Badge>
            <Badge>{`Base histórica: ${matches.length} jogos`}</Badge>
            {lastSuccessAt ? <Badge>{`Última atualização: ${new Date(lastSuccessAt).toLocaleTimeString("pt-BR")}`}</Badge> : null}
          </div>

          {error ? <Badge tone="bad">{error}</Badge> : null}

          {!boardWithProb.length ? (
            <div style={{ marginTop: 12 }}>
              <EmptyState title="Sem dados ao vivo" subtitle="Ative o Auto 1s ou clique em Atualizar agora para iniciar." />
            </div>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <Table>
                <thead>
                  <tr>
                    <th>Tempo</th>
                    <th>Status</th>
                    <th>Jogo</th>
                    <th className="right">Placar</th>
                    <th className="right">Casa</th>
                    <th className="right">Empate</th>
                    <th className="right">Fora</th>
                    <th>Favorito</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {boardWithProb.map(({ row, prob }, index) => (
                    <tr key={`${row.eventTime}-${row.fixture}-${index}`}>
                      <td>{row.eventTime}</td>
                      <td>
                        <Badge tone={row.status === "live" ? "warn" : row.status === "upcoming" ? "good" : "bad"}>
                          {statusLabel(row.status)}
                        </Badge>
                      </td>
                      <td>{row.fixture}</td>
                      <td className="right">{row.score}</td>
                      <td className="right">{(prob.home * 100).toFixed(1)}%</td>
                      <td className="right">{(prob.draw * 100).toFixed(1)}%</td>
                      <td className="right">{(prob.away * 100).toFixed(1)}%</td>
                      <td>
                        <Badge tone={prob.favorite === "draw" ? "warn" : "good"}>
                          {prob.favorite === "home" ? "Casa" : prob.favorite === "away" ? "Fora" : "Empate"} • {prob.confidence}
                        </Badge>
                      </td>
                      <td>
                        <Button onClick={() => setSelectedRow(row)}>Ver mais</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {selectedDeepStats && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedRow(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4,8,16,.72)",
            zIndex: 2000,
            padding: 20,
            overflowY: "auto",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              maxWidth: 1200,
              margin: "24px auto",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "var(--shadow2)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Estatística avançada do jogo</h3>
                <small style={{ color: "var(--muted)" }}>{selectedDeepStats.row.eventTime} • {selectedDeepStats.row.fixture}</small>
              </div>
              <Button onClick={() => setSelectedRow(null)}>Fechar</Button>
            </div>

            <div className="chips" style={{ marginBottom: 10 }}>
              <Badge>Placar atual: {selectedDeepStats.row.score}</Badge>
              <Badge>xG Casa: {selectedDeepStats.expHomeGoals.toFixed(2)}</Badge>
              <Badge>xG Fora: {selectedDeepStats.expAwayGoals.toFixed(2)}</Badge>
              <Badge>xG Total: {selectedDeepStats.expTotalGoals.toFixed(2)}</Badge>
              <Badge>BTTS: {(selectedDeepStats.bttsProb * 100).toFixed(1)}%</Badge>
              <Badge>H2H jogos: {selectedDeepStats.h2hGames}</Badge>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Card className="col-12">
                <CardHeader><div><h3>Probabilidade 1X2</h3><small>Distribuição precisa para resultado final</small></div></CardHeader>
                <CardBody>
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={selectedDeepStats.resultBars}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.08)" />
                        <XAxis dataKey="label" stroke="var(--muted)" />
                        <YAxis stroke="var(--muted)" domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                        <Tooltip formatter={(value) => `${((Number(value) || 0) * 100).toFixed(1)}%`} />
                        <Bar dataKey="probability" fill="rgba(59,130,246,.85)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>

              <Card className="col-12">
                <CardHeader><div><h3>Curva Over (todas linhas)</h3><small>Mercado de gols em múltiplas linhas</small></div></CardHeader>
                <CardBody>
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={selectedDeepStats.overCurve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.08)" />
                        <XAxis dataKey="line" stroke="var(--muted)" />
                        <YAxis stroke="var(--muted)" domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                        <Tooltip formatter={(value) => `${((Number(value) || 0) * 100).toFixed(1)}%`} />
                        <Line type="monotone" dataKey="probability" stroke="rgba(46,229,157,.95)" strokeWidth={3} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Card className="col-12">
                <CardHeader><div><h3>Forma Casa</h3><small>Janela recente de performance</small></div></CardHeader>
                <CardBody>
                  <div className="chips">
                    <Badge>Jogos: {selectedDeepStats.homeStats.games}</Badge>
                    <Badge>PPG: {selectedDeepStats.homeStats.pointsPerGame.toFixed(2)}</Badge>
                    <Badge>GF/J: {selectedDeepStats.homeStats.avgGoalsFor.toFixed(2)}</Badge>
                    <Badge>GA/J: {selectedDeepStats.homeStats.avgGoalsAgainst.toFixed(2)}</Badge>
                    <Badge>W-D-L: {selectedDeepStats.homeStats.wins}-{selectedDeepStats.homeStats.draws}-{selectedDeepStats.homeStats.losses}</Badge>
                  </div>
                </CardBody>
              </Card>

              <Card className="col-12">
                <CardHeader><div><h3>Forma Fora</h3><small>Janela recente de performance</small></div></CardHeader>
                <CardBody>
                  <div className="chips">
                    <Badge>Jogos: {selectedDeepStats.awayStats.games}</Badge>
                    <Badge>PPG: {selectedDeepStats.awayStats.pointsPerGame.toFixed(2)}</Badge>
                    <Badge>GF/J: {selectedDeepStats.awayStats.avgGoalsFor.toFixed(2)}</Badge>
                    <Badge>GA/J: {selectedDeepStats.awayStats.avgGoalsAgainst.toFixed(2)}</Badge>
                    <Badge>W-D-L: {selectedDeepStats.awayStats.wins}-{selectedDeepStats.awayStats.draws}-{selectedDeepStats.awayStats.losses}</Badge>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card className="col-12">
              <CardHeader><div><h3>Mercados detalhados</h3><small>Probabilidade e odd justa para mercados disponíveis</small></div></CardHeader>
              <CardBody>
                <div style={{ overflowX: "auto" }}>
                  <Table>
                    <thead>
                      <tr>
                        <th>Mercado</th>
                        <th className="right">Probabilidade</th>
                        <th className="right">Odd justa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDeepStats.markets.map((item) => (
                        <tr key={item.market}>
                          <td>{item.market}</td>
                          <td className="right">{(item.probability * 100).toFixed(1)}%</td>
                          <td className="right">{item.fairOdd.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
