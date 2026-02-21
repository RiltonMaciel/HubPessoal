import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { WatchlistRecord } from "@/lib/types";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export async function addWatchlist(kind: WatchlistRecord["kind"], value: string) {
  const normalized = normalize(value);
  if (!normalized) return null;

  const exists = await db.watchlist
    .where("value")
    .equals(normalized)
    .and((item) => item.kind === kind)
    .first();

  if (exists) return exists;

  const row: WatchlistRecord = {
    id: uuidv4(),
    kind,
    value: normalized,
    createdAt: new Date().toISOString(),
  };

  await db.watchlist.put(row);
  return row;
}

export async function removeWatchlist(id: string) {
  await db.watchlist.delete(id);
}

export async function listWatchlist() {
  return db.watchlist.orderBy("createdAt").reverse().toArray();
}

export function inWatchlist(kind: WatchlistRecord["kind"], value: string, rows: WatchlistRecord[]) {
  const normalized = normalize(value);
  return rows.some((item) => item.kind === kind && item.value === normalized);
}
