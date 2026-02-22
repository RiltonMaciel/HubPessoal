export type BetsApiMatch = {
  dateTime: string;
  fixture: string;
  score: string;
  matchUrl?: string;
};

export type BetsApiLiveStatus = "live" | "upcoming" | "finished";

export type BetsApiBoardRow = {
  eventTime: string;
  fixture: string;
  score: string;
  status: BetsApiLiveStatus;
  minute?: number;
  homeTeam: string;
  awayTeam: string;
  homeNick?: string;
  awayNick?: string;
};

const DATE_RE = /^\d{2}\/\d{2}\s\d{1,2}:\d{2}$/;
const SCORE_RE = /^\d+\s*[-:]\s*\d+$/;
const PAGE_TIMEOUT_MS = 8000;
const RETRY_ATTEMPTS = 3;
const MANUAL_BETSAPI_COOKIE = process.env.BETSAPI_COOKIE?.trim() ?? "";

type BetsApiFetchOptions = {
  cookie?: string;
  userAgent?: string;
  maxMatches?: number;
};

function buildBrowserHeaders(extra?: Record<string, string>) {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "upgrade-insecure-requests": "1",
    ...extra,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBrasiliaTimeLabel(dateToken: string) {
  const match = dateToken.match(/^(\d{2})\/(\d{2})\s(\d{1,2}):(\d{2})$/);
  if (!match) return dateToken;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const hour = Number(match[3]);
  const minute = Number(match[4]);
  if ([month, day, hour, minute].some((value) => Number.isNaN(value))) return dateToken;

  const nowUtc = new Date();
  const year = nowUtc.getUTCFullYear();
  const sourceUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(sourceUtc);

  const monthBr = parts.find((item) => item.type === "month")?.value;
  const dayBr = parts.find((item) => item.type === "day")?.value;
  const hourBr = parts.find((item) => item.type === "hour")?.value;
  const minuteBr = parts.find((item) => item.type === "minute")?.value;

  if (!monthBr || !dayBr || !hourBr || !minuteBr) return dateToken;
  return `${monthBr}/${dayBr} ${hourBr}:${minuteBr}`;
}

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

function extractFirstHref(html: string) {
  const match = html.match(/href=["']([^"']+)["']/i);
  const href = match?.[1]?.trim();
  return href ? toAbsoluteBetsApiUrl(href) : undefined;
}

function extractMatchUrlFromRowHtml(rowHtml: string) {
  const hrefs = [...rowHtml.matchAll(/href=["']([^"']+)["']/gi)]
    .map((m) => m[1] ?? "")
    .map((href) => href.trim())
    .filter(Boolean)
    .map(toAbsoluteBetsApiUrl);

  const deny = (href: string) => /\/le\/|\/ls\/|\/l\/|\?service=|\/p\.\d+$/i.test(href);

  const preferred = hrefs.find((href) => !deny(href) && /(\/(r|ev|e|match)\/)\d+/i.test(href));
  if (preferred) return preferred;

  const fallback = hrefs.find((href) => !deny(href) && /betsapi\.com\//i.test(href));
  return fallback;
}

function parseDateToken(token: string) {
  const match = token.match(/^(\d{2})\/(\d{2})\s(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const hour = Number(match[3]);
  const minute = Number(match[4]);
  if ([month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
  return { month, day, hour, minute };
}

function parseIsoToSaoPauloParts(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if ([month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
  return { month, day, hour, minute };
}

function normalizeLeagueUrl(leagueUrl: string) {
  const withoutHash = leagueUrl.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  return withoutQuery.replace(/\/p\.\d+$/, "");
}

function toAbsoluteBetsApiUrl(input: string) {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("/")) return `https://betsapi.com${input}`;
  return `https://betsapi.com/${input}`;
}

function findFixturesUrlFromHtml(html: string, fallbackBaseUrl: string) {
  const anchorMatches = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  for (const match of anchorMatches) {
    const href = match[1] ?? "";
    const labelRaw = match[2] ?? "";
    const label = decodeEntities(stripTags(labelRaw)).replace(/\s+/g, " ").trim().toLowerCase();
    if (!href) continue;

    if (label.includes("fixtures") || /\/fi\//i.test(href)) {
      return normalizeLeagueUrl(toAbsoluteBetsApiUrl(href));
    }
  }

  if (/\/(ls|le)\//i.test(fallbackBaseUrl)) {
    return fallbackBaseUrl.replace(/\/(ls|le)\//i, "/fi/");
  }

  return fallbackBaseUrl;
}

function buildLeagueUrlCandidates(leagueUrl: string) {
  const base = normalizeLeagueUrl(leagueUrl);
  const candidates = [base];
  if (base.includes("/ls/")) candidates.push(base.replace("/ls/", "/le/"));
  if (base.includes("/le/")) candidates.push(base.replace("/le/", "/ls/"));
  if (base.includes("/l/")) {
    candidates.push(base.replace("/l/", "/le/"));
    candidates.push(base.replace("/l/", "/ls/"));
  }
  if (base.includes("/le/")) candidates.push(base.replace("/le/", "/l/"));
  if (base.includes("/ls/")) candidates.push(base.replace("/ls/", "/l/"));
  return [...new Set(candidates)];
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

    const cellsNormalized = cellsRaw.map((cell) => normalizeText(cell));
    const dateTimeRaw = cellsNormalized.find((cell) => DATE_RE.test(cell)) ?? "";

    const fixtureIndex = cellsNormalized.findIndex((cell) => /\sv(?:s)?\s/i.test(cell));
    const fixtureCellHtml = fixtureIndex >= 0 ? (cellsRaw[fixtureIndex] ?? "") : "";
    const fixture = fixtureIndex >= 0 ? (cellsNormalized[fixtureIndex] ?? "") : "";

    const scoreCandidate = cellsNormalized.find((cell) => SCORE_RE.test(cell.replace(/\s+/g, ""))) ?? "";
    const score = scoreCandidate.replace(/\s+/g, "");

    const matchUrl = extractFirstHref(fixtureCellHtml) ?? extractMatchUrlFromRowHtml(rowHtml);

    if (!DATE_RE.test(dateTimeRaw)) continue;
    if (!fixture || !/\sv(?:s)?\s/i.test(fixture)) continue;
    if (!SCORE_RE.test(score)) continue;

    matches.push({
      dateTime: toBrasiliaTimeLabel(dateTimeRaw),
      fixture,
      score: score.replace(/\s+/g, "").replace(":", "-"),
      matchUrl,
    });
  }

  return matches;
}

function minutesOfDay(parts: { hour: number; minute: number }) {
  return parts.hour * 60 + parts.minute;
}

function absDiff(a: number, b: number) {
  return Math.abs(a - b);
}

export async function findBetsApiMatchUrl(args: {
  leagueUrl: string;
  match: {
    dateTimeIso: string;
    homeNick: string;
    awayNick: string;
    homeGoals: number;
    awayGoals: number;
  };
  maxPages: number;
  options?: BetsApiFetchOptions;
}) {
  const safeMaxPages = Math.max(1, Math.min(5000, Math.floor(args.maxPages)));
  const targetScore = `${Math.floor(args.match.homeGoals)}-${Math.floor(args.match.awayGoals)}`;
  const targetScoreRev = `${Math.floor(args.match.awayGoals)}-${Math.floor(args.match.homeGoals)}`;
  const targetHome = String(args.match.homeNick ?? "").trim().toLowerCase();
  const targetAway = String(args.match.awayNick ?? "").trim().toLowerCase();
  const targetParts = parseIsoToSaoPauloParts(args.match.dateTimeIso);

  if (!targetHome || !targetAway || !targetParts) {
    return { processedPages: 0, matchUrl: null as string | null, errors: ["Critério inválido para localizar a partida."] };
  }

  const baseCandidates = buildLeagueUrlCandidates(args.leagueUrl);
  const errors: string[] = [];
  let processedPages = 0;

  for (const candidate of baseCandidates) {
    try {
      const rootHtml = await fetchBetsApiPage(candidate, args.options);
      const fixturesBaseUrl = findFixturesUrlFromHtml(rootHtml, candidate);

      for (let page = 1; page <= safeMaxPages; page += 1) {
        const pageUrl = buildPageUrl(fixturesBaseUrl, page);
        const html = await fetchBetsApiPage(pageUrl, args.options);
        const pageRows = parseRowsFromHtml(html);
        processedPages += 1;

        if (pageRows.length === 0) break;

        let best: { score: number; matchUrl: string } | null = null;

        for (const row of pageRows) {
          if (!row.matchUrl) continue;

          const rowScore = row.score.replace(/\s+/g, "");
          const scoreOk = rowScore === targetScore || rowScore === targetScoreRev;
          if (!scoreOk) continue;

          const fixtureParts = parseFixtureParts(row.fixture);
          const rowHome = (fixtureParts.homeNick ?? "").trim().toLowerCase();
          const rowAway = (fixtureParts.awayNick ?? "").trim().toLowerCase();

          const direct = rowHome === targetHome && rowAway === targetAway;
          const reverse = rowHome === targetAway && rowAway === targetHome;
          if (!direct && !reverse) continue;

          // Base score: score+nick batem.
          let candidateScore = 10;

          // Preferir o lado correto (home/away) bater com placar.
          if (direct && rowScore === targetScore) candidateScore += 4;
          if (reverse && rowScore === targetScoreRev) candidateScore += 4;

          // Time closeness (tolerância de minutos).
          const rowParts = parseDateToken(row.dateTime);
          if (rowParts && targetParts) {
            const sameDay = rowParts.month === targetParts.month && rowParts.day === targetParts.day;
            if (sameDay) {
              const diff = absDiff(minutesOfDay(rowParts), minutesOfDay(targetParts));
              if (diff <= 2) candidateScore += 6;
              else if (diff <= 7) candidateScore += 3;
              else if (diff <= 15) candidateScore += 1;
            }
          }

          if (!best || candidateScore > best.score) {
            best = { score: candidateScore, matchUrl: row.matchUrl };
          }
        }

        if (best) {
          return { processedPages, matchUrl: best.matchUrl, errors: [] };
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Falha ao processar ${candidate}`);
    }
  }

  return { processedPages, matchUrl: null as string | null, errors };
}

function extractNick(teamLabel: string) {
  const nickMatch = teamLabel.match(/\(([^)]+)\)\s*$/);
  if (!nickMatch) return undefined;
  return nickMatch[1]?.trim();
}

function parseFixtureParts(fixture: string) {
  const [homeRaw = "", awayRaw = ""] = fixture.split(/\sv(?:s)?\s/i);
  const homeTeam = homeRaw.trim();
  const awayTeam = awayRaw.trim();
  return {
    homeTeam,
    awayTeam,
    homeNick: extractNick(homeTeam),
    awayNick: extractNick(awayTeam),
  };
}

function parseBoardRowsFromHtml(html: string): BetsApiBoardRow[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const parsed: BetsApiBoardRow[] = [];

  for (const rowHtml of rows) {
    const cellsRaw = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1]);
    if (cellsRaw.length < 4) continue;

    const eventTimeRaw = normalizeText(cellsRaw[0]);
    const fixture = normalizeText(cellsRaw[2]);
    const scoreText = normalizeText(cellsRaw[3]);
    const scoreNormalized = scoreText.replace(/\s+/g, "");

    if (!/\sv(?:s)?\s/i.test(fixture)) continue;

    let status: BetsApiLiveStatus | null = null;
    let minute: number | undefined;

    if (/^\d{1,2}(?:\+\d+)?'$/.test(eventTimeRaw) && /^\d+\-\d+$/.test(scoreNormalized)) {
      status = "live";
      minute = Number((eventTimeRaw.split("+")[0] ?? "0").replace("'", ""));
    } else if (DATE_RE.test(eventTimeRaw) && /view/i.test(scoreText)) {
      status = "upcoming";
    } else if (DATE_RE.test(eventTimeRaw) && /^\d+\-\d+$/.test(scoreNormalized)) {
      status = "finished";
    }

    if (!status) continue;

    parsed.push({
      eventTime: DATE_RE.test(eventTimeRaw) ? toBrasiliaTimeLabel(eventTimeRaw) : eventTimeRaw,
      fixture,
      score: scoreNormalized || scoreText,
      status,
      minute: Number.isFinite(minute) ? minute : undefined,
      ...parseFixtureParts(fixture),
    });
  }

  return parsed;
}

async function fetchBetsApiPage(url: string, options?: BetsApiFetchOptions) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

    try {
      const requestOrigin = (() => {
        try {
          return new URL(url).origin;
        } catch {
          return "https://betsapi.com";
        }
      })();
      const response = await fetch(url, {
        headers: {
          "user-agent": options?.userAgent?.trim() || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache",
          pragma: "no-cache",
          ...(options?.cookie?.trim() || MANUAL_BETSAPI_COOKIE ? { cookie: (options?.cookie?.trim() || MANUAL_BETSAPI_COOKIE) } : {}),
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Falha ao buscar ${url}: HTTP ${response.status}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      if (error instanceof Error && /\bHTTP\s+(403|429)\b/i.test(error.message)) {
        break;
      }

      if (attempt < RETRY_ATTEMPTS) {
        await delay(250 * attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error) {
    throw new Error(`Falha ao buscar ${url}: ${lastError.message}`);
  }
  throw new Error(`Falha ao buscar ${url}`);
}

export async function collectBetsApiMatches(leagueUrl: string, maxPages: number, options?: BetsApiFetchOptions) {
  const safeMaxPages = Math.max(1, Math.min(5000, Math.floor(maxPages)));
  const safeMaxMatches = options?.maxMatches != null
    ? Math.max(1, Math.min(5000, Math.floor(options.maxMatches)))
    : null;
  const baseCandidates = buildLeagueUrlCandidates(leagueUrl);
  const seen = new Set<string>();
  const allMatches: BetsApiMatch[] = [];
  let processedPages = 0;
  const errors: string[] = [];

  for (const candidate of baseCandidates) {
    try {
      const rootHtml = await fetchBetsApiPage(candidate, options);
      const fixturesBaseUrl = findFixturesUrlFromHtml(rootHtml, candidate);

      for (let page = 1; page <= safeMaxPages; page += 1) {
        const pageUrl = buildPageUrl(fixturesBaseUrl, page);
        const html = await fetchBetsApiPage(pageUrl, options);
        const pageMatches = parseRowsFromHtml(html);
        processedPages += 1;

        if (pageMatches.length === 0) break;

        for (const item of pageMatches) {
          const key = `${item.dateTime}|${item.fixture}|${item.score}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allMatches.push(item);

          if (safeMaxMatches != null && allMatches.length >= safeMaxMatches) {
            break;
          }
        }

        if (safeMaxMatches != null && allMatches.length >= safeMaxMatches) {
          break;
        }
      }

      if (allMatches.length > 0) {
        return {
          processedPages,
          matches: allMatches,
          lines: allMatches.map((item) => `${item.dateTime}\t-\t${item.fixture}\t${item.score}`),
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Falha ao ler ${candidate}`);
    }
  }

  const boardFallback = await collectBetsApiBoard(leagueUrl, safeMaxPages, options);
  const finishedRows = boardFallback.rows.filter((item) => item.status === "finished" && SCORE_RE.test(item.score));
  const fallbackMatches = finishedRows.map((item) => ({
    dateTime: item.eventTime,
    fixture: item.fixture,
    score: item.score.replace(":", "-"),
  }));

  if (fallbackMatches.length > 0) {
    return {
      processedPages: Math.max(processedPages, boardFallback.processedPages),
      matches: fallbackMatches,
      lines: fallbackMatches.map((item) => `${item.dateTime}\t-\t${item.fixture}\t${item.score}`),
    };
  }

  if (errors.length) {
    throw new Error(`Histórico indisponível no momento. ${errors.join(" | ")}`);
  }

  return {
    processedPages,
    matches: [],
    lines: [],
  };
}

export async function collectBetsApiBoard(leagueUrl: string, maxPages: number, options?: BetsApiFetchOptions) {
  const safeMaxPages = Math.max(1, Math.min(5000, Math.floor(maxPages)));
  const candidates = buildLeagueUrlCandidates(leagueUrl);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const seen = new Set<string>();
    const board: BetsApiBoardRow[] = [];
    let processedPages = 0;

    try {
      for (let page = 1; page <= safeMaxPages; page += 1) {
        const pageUrl = buildPageUrl(candidate, page);
        const html = await fetchBetsApiPage(pageUrl, options);
        const pageRows = parseBoardRowsFromHtml(html);
        processedPages += 1;

        if (pageRows.length === 0) break;

        for (const row of pageRows) {
          const key = `${row.eventTime}|${row.fixture}|${row.score}|${row.status}`;
          if (seen.has(key)) continue;
          seen.add(key);
          board.push(row);
        }
      }

      if (board.length > 0) {
        return {
          processedPages,
          rows: board,
          lines: board.map((item) => `${item.eventTime}\t-\t${item.fixture}\t${item.score}`),
        };
      }
      errors.push(`Sem linhas válidas em ${candidate}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Falha ao processar ${candidate}`);
    }
  }

  throw new Error(
    `Não foi possível coletar dados AoVivo. Possível bloqueio do BetsAPI (403/anti-bot). Detalhes: ${errors.join(" | ")}`
  );
}
