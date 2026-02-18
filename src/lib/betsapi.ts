export type BetsApiMatch = {
  dateTime: string;
  fixture: string;
  score: string;
};

const DATE_RE = /^\d{2}\/\d{2}\s\d{2}:\d{2}$/;
const SCORE_RE = /^\d+\s*-\s*\d+$/;

function stripTags(input: string) {
  return input.replace(/<[^>]*>/g, " ");
}

function decodeEntities(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(input: string) {
  return decodeEntities(stripTags(input)).replace(/\s+/g, " ").trim();
}

function normalizeLeagueUrl(leagueUrl: string) {
  const withoutHash = leagueUrl.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  return withoutQuery.replace(/\/p\.\d+$/, "");
}

function buildPageUrl(baseUrl: string, page: number) {
  if (page <= 1) return baseUrl;
  return `${baseUrl}/p.${page}`;
}

function parseRowsFromHtml(html: string): BetsApiMatch[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const matches: BetsApiMatch[] = [];

  for (const rowHtml of rows) {
    const cellsRaw = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1]);
    if (cellsRaw.length < 4) continue;

    const dateTime = normalizeText(cellsRaw[0]);
    const fixture = normalizeText(cellsRaw[2]);
    const score = normalizeText(cellsRaw[3]).replace(/\s+/g, "");

    if (!DATE_RE.test(dateTime)) continue;
    if (!fixture.includes(" v ")) continue;
    if (!SCORE_RE.test(score)) continue;

    matches.push({
      dateTime,
      fixture,
      score: score.replace(/\s+/g, ""),
    });
  }

  return matches;
}

async function fetchBetsApiPage(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

export async function collectBetsApiMatches(leagueUrl: string, maxPages: number) {
  const safeMaxPages = Math.max(1, Math.min(1000, Math.floor(maxPages)));
  const baseUrl = normalizeLeagueUrl(leagueUrl);
  const seen = new Set<string>();
  const allMatches: BetsApiMatch[] = [];
  let processedPages = 0;

  for (let page = 1; page <= safeMaxPages; page += 1) {
    const pageUrl = buildPageUrl(baseUrl, page);
    const html = await fetchBetsApiPage(pageUrl);
    const pageMatches = parseRowsFromHtml(html);
    processedPages += 1;

    if (pageMatches.length === 0) {
      break;
    }

    for (const item of pageMatches) {
      const key = `${item.dateTime}|${item.fixture}|${item.score}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allMatches.push(item);
    }
  }

  return {
    processedPages,
    matches: allMatches,
    lines: allMatches.map((item) => `${item.dateTime}\t-\t${item.fixture}\t${item.score}`),
  };
}
