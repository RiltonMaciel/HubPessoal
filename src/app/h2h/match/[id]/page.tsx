"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/db";
import type { MatchDetailsRecord, MatchRecord } from "@/lib/types";
import { formatDateTimePtBr } from "@/lib/datetime";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

type ApiResponse =
  | { ok: true; record: MatchDetailsRecord }
  | { error: string };

type AutoApiResponse =
  | { ok: true; record: MatchDetailsRecord; matchUrl: string; processedPages: number }
  | { error: string; processedPages?: number; matchUrl?: string };

const BETSAPI_LAST_COMPETITION_URL_KEY = "hubpessoal-betsapi-last-competition-url-v1";
const BETSAPI_COOKIE_SHARED_KEY = "hubpessoal-betsapi-cookie-v1";

function StatRow({ label, home, away }: { label: string; home: number; away: number }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b>
        {home} — {away}
      </b>
    </div>
  );
}

export default function H2HMatchDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = String(params?.id ?? "");

  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [details, setDetails] = useState<MatchDetailsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoTried, setAutoTried] = useState(false);

  const reload = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    try {
      const [m, d] = await Promise.all([
        db.matches.get(matchId),
        db.matchDetails.where("matchId").equals(matchId).first(),
      ]);
      setMatch((m as MatchRecord) ?? null);
      setDetails((d as MatchDetailsRecord) ?? null);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const headerTitle = useMemo(() => {
    if (!match) return "Detalhes da Partida";
    return `${match.homeTeam} (${match.homeNick}) ${match.homeGoals}-${match.awayGoals} ${match.awayTeam} (${match.awayNick})`;
  }, [match]);

  const saveDetails = useCallback(async (record: MatchDetailsRecord) => {
    await db.matchDetails.put({
      ...record,
      source: record.sourceRef ? "url" : "rawText",
      updatedAt: new Date().toISOString(),
    });
    await reload();
  }, [reload]);

  const importFromApi = async (payload: { url?: string; rawText?: string }) => {
    setBusy(true);
    setMessage("");

    let cookie = "";
    try {
      cookie = window.localStorage.getItem(BETSAPI_COOKIE_SHARED_KEY) ?? "";
    } catch {
      // ignore
    }
    try {
      const response = await fetch("/api/betsapi/match-details", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId,
          ...payload,
          cookie: cookie.trim() || undefined,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });

      const data = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setMessage("error" in data ? data.error : "Falha ao importar detalhes.");
        return;
      }

      if ("ok" in data && data.ok) {
        await saveDetails(data.record);
        setMessage("Detalhes importados e salvos no IndexedDB.");
      }
    } catch {
      setMessage("Falha de rede ao importar detalhes.");
    } finally {
      setBusy(false);
    }
  };

  const importAutomatically = useCallback(async () => {
    if (!matchId || !match) return;
    if (details) return;
    if (autoTried) return;
    setAutoTried(true);

    const ageDays = (() => {
      const ts = new Date(match.dateTime).getTime();
      if (Number.isNaN(ts)) return 30;
      const diff = Date.now() - ts;
      return Math.max(0, diff / (1000 * 60 * 60 * 24));
    })();

    const maxPages = ageDays <= 2 ? 250 : ageDays <= 7 ? 600 : 1500;

    let leagueUrl = "";
    let cookie = "";

    try {
      leagueUrl = window.localStorage.getItem(BETSAPI_LAST_COMPETITION_URL_KEY) ?? "";
      cookie = window.localStorage.getItem(BETSAPI_COOKIE_SHARED_KEY) ?? "";
    } catch {
      // ignore
    }

    if (!leagueUrl.trim()) {
      setMessage("Sem URL do BetsAPI salva ainda. Vá em /betsapi ou /aovivo, preencha a URL da competição, e depois clique no placar novamente.");
      return;
    }

    setBusy(true);
    setMessage("Buscando detalhes automaticamente no BetsAPI...");

    try {
      const response = await fetch("/api/betsapi/match-details-auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leagueUrl,
          matchId,
          match: {
            dateTimeIso: match.dateTime,
            homeNick: match.homeNick,
            awayNick: match.awayNick,
            homeGoals: match.homeGoals,
            awayGoals: match.awayGoals,
          },
          maxPages,
          cookie: cookie.trim() || undefined,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });

      const data = (await response.json()) as AutoApiResponse;
      if (!response.ok) {
        setMessage("error" in data ? data.error : "Não foi possível buscar detalhes automaticamente.");
        return;
      }

      if ("ok" in data && data.ok) {
        await saveDetails(data.record);
        setMessage("Detalhes encontrados automaticamente e salvos no IndexedDB.");
      }
    } catch {
      setMessage("Falha de rede ao buscar detalhes automaticamente.");
    } finally {
      setBusy(false);
    }
  }, [autoTried, details, match, matchId, saveDetails]);

  useEffect(() => {
    if (loading) return;
    if (!match) return;
    if (details) return;
    void importAutomatically();
  }, [loading, match, details, importAutomatically]);

  if (loading) {
    return (
      <section className="pageGrid">
        <Card className="col-12">
          <CardBody>
            <div className="mini">Carregando...</div>
          </CardBody>
        </Card>
      </section>
    );
  }

  if (!match) {
    return (
      <section className="pageGrid">
        <Card className="col-12">
          <CardBody>
            <EmptyState title="Partida não encontrada" subtitle="Esse ID não existe na base local." />
            <div className="chips" style={{ marginTop: 10 }}>
              <Button onClick={() => router.back()}>← Voltar</Button>
            </div>
          </CardBody>
        </Card>
      </section>
    );
  }

  return (
    <section className="pageGrid" aria-label="Detalhes da partida H2H">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3 style={{ margin: 0 }}>{headerTitle}</h3>
            <small>{formatDateTimePtBr(match.dateTime)} • {match.league}</small>
          </div>
          <div className="chips">
            <Button onClick={() => router.back()}>← Voltar</Button>
            {details ? <Badge tone="good">Detalhes salvos</Badge> : <Badge tone="warn">Sem detalhes</Badge>}
          </div>
        </CardHeader>

        <CardBody>
          {message ? <div className="mini">{message}</div> : null}

          {!details ? (
            <>
              <EmptyState
                title="Sem dados extras ainda"
                subtitle="Cole o texto da partida (BetsAPI) ou informe a URL para importar automaticamente e salvar no IndexedDB."
              />

              <div className="mini" style={{ marginTop: 10 }}>
                Dica: ao clicar no placar no H2H, o sistema tenta buscar automaticamente usando a última URL salva em /betsapi ou /aovivo.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 14 }}>
                <input
                  className="select"
                  placeholder="URL da partida (BetsAPI)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <Button variant="primary" onClick={() => void importFromApi({ url })} disabled={busy || !url.trim()}>
                  {busy ? "Importando..." : "Buscar URL"}
                </Button>
              </div>

              <div style={{ marginTop: 10 }}>
                <textarea
                  className="select"
                  rows={10}
                  placeholder="Ou cole aqui o texto (copiado da página) com Goals/Corners/Attacks/Events..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  style={{ width: "100%", resize: "vertical" }}
                />
                <div className="chips" style={{ marginTop: 10 }}>
                  <Button variant="primary" onClick={() => void importFromApi({ rawText })} disabled={busy || !rawText.trim()}>
                    {busy ? "Importando..." : "Importar texto"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
              <Card>
                <CardHeader>
                  <div>
                    <h3 style={{ margin: 0 }}>Resumo</h3>
                    <small>Stats do jogo</small>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="list">
                    <StatRow label="Goals" home={details.stats.goalsHome} away={details.stats.goalsAway} />
                    <StatRow label="Corners" home={details.stats.cornersHome} away={details.stats.cornersAway} />
                    <StatRow label="On Target" home={details.stats.onTargetHome} away={details.stats.onTargetAway} />
                    <StatRow label="Attacks" home={details.stats.attacksHome} away={details.stats.attacksAway} />
                    <StatRow label="Dangerous Attacks" home={details.stats.dangerousAttacksHome} away={details.stats.dangerousAttacksAway} />
                    <StatRow label="Yellow Card" home={details.stats.yellowHome} away={details.stats.yellowAway} />
                    <StatRow label="Red Card" home={details.stats.redHome} away={details.stats.redAway} />
                    <StatRow label="Penalties" home={details.stats.penaltiesHome} away={details.stats.penaltiesAway} />
                    <StatRow label="Substitutions" home={details.stats.substitutionsHome} away={details.stats.substitutionsAway} />
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <h3 style={{ margin: 0 }}>Events</h3>
                    <small>{details.events.length} evento(s)</small>
                  </div>
                  <Badge>{details.source === "url" ? "URL" : "Texto"}</Badge>
                </CardHeader>
                <CardBody>
                  {!details.events.length ? (
                    <EmptyState title="Sem eventos" subtitle="A fonte importada não trouxe a lista de events." />
                  ) : (
                    <div className="list">
                      {details.events.slice(0, 60).map((ev, idx) => (
                        <div key={`${ev.minute ?? "x"}-${idx}`} className="row">
                          <span>{ev.minute != null ? `${ev.minute}'` : "—"}</span>
                          <b>{ev.label}{ev.team ? ` • ${ev.team}` : ""}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <h3 style={{ margin: 0 }}>Reimportar</h3>
                    <small>Atualiza os detalhes salvos</small>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="list">
                    <input
                      className="select"
                      placeholder="URL da partida (BetsAPI)"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <Button variant="primary" onClick={() => void importFromApi({ url })} disabled={busy || !url.trim()}>
                      {busy ? "Importando..." : "Buscar URL"}
                    </Button>
                    <textarea
                      className="select"
                      rows={8}
                      placeholder="Ou cole o texto..."
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                    />
                    <Button variant="primary" onClick={() => void importFromApi({ rawText })} disabled={busy || !rawText.trim()}>
                      {busy ? "Importando..." : "Importar texto"}
                    </Button>
                    <Button onClick={async () => {
                      await db.matchDetails.delete(`details:${matchId}`);
                      await reload();
                      setMessage("Detalhes removidos do IndexedDB.");
                    }}>
                      Remover detalhes
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
