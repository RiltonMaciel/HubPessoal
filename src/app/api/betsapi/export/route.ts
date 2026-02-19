import { NextResponse } from "next/server";
import { collectBetsApiMatches } from "@/lib/betsapi";

type ExportBody = {
  url?: string;
  maxPages?: number;
  maxMatches?: number;
  cookie?: string;
  userAgent?: string;
};

export async function POST(request: Request) {
  try {
    const startedAt = Date.now();
    const body = (await request.json()) as ExportBody;
    const url = body.url?.trim();
    const rawMaxPages = Number(body.maxPages ?? 1);
    const rawMaxMatches = body.maxMatches == null ? null : Number(body.maxMatches);
    const cookie = body.cookie?.trim();
    const userAgent = body.userAgent?.trim();

    if (!url) {
      return NextResponse.json({ error: "Informe a URL da liga no BetsAPI." }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "A URL precisa começar com http:// ou https://." }, { status: 400 });
    }

    if (Number.isNaN(rawMaxPages) || rawMaxPages < 1 || rawMaxPages > 5000) {
      return NextResponse.json({ error: "maxPages deve estar entre 1 e 5000." }, { status: 400 });
    }

    if (rawMaxMatches != null && (Number.isNaN(rawMaxMatches) || rawMaxMatches < 1 || rawMaxMatches > 5000)) {
      return NextResponse.json({ error: "maxMatches deve estar entre 1 e 5000." }, { status: 400 });
    }

    const result = await collectBetsApiMatches(
      url,
      rawMaxPages,
      cookie || userAgent || rawMaxMatches != null
        ? { cookie: cookie ?? undefined, userAgent: userAgent ?? undefined, maxMatches: rawMaxMatches ?? undefined }
        : undefined
    );
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

    return NextResponse.json({
      ok: true,
      total: result.matches.length,
      pagesProcessed: result.processedPages,
      collectedInMs: Date.now() - startedAt,
      fileName: `betsapi-esoccer-${stamp}.txt`,
      text: result.lines.join("\n"),
      lines: result.lines,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado ao processar BetsAPI.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
