import { NextRequest, NextResponse } from "next/server";

type MonitorPayload = {
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
};

type CacheEntry = {
  at: number;
  payload: MonitorPayload;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

type TimelineResponse = {
  incidents?: Array<{
    messageType?: string;
    time?: number;
    payload?: { team?: string } | null;
    runningScore?: { home?: number; away?: number };
  }>;
  matchSummary?: {
    sport?: string;
    startDate?: string;
    streamName?: string;
    finalScore?: { teamA?: number; teamB?: number };
    halfTimeScore?: { teamA?: number; teamB?: number };
    teamA?: { teamName?: string; participantName?: string };
    teamB?: { teamName?: string; participantName?: string };
  };
};

type H2HResponse = {
  matchDetails?: {
    participantAName?: string;
    participantBName?: string;
    teamAName?: string;
    teamBName?: string;
  };
  h2H?: string[];
  participantAStats?: {
    matchesPlayed?: number;
    matchesWinPct?: number;
  };
  participantBStats?: {
    matchesPlayed?: number;
    matchesWinPct?: number;
  };
};

type MatchStatsResponse = Array<{
  periodType?: string;
  teamA?: Record<string, number | string | null>;
  teamB?: Record<string, number | string | null>;
}>;

function extractByRegex(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function isAllowedHost(host: string) {
  const normalized = host.toLowerCase();
  return normalized === "h2hggl.com" || normalized.endsWith(".h2hggl.com");
}

function extractMatchIdFromUrl(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const matchIndex = parts.findIndex((part) => part.toLowerCase() === "match");
  if (matchIndex < 0) return null;
  return parts[matchIndex + 1] ?? null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HubPessoalMonitor/1.0",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchLiveMatchData(matchId: string): Promise<MonitorPayload["liveData"]> {
  const timeline = await fetchJson<TimelineResponse>(
    `https://api-h2h.hudstats.com/v1/timeline/?external_id=${encodeURIComponent(matchId)}`,
  );
  const sport = timeline?.matchSummary?.sport?.toLowerCase() ?? "fifa";
  const [stats, h2h] = await Promise.all([
    fetchJson<MatchStatsResponse>(
      `https://api-h2h.hudstats.com/v1/match/stats/${encodeURIComponent(sport)}?external_id=${encodeURIComponent(matchId)}`,
    ),
    fetchJson<H2HResponse>(
      `https://api-h2h.hudstats.com/v1/h2h/${encodeURIComponent(sport)}?external_id=${encodeURIComponent(matchId)}`,
    ),
  ]);

  if (!timeline && !stats && !h2h) return null;

  const summary = timeline?.matchSummary;
  const finalA = summary?.finalScore?.teamA;
  const finalB = summary?.finalScore?.teamB;
  const htA = summary?.halfTimeScore?.teamA;
  const htB = summary?.halfTimeScore?.teamB;
  const incidents = Array.isArray(timeline?.incidents) ? timeline.incidents : [];
  const endMatchStats = Array.isArray(stats)
    ? stats.find((item) => item?.periodType?.toLowerCase() === "end-match")
    : false;

  function toValue(value: unknown): string {
    if (typeof value === "number") {
      if (Number.isInteger(value)) return value.toString();
      return value.toFixed(1);
    }
    if (typeof value === "string" && value.trim()) return value;
    return "-";
  }

  function statRow(label: string, key: string) {
    const teamAValue = endMatchStats && typeof endMatchStats !== "boolean" ? endMatchStats.teamA?.[key] : null;
    const teamBValue = endMatchStats && typeof endMatchStats !== "boolean" ? endMatchStats.teamB?.[key] : null;
    if (teamAValue == null && teamBValue == null) return null;
    return {
      label,
      teamA: toValue(teamAValue),
      teamB: toValue(teamBValue),
    };
  }

  const statsRows = [
    statRow("Placar", "statsScore"),
    statRow("% Posse", "statsPossession"),
    statRow("Chutes", "statsShots"),
    statRow("xG", "statsExpectedGoals"),
    statRow("Passes", "statsPasses"),
    statRow("Desarmes", "statsTackles"),
    statRow("Desarmes ganhos", "statsTacklesWon"),
    statRow("Escanteios", "statsCorners"),
    statRow("Impedimentos", "statsOffsides"),
    statRow("Defesas", "statsSaves"),
  ].filter((item): item is { label: string; teamA: string; teamB: string } => item !== null);

  const recentEvents = incidents
    .filter((event) => event?.messageType && event.messageType !== "period-change")
    .slice(-12)
    .reverse()
    .map((event) => {
      const minuteValue = typeof event.time === "number" ? Math.max(0, Math.floor(event.time / 60_000)) : null;
      const home = event.runningScore?.home;
      const away = event.runningScore?.away;
      return {
        minute: minuteValue === null ? "-" : `${minuteValue}'`,
        event: (event.messageType ?? "evento").replace(/-/g, " "),
        team: event.payload?.team ?? null,
        score: typeof home === "number" && typeof away === "number" ? `${home} x ${away}` : null,
      };
    });

  return {
    sport: summary?.sport ?? null,
    streamName: summary?.streamName ?? null,
    startedAt: summary?.startDate ?? null,
    participantA: summary?.teamA?.participantName ?? h2h?.matchDetails?.participantAName ?? null,
    participantB: summary?.teamB?.participantName ?? h2h?.matchDetails?.participantBName ?? null,
    teamA: summary?.teamA?.teamName ?? h2h?.matchDetails?.teamAName ?? null,
    teamB: summary?.teamB?.teamName ?? h2h?.matchDetails?.teamBName ?? null,
    finalScore: typeof finalA === "number" && typeof finalB === "number" ? `${finalA} x ${finalB}` : null,
    halfTimeScore: typeof htA === "number" && typeof htB === "number" ? `${htA} x ${htB}` : null,
    timelineIncidents: incidents.length,
    h2hForm: Array.isArray(h2h?.h2H) && h2h.h2H.length > 0 ? h2h.h2H.join(" ") : null,
    statsCaptured: !!endMatchStats,
    comparison: {
      matchesPlayedA: h2h?.participantAStats?.matchesPlayed ?? null,
      matchesPlayedB: h2h?.participantBStats?.matchesPlayed ?? null,
      winRateA: h2h?.participantAStats?.matchesWinPct ?? null,
      winRateB: h2h?.participantBStats?.matchesWinPct ?? null,
    },
    statsRows,
    recentEvents,
  };
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")?.trim();

  if (!url) {
    return NextResponse.json({ error: "Informe ?url= com um link do h2hggl." }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida." }, { status: 400 });
  }

  if (!isAllowedHost(parsedUrl.hostname)) {
    return NextResponse.json({ error: "Apenas links do h2hggl.com são permitidos." }, { status: 400 });
  }

  const cached = cache.get(url);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.payload, fromCache: true });
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36 HubPessoalMonitor/1.0",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const html = await response.text();
    const appScript = extractByRegex(html, /<script[^>]+src=["']([^"']*index[^"']*\.js)["'][^>]*>/i);
    const hasVueRoot = /<div\s+id=["']app["'][^>]*><\/div>/i.test(html);
    const matchIdFromUrl = extractMatchIdFromUrl(parsedUrl);
    const liveData = hasVueRoot && matchIdFromUrl ? await fetchLiveMatchData(matchIdFromUrl) : null;

    const payload: MonitorPayload = {
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      title: extractByRegex(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      ogTitle: extractByRegex(
        html,
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["'][^>]*>/i,
      ),
      description: extractByRegex(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
      ),
      htmlSize: html.length,
      appScript,
      shellDetected: hasVueRoot,
      matchIdFromUrl,
      statusCode: response.status,
      liveData,
    };

    cache.set(url, { at: now, payload });

    return NextResponse.json({ ...payload, fromCache: false });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Falha ao buscar dados do site monitorado.",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 502 },
    );
  }
}
