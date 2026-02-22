import type { MatchDetailsEvent, MatchDetailsRecord, MatchDetailsStats } from "@/lib/types";

function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
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

export function htmlToLooseText(html: string) {
  const text = decodeEntities(stripTags(html));
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emptyStats(goalsHome = 0, goalsAway = 0): MatchDetailsStats {
  return {
    goalsHome,
    goalsAway,
    cornersHome: 0,
    cornersAway: 0,
    yellowHome: 0,
    yellowAway: 0,
    redHome: 0,
    redAway: 0,
    penaltiesHome: 0,
    penaltiesAway: 0,
    substitutionsHome: 0,
    substitutionsAway: 0,
    attacksHome: 0,
    attacksAway: 0,
    dangerousAttacksHome: 0,
    dangerousAttacksAway: 0,
    onTargetHome: 0,
    onTargetAway: 0,
  };
}

function clampNonNegInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function pickTwoIntsFromLine(line: string) {
  const nums = line.match(/\d+/g)?.map((n) => Number(n)).filter((n) => Number.isFinite(n)) ?? [];
  if (nums.length < 2) return null;

  // Caso do copy do BetsAPI que cola "2727" "2525" (sem espaço): tenta splitar em pares.
  const expand = (n: number) => {
    const s = String(n);
    if (s.length === 4 && s === s.slice(0, 2) + s.slice(2)) {
      return [Number(s.slice(0, 2)), Number(s.slice(2))];
    }
    return [n];
  };

  const expanded = nums.flatMap(expand);
  if (expanded.length >= 2) return [expanded[0]!, expanded[1]!] as const;
  return null;
}

function parseHeaderLine(line: string) {
  // Exemplo: "Portugal (CRUSADER) 2-3 Spain (HORIZON) 2026/02/21 15:46"
  const cleaned = normalizeWhitespace(line);
  const m = cleaned.match(/^(.*?)\s+(\d+)\s*[-–:]\s*(\d+)\s+(.*?)\s+(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s*$/);
  if (!m) return null;
  return {
    homeLabel: m[1]!.trim(),
    goalsHome: Number(m[2]),
    goalsAway: Number(m[3]),
    awayLabel: m[4]!.trim(),
    dateTimeLabel: m[5]!.trim(),
  };
}

function parseEvents(lines: string[]) {
  const events: MatchDetailsEvent[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Ex: 1' - 1st Goal - (Spain (HORIZON)) -
    const m = line.match(/^(\d{1,3})'\s*-\s*(.*?)\s*-\s*\((.*?)\)\s*-?/);
    if (m) {
      events.push({
        minute: clampNonNegInt(Number(m[1])),
        label: normalizeWhitespace(m[2] ?? ""),
        team: normalizeWhitespace(m[3] ?? ""),
      });
      continue;
    }

    // Fallback: sem time em parênteses
    const m2 = line.match(/^(\d{1,3})'\s*-\s*(.*)$/);
    if (m2) {
      events.push({
        minute: clampNonNegInt(Number(m2[1])),
        label: normalizeWhitespace(m2[2] ?? ""),
        team: "",
      });
    }
  }

  return events;
}

export function parseMatchDetailsFromText(args: {
  matchId: string;
  rawText: string;
  sourceRef?: string;
}) {
  const raw = args.rawText.replace(/\r\n/g, "\n");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  const header = lines.map(parseHeaderLine).find(Boolean) ?? null;

  const stats = emptyStats(
    header?.goalsHome ? clampNonNegInt(header.goalsHome) : 0,
    header?.goalsAway ? clampNonNegInt(header.goalsAway) : 0
  );

  const takeStat = (labelRe: RegExp, apply: (home: number, away: number) => void) => {
    const hit = lines.find((l) => labelRe.test(l));
    if (!hit) return;
    const pair = pickTwoIntsFromLine(hit);
    if (!pair) return;
    apply(clampNonNegInt(pair[0]), clampNonNegInt(pair[1]));
  };

  takeStat(/\bCorners\b/i, (home, away) => {
    stats.cornersHome = home;
    stats.cornersAway = away;
  });

  takeStat(/\bYellow\s*Card\b/i, (home, away) => {
    stats.yellowHome = home;
    stats.yellowAway = away;
  });

  takeStat(/\bRed\s*Card\b/i, (home, away) => {
    stats.redHome = home;
    stats.redAway = away;
  });

  takeStat(/\bPenalties\b/i, (home, away) => {
    stats.penaltiesHome = home;
    stats.penaltiesAway = away;
  });

  takeStat(/\bSubstitutions\b/i, (home, away) => {
    stats.substitutionsHome = home;
    stats.substitutionsAway = away;
  });

  takeStat(/^Attacks$|\bAttacks\b/i, (home, away) => {
    stats.attacksHome = home;
    stats.attacksAway = away;
  });

  takeStat(/Dangerous\s*Attacks/i, (home, away) => {
    stats.dangerousAttacksHome = home;
    stats.dangerousAttacksAway = away;
  });

  takeStat(/\bOn\s*Target\b/i, (home, away) => {
    stats.onTargetHome = home;
    stats.onTargetAway = away;
  });

  const eventsIndex = lines.findIndex((l) => /^Events$/i.test(l));
  const eventLines = eventsIndex >= 0 ? lines.slice(eventsIndex + 1) : [];
  const events = parseEvents(eventLines);

  const now = new Date().toISOString();
  const record: MatchDetailsRecord = {
    id: `details:${args.matchId}`,
    matchId: args.matchId,
    createdAt: now,
    updatedAt: now,
    homeLabel: header?.homeLabel,
    awayLabel: header?.awayLabel,
    dateTimeLabel: header?.dateTimeLabel,
    stats,
    events,
    source: "rawText",
    sourceRef: args.sourceRef,
  };

  return record;
}
