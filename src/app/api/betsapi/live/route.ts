import { NextResponse } from "next/server";
import { collectBetsApiBoard } from "@/lib/betsapi";

type LiveBody = {
  url?: string;
  maxPages?: number;
  force?: boolean;
  cookie?: string;
  userAgent?: string;
};

type LiveCacheEntry = {
  updatedAt: string;
  collectedInMs: number;
  pagesProcessed: number;
  total: number;
  rows: Awaited<ReturnType<typeof collectBetsApiBoard>>["rows"];
  lines: Awaited<ReturnType<typeof collectBetsApiBoard>>["lines"];
  statusCounts: {
    live: number;
    upcoming: number;
    finished: number;
  };
  reliabilityScore: number;
  isCollectReliable: boolean;
  reliabilityReasons: string[];
};

const liveSnapshotCache = new Map<string, LiveCacheEntry>();
const liveInFlight = new Map<string, Promise<LiveCacheEntry>>();
const failureBackoffUntil = new Map<string, number>();
const SNAPSHOT_TTL_MS = 2500;
const FAILURE_BACKOFF_MS = 15000;

export async function POST(request: Request) {
  let requestUrl = "";
  let requestHadCookie = false;
  try {
    const startedAt = Date.now();
    const body = (await request.json()) as LiveBody;
    const url = body.url?.trim();
    const cookie = body.cookie?.trim() || "";
     requestHadCookie = Boolean(cookie);
    const userAgent = body.userAgent?.trim() || "";
    const cacheKey = `${url ?? ""}::${cookie ? "cookie" : "nocookie"}::${userAgent ? userAgent.slice(0, 80) : "noua"}`;
    requestUrl = cacheKey;
    const rawMaxPages = Number(body.maxPages ?? 1);
    const force = body.force === true;

    if (!url) {
      return NextResponse.json({ error: "Informe a URL da liga no BetsAPI." }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "A URL precisa começar com http:// ou https://." }, { status: 400 });
    }

    if (Number.isNaN(rawMaxPages) || rawMaxPages < 1 || rawMaxPages > 5000) {
      return NextResponse.json({ error: "maxPages deve estar entre 1 e 5000." }, { status: 400 });
    }

    const cached = liveSnapshotCache.get(cacheKey);
    const cachedAge = cached ? Date.now() - new Date(cached.updatedAt).getTime() : Number.POSITIVE_INFINITY;
    if (!force && cached && cachedAge <= SNAPSHOT_TTL_MS) {
      return NextResponse.json({
        ok: true,
        updatedAt: cached.updatedAt,
        collectedInMs: cached.collectedInMs,
        reliabilityScore: cached.reliabilityScore,
        isCollectReliable: cached.isCollectReliable,
        reliabilityReasons: [...cached.reliabilityReasons, "Snapshot reaproveitado (anti-burst)."],
        pagesProcessed: cached.pagesProcessed,
        total: cached.total,
        rows: cached.rows,
        lines: cached.lines,
        statusCounts: cached.statusCounts,
        staleFallback: false,
        servedFromCache: true,
      });
    }

    const blockedUntil = failureBackoffUntil.get(cacheKey) ?? 0;
    if (!force && blockedUntil > Date.now() && cached) {
      return NextResponse.json({
        ok: true,
        updatedAt: cached.updatedAt,
        collectedInMs: cached.collectedInMs,
        reliabilityScore: Math.min(cached.reliabilityScore, 58),
        isCollectReliable: false,
        reliabilityReasons: [...cached.reliabilityReasons, "Backoff ativo após bloqueio da origem; usando snapshot."],
        pagesProcessed: cached.pagesProcessed,
        total: cached.total,
        rows: cached.rows,
        lines: cached.lines,
        statusCounts: cached.statusCounts,
        staleFallback: true,
        staleReason: "Backoff anti-bot ativo.",
      });
    }

    const active = liveInFlight.get(cacheKey);
    if (!force && active) {
      const shared = await active;
      return NextResponse.json({
        ok: true,
        updatedAt: shared.updatedAt,
        collectedInMs: shared.collectedInMs,
        reliabilityScore: shared.reliabilityScore,
        isCollectReliable: shared.isCollectReliable,
        reliabilityReasons: [...shared.reliabilityReasons, "Resposta compartilhada de requisição em andamento."],
        pagesProcessed: shared.pagesProcessed,
        total: shared.total,
        rows: shared.rows,
        lines: shared.lines,
        statusCounts: shared.statusCounts,
        staleFallback: false,
        servedFromCache: true,
      });
    }

    const collectPromise = (async (): Promise<LiveCacheEntry> => {
      let result = await collectBetsApiBoard(url, rawMaxPages, cookie || userAgent ? { cookie: cookie || undefined, userAgent: userAgent || undefined } : undefined);
      if (!result.rows.length && rawMaxPages > 1) {
        result = await collectBetsApiBoard(url, 1, cookie || userAgent ? { cookie: cookie || undefined, userAgent: userAgent || undefined } : undefined);
      }
      const liveCount = result.rows.filter((item) => item.status === "live").length;
      const upcomingCount = result.rows.filter((item) => item.status === "upcoming").length;
      const finishedCount = result.rows.filter((item) => item.status === "finished").length;

      const freshnessScore = liveCount > 0 ? 1 : upcomingCount > 0 ? 0.75 : 0.5;
      const volumeScore = result.rows.length >= 20 ? 1 : result.rows.length >= 8 ? 0.75 : result.rows.length >= 3 ? 0.5 : 0.25;
      const pagesScore = result.processedPages >= Math.min(rawMaxPages, 2) ? 1 : 0.7;
      const reliabilityScore = Math.round((freshnessScore * 0.45 + volumeScore * 0.35 + pagesScore * 0.2) * 100);
      const reliabilityReasons = [
        `Ao vivo: ${liveCount}`,
        `Na fila: ${upcomingCount}`,
        `Finalizados: ${finishedCount}`,
        `Páginas processadas: ${result.processedPages}`,
      ];
      const isCollectReliable = reliabilityScore >= 60;

      return {
        updatedAt: new Date().toISOString(),
        collectedInMs: Date.now() - startedAt,
        reliabilityScore,
        isCollectReliable,
        reliabilityReasons,
        pagesProcessed: result.processedPages,
        total: result.rows.length,
        rows: result.rows,
        lines: result.lines,
        statusCounts: {
          live: liveCount,
          upcoming: upcomingCount,
          finished: finishedCount,
        },
      };
    })();

    liveInFlight.set(cacheKey, collectPromise);
    let entry: LiveCacheEntry;
    try {
      entry = await collectPromise;
    } finally {
      liveInFlight.delete(cacheKey);
    }

    const payload = {
      ok: true,
      updatedAt: entry.updatedAt,
      collectedInMs: entry.collectedInMs,
      reliabilityScore: entry.reliabilityScore,
      isCollectReliable: entry.isCollectReliable,
      reliabilityReasons: entry.reliabilityReasons,
      pagesProcessed: entry.pagesProcessed,
      total: entry.total,
      rows: entry.rows,
      lines: entry.lines,
      statusCounts: entry.statusCounts,
      staleFallback: false,
      servedFromCache: false,
    };

    failureBackoffUntil.delete(cacheKey);
    liveSnapshotCache.set(cacheKey, entry);

    return NextResponse.json(payload);
  } catch (error) {
    let message = error instanceof Error ? error.message : "Erro inesperado ao processar o AoVivo.";
    if (!requestHadCookie && /\bHTTP\s*403\b/i.test(message)) {
      message =
        "BetsAPI retornou HTTP 403 (Cloudflare/anti-bot). Cole seu cf_clearance/cookie no campo Cookie do AoVivo ou na tela /betsapi (o valor será reutilizado automaticamente).";
    }
    if (requestUrl && /403|forbidden|anti-bot|bloqueio|security verification|captcha/i.test(message)) {
      failureBackoffUntil.set(requestUrl, Date.now() + FAILURE_BACKOFF_MS);
    }
    const cached = requestUrl ? liveSnapshotCache.get(requestUrl) : undefined;
    if (cached) {
      return NextResponse.json({
        ok: true,
        updatedAt: cached.updatedAt,
        collectedInMs: cached.collectedInMs,
        reliabilityScore: Math.min(cached.reliabilityScore, 58),
        isCollectReliable: false,
        reliabilityReasons: [...cached.reliabilityReasons, "Fallback: usando último snapshot válido (origem bloqueada temporariamente)."],
        pagesProcessed: cached.pagesProcessed,
        total: cached.total,
        rows: cached.rows,
        lines: cached.lines,
        statusCounts: cached.statusCounts,
        staleFallback: true,
        staleReason: message,
      });
    }
    const status = /403|forbidden|anti-bot|bloqueio/i.test(message) ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
