"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/db";
import { applyAliasesToMatches, getAliasMap } from "@/lib/aliases";
import { applyCalibrator, fitCalibrator, summarizeCalibration, type CalibratorModel, type CalibrationSample } from "@/lib/calibration";
import { decideRecommendation } from "@/lib/decision";
import { getHistoryBefore } from "@/lib/evaluation";
import { logPrediction, resolvePendingPredictions } from "@/lib/prediction-ledger";
import type { MatchRecord } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Table } from "@/components/ui/Table";
import { Skeleton } from "@/components/ui/Skeleton";
import { Chip } from "@/components/ui/Chip";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAppStore } from "@/store/appStore";
import { InfoHint } from "@/components/ui/InfoHint";
import { buildDerivedSignalIndex, computeDerivedSignals } from "@/lib/derived-signals";
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
  collectedInMs?: number;
  reliabilityScore?: number;
  isCollectReliable?: boolean;
  reliabilityReasons?: string[];
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
  recommendationStatus: "APOSTAVEL" | "CAUTELA" | "EVITAR" | "SEM_SINAL";
  recommendationReasons: string[];
  favoriteRaw: number;
  favoriteCalibrated: number;
};

type FavoriteCalibration = {
  model: CalibratorModel;
  summary: ReturnType<typeof summarizeCalibration>;
};

const DEFAULT_URL = "https://betsapi.com/ls/37298/Esoccer-H2H-GG-League--8-mins-play";
const POLL_MS = 1000;
const AOVIVO_SNAPSHOT_KEY = "hubpessoal-aovivo-snapshot-v1";
const AOVIVO_COOKIE_KEY = "hubpessoal-betsapi-cookie-v1";
const AOVIVO_SAVED_COMPETITIONS_KEY = "hubpessoal-betsapi-saved-competitions-v1";
const AOVIVO_PAGE_SIZE = 50;
const MAX_CALIBRATION_MATCHES = 180;

function normalizeCompetitionUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}

function formatCompetitionLabel(value: string) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/+$/, "");
    const short = `${parsed.host}${path}`;
    return short.length > 52 ? `${short.slice(0, 49)}...` : short;
  } catch {
    return value.length > 52 ? `${value.slice(0, 49)}...` : value;
  }
}

const HELP = {
  title:
    "O AoVivo puxa (poll) a liga do BetsAPI e transforma as linhas em um board com probabilidades (1X2) + semáforo de recomendação.\n\nRegras importantes:\n- As análises dependem da sua base histórica importada (IndexedDB).\n- Se o BetsAPI bloquear (Cloudflare/403), você precisa colar o cookie (cf_clearance ou cookie completo).\n- O sistema tenta ser conservador: quando a coleta está fraca ou a base é pequena, ele rebaixa o sinal.",
  freshness:
    "Indicador de frescor do board.\n- Atualizado = houve coleta bem-sucedida recentemente.\n- Sem atualização = falha de rede/anti-bot ou o board está vazio.\n\nDica: se ficar vermelho e o total de linhas não sobe, aplique cookie e clique em 'Atualizar agora'.",
  chips:
    "Legenda rápida:\n- Minuto (ex: 08') = jogo em andamento (ao vivo).\n- View/Próximo = partidas na fila (upcoming) usadas para prever o vencedor provável.\n- Horários são ajustados para Brasília quando possível.\n- Modo leve reduz custo de cálculo e evita travamentos.",
  url:
    "URL da liga no BetsAPI.\nExemplo: https://betsapi.com/ls/37298/Esoccer-H2H-GG-League--8-mins-play\n\nTrocar a URL muda o board monitorado. Se a liga for diferente do seu histórico importado, os sinais ficam menos confiáveis.",
  maxPages:
    "Quantidade máxima de páginas que o coletor tenta processar.\n\nRecomendação:\n- 1: mais rápido e menos chance de bloqueio.\n- 2+: pode trazer mais linhas, mas aumenta risco de 403/anti-bot e latência.",
  updateNow:
    "Força uma coleta imediata (sem esperar o timer).\n\nUse quando:\n- acabou de colar cookie;\n- o indicador está desatualizado;\n- você mudou URL/maxPages.",
  autoRefresh:
    "Liga/desliga o polling automático.\n\nON = atualiza sozinho conforme o 'Refresh'.\nOFF = só atualiza quando você clicar em 'Atualizar agora'.",
  lightMode:
    "Modo leve evita cálculos pesados e reduz travamentos.\n\nNo modo completo, você pode abrir 'Ver mais' para estatísticas avançadas por jogo.",
  safeMode:
    "Safe mode ajusta automaticamente o intervalo de refresh (ex: 1s → 3s/5s) quando: \n- a coleta fica lenta;\n- o servidor demora;\n- há instabilidade.\n\nObjetivo: evitar burst, reduzir bloqueio e manter o site responsivo.",
  cookie:
    "Cookie usado para contornar o anti-bot do BetsAPI (Cloudflare).\n\nAceita:\n- apenas o valor do cf_clearance; ou\n- cookie completo copiado do DevTools (mais confiável).\n\nSegurança: isso fica só no seu navegador (localStorage).",
  kpis:
    "KPIs do AoVivo:\n- Linhas monitoradas: total bruto retornado do BetsAPI.\n- Fila+AoVivo: o recorte relevante para análise (live + upcoming).\n- Base histórica: jogos importados (IndexedDB).\n- Confiabilidade/Gate: saúde da coleta.\n- Calibração: qualidade do ajuste raw→calibrado usando sua base.",
  reliability:
    "Score de confiabilidade (0–100) baseado em: volume de linhas, presença de jogos ao vivo e páginas processadas.\n\nQuanto menor, maior a chance de: board incompleto, dados vazios, ou bloqueio parcial.",
  gate:
    "Gate de coleta: quando a confiabilidade cai, o sistema rebaixa o status para evitar sinal frágil.\n\nSe ficar REBAIXADA com frequência: use maxPages=1 e aplique cookie completo.",
  calibration:
    "Fav raw/cal = probabilidade do favorito antes/depois da calibração.\n\n- Raw: cálculo direto da heurística.\n- Calibrada: ajustada com base no seu histórico (melhora a honestidade da probabilidade).\n\nBrier menor = probabilidade melhor calibrada.",
  latency:
    "Latências:\n- Cliente: tempo total no navegador (rede + parse + render).\n- Servidor: tempo que a rota /api/betsapi/live levou para coletar e parsear.",
  refresh:
    "Refresh é o intervalo do timer do Auto.\n\nSafe mode pode aumentar esse valor automaticamente para evitar bloqueio e manter o app fluindo.",
  table:
    "Tabela AoVivo:\n- Casa/Empate/Fora: probabilidades 1X2 estimadas.\n- Fav raw/cal: chance do favorito antes/depois da calibração.\n- Status: semáforo final (APOSTAVEL/CAUTELA/EVITAR) com gates de segurança.\n\nDica: use 'Ver mais' para abrir a análise completa do jogo.",
  favoriteRaw:
    "Fav raw = maior probabilidade entre (Casa/Empate/Fora) antes da calibração.\n\nExemplo: Casa 52%, Empate 24%, Fora 24% → Fav raw = 52%.",
  favoriteCal:
    "Fav cal = Fav raw após aplicar calibração (aprendida do seu histórico).\n\nEm geral, calibração reduz excesso de confiança e aproxima a probabilidade do mundo real.",
  actions:
    "Ações por linha:\n- 'Ver mais' abre o painel avançado do jogo (modo completo).\n- No modo leve, essa ação é desativada para manter performance.",
  modal:
    "Painel avançado do jogo (auditoria).\n\nAqui você vê:\n- probabilidade 1X2 e confiança;\n- curva de Over por linhas;\n- forma recente (casa/fora) na janela da base;\n- mercados com probabilidade e odd justa.\n\nUse para justificar entradas e entender o porquê do semáforo.",
  prob1x2:
    "Distribuição de resultado final (1X2).\n\nServe para ver se o modelo está realmente 'puxando' para Casa/Fora ou se está indeciso (Empate alto).",
  overCurve:
    "Curva Over (todas as linhas) mostra a probabilidade estimada do total de gols ultrapassar cada linha (2.5..7.5 etc).\n\nCurva alta em várias linhas = jogo com tendência de muitos gols.",
  form:
    "Forma = estatísticas recentes em janela móvel (gols pró/contra, PPG, W/D/L).\n\nAjuda a confirmar se o favorito está consistente ou se é só ruído.",
  markets:
    "Mercados detalhados:\n- Probabilidade: estimativa do evento.\n- Odd justa: 1 / probabilidade (sem margem da casa).\n\nCompare com odds reais para avaliar edge (vantagem).",
} as const;

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
    recommendationStatus: "SEM_SINAL",
    recommendationReasons: [],
    favoriteRaw: 0,
    favoriteCalibrated: 0,
  };
}

