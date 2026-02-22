import { NextResponse } from "next/server";
import { htmlToLooseText, parseMatchDetailsFromText } from "@/lib/match-details";

const PAGE_TIMEOUT_MS = 12000;

type Body = {
  matchId?: string;
  url?: string;
  rawText?: string;
  cookie?: string;
  userAgent?: string;
};

async function fetchText(url: string, options?: { cookie?: string; userAgent?: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        "user-agent":
          options?.userAgent?.trim() ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        pragma: "no-cache",
        "cache-control": "no-cache",
        ...(options?.cookie?.trim() ? { cookie: options.cookie.trim() } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Falha ao buscar URL: HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const matchId = String(body.matchId ?? "").trim();
    const url = String(body.url ?? "").trim();
    const rawText = String(body.rawText ?? "");
    const cookie = String(body.cookie ?? "").trim();
    const userAgent = String(body.userAgent ?? "").trim();

    if (!matchId) {
      return NextResponse.json({ error: "matchId é obrigatório." }, { status: 400 });
    }

    if (!url && !rawText.trim()) {
      return NextResponse.json({ error: "Informe url ou rawText." }, { status: 400 });
    }

    const effectiveText = url
      ? htmlToLooseText(await fetchText(url, { cookie: cookie || undefined, userAgent: userAgent || undefined }))
      : rawText;

    const record = parseMatchDetailsFromText({
      matchId,
      rawText: effectiveText,
      sourceRef: url || undefined,
    });

    // Pequena validação: pelo menos 1 métrica ou evento.
    const hasSomeSignal =
      record.events.length > 0 ||
      record.stats.cornersHome + record.stats.cornersAway > 0 ||
      record.stats.attacksHome + record.stats.attacksAway > 0 ||
      record.stats.onTargetHome + record.stats.onTargetAway > 0;

    if (!hasSomeSignal) {
      return NextResponse.json(
        { error: "Não consegui extrair dados dessa fonte. Tente colar o texto (rawText) ou usar outra URL." },
        { status: 422 }
      );
    }

    return NextResponse.json({ ok: true, record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado ao processar detalhes.";
    const status = /401|403|forbidden|unauthorized|anti-bot|bloqueio/i.test(message) ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
