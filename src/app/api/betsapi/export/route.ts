import { NextResponse } from "next/server";
import { collectBetsApiMatches } from "@/lib/betsapi";

type ExportBody = {
  url?: string;
  maxPages?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportBody;
    const url = body.url?.trim();
    const rawMaxPages = Number(body.maxPages ?? 1);

    if (!url) {
      return NextResponse.json({ error: "Informe a URL da liga no BetsAPI." }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "A URL precisa começar com http:// ou https://." }, { status: 400 });
    }

    if (Number.isNaN(rawMaxPages) || rawMaxPages < 1 || rawMaxPages > 1000) {
      return NextResponse.json({ error: "maxPages deve estar entre 1 e 1000." }, { status: 400 });
    }

    const result = await collectBetsApiMatches(url, rawMaxPages);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

    return NextResponse.json({
      ok: true,
      total: result.matches.length,
      pagesProcessed: result.processedPages,
      fileName: `betsapi-esoccer-${stamp}.txt`,
      text: result.lines.join("\n"),
      lines: result.lines,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado ao processar BetsAPI.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
