import { db } from "@/lib/db";
import type { AliasRecord, MatchRecord } from "@/lib/types";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export async function getAliasMap() {
  const rows = await db.aliases.toArray();
  const map = new Map<string, string>();

  rows.forEach((row) => {
    const from = normalize(row.nickOriginal);
    const to = row.nickCanonico.trim();
    if (!from || !to) return;
    map.set(from, to);
  });

  return map;
}

export function applyAliasToNick(nick: string, aliasMap: Map<string, string>) {
  const key = normalize(nick);
  return aliasMap.get(key) ?? nick;
}

export function applyAliasesToMatches(matches: MatchRecord[], aliasMap: Map<string, string>) {
  if (!aliasMap.size) return matches;
  return matches.map((match) => ({
    ...match,
    homeNick: applyAliasToNick(match.homeNick, aliasMap),
    awayNick: applyAliasToNick(match.awayNick, aliasMap),
  }));
}

export async function upsertAlias(nickOriginal: string, nickCanonico: string): Promise<AliasRecord> {
  const now = new Date().toISOString();
  const id = `${normalize(nickOriginal)}=>${normalize(nickCanonico)}`;
  const row: AliasRecord = {
    id,
    nickOriginal: nickOriginal.trim(),
    nickCanonico: nickCanonico.trim(),
    createdAt: now,
    updatedAt: now,
  };

  const existing = await db.aliases.get(id);
  if (existing) {
    row.createdAt = existing.createdAt;
  }

  await db.aliases.put(row);
  return row;
}
