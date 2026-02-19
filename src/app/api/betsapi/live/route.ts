import { NextResponse } from "next/server";
import { collectBetsApiBoard } from "@/lib/betsapi";

type LiveBody = {
  url?: string;
  maxPages?: number;
};

export async function POST(request: Request) {
  try {
    const startedAt = Date.now();
    const body = (await request.json()) as LiveBody;
    const url = body.url?.trim();
    const rawMaxPages = Number(body.maxPages ?? 1);

    if (!url) {
      return NextResponse.json({ error: "Informe a URL da liga no BetsAPI." }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "A URL precisa começar com http:// ou https://." }, { status: 400 });
    }

    if (Number.isNaN(rawMaxPages) || rawMaxPages < 1 || rawMaxPages > 5000) {
      return NextResponse.json({ error: "maxPages deve estar entre 1 e 5000." }, { status: 400 });
    }

    const result = await collectBetsApiBoard(url, rawMaxPages);

    return NextResponse.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      collectedInMs: Date.now() - startedAt,
      pagesProcessed: result.processedPages,
      total: result.rows.length,
      rows: result.rows,
      lines: result.lines,
      statusCounts: {
        live: result.rows.filter((item) => item.status === "live").length,
        upcoming: result.rows.filter((item) => item.status === "upcoming").length,
        finished: result.rows.filter((item) => item.status === "finished").length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado ao processar o AoVivo.";
    const status = /403|forbidden|anti-bot|bloqueio/i.test(message) ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
