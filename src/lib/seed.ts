import { v4 as uuidv4 } from "uuid";
import type { MatchRecord, UpcomingRecord } from "@/lib/types";

export function getSeedMatches(): MatchRecord[] {
  const base = [
    ["H2H GG", "2026-02-16T22:08:00", "France", "CATALYST", "Spain", "DOMINATOR", 1, 3],
    ["H2H GG", "2026-02-16T22:01:00", "Liverpool", "EDEN", "Napoli", "ODYSSEY", 3, 2],
    ["H2H GG", "2026-02-16T21:46:00", "Barcelona", "HAYMAKER", "Liverpool", "EDEN", 4, 0],
    ["H2H GG", "2026-02-16T21:38:00", "Portugal", "DOMINATOR", "Germany", "AGENT", 1, 1],
    ["H2H GG", "2026-02-16T21:32:00", "Tottenham", "DANTE", "Portugal", "AGENT", 4, 4],
    ["H2H GG", "2026-02-16T21:25:00", "Tottenham", "DANTE", "Barcelona", "HAYMAKER", 2, 1],
    ["H2H GG", "2026-02-16T21:10:00", "Napoli", "ODYSSEY", "Milan", "VIRUS", 6, 2],
    ["H2H GG", "2026-02-16T21:00:00", "Real", "MERLIN", "Bayern", "BIBIBI", 3, 5],
  ] as const;

  const expanded: MatchRecord[] = [];
  for (let i = 0; i < 26; i += 1) {
    const row = base[i % base.length];
    const date = new Date(row[1]);
    date.setHours(date.getHours() - i * 3);
    expanded.push({
      id: uuidv4(),
      league: row[0],
      dateTime: date.toISOString(),
      homeTeam: row[2],
      homeNick: row[3],
      awayTeam: row[4],
      awayNick: row[5],
      homeGoals: row[6],
      awayGoals: row[7],
      status: "FINISHED",
    });
  }
  return expanded;
}

export function getSeedUpcoming(): UpcomingRecord[] {
  return [
    { id: uuidv4(), league: "H2H GG", dateTime: "2026-02-17T18:08:00", homeTeam: "France", homeNick: "CATALYST", awayTeam: "Spain", awayNick: "DOMINATOR" },
    { id: uuidv4(), league: "H2H GG", dateTime: "2026-02-17T18:12:00", homeTeam: "Aston Villa", homeNick: "JAEGER", awayTeam: "Tottenham", awayNick: "DANTE" },
    { id: uuidv4(), league: "H2H GG", dateTime: "2026-02-17T18:18:00", homeTeam: "Barcelona", homeNick: "HAYMAKER", awayTeam: "Liverpool", awayNick: "EDEN" },
  ];
}
