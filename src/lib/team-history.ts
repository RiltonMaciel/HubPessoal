import type { MatchRecord } from "@/lib/types";

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesText(source: string, search: string) {
  const s = normalize(source);
  const q = normalize(search);
  if (!q) return true;
  return s.includes(q);
}

function toTs(iso: string) {
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function getPlayerSide(match: MatchRecord, nick: string) {
  const n = normalize(nick);
  if (!n) return null;
  if (normalize(match.homeNick) === n) return "home" as const;
  if (normalize(match.awayNick) === n) return "away" as const;
  return null;
}

export function getPlayerTeam(match: MatchRecord, nick: string) {
  const side = getPlayerSide(match, nick);
  if (!side) return null;
  return side === "home" ? match.homeTeam : match.awayTeam;
}

export function inferMostRecentTeam(matches: MatchRecord[], nick: string): string | null {
  const n = normalize(nick);
  if (!n || !matches.length) return null;

  let bestTeam: string | null = null;
  let bestTs = -1;

  for (const match of matches) {
    const side = getPlayerSide(match, n);
    if (!side) continue;
    const ts = toTs(match.dateTime);
    if (ts <= bestTs) continue;
    bestTs = ts;
    bestTeam = side === "home" ? match.homeTeam : match.awayTeam;
  }

  return bestTeam && bestTeam.trim() ? bestTeam : null;
}

export function lastMatchesWithTeam(matches: MatchRecord[], nick: string, teamQuery: string, limit = 5) {
  const n = normalize(nick);
  const q = teamQuery.trim();
  if (!n || !q || !matches.length) return [] as MatchRecord[];

  return matches
    .filter((match) => {
      const team = getPlayerTeam(match, n);
      if (!team) return false;
      return includesText(team, q);
    })
    .sort((a, b) => toTs(b.dateTime) - toTs(a.dateTime))
    .slice(0, Math.max(0, limit));
}

export function lastMatchesForPlayer(matches: MatchRecord[], nick: string, limit = 10) {
  const n = normalize(nick);
  if (!n || !matches.length) return [] as MatchRecord[];

  return matches
    .filter((match) => getPlayerSide(match, n) != null)
    .sort((a, b) => toTs(b.dateTime) - toTs(a.dateTime))
    .slice(0, Math.max(0, limit));
}
