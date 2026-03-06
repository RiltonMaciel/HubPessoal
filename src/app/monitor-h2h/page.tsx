"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table } from "@/components/ui/Table";

type MonitorResponse = {
  sourceUrl: string;
  fetchedAt: string;
  title: string | null;
  ogTitle: string | null;
  description: string | null;
  htmlSize: number;
  appScript: string | null;
  shellDetected: boolean;
  matchIdFromUrl: string | null;
  statusCode: number;
  liveData: {
    sport: string | null;
    streamName: string | null;
    startedAt: string | null;
    participantA: string | null;
    participantB: string | null;
    teamA: string | null;
    teamB: string | null;
    finalScore: string | null;
    halfTimeScore: string | null;
    timelineIncidents: number;
    h2hForm: string | null;
    statsCaptured: boolean;
    comparison: {
      matchesPlayedA: number | null;
      matchesPlayedB: number | null;
      winRateA: number | null;
      winRateB: number | null;
    };
    statsRows: Array<{
      label: string;
      teamA: string;
      teamB: string;
    }>;
    recentEvents: Array<{
      minute: string;
      event: string;
      team: string | null;
      score: string | null;
    }>;
  } | null;
  fromCache?: boolean;
  error?: string;
};

const DEFAULT_URL = "https://h2hggl.com/pt/esoccer/match/FI023250226";
const REFRESH_SECONDS = 60;

function normalizeMonitorUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatWinRate(value: number | null) {
  if (typeof value !== "number") return "-";
  return `${value.toFixed(1)}%`;
}

