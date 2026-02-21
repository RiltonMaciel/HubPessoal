import type { MatchRecord, UpcomingRecord } from "@/lib/types";

function normalizePart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

type MatchLike = Pick<MatchRecord, "dateTime" | "league" | "homeNick" | "awayNick"> | Pick<UpcomingRecord, "dateTime" | "league" | "homeNick" | "awayNick">;

export function buildMatchKey(input: MatchLike) {
  return [
    normalizePart(input.dateTime),
    normalizePart(input.league || "all"),
    normalizePart(input.homeNick),
    normalizePart(input.awayNick),
  ].join("|");
}
