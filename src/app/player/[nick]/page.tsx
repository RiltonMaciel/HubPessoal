"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/db";
import { buildDashboardData } from "@/lib/analytics";
import { getSeedMatches } from "@/lib/seed";
import type { MatchRecord } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

const lines = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];

function avatarColor(seed: string) {
  const palette = ["#7C5CFF", "#4F8CFF", "#2EE59D", "#FFB020", "#FF4D6D"];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash += seed.charCodeAt(i);
  return palette[hash % palette.length];
}

export default function PlayerPage() {
  const params = useParams<{ nick: string }>();
  const nick = decodeURIComponent(params.nick ?? "");

  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [allMatches, avatarRow] = await Promise.all([db.matches.toArray(), db.avatars.get(nick)]);
      setMatches(allMatches.length ? allMatches : getSeedMatches());
      setAvatar(avatarRow?.imageDataUrl ?? null);
    })();
  }, [nick]);

  const dashboard = useMemo(
    () => buildDashboardData({ matches, league: "all", period: "all", recencyOn: true, line: 6.5, decisionMode: "conservador" }),
    [matches]
  );

  const player = dashboard.players.find((item) => item.nick.toLowerCase() === nick.toLowerCase());

  const recentGames = useMemo(
    () =>
      matches
        .filter((match) => match.homeNick.toLowerCase() === nick.toLowerCase() || match.awayNick.toLowerCase() === nick.toLowerCase())
        .sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime))
        .slice(0, 5),
    [matches, nick]
  );

  const favoriteLine = useMemo(() => {
    if (!player) return null;
    let best = { line: 2.5, diff: -Infinity };
    lines.forEach((line) => {
      const diff = (player.overRates[line] ?? 0) - (dashboard.leagueOverLines[line] ?? 0);
      if (diff > best.diff) best = { line, diff };
    });
    return best;
  }, [player, dashboard.leagueOverLines]);

  const trend = useMemo(() => {
    if (!player) return null;
    const lastFive = recentGames;
    if (!lastFive.length) return null;
    const avgLast = lastFive.reduce((acc, match) => acc + match.homeGoals + match.awayGoals, 0) / lastFive.length;
    const diff = avgLast - player.totalPerGame;
    const status = diff >= 0 ? "acima" : "abaixo";
    return `Últimos 5 com média ${avgLast.toFixed(2)} (${Math.abs(diff).toFixed(2)} ${status} da média geral ${player.totalPerGame.toFixed(2)}), n efetivo ${player.effectiveGames.toFixed(1)}.`;
  }, [player, recentGames]);

  const uploadAvatar = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const imageDataUrl = String(event.target?.result ?? "");
      await db.avatars.put({ nick, imageDataUrl });
      setAvatar(imageDataUrl);
    };
    reader.readAsDataURL(file);
  };

  if (!player) return <div className="empty">Jogador não encontrado.</div>;

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardBody>
          <div className="row" style={{ padding: 16 }}>
            <div className="left">
              {avatar ? (
                <Image src={avatar} alt={nick} width={88} height={88} style={{ borderRadius: 20, objectFit: "cover" }} />
              ) : (
                <div className="avatar" style={{ width: 88, height: 88, borderRadius: 22, background: avatarColor(nick) }}>{nick.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="nick">
                <b style={{ fontSize: 24 }}>{nick}</b>
                <small>
                  {player.confidence === "alta" ? <Badge tone="good">Confiabilidade alta</Badge> : player.confidence === "media" ? <Badge tone="warn">Confiabilidade média</Badge> : <Badge tone="bad">Confiabilidade baixa</Badge>}
                  <span style={{ marginLeft: 8 }}><Badge>n jogos: {player.games}</Badge></span>
                </small>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <label className="btn" style={{ cursor: "pointer" }}>Upload avatar<input type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAvatar(file); }} /></label>
              <Button>📌 Fixar</Button>
              <Button>⬇️ Exportar</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="col-4"><CardHeader><div><h3>Resumo</h3><small>W/D/L e produção</small></div></CardHeader><CardBody><div className="list"><div className="row"><span>W/D/L</span><b>{player.wins}/{player.draws}/{player.losses}</b></div><div className="row"><span>PPG</span><b>{player.ppgFinal.toFixed(2)}</b></div><div className="row"><span>GF/J</span><b>{player.gfPerGame.toFixed(2)}</b></div><div className="row"><span>GA/J</span><b>{player.gaPerGame.toFixed(2)}</b></div><div className="row"><span>Total/J</span><b>{player.totalPerGame.toFixed(2)}</b></div><div className="row"><span>BTTS%</span><b>{(player.bttsRate * 100).toFixed(1)}%</b></div></div></CardBody></Card>

      <Card className="col-4"><CardHeader><div><h3>Over/Under 2.5..7.5</h3><small>Taxas por linha</small></div></CardHeader><CardBody><table className="table"><thead><tr><th>Linha</th><th className="right">Over</th><th className="right">Under</th></tr></thead><tbody>{lines.map((line) => { const over = player.overRates[line] ?? 0; return <tr key={line}><td>{line}</td><td className="right">{(over * 100).toFixed(1)}%</td><td className="right">{(100 - over * 100).toFixed(1)}%</td></tr>; })}</tbody></table></CardBody></Card>

      <Card className="col-4"><CardHeader><div><h3>Comparação vs Liga</h3><small>Diferença por métrica</small></div></CardHeader><CardBody><div className="list"><div className="row"><span>PPG</span><b>{(player.ppgFinal - (dashboard.rankings.topBest[0]?.ppgFinal ?? 0)).toFixed(2)}</b></div><div className="row"><span>BTTS</span><b>{((player.bttsRate - dashboard.bttsRate) * 100).toFixed(1)} pp</b></div><div className="row"><span>IC95% BTTS</span><b>{(player.bttsInterval.low * 100).toFixed(1)}%–{(player.bttsInterval.high * 100).toFixed(1)}%</b></div><div className="row"><span>Linha favorita</span><b>{favoriteLine?.line ?? "-"}</b></div></div></CardBody></Card>

      <Card className="col-6"><CardHeader><div><h3>Últimos 5 jogos</h3><small>Recorte recente</small></div></CardHeader><CardBody><div className="list">{recentGames.map((match) => <div key={match.id} className="row"><div className="left"><div className="avatar">{match.homeNick.slice(0,1)}{match.awayNick.slice(0,1)}</div><div className="nick"><b>{match.homeNick} {match.homeGoals} x {match.awayGoals} {match.awayNick}</b><small>{new Date(match.dateTime).toLocaleString("pt-BR")}</small></div></div></div>)}</div></CardBody></Card>

      <Card className="col-6"><CardHeader><div><h3>Insights explicáveis</h3><small>Sem IA, regras determinísticas</small></div></CardHeader><CardBody><div className="list"><div className="row"><span>Linha favorita</span><b>{favoriteLine ? `${favoriteLine.line} (${(favoriteLine.diff * 100).toFixed(1)} pp vs liga)` : "-"}</b></div><div className="row"><span>Tendência recente</span><b>{trend ?? "Sem amostra"}</b></div><div className="row"><span>Força da evidência</span><b>{player.effectiveGames >= 10 ? "Robusta" : player.effectiveGames >= 5 ? "Moderada" : "Frágil"}</b></div></div></CardBody></Card>
    </section>
  );
}