export default function MonitorH2HPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MonitorResponse | null>(null);

  async function loadNow() {
    setLoading(true);
    setError("");
    const normalizedUrl = normalizeMonitorUrl(url);

    if (!normalizedUrl) {
      setLoading(false);
      setResult(null);
      setError("Informe uma URL válida para monitorar.");
      return;
    }

    try {
      const response = await fetch(`/api/h2h-monitor?url=${encodeURIComponent(normalizedUrl)}`, { cache: "no-store" });
      const data = (await response.json()) as MonitorResponse;

      if (!response.ok) {
        setResult(null);
        setError(data.error || "Não foi possível atualizar agora.");
        return;
      }

      setResult(data);
      if (normalizedUrl !== url) setUrl(normalizedUrl);
      setCountdown(REFRESH_SECONDS);
    } catch {
      setResult(null);
      setError("Falha de conexão ao tentar atualizar o monitor.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNow();
  }, []);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      void loadNow();
    }, REFRESH_SECONDS * 1000);

    const countdownTimer = window.setInterval(() => {
      setCountdown((current) => (current <= 1 ? REFRESH_SECONDS : current - 1));
    }, 1000);

    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(countdownTimer);
    };
  }, [url]);

  const statusLabel = useMemo(() => {
    if (!result) return "Sem atualização";
    return `HTTP ${result.statusCode} • ${result.fromCache ? "cache" : "origem"}`;
  }, [result]);

  return (
    <div className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Monitor H2H (a cada 1 min)</h3>
            <small>Busca dados do link informado automaticamente de 60 em 60 segundos.</small>
          </div>
          <Badge tone="warn">Beta</Badge>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gap: 10 }}>
            <input
              className="input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Cole a URL do h2hggl"
              aria-label="URL monitorada"
            />

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Button variant="primary" onClick={loadNow} disabled={loading}>
                {loading ? "Atualizando..." : "Atualizar agora"}
              </Button>
              <span className="mini">Próxima atualização em: {countdown}s</span>
              <span className="mini">Status: {statusLabel}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      {!!error && (
        <Card className="col-12">
          <CardBody>
            <EmptyState title="Falha no monitor" subtitle={error} />
          </CardBody>
        </Card>
      )}

      {!!result && !error && (
        <>
          <Card className="col-12">
            <CardHeader>
              <div>
                <h3>Última leitura</h3>
                <small>{new Date(result.fetchedAt).toLocaleString("pt-BR")}</small>
              </div>
              {result.liveData?.statsCaptured ? <Badge tone="good">Dados completos</Badge> : <Badge tone="warn">Parcial</Badge>}
            </CardHeader>
            <CardBody>
              <div className="list">
                <div className="row"><span>Origem</span><b>{result.sourceUrl}</b></div>
                <div className="row"><span>Match ID</span><b>{result.matchIdFromUrl || "-"}</b></div>
                <div className="row"><span>Script app</span><b>{result.appScript || "-"}</b></div>
                <div className="row"><span>Tamanho HTML</span><b>{result.htmlSize} bytes</b></div>
              </div>
            </CardBody>
          </Card>

          {!!result.liveData && (
            <>
              <Card className="col-4">
                <CardHeader>
                  <div>
                    <h3>Resumo da partida</h3>
                    <small>{result.liveData.streamName || result.liveData.sport || "-"}</small>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="list">
                    <div className="row"><span>Participantes</span><b>{result.liveData.participantA || "-"} x {result.liveData.participantB || "-"}</b></div>
                    <div className="row"><span>Times</span><b>{result.liveData.teamA || "-"} x {result.liveData.teamB || "-"}</b></div>
                    <div className="row"><span>Placar final</span><b>{result.liveData.finalScore || "-"}</b></div>
                    <div className="row"><span>Placar HT</span><b>{result.liveData.halfTimeScore || "-"}</b></div>
                    <div className="row"><span>Forma H2H</span><b>{result.liveData.h2hForm || "-"}</b></div>
                    <div className="row"><span>Eventos timeline</span><b>{result.liveData.timelineIncidents}</b></div>
                    <div className="row"><span>Início</span><b>{result.liveData.startedAt ? new Date(result.liveData.startedAt).toLocaleString("pt-BR") : "-"}</b></div>
                  </div>
                </CardBody>
              </Card>

              <Card className="col-4">
                <CardHeader>
                  <div>
                    <h3>Comparativo</h3>
                    <small>Desempenho histórico</small>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="list">
                    <div className="row"><span>Win rate A</span><b>{formatWinRate(result.liveData.comparison.winRateA)}</b></div>
                    <div className="row"><span>Win rate B</span><b>{formatWinRate(result.liveData.comparison.winRateB)}</b></div>
                    <div className="row"><span>Jogos A</span><b>{result.liveData.comparison.matchesPlayedA ?? "-"}</b></div>
                    <div className="row"><span>Jogos B</span><b>{result.liveData.comparison.matchesPlayedB ?? "-"}</b></div>
                  </div>
                </CardBody>
              </Card>

              <Card className="col-4">
                <CardHeader>
                  <div>
                    <h3>Minuto a minuto</h3>
                    <small>Últimos 12 eventos</small>
                  </div>
                </CardHeader>
                <CardBody>
                  {result.liveData.recentEvents.length === 0 ? (
                    <EmptyState title="Sem eventos" subtitle="A timeline ainda não retornou eventos para esta partida." />
                  ) : (
                    <div className="list">
                      {result.liveData.recentEvents.map((item, index) => (
                        <div key={`${item.minute}-${item.event}-${index}`} className="row" style={{ alignItems: "flex-start" }}>
                          <div className="left">
                            <span>{item.minute}</span>
                            <small>{item.event}</small>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <small>{item.team || "-"}</small>
                            <small>{item.score || "-"}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card className="col-12">
                <CardHeader>
                  <div>
                    <h3>Estatísticas da partida</h3>
                    <small>Comparação lado a lado</small>
                  </div>
                </CardHeader>
                <CardBody>
                  {result.liveData.statsRows.length === 0 ? (
                    <EmptyState title="Sem estatísticas" subtitle="O endpoint não retornou stats detalhadas para este confronto." />
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <th>{result.liveData.participantA || "A"}</th>
                          <th>Métrica</th>
                          <th className="right">{result.liveData.participantB || "B"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.liveData.statsRows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.teamA}</td>
                            <td>{row.label}</td>
                            <td className="right">{row.teamB}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </>
          )}

          {result.shellDetected && !result.liveData && (
            <Card className="col-12">
              <CardBody>
                <EmptyState
                  title="Shell detectado sem dados vivos"
                  subtitle="O site de origem carregou como SPA, mas a API externa não retornou os dados da partida neste momento."
                />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