function buildFavoriteCalibration(matches: MatchRecord[]): FavoriteCalibration {
  const chronological = [...matches]
    .sort((left, right) => +new Date(left.dateTime) - +new Date(right.dateTime))
    .slice(-MAX_CALIBRATION_MATCHES);
  const samples: CalibrationSample[] = [];
  const stride = chronological.length > 140 ? 2 : 1;

  for (let index = 0; index < chronological.length; index += stride) {
    const match = chronological[index];
    if (!match) continue;
    const history = getHistoryBefore(match.dateTime, chronological);
    if (history.length < 12) continue;
    const strengths = buildStrengthMap(history);
    const all = [...strengths.values()];
    const leaguePpg = all.length
      ? all.reduce((acc, item) => acc + item.points / Math.max(item.games, 1), 0) / all.length
      : 1.35;

    const row: LiveRow = {
      eventTime: match.dateTime,
      fixture: `${match.homeNick} vs ${match.awayNick}`,
      score: `${match.homeGoals}-${match.awayGoals}`,
      status: "finished",
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeNick: match.homeNick,
      awayNick: match.awayNick,
    };

    const prediction = estimateWinnerProbability(row, strengths, leaguePpg);
    const rawFavorite = Math.max(prediction.home, prediction.draw, prediction.away);
    const outcome =
      (prediction.favorite === "home" && match.homeGoals > match.awayGoals) ||
      (prediction.favorite === "away" && match.awayGoals > match.homeGoals) ||
      (prediction.favorite === "draw" && match.homeGoals === match.awayGoals)
        ? 1
        : 0;

    samples.push({ pRaw: rawFavorite, outcome });
  }

  const model = fitCalibrator(samples);
  const summary = summarizeCalibration(samples, model);
  const avgRaw = samples.length ? samples.reduce((acc, item) => acc + item.pRaw, 0) / samples.length : 0;
  const avgCal = samples.length
    ? samples.reduce((acc, item) => acc + applyCalibrator(model, item.pRaw), 0) / samples.length
    : 0;
  summary.market = "1x2_favorite";
  summary.league = "all";
  summary.currentRaw = avgRaw;
  summary.currentCalibrated = avgCal;

  return { model, summary };
}

