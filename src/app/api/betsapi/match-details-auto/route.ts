import { NextResponse } from "next/server";
import { findBetsApiMatchUrl } from "@/lib/betsapi";
import { htmlToLooseText, parseMatchDetailsFromText } from "@/lib/match-details";

const PAGE_TIMEOUT_MS = 14000;

type Body = {
  leagueUrl?: string;
  matchId?: string;
  match?: {
    dateTimeIso: string;
    homeNick: string;
    awayNick: string;
    homeGoals: number;
    awayGoals: number;
  };
  maxPages?: number;
  cookie?: string;
  userAgent?: string;
};

async function fetchHtml(url: string, options?: { cookie?: string; userAgent?: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "user-agent":
        options?.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      pragma: "no-cache",
      "cache-control": "no-cache",
    };

    const cookie = options?.cookie?.trim();
    if (cookie) headers.cookie = cookie;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Falha ao buscar URL do jogo: HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const startedAt = Date.now();
    const body = (await request.json()) as Body;

    const leagueUrl = String(body.leagueUrl ?? "").trim();
    const matchId = String(body.matchId ?? "").trim();
    const match = body.match;
    const maxPages = Number(body.maxPages ?? 200);
    const cookie = String(body.cookie ?? "").trim();
    const userAgent = String(body.userAgent ?? "").trim();

    if (!leagueUrl) {
      return NextResponse.json({ error: "leagueUrl é obrigatório." }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(leagueUrl)) {
      return NextResponse.json({ error: "leagueUrl precisa começar com http:// ou https://." }, { status: 400 });
    }

    if (!matchId) {
      return NextResponse.json({ error: "matchId é obrigatório." }, { status: 400 });
    }

    if (!match) {
      return NextResponse.json({ error: "match é obrigatório." }, { status: 400 });
    }

    if (Number.isNaN(maxPages) || maxPages < 1 || maxPages > 5000) {
      return NextResponse.json({ error: "maxPages deve estar entre 1 e 5000." }, { status: 400 });
    }

    const lookup = await findBetsApiMatchUrl({
      leagueUrl,
      match,
      maxPages,
      options: cookie || userAgent ? { cookie: cookie || undefined, userAgent: userAgent || undefined } : undefined,
    });

    if (!lookup.matchUrl) {
      return NextResponse.json(
        {
          error: "Não encontrei o link do jogo no BetsAPI com base nesse placar/horário. Tente aumentar maxPages, ou use a opção de colar URL/texto manualmente.",
          processedPages: lookup.processedPages,
          errors: lookup.errors,
        },
        { status: 404 }
      );
    }

    const html = await fetchHtml(lookup.matchUrl, { cookie: cookie || undefined, userAgent: userAgent || undefined });
    const text = htmlToLooseText(html);
    const record = parseMatchDetailsFromText({
      matchId,
      rawText: text,
      sourceRef: lookup.matchUrl,
    });

    const hasSomeSignal =
      record.events.length > 0 ||
      record.stats.cornersHome + record.stats.cornersAway > 0 ||
      record.stats.attacksHome + record.stats.attacksAway > 0 ||
      record.stats.onTargetHome + record.stats.onTargetAway > 0;

    if (!hasSomeSignal) {
      return NextResponse.json(
        {
          error: "Encontrei a página do jogo, mas não consegui extrair stats/events. Talvez o layout tenha mudado ou o conteúdo esteja bloqueado.",
          matchUrl: lookup.matchUrl,
          processedPages: lookup.processedPages,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      matchUrl: lookup.matchUrl,
      processedPages: lookup.processedPages,
      collectedInMs: Date.now() - startedAt,
      record,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado ao buscar detalhes automaticamente.";
    const status = /403|401|forbidden|unauthorized|anti-bot|bloqueio|cloudflare/i.test(message) ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