export default function AoVivoPage() {
  const dataRevision = useAppStore((state) => state.dataRevision);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [maxPages, setMaxPages] = useState(1);
  const [betApiCookie, setBetApiCookie] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lightMode, setLightMode] = useState(false);
  const [safeMode, setSafeMode] = useState(true);
  const [cookieStorageReady, setCookieStorageReady] = useState(false);
  const [refreshMs, setRefreshMs] = useState(POLL_MS);
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastFetchMs, setLastFetchMs] = useState(0);
  const [lastServerMs, setLastServerMs] = useState(0);
  const [reliabilityScore, setReliabilityScore] = useState<number | null>(null);
  const [isCollectReliable, setIsCollectReliable] = useState<boolean | null>(null);
  const [reliabilityReasons, setReliabilityReasons] = useState<string[]>([]);
  const [datasetVersion, setDatasetVersion] = useState<string | null>(null);
  const [boardPage, setBoardPage] = useState(1);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [aliasMap, setAliasMap] = useState<Map<string, string>>(new Map());
  const [selectedRow, setSelectedRow] = useState<LiveRow | null>(null);
  const [savedCompetitions, setSavedCompetitions] = useState<string[]>([]);
  const inFlightRef = useRef(false);
  const debouncedUrl = useDebouncedValue(url, 300);
  const debouncedMaxPages = useDebouncedValue(maxPages, 300);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [rowsDb, aliases, rawDataset, config] = await Promise.all([
          db.matches.toArray(),
          getAliasMap(),
          db.rawDatasets.get("latest"),
          db.config.toCollection().last(),
        ]);
        if (cancelled) return;
        setAliasMap(aliases);
        setMatches(rowsDb);
        setDatasetVersion(rawDataset?.datasetVersion ?? config?.datasetVersion ?? null);
        await resolvePendingPredictions();
      } catch (error) {
        console.error("[aovivo] falha ao carregar base local", error);
        if (cancelled) return;
        setAliasMap(new Map());
        setMatches([]);
        setDatasetVersion(null);
        setError("Falha ao carregar base local (IndexedDB). Se isso começou após uma atualização, vá em /import e use 'Limpeza total da base' e importe novamente.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataRevision]);

  useEffect(() => {
    const rawCookie = window.localStorage.getItem(AOVIVO_COOKIE_KEY);
    if (typeof rawCookie === "string") setBetApiCookie(rawCookie);
    setCookieStorageReady(true);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AOVIVO_SAVED_COMPETITIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .filter((item) => typeof item === "string")
        .map((item) => normalizeCompetitionUrl(item))
        .filter(Boolean);
      setSavedCompetitions(Array.from(new Set(normalized)).slice(0, 30));
    } catch {
      window.localStorage.removeItem(AOVIVO_SAVED_COMPETITIONS_KEY);
    }
  }, []);

  function persistSavedCompetitions(next: string[]) {
    setSavedCompetitions(next);
    try {
      window.localStorage.setItem(AOVIVO_SAVED_COMPETITIONS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function addCurrentCompetition() {
    const normalized = normalizeCompetitionUrl(url);
    if (!normalized) return;
    const deduped = [
      normalized,
      ...savedCompetitions.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, 30);
    persistSavedCompetitions(deduped);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AOVIVO_SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        url: string;
        maxPages: number;
        rows: LiveRow[];
        updatedAt?: string;
      };
      if (!parsed || !Array.isArray(parsed.rows)) return;
      if (parsed.url === debouncedUrl && parsed.maxPages === debouncedMaxPages) {
        setRows(parsed.rows);
        if (parsed.updatedAt) setLastSuccessAt(parsed.updatedAt);
      }
    } catch {
      window.localStorage.removeItem(AOVIVO_SNAPSHOT_KEY);
    }
  }, [debouncedUrl, debouncedMaxPages]);

  useEffect(() => {
    if (!cookieStorageReady) return;
    window.localStorage.setItem(AOVIVO_COOKIE_KEY, betApiCookie);
  }, [betApiCookie, cookieStorageReady]);

  async function fetchLiveBoard(options?: { manual?: boolean }) {
    const manual = options?.manual ?? false;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (manual) {
      setLoading(true);
      setError("");
    }

    let timeoutId: number | null = null;
    try {
      const startedAt = performance.now();
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : undefined;
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), manual ? 20000 : 12000);
      const response = await fetch("/api/betsapi/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: debouncedUrl,
          maxPages: debouncedMaxPages,
          force: manual,
          cookie: betApiCookie.trim() || undefined,
          userAgent,
        }),
        signal: controller.signal,
      });

      const data = (await response.json()) as LiveResponse | { error: string };
      if (!response.ok) {
        setError("error" in data ? data.error : "Falha ao atualizar AoVivo.");
        return;
      }

      const payload = data as LiveResponse;
      if (payload.rows.length > 0) {
        setRows(payload.rows);
        window.localStorage.setItem(
          AOVIVO_SNAPSHOT_KEY,
          JSON.stringify({
            url: debouncedUrl,
            maxPages: debouncedMaxPages,
            rows: payload.rows,
            updatedAt: payload.updatedAt,
          })
        );
      } else if (!manual) {
        setError("Atualização sem linhas válidas no momento. Mantendo último snapshot.");
      }
      setLastSuccessAt(payload.updatedAt);
      setLastFetchMs(Math.round(performance.now() - startedAt));
      if (typeof payload.collectedInMs === "number") {
        setLastServerMs(payload.collectedInMs);
      }
      if (typeof payload.reliabilityScore === "number") {
        setReliabilityScore(payload.reliabilityScore);
      } else {
        setReliabilityScore(null);
      }
      setIsCollectReliable(typeof payload.isCollectReliable === "boolean" ? payload.isCollectReliable : null);
      setReliabilityReasons(Array.isArray(payload.reliabilityReasons) ? payload.reliabilityReasons : []);
      if (payload.rows.length > 0) {
        setError("");
      }

      if (safeMode) {
        const nextClientMs = Math.round(performance.now() - startedAt);
        const nextServerMs = typeof payload.collectedInMs === "number" ? payload.collectedInMs : 0;
        if (nextClientMs > 3500 || nextServerMs > 3000) {
          setRefreshMs(5000);
        } else if (nextClientMs > 2200 || nextServerMs > 1800) {
          setRefreshMs(3000);
        } else {
          setRefreshMs(POLL_MS);
        }
      }
    } catch {
      if (manual) {
        setError("Falha de rede ao consultar o BetsAPI.");
      } else {
        setError((prev) => prev || "Falha de rede ao consultar o BetsAPI.");
      }
      if (safeMode) setRefreshMs(5000);
    } finally {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      if (manual) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      await fetchLiveBoard({ manual: false });
      if (cancelled) return;
      timer = window.setTimeout(tick, refreshMs);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [autoRefresh, debouncedUrl, debouncedMaxPages, refreshMs, betApiCookie]);

  useEffect(() => {
    if (!autoRefresh) return;
    let lastKick = 0;

    const kick = () => {
      const now = Date.now();
      if (now - lastKick < 1200) return;
      lastKick = now;
      void fetchLiveBoard({ manual: false });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") kick();
    };

    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [autoRefresh, debouncedUrl, debouncedMaxPages, betApiCookie]);

  const aliasedMatches = useMemo(() => applyAliasesToMatches(matches, aliasMap), [matches, aliasMap]);
  const derivedIndex = useMemo(() => buildDerivedSignalIndex(aliasedMatches), [aliasedMatches]);

  const strengths = useMemo(() => buildStrengthMap(aliasedMatches), [aliasedMatches]);
  const leaguePpg = useMemo(() => {
    const all = [...strengths.values()];
    if (!all.length) return 1.35;
    return all.reduce((acc, item) => acc + item.points / Math.max(item.games, 1), 0) / all.length;
  }, [strengths]);

  const favoriteCalibration = useMemo(() => buildFavoriteCalibration(aliasedMatches), [aliasedMatches]);

  const driftLevel = useMemo(() => {
    const chronological = [...aliasedMatches].sort((left, right) => +new Date(left.dateTime) - +new Date(right.dateTime));
    const recent = chronological.slice(-30);
    const prev = chronological.slice(-60, -30);
    const recentOver = recent.length
      ? recent.filter((item) => item.homeGoals + item.awayGoals > 6.5).length / recent.length
      : 0;
    const prevOver = prev.length
      ? prev.filter((item) => item.homeGoals + item.awayGoals > 6.5).length / prev.length
      : 0;
    const delta = Math.abs(recentOver - prevOver);
    if (delta >= 0.18) return "critico" as const;
    if (delta >= 0.1) return "atencao" as const;
    return "estavel" as const;
  }, [aliasedMatches]);

  const queueRows = useMemo(
    () => rows.filter((item) => item.status === "upcoming" || item.status === "live"),
    [rows]
  );

  const coverage = useMemo(() => {
    const total = queueRows.length;
    if (!total) {
      return {
        total: 0,
        coveredBoth: 0,
        coverageScore: 0,
        minGamesAvg: 0,
        level: "critical" as const,
        reasons: ["Sem linhas na fila para validar cobertura."],
      };
    }

    let coveredBoth = 0;
    let minGamesSum = 0;

    for (const row of queueRows) {
      const homeKey = normalizeNick(row.homeNick ?? row.homeTeam);
      const awayKey = normalizeNick(row.awayNick ?? row.awayTeam);
      const homeGames = strengths.get(homeKey)?.games ?? 0;
      const awayGames = strengths.get(awayKey)?.games ?? 0;
      const minGames = Math.min(homeGames, awayGames);
      minGamesSum += minGames;
      if (minGames >= 8) coveredBoth += 1;
    }

    const ratio = coveredBoth / total;
    const coverageScore = Math.round(ratio * 100);
    const minGamesAvg = minGamesSum / total;
    const level = coverageScore >= 70 ? ("ok" as const) : coverageScore >= 45 ? ("warn" as const) : ("critical" as const);
    const reasons: string[] = [];
    reasons.push(`Cobertura (n>=8 em ambos): ${coveredBoth}/${total} (${(ratio * 100).toFixed(0)}%).`);
    reasons.push(`Amostra mínima média (min(home/away)): ${minGamesAvg.toFixed(1)} jogos.`);
    if (coverageScore < 45) {
      reasons.push("Cobertura baixa: muitos nicks do board não existem (ou têm pouca amostra) no histórico importado.");
    } else if (coverageScore < 70) {
      reasons.push("Cobertura moderada: rebaixar agressividade e evitar sinais fortes sem auditoria.");
    }

    return { total, coveredBoth, coverageScore, minGamesAvg, level, reasons };
  }, [queueRows, strengths]);

  const finalReliabilityScore = useMemo(() => {
    const base = reliabilityScore ?? 0;
    if (!queueRows.length) return base;

    // Confiabilidade final combina saúde da coleta (API) + cobertura na base (local).
    // Mantém comportamento conservador: coverage baixa penaliza mais.
    const coveragePenalty = coverage.coverageScore >= 70 ? 0 : coverage.coverageScore >= 45 ? 12 : 25;
    return clamp(base - coveragePenalty, 0, 100);
  }, [reliabilityScore, coverage.coverageScore, queueRows.length]);

  const finalIsCollectReliable = useMemo(() => {
    const baseGate = isCollectReliable ?? true;
    const coverageGate = coverage.coverageScore >= 60;
    return baseGate && coverageGate;
  }, [isCollectReliable, coverage.coverageScore]);

  const boardWithProb = useMemo(
    () => queueRows.map((row) => {
      const prob = estimateWinnerProbability(row, strengths, leaguePpg);
      const favoriteRaw = Math.max(prob.home, prob.draw, prob.away);
      const favoriteCalibrated = applyCalibrator(favoriteCalibration.model, favoriteRaw);
      const signal = prob.favorite === "draw" ? "neutro" : "over";
      const decision = decideRecommendation({
        mode: "conservador",
        signal,
        score: Math.round(favoriteCalibrated * 100),
        effectiveGames: Math.min(
          strengths.get(normalizeNick(row.homeNick))?.games ?? 0,
          strengths.get(normalizeNick(row.awayNick))?.games ?? 0
        ),
        minGamesConfidence: 8,
        intervalWidth: prob.confidence === "alta" ? 0.18 : prob.confidence === "media" ? 0.26 : 0.34,
        driftLevel,
        edgeVsNeutral: Math.abs(favoriteCalibrated - 0.5),
        adaptiveEdgeThreshold: 0.06,
        probabilityRaw: favoriteRaw,
        probabilityCalibrated: favoriteCalibrated,
        reliabilityScore: finalReliabilityScore,
        isCollectReliable: finalIsCollectReliable,
        antiFalseSignalPassed: favoriteCalibrated >= 0.5 && prob.favorite !== "draw",
      });

      return {
        row,
        prob,
        favoriteRaw,
        favoriteCalibrated,
        recommendation: decision,
      };
    }),
    [queueRows, strengths, leaguePpg, favoriteCalibration.model, driftLevel, finalReliabilityScore, finalIsCollectReliable]
  );

  const boardTotalPages = useMemo(
    () => Math.max(1, Math.ceil(boardWithProb.length / AOVIVO_PAGE_SIZE)),
    [boardWithProb.length]
  );

  const boardVisible = useMemo(() => {
    const start = (boardPage - 1) * AOVIVO_PAGE_SIZE;
    return boardWithProb.slice(start, start + AOVIVO_PAGE_SIZE);
  }, [boardWithProb, boardPage]);

  useEffect(() => {
    setBoardPage(1);
  }, [debouncedUrl, debouncedMaxPages, rows.length]);

  const selectedDeepStats = useMemo(() => {
    if (!selectedRow || lightMode) return null;
    const base = buildDeepStats(selectedRow, aliasedMatches, strengths, leaguePpg);
    const favoriteRaw = Math.max(base.winner.home, base.winner.draw, base.winner.away);
    const favoriteCalibrated = applyCalibrator(favoriteCalibration.model, favoriteRaw);
    const signal = base.winner.favorite === "draw" ? "neutro" : "over";

    const contextSignals = (() => {
      const nowIso = new Date().toISOString();
      const homeNick = selectedRow.homeNick ?? selectedRow.homeTeam;
      const awayNick = selectedRow.awayNick ?? selectedRow.awayTeam;
      return computeDerivedSignals({
        match: {
          dateTime: nowIso,
          league: "all",
          homeNick,
          awayNick,
          homeTeam: selectedRow.homeTeam,
          awayTeam: selectedRow.awayTeam,
        },
        index: derivedIndex,
        ouLine: 6.5,
        sessionGapMinutes: 45,
        validateLeague: true,
      });
    })();

    const favoredSide = base.winner.favorite === "home" ? "home" : base.winner.favorite === "away" ? "away" : null;
    const tiltFav = favoredSide === "home" ? contextSignals.tilt.home.tiltScore : favoredSide === "away" ? contextSignals.tilt.away.tiltScore : 0;
    const tiltDog = favoredSide === "home" ? contextSignals.tilt.away.tiltScore : favoredSide === "away" ? contextSignals.tilt.home.tiltScore : 0;
    const affinityFav = favoredSide === "home" ? contextSignals.teamAffinity.home : favoredSide === "away" ? contextSignals.teamAffinity.away : null;

    let scoreDelta = 0;
    if (favoredSide) {
      // Tilt: pequeno modulador
      if (tiltFav === 1 && tiltDog === -1) scoreDelta += 4;
      else if (tiltFav === 1) scoreDelta += 2;
      else if (tiltFav === -1) scoreDelta -= 2;

      // Afinidade por time: só se amostra não for muito baixa
      if (affinityFav && !affinityFav.lowSample) {
        if (affinityFav.deltaWin >= 0.08) scoreDelta += 3;
        else if (affinityFav.deltaWin <= -0.08) scoreDelta -= 3;
      }

      // Drift segmentado crítico: puxa para baixo
      if (contextSignals.drift?.level === "critico") scoreDelta -= 4;
      else if (contextSignals.drift?.level === "atencao") scoreDelta -= 2;
    }

    const baseScore = Math.round(favoriteCalibrated * 100);
    const adjustedScore = Math.max(0, Math.min(100, baseScore + scoreDelta));
    const decision = decideRecommendation({
      mode: "conservador",
      signal,
      score: adjustedScore,
      effectiveGames: Math.min(base.homeStats.games, base.awayStats.games),
      minGamesConfidence: 8,
      intervalWidth: base.winner.confidence === "alta" ? 0.18 : base.winner.confidence === "media" ? 0.26 : 0.34,
      driftLevel,
      edgeVsNeutral: Math.abs(favoriteCalibrated - 0.5),
      adaptiveEdgeThreshold: 0.06,
      probabilityRaw: favoriteRaw,
      probabilityCalibrated: favoriteCalibrated,
      reliabilityScore: finalReliabilityScore,
      isCollectReliable: finalIsCollectReliable,
      antiFalseSignalPassed: favoriteCalibrated >= 0.5 && base.winner.favorite !== "draw",
    });

    const contextLines: string[] = [];
    contextLines.push(`Score ajustado: ${baseScore} → ${adjustedScore} (Δ ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}).`);
    if (contextSignals.revenge.validation?.status === "ok") {
      contextLines.push(
        `Revenge: H ${contextSignals.revenge.homeRevengeIndex} vs A ${contextSignals.revenge.awayRevengeIndex} (uplift ${(contextSignals.revenge.validation.uplift * 100).toFixed(1)}pp).`
      );
    } else {
      contextLines.push(
        `Revenge: H ${contextSignals.revenge.homeRevengeIndex} vs A ${contextSignals.revenge.awayRevengeIndex} (efeito não confirmado).`
      );
    }
    contextLines.push(`Tilt: casa ${contextSignals.tilt.home.tiltScore} • fora ${contextSignals.tilt.away.tiltScore}.`);
    contextLines.push(`Sessão: casa n=${contextSignals.session.home.sessionGamesCount}(${contextSignals.session.home.sessionTrend}) • fora n=${contextSignals.session.away.sessionGamesCount}(${contextSignals.session.away.sessionTrend}).`);
    contextLines.push(`Estilo: pace ${contextSignals.style.pace.toFixed(2)} • frag ${contextSignals.style.fragility.toFixed(2)} • vol ${contextSignals.style.volatility.toFixed(2)}.`);
    if (contextSignals.drift) {
      contextLines.push(`Drift(seg): ${contextSignals.drift.level} (Δover ${(contextSignals.drift.deltaOver * 100).toFixed(1)}pp).`);
    }

    return {
      ...base,
      recommendationStatus: decision.recommendation,
      recommendationReasons: [...decision.reasons, ...contextLines],
      favoriteRaw,
      favoriteCalibrated,
      contextSignals,
    };
  }, [selectedRow, aliasedMatches, strengths, leaguePpg, lightMode, favoriteCalibration.model, driftLevel, finalReliabilityScore, finalIsCollectReliable, derivedIndex]);

  useEffect(() => {
    if (!datasetVersion || !boardWithProb.length) return;
    const target = boardWithProb[0];
    if (!target) return;

    void logPrediction({
      datasetVersion,
      modelVersion: "model:v1",
      presetId: "aovivo:default",
      routeContext: "aovivo",
      match: {
        dateTime: target.row.eventTime,
        league: "aovivo",
        homeNick: target.row.homeNick ?? target.row.homeTeam,
        awayNick: target.row.awayNick ?? target.row.awayTeam,
      },
      market: "1x2_favorite",
      pRaw: target.favoriteRaw,
      pCalibrated: target.favoriteCalibrated,
      decision: target.recommendation.recommendation,
      confidence: target.recommendation.confidence,
      reasons: target.recommendation.reasons,
      contraReasons: target.recommendation.contrarianReasons,
      inputSnapshot: {
        status: target.row.status,
        score: target.row.score,
        favorite: target.prob.favorite,
      },
      reliabilityScore: finalReliabilityScore,
      isCollectReliable: finalIsCollectReliable,
    });
  }, [datasetVersion, boardWithProb, finalReliabilityScore, finalIsCollectReliable]);

  const isFresh = useMemo(() => {
    if (!lastSuccessAt) return false;
    const diff = Date.now() - new Date(lastSuccessAt).getTime();
    const ttl = Math.max(POLL_MS * 2.5, refreshMs * 2.5);
    return diff <= ttl && !error;
  }, [lastSuccessAt, error, refreshMs]);

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>AoVivo (Analytics) <InfoHint text={HELP.title} /></h3>
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
            <InfoHint text={HELP.freshness} />
          </div>
        </CardHeader>

        <CardBody>
          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge tone="warn">Minuto (ex: 08') = Ao Vivo</Badge>
            <Badge tone="good">View = Próximo jogo</Badge>
            <Badge>Horários ajustados para Brasília (BRT)</Badge>
            <Badge tone={lightMode ? "warn" : "good"}>{lightMode ? "Modo leve ON" : "Modo completo ON"}</Badge>
            <InfoHint text={HELP.chips} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto auto", gap: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="URL da liga"
                style={{
                  flex: 1,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,.1)",
                  background: "rgba(255,255,255,.03)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  fontSize: 12,
                }}
              />
              <InfoHint text={HELP.url} />
              <Button onClick={addCurrentCompetition} disabled={!normalizeCompetitionUrl(url)}>
                Adicionar competição
              </Button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                min={1}
                max={5000}
                value={maxPages}
                onChange={(event) => setMaxPages(Number(event.target.value))}
                style={{
                  width: 120,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,.1)",
                  background: "rgba(255,255,255,.03)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  fontSize: 12,
                }}
              />
              <InfoHint text={HELP.maxPages} />
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Button onClick={() => void fetchLiveBoard({ manual: true })} disabled={loading}>{loading ? "Atualizando..." : "Atualizar agora"}</Button>
              <InfoHint text={HELP.updateNow} />
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Button variant={autoRefresh ? "primary" : "default"} onClick={() => setAutoRefresh((prev) => !prev)}>
                {autoRefresh ? "Auto 1s: ON" : "Auto 1s: OFF"}
              </Button>
              <InfoHint text={HELP.autoRefresh} />
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Button variant={lightMode ? "primary" : "default"} onClick={() => setLightMode((prev) => !prev)}>
                {lightMode ? "Modo leve: ON" : "Modo leve: OFF"}
              </Button>
              <InfoHint text={HELP.lightMode} />
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Button variant={safeMode ? "primary" : "default"} onClick={() => {
                setSafeMode((prev) => !prev);
                setRefreshMs(POLL_MS);
              }}>
                {safeMode ? "Safe mode: ON" : "Safe mode: OFF"}
              </Button>
              <InfoHint text={HELP.safeMode} />
            </div>
          </div>

          {savedCompetitions.length > 0 ? (
            <div className="chips" style={{ marginBottom: 10 }}>
              {savedCompetitions.map((item) => (
                <Chip key={item} active={item === url} onClick={() => setUrl(item)}>
                  {formatCompetitionLabel(item)}
                </Chip>
              ))}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                value={betApiCookie}
                onChange={(event) => setBetApiCookie(event.target.value)}
                placeholder="Cookie cf_clearance (opcional) para desbloquear anti-bot"
                style={{
                  flex: 1,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,.1)",
                  background: "rgba(255,255,255,.03)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  fontSize: 12,
                }}
              />
              <InfoHint text={HELP.cookie} />
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Button onClick={() => void fetchLiveBoard({ manual: true })}>Aplicar cookie + atualizar</Button>
              <InfoHint text={HELP.updateNow} />
            </div>
          </div>

          <div className="chips" style={{ marginBottom: 10 }}>
            <Badge>{`Linhas monitoradas: ${rows.length}`}</Badge>
            <Badge>{`Fila+AoVivo: ${queueRows.length}`}</Badge>
            <Badge>{`Base histórica: ${matches.length} jogos`}</Badge>
            <Badge tone={(reliabilityScore ?? 0) >= 70 ? "good" : (reliabilityScore ?? 0) >= 55 ? "warn" : "bad"}>
              {`Confiabilidade coleta: ${(reliabilityScore ?? 0).toFixed(0)}/100`} <InfoHint text={HELP.reliability} />
            </Badge>
            <Badge tone={coverage.level === "ok" ? "good" : coverage.level === "warn" ? "warn" : "bad"}>
              {`Cobertura base: ${coverage.coverageScore}/100`} <InfoHint text={coverage.reasons.join("\n")} />
            </Badge>
            <Badge tone={finalReliabilityScore >= 70 ? "good" : finalReliabilityScore >= 55 ? "warn" : "bad"}>
              {`Confiabilidade final: ${finalReliabilityScore.toFixed(0)}/100`}
            </Badge>
            <Badge tone={finalIsCollectReliable === false ? "bad" : "good"}>
              {`Gate coleta: ${finalIsCollectReliable === false ? "REBAIXADA" : "OK"}`} <InfoHint text={HELP.gate} />
            </Badge>
            <Badge>{`Fav raw/cal: ${(favoriteCalibration.summary.currentRaw ?? 0).toFixed(0)} / ${(favoriteCalibration.summary.currentCalibrated ?? 0).toFixed(0)}`} <InfoHint text={HELP.calibration} /></Badge>
            <Badge>{`Calibração ${favoriteCalibration.summary.method ?? "identity"} • Brier ${(favoriteCalibration.summary.brierScore ?? 0).toFixed(3)}`} <InfoHint text={HELP.calibration} /></Badge>
            <Badge>{`Latência cliente: ${lastFetchMs}ms`} <InfoHint text={HELP.latency} /></Badge>
            <Badge>{`Coleta servidor: ${lastServerMs}ms`} <InfoHint text={HELP.latency} /></Badge>
            <Badge>{`Refresh: ${refreshMs}ms`} <InfoHint text={HELP.refresh} /></Badge>
            {lastSuccessAt ? <Badge>{`Última atualização: ${new Date(lastSuccessAt).toLocaleTimeString("pt-BR")}`}</Badge> : null}
            <InfoHint text={HELP.kpis} />
          </div>

          <div className="chips" style={{ marginBottom: 10 }}>
            {favoriteCalibration.summary.byBin.slice(0, 3).map((bin) => (
              <Badge key={bin.label}>{`Rel ${bin.label} n=${bin.count} • prev ${(bin.predicted * 100).toFixed(0)}% vs obs ${(bin.observed * 100).toFixed(0)}%`}</Badge>
            ))}
            {reliabilityReasons.slice(0, 2).map((reason) => (
              <Badge key={reason}>{reason}</Badge>
            ))}
            {coverage.reasons.slice(0, 1).map((reason) => (
              <Badge key={reason}>{reason}</Badge>
            ))}
          </div>

          {error ? <Badge tone="bad">{error}</Badge> : null}

          {loading && !rows.length ? (
            <div style={{ marginTop: 12 }}>
              <Skeleton />
              <div style={{ marginTop: 8 }}><Skeleton width="80%" /></div>
              <div style={{ marginTop: 8 }}><Skeleton width="65%" /></div>
            </div>
          ) : !boardWithProb.length ? (
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
                    <th className="right">Fav raw <InfoHint text={HELP.favoriteRaw} /></th>
                    <th className="right">Fav cal <InfoHint text={HELP.favoriteCal} /></th>
                    <th>Favorito</th>
                    <th>Status</th>
                    <th>Ações <InfoHint text={HELP.actions} /></th>
                  </tr>
                </thead>
                <tbody>
                  {boardVisible.map(({ row, prob, favoriteRaw, favoriteCalibrated, recommendation }, index) => (
                    <tr key={`${row.eventTime}-${row.fixture}-${index}`}>
                      <td>{row.eventTime}</td>
                      <td>
                        <Badge tone={row.status === "live" ? "warn" : row.status === "upcoming" ? "good" : "bad"}>
                          {statusLabel(row.status)}
                        </Badge>
                      </td>
                      <td>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <PlayerAvatar nick={row.homeNick || row.homeTeam} size={24} radius={10} />
                          <PlayerAvatar nick={row.awayNick || row.awayTeam} size={24} radius={10} />
                          <span>{row.fixture}</span>
                        </div>
                      </td>
                      <td className="right">{row.score}</td>
                      <td className="right">{(prob.home * 100).toFixed(1)}%</td>
                      <td className="right">{(prob.draw * 100).toFixed(1)}%</td>
                      <td className="right">{(prob.away * 100).toFixed(1)}%</td>
                      <td className="right">{(favoriteRaw * 100).toFixed(1)}%</td>
                      <td className="right">{(favoriteCalibrated * 100).toFixed(1)}%</td>
                      <td>
                        <Badge tone={prob.favorite === "draw" ? "warn" : "good"}>
                          {prob.favorite === "home" ? "Casa" : prob.favorite === "away" ? "Fora" : "Empate"} • {prob.confidence}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={recommendation.recommendation === "APOSTAVEL" ? "good" : recommendation.recommendation === "CAUTELA" ? "warn" : "bad"}>
                          {recommendation.recommendation}
                        </Badge>
                      </td>
                      <td>
                        {lightMode ? <span className="mini">-</span> : <Button onClick={() => setSelectedRow(row)}>Ver mais</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {boardWithProb.length > AOVIVO_PAGE_SIZE && (
                <div className="chips" style={{ marginTop: 10 }}>
                  <Button onClick={() => setBoardPage((prev) => Math.max(1, prev - 1))} disabled={boardPage <= 1}>← Anterior</Button>
                  <Badge>Página {boardPage} de {boardTotalPages}</Badge>
                  <Button onClick={() => setBoardPage((prev) => Math.min(boardTotalPages, prev + 1))} disabled={boardPage >= boardTotalPages}>Próxima →</Button>
                </div>
              )}
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
                <h3 style={{ margin: 0 }}>Estatística avançada do jogo <InfoHint text={HELP.modal} /></h3>
                <small style={{ color: "var(--muted)" }}>{selectedDeepStats.row.eventTime} • {selectedDeepStats.row.fixture}</small>
              </div>
              <Button onClick={() => setSelectedRow(null)}>Fechar</Button>
            </div>

            <div className="chips" style={{ marginBottom: 10 }}>
              <Badge>Placar atual: {selectedDeepStats.row.score}</Badge>
              <Badge>Fav raw: {(selectedDeepStats.favoriteRaw * 100).toFixed(1)}%</Badge>
              <Badge tone="good">Fav calibrada: {(selectedDeepStats.favoriteCalibrated * 100).toFixed(1)}%</Badge>
              <Badge tone={selectedDeepStats.recommendationStatus === "APOSTAVEL" ? "good" : selectedDeepStats.recommendationStatus === "CAUTELA" ? "warn" : "bad"}>
                Status: {selectedDeepStats.recommendationStatus}
              </Badge>
              <Badge>xG Casa: {selectedDeepStats.expHomeGoals.toFixed(2)}</Badge>
              <Badge>xG Fora: {selectedDeepStats.expAwayGoals.toFixed(2)}</Badge>
              <Badge>xG Total: {selectedDeepStats.expTotalGoals.toFixed(2)}</Badge>
              <Badge>BTTS: {(selectedDeepStats.bttsProb * 100).toFixed(1)}%</Badge>
              <Badge>H2H jogos: {selectedDeepStats.h2hGames}</Badge>
            </div>

            {!!selectedDeepStats.recommendationReasons.length && (
              <div className="list" style={{ marginBottom: 10 }}>
                {selectedDeepStats.recommendationReasons.slice(0, 4).map((reason) => (
                  <div key={reason} className="row"><div className="left"><small>{reason}</small></div></div>
                ))}
              </div>
            )}

            {selectedDeepStats.contextSignals ? (
              <Card className="col-12" style={{ marginBottom: 14 }}>
                <CardHeader>
                  <div>
                    <h3 style={{ margin: 0 }}>Sinais Contextuais <InfoHint text="Sinais derivados calculados sem vazamento temporal (somente histórico ANTERIOR ao momento atual).\n\nEles modulam confiança e explicam contexto — não são atalho para liberar entrada." /></h3>
                    <small>Revenge • Tilt • Sessão • Estilo • Afinidade</small>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="chips">
                    <Badge>Revenge H→A: {selectedDeepStats.contextSignals.revenge.homeRevengeIndex}</Badge>
                    <Badge>Revenge A→H: {selectedDeepStats.contextSignals.revenge.awayRevengeIndex}</Badge>
                    <Badge>H2H jogos: {selectedDeepStats.contextSignals.revenge.h2hGames}</Badge>
                    {selectedDeepStats.contextSignals.revenge.validation ? (
                      <Badge tone={selectedDeepStats.contextSignals.revenge.validation.status === "ok" ? "good" : "warn"}>
                        Validação revenge: {selectedDeepStats.contextSignals.revenge.validation.status} (n={selectedDeepStats.contextSignals.revenge.validation.sampleSize})
                      </Badge>
                    ) : null}
                    <Badge tone={selectedDeepStats.contextSignals.tilt.home.tiltScore > 0 ? "good" : selectedDeepStats.contextSignals.tilt.home.tiltScore < 0 ? "bad" : "warn"}>
                      Tilt casa: {selectedDeepStats.contextSignals.tilt.home.tiltScore}
                    </Badge>
                    <Badge tone={selectedDeepStats.contextSignals.tilt.away.tiltScore > 0 ? "good" : selectedDeepStats.contextSignals.tilt.away.tiltScore < 0 ? "bad" : "warn"}>
                      Tilt fora: {selectedDeepStats.contextSignals.tilt.away.tiltScore}
                    </Badge>
                    <Badge>Estilo pace {selectedDeepStats.contextSignals.style.pace.toFixed(2)} • frag {selectedDeepStats.contextSignals.style.fragility.toFixed(2)} • vol {selectedDeepStats.contextSignals.style.volatility.toFixed(2)}</Badge>
                    <Badge tone={selectedDeepStats.contextSignals.session.home.lowSample ? "warn" : "good"}>Sessão casa: n={selectedDeepStats.contextSignals.session.home.sessionGamesCount} • {selectedDeepStats.contextSignals.session.home.sessionTrend}</Badge>
                    <Badge tone={selectedDeepStats.contextSignals.session.away.lowSample ? "warn" : "good"}>Sessão fora: n={selectedDeepStats.contextSignals.session.away.sessionGamesCount} • {selectedDeepStats.contextSignals.session.away.sessionTrend}</Badge>
                    <Badge tone={selectedDeepStats.contextSignals.teamAffinity.home.lowSample ? "warn" : "good"}>Afinidade casa×time: {(selectedDeepStats.contextSignals.teamAffinity.home.deltaWin * 100).toFixed(1)}pp</Badge>
                    <Badge tone={selectedDeepStats.contextSignals.teamAffinity.away.lowSample ? "warn" : "good"}>Afinidade fora×time: {(selectedDeepStats.contextSignals.teamAffinity.away.deltaWin * 100).toFixed(1)}pp</Badge>
                    {selectedDeepStats.contextSignals.drift ? (
                      <Badge tone={selectedDeepStats.contextSignals.drift.level === "estavel" ? "good" : selectedDeepStats.contextSignals.drift.level === "atencao" ? "warn" : "bad"}>
                        Drift(seg): {selectedDeepStats.contextSignals.drift.level}
                      </Badge>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Card className="col-12">
                <CardHeader><div><h3>Probabilidade 1X2 <InfoHint text={HELP.prob1x2} /></h3><small>Distribuição precisa para resultado final</small></div></CardHeader>
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
                <CardHeader><div><h3>Curva Over (todas linhas) <InfoHint text={HELP.overCurve} /></h3><small>Mercado de gols em múltiplas linhas</small></div></CardHeader>
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
                <CardHeader><div><h3>Forma Casa <InfoHint text={HELP.form} /></h3><small>Janela recente de performance</small></div></CardHeader>
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
                <CardHeader><div><h3>Forma Fora <InfoHint text={HELP.form} /></h3><small>Janela recente de performance</small></div></CardHeader>
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
              <CardHeader><div><h3>Mercados detalhados <InfoHint text={HELP.markets} /></h3><small>Probabilidade e odd justa para mercados disponíveis</small></div></CardHeader>
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
