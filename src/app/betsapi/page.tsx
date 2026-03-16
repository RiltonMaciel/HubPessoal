"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { db } from "@/lib/db";
import { parseRawTextMatches } from "@/lib/excel";
import type { MatchRecord } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table } from "@/components/ui/Table";

/* ─────────────── Types ─────────────── */

type ExportResponse = {
  ok: boolean;
  total: number;
  pagesProcessed: number;
  emptyPages?: number;
  fetchErrors?: number;
  fileName: string;
  text: string;
  lines: string[];
};

type ParsedRow = {
  dateTime: string;
  sep: string;
  fixture: string;
  score: string;
  homeNick: string;
  awayNick: string;
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
};

type CollectionSnapshot = {
  id: string;
  url: string;
  collectedAt: string;
  total: number;
  pagesProcessed: number;
  text: string;
  lines: string[];
  newVsPrevious: number;
};

type QualityGate = {
  score: number;
  level: "ok" | "warn" | "critical";
  reasons: string[];
  sampleSize: number;
  uniquePairs: number;
  spanDays: number;
  avgGoals: number;
  bttsRate: number;
  duplicates: number;
};

type QuickStats = {
  totalMatches: number;
  avgGoals: number;
  bttsRate: number;
  overRates: Record<string, number>;
  topScorelines: Array<{ scoreline: string; count: number; pct: number }>;
  topPlayers: Array<{ nick: string; games: number; gf: number; ga: number; winRate: number }>;
  noHistoryPlayers: string[];
};

/* ─────────────── Constants ─────────────── */

const DEFAULT_URL = "https://betsapi.com/le/37298/Esoccer-H2H-GG-League--8-mins-play";
const BETSAPI_LAST_COMPETITION_URL_KEY = "hubpessoal-betsapi-last-competition-url-v1";
const BETSAPI_CLEARANCE_VALUE_KEY = "hubpessoal-betsapi-cf-clearance-v1";
const BETSAPI_COOKIE_FULL_KEY = "hubpessoal-betsapi-cookie-full-v1";
const BETSAPI_COOKIE_SHARED_KEY = "hubpessoal-betsapi-cookie-v1";
const BETSAPI_SAVED_COMPETITIONS_KEY = "hubpessoal-betsapi-saved-competitions-v1";
const BETSAPI_HISTORY_KEY = "hubpessoal-betsapi-collection-history-v1";
const MAX_HISTORY_SNAPSHOTS = 10;

const INPUT_STYLE: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,.1)",
  background: "rgba(255,255,255,.03)",
  color: "var(--text)",
  padding: "10px 12px",
  fontSize: 12,
};

/* ─────────────── Helpers ─────────────── */

function normalizeText(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeCompetitionUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}

function formatCompetitionLabel(value: string) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/+$/, "");
    const short = `${parsed.host}${path}`;
    return short.length > 52 ? `${short.slice(0, 49)}...` : short;
  } catch {
    return value.length > 52 ? `${value.slice(0, 49)}...` : value;
  }
}

function sanitizeCookieHeader(value: string) {
  const cleaned = value
    .trim()
    .replace(/^cookie\s*:\s*/i, "")
    .replace(/[\r\n]+/g, " ")
    .trim();

  if (!cleaned) return "";

  const ignored = new Set([
    "path", "domain", "expires", "max-age", "secure",
    "httponly", "samesite", "priority", "partitioned", "version",
  ]);

  const parts = cleaned
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) return null;
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      if (!key || !val) return null;
      if (ignored.has(key.toLowerCase())) return null;
      return `${key}=${val}`;
    })
    .filter((item): item is string => Boolean(item));

  return parts.join("; ");
}

function extractCfClearanceValue(raw: string) {
  const cleaned = raw.trim().replace(/^cookie\s*:\s*/i, "");
  if (!cleaned) return "";
  const match = cleaned.match(/(?:^|[;\s])cf_clearance\s*=\s*([^;\s]+)/i);
  if (match?.[1]) return match[1].trim();
  if (!/[;=\s]/.test(cleaned)) return cleaned;
  return "";
}

function buildCookieHeaderFromClearance(value: string) {
  const token = extractCfClearanceValue(value);
  if (!token) return undefined;
  return `cf_clearance=${token}`;
}

function buildCookieHeader(clearanceValue: string, cookieFull: string) {
  const full = sanitizeCookieHeader(cookieFull);
  if (full) return full;
  return buildCookieHeaderFromClearance(clearanceValue);
}

function parseEnrichedLine(line: string): ParsedRow {
  const [dateTime = "", sep = "", fixture = "", score = ""] = line.split("\t");
  const fixtureMatch = fixture.match(/(.+?)\s+v\s+(.+)/i);
  const homeNick = fixtureMatch?.[1]?.trim() ?? "";
  const awayNick = fixtureMatch?.[2]?.trim() ?? "";
  const scoreParts = score.match(/^(\d+)\s*-\s*(\d+)$/);
  const homeGoals = scoreParts ? Number(scoreParts[1]) : 0;
  const awayGoals = scoreParts ? Number(scoreParts[2]) : 0;
  return {
    dateTime, sep, fixture, score,
    homeNick, awayNick, homeGoals, awayGoals,
    totalGoals: homeGoals + awayGoals,
  };
}

/* ─────────────── Quality Gate ─────────────── */

function evaluateCollectionQuality(rows: ParsedRow[]): QualityGate {
  const sampleSize = rows.length;
  const reasons: string[] = [];
  let score = 100;

  const pairSet = new Set<string>();
  const pairCounts = new Map<string, number>();
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let totalGoalsSum = 0;
  let bttsCount = 0;
  let duplicateCount = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const key = `${row.dateTime}|${row.fixture}|${row.score}`;
    if (seen.has(key)) { duplicateCount++; continue; }
    seen.add(key);

    const pair = [normalizeText(row.homeNick), normalizeText(row.awayNick)].sort().join("|");
    pairSet.add(pair);
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    totalGoalsSum += row.totalGoals;
    if (row.homeGoals > 0 && row.awayGoals > 0) bttsCount++;

    const ts = new Date(row.dateTime).getTime();
    if (!Number.isNaN(ts)) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
    }
  }

  const uniquePairs = pairSet.size;
  const avgGoals = sampleSize > 0 ? totalGoalsSum / sampleSize : 0;
  const bttsRate = sampleSize > 0 ? bttsCount / sampleSize : 0;
  const spanDays = Number.isFinite(minTs) && Number.isFinite(maxTs)
    ? Math.max(0, (maxTs - minTs) / (1000 * 60 * 60 * 24)) : 0;

  const maxPairCount = [...pairCounts.values()].reduce((a, b) => Math.max(a, b), 0);
  const maxPairShare = sampleSize > 0 ? maxPairCount / sampleSize : 0;

  if (sampleSize < 40) {
    score -= 35;
    reasons.push(`Amostra insuficiente (${sampleSize} < 40 jogos).`);
  } else if (sampleSize < 80) {
    score -= 15;
    reasons.push("Amostra curta — maior variância esperada.");
  }

  if (uniquePairs <= 5 && sampleSize >= 40) {
    score -= 30;
    reasons.push(`Poucos confrontos únicos (${uniquePairs}).`);
  } else if (maxPairShare >= 0.5 && sampleSize >= 40) {
    score -= 25;
    reasons.push(`Confronto dominante: ${(maxPairShare * 100).toFixed(0)}% dos jogos.`);
  }

  if (spanDays < 7) {
    score -= 20;
    reasons.push("Janela temporal curta (< 7 dias). Risco de sobreajuste.");
  } else if (spanDays < 21) {
    score -= 10;
    reasons.push("Janela temporal curta (< 21 dias).");
  }

  if (duplicateCount > 0) {
    score -= Math.min(15, duplicateCount);
    reasons.push(`${duplicateCount} linhas duplicadas detectadas.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: QualityGate["level"] = score < 55 ? "critical" : score < 75 ? "warn" : "ok";

  return { score, level, reasons, sampleSize, uniquePairs, spanDays, avgGoals, bttsRate, duplicates: duplicateCount };
}

/* ─────────────── Quick Stats ─────────────── */

function computeQuickStats(rows: ParsedRow[], dbMatches: MatchRecord[]): QuickStats {
  const totalMatches = rows.length;
  if (!totalMatches) {
    return {
      totalMatches: 0, avgGoals: 0, bttsRate: 0,
      overRates: {}, topScorelines: [], topPlayers: [], noHistoryPlayers: [],
    };
  }

  let goalsSum = 0;
  let bttsCount = 0;
  const overCounts: Record<string, number> = {};
  const scorelineCounts = new Map<string, number>();
  const playerStats = new Map<string, { games: number; gf: number; ga: number; wins: number }>();

  const lines = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
  for (const line of lines) overCounts[line.toString()] = 0;

  for (const row of rows) {
    goalsSum += row.totalGoals;
    if (row.homeGoals > 0 && row.awayGoals > 0) bttsCount++;
    for (const line of lines) {
      if (row.totalGoals > line) overCounts[line.toString()]++;
    }

    const scoreline = `${row.homeGoals}-${row.awayGoals}`;
    scorelineCounts.set(scoreline, (scorelineCounts.get(scoreline) ?? 0) + 1);

    for (const side of ["home", "away"] as const) {
      const nick = side === "home" ? row.homeNick : row.awayNick;
      if (!nick) continue;
      const key = normalizeText(nick);
      const existing = playerStats.get(key) ?? { games: 0, gf: 0, ga: 0, wins: 0 };
      existing.games++;
      existing.gf += side === "home" ? row.homeGoals : row.awayGoals;
      existing.ga += side === "home" ? row.awayGoals : row.homeGoals;
      const gf = side === "home" ? row.homeGoals : row.awayGoals;
      const ga = side === "home" ? row.awayGoals : row.homeGoals;
      if (gf > ga) existing.wins++;
      playerStats.set(key, existing);
    }
  }

  const avgGoals = goalsSum / totalMatches;
  const bttsRate = bttsCount / totalMatches;

  const overRates: Record<string, number> = {};
  for (const line of lines) {
    overRates[line.toString()] = overCounts[line.toString()] / totalMatches;
  }

  const topScorelines = [...scorelineCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([scoreline, count]) => ({ scoreline, count, pct: count / totalMatches }));

  const topPlayers = [...playerStats.entries()]
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 10)
    .map(([nick, stats]) => ({
      nick,
      games: stats.games,
      gf: stats.gf / stats.games,
      ga: stats.ga / stats.games,
      winRate: stats.wins / stats.games,
    }));

  // Detectar jogadores sem histórico na base local (IndexedDB)
  const dbNicks = new Set<string>();
  for (const m of dbMatches) {
    dbNicks.add(normalizeText(m.homeNick));
    dbNicks.add(normalizeText(m.awayNick));
  }

  const collectedNicks = new Set<string>();
  for (const row of rows) {
    if (row.homeNick) collectedNicks.add(normalizeText(row.homeNick));
    if (row.awayNick) collectedNicks.add(normalizeText(row.awayNick));
  }

  const noHistoryPlayers = [...collectedNicks].filter((nick) => !dbNicks.has(nick)).sort();

  return { totalMatches, avgGoals, bttsRate, overRates, topScorelines, topPlayers, noHistoryPlayers };
}

/* ─────────────── Snapshot history ─────────────── */

function loadHistory(): CollectionSnapshot[] {
  try {
    const raw = window.localStorage.getItem(BETSAPI_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(snapshots: CollectionSnapshot[]) {
  try {
    window.localStorage.setItem(BETSAPI_HISTORY_KEY, JSON.stringify(snapshots.slice(0, MAX_HISTORY_SNAPSHOTS)));
  } catch { /* ignore */ }
}

function countNewLines(current: string[], previousLines: string[]): number {
  const prevSet = new Set(previousLines);
  return current.filter((line) => !prevSet.has(line)).length;
}

/* ─────────────── Component ─────────────── */

export default function BetsApiPage() {
  /* ── state: collection form ── */
  const [url, setUrl] = useState(DEFAULT_URL);
  const [maxPages, setMaxPages] = useState(5000);
  const [maxMatches, setMaxMatches] = useState(5000);
  const [savedCompetitions, setSavedCompetitions] = useState<string[]>([]);
  const [cfClearanceValue, setCfClearanceValue] = useState("");
  const [cookieFull, setCookieFull] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  /* ── state: new features ── */
  const [dbMatches, setDbMatches] = useState<MatchRecord[]>([]);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [importMessage, setImportMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState<"dateTime" | "fixture" | "score" | "totalGoals">("dateTime");
  const [sortAsc, setSortAsc] = useState(false);
  const [collectionHistory, setCollectionHistory] = useState<CollectionSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showStats, setShowStats] = useState(true);

  /* ── Load local DB matches for "no history" detection ── */
  useEffect(() => {
    db.matches.toArray().then(setDbMatches).catch(() => setDbMatches([]));
  }, []);

  /* ── Restore from localStorage ── */
  useEffect(() => {
    const savedClearance = window.localStorage.getItem(BETSAPI_CLEARANCE_VALUE_KEY);
    if (typeof savedClearance === "string") setCfClearanceValue(savedClearance);

    const savedCookie = window.localStorage.getItem(BETSAPI_COOKIE_FULL_KEY);
    if (typeof savedCookie === "string") setCookieFull(savedCookie);

    try {
      const raw = window.localStorage.getItem(BETSAPI_SAVED_COMPETITIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .filter((item) => typeof item === "string")
            .map((item) => normalizeCompetitionUrl(item))
            .filter(Boolean);
          setSavedCompetitions(Array.from(new Set(normalized)).slice(0, 30));
        }
      }
    } catch {
      window.localStorage.removeItem(BETSAPI_SAVED_COMPETITIONS_KEY);
    }

    setCollectionHistory(loadHistory());
    setStorageReady(true);
  }, []);

  /* ── Persist URL ── */
  useEffect(() => {
    try { window.localStorage.setItem(BETSAPI_LAST_COMPETITION_URL_KEY, url); } catch { /* */ }
  }, [url]);

  /* ── Persist cookie fields ── */
  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(BETSAPI_CLEARANCE_VALUE_KEY, cfClearanceValue);
  }, [cfClearanceValue, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(BETSAPI_COOKIE_FULL_KEY, cookieFull);
  }, [cookieFull, storageReady]);

  const sharedCookieHeader = useMemo(() => buildCookieHeader(cfClearanceValue, cookieFull), [cfClearanceValue, cookieFull]);

  useEffect(() => {
    if (!storageReady || !sharedCookieHeader) return;
    window.localStorage.setItem(BETSAPI_COOKIE_SHARED_KEY, sharedCookieHeader);
  }, [sharedCookieHeader, storageReady]);

  /* ── Competitions management ── */
  function persistSavedCompetitions(next: string[]) {
    setSavedCompetitions(next);
    try { window.localStorage.setItem(BETSAPI_SAVED_COMPETITIONS_KEY, JSON.stringify(next)); } catch { /* */ }
  }

  function addCurrentCompetition() {
    const normalized = normalizeCompetitionUrl(url);
    if (!normalized) return;
    const deduped = [
      normalized,
      ...savedCompetitions.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, 30);
    persistSavedCompetitions(deduped);
  }

  function removeCompetition(target: string) {
    persistSavedCompetitions(savedCompetitions.filter((item) => item !== target));
  }

  /* ── Parsed rows with enrichment ── */
  const previewRows = useMemo(() => {
    if (!result) return [];
    return result.lines.map(parseEnrichedLine);
  }, [result]);

  /* ── Filter & sort ── */
  const filteredRows = useMemo(() => {
    let rows = previewRows;

    if (searchTerm.trim()) {
      const term = normalizeText(searchTerm);
      rows = rows.filter((row) =>
        normalizeText(row.fixture).includes(term) ||
        normalizeText(row.dateTime).includes(term) ||
        normalizeText(row.score).includes(term)
      );
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "dateTime": cmp = a.dateTime.localeCompare(b.dateTime); break;
        case "fixture": cmp = a.fixture.localeCompare(b.fixture); break;
        case "score": cmp = a.score.localeCompare(b.score); break;
        case "totalGoals": cmp = a.totalGoals - b.totalGoals; break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return rows;
  }, [previewRows, searchTerm, sortColumn, sortAsc]);

  /* ── Quality gate ── */
  const qualityGate = useMemo(() => {
    if (!previewRows.length) return null;
    return evaluateCollectionQuality(previewRows);
  }, [previewRows]);

  /* ── Quick stats ── */
  const quickStats = useMemo(() => {
    if (!previewRows.length) return null;
    return computeQuickStats(previewRows, dbMatches);
  }, [previewRows, dbMatches]);

  /* ── Collection ── */
  async function runCollection() {
    setLoading(true);
    setError("");
    setCopyMessage("");
    setImportStatus("idle");
    setImportMessage("");

    try {
      const cookie = buildCookieHeader(cfClearanceValue, cookieFull);
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : undefined;
      const response = await fetch("/api/betsapi/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, maxPages, maxMatches, cookie, userAgent }),
      });

      const data = (await response.json()) as ExportResponse | { error: string };
      if (!response.ok) {
        setResult(null);
        setError("error" in data ? data.error : "Não foi possível coletar os jogos.");
        return;
      }

      const exportResult = data as ExportResponse;
      setResult(exportResult);

      // Save to history
      const prev = collectionHistory[0];
      const newLines = prev ? countNewLines(exportResult.lines, prev.lines) : exportResult.lines.length;
      const snapshot: CollectionSnapshot = {
        id: Date.now().toString(36),
        url,
        collectedAt: new Date().toISOString(),
        total: exportResult.total,
        pagesProcessed: exportResult.pagesProcessed,
        text: exportResult.text,
        lines: exportResult.lines,
        newVsPrevious: newLines,
      };
      const updatedHistory = [snapshot, ...collectionHistory].slice(0, MAX_HISTORY_SNAPSHOTS);
      setCollectionHistory(updatedHistory);
      saveHistory(updatedHistory);

      // Refresh DB matches after collection for noHistory detection
      db.matches.toArray().then(setDbMatches).catch(() => {});
    } catch {
      setResult(null);
      setError("Falha de rede ao consultar o BetsAPI.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Direct import to IndexedDB ── */
  const importDirectToDb = useCallback(async () => {
    if (!result) return;
    setImportStatus("loading");
    setImportMessage("");

    try {
      const parsed = parseRawTextMatches(result.text, {
        referenceYear: new Date().getFullYear(),
        league: "eSoccer",
      });

      if (!parsed.matches.length) {
        setImportStatus("error");
        setImportMessage("Nenhum jogo válido para importar.");
        return;
      }

      // Merge with existing (append, deduplicate by fingerprint)
      const existing = await db.matches.toArray();
      const existingKeys = new Set(
        existing.map((m) => `${m.dateTime}|${m.league}|${m.homeNick}|${m.awayNick}|${m.homeGoals}|${m.awayGoals}`)
      );

      const newMatches = parsed.matches.filter((m) => {
        const key = `${m.dateTime}|${m.league}|${m.homeNick}|${m.awayNick}|${m.homeGoals}|${m.awayGoals}`;
        return !existingKeys.has(key);
      });

      if (newMatches.length === 0) {
        setImportStatus("success");
        setImportMessage(`Todos os ${parsed.matches.length} jogos já existem na base local.`);
        return;
      }

      await db.matches.bulkAdd(newMatches);

      // Also ensure players table is up to date
      const existingPlayers = new Set((await db.players.toArray()).map((p) => p.nick));
      const newPlayers = parsed.players.filter((p) => !existingPlayers.has(p.nick));
      if (newPlayers.length) await db.players.bulkAdd(newPlayers);

      setImportStatus("success");
      setImportMessage(
        `${newMatches.length} jogos novos importados (${parsed.matches.length - newMatches.length} duplicados ignorados). Total na base: ${existing.length + newMatches.length}.`
      );

      // Refresh DB matches
      db.matches.toArray().then(setDbMatches).catch(() => {});
    } catch (err) {
      setImportStatus("error");
      setImportMessage(err instanceof Error ? err.message : "Erro ao importar para base local.");
    }
  }, [result]);

  /* ── Download / Copy ── */
  function downloadFile(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const fileUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(fileUrl);
  }

  function downloadTxt() {
    if (!result) return;
    downloadFile(result.text, result.fileName, "text/plain");
  }

  function downloadCsv() {
    if (!result) return;
    const header = "DateTime,Fixture,Score,HomeGoals,AwayGoals,TotalGoals\n";
    const csvRows = previewRows.map((r) =>
      `"${r.dateTime}","${r.fixture}","${r.score}",${r.homeGoals},${r.awayGoals},${r.totalGoals}`
    ).join("\n");
    downloadFile(header + csvRows, result.fileName.replace(".txt", ".csv"), "text/csv");
  }

  async function copyToClipboard() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopyMessage("Copiado para a área de transferência.");
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = result.text;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const copied = document.execCommand("copy");
      textArea.remove();
      setCopyMessage(copied ? "Copiado para a área de transferência." : "Não foi possível copiar automaticamente.");
    }
  }

  /* ── Sort handler ── */
  function handleSort(col: typeof sortColumn) {
    if (sortColumn === col) setSortAsc(!sortAsc);
    else { setSortColumn(col); setSortAsc(false); }
  }

  const sortIcon = (col: typeof sortColumn) =>
    sortColumn === col ? (sortAsc ? " ▲" : " ▼") : "";

  /* ── Restore history snapshot ── */
  function restoreSnapshot(snapshot: CollectionSnapshot) {
    setResult({
      ok: true,
      total: snapshot.total,
      pagesProcessed: snapshot.pagesProcessed,
      fileName: `betsapi-restore-${snapshot.id}.txt`,
      text: snapshot.text,
      lines: snapshot.lines,
    });
    setShowHistory(false);
  }

  /* ─────────────── Render ─────────────── */

  return (
    <div className="pageGrid">

      {/* ══════ CARD: Formulário de coleta ══════ */}
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Coletor BetsAPI (por limite de jogos)</h3>
            <small>Formato de saída: MM/DD HH:mm - Time A v Time B X-Y • histórico via aba Fixtures automático</small>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Badge tone="warn">Web scraping</Badge>
            {collectionHistory.length > 0 && (
              <span style={{ cursor: "pointer" }} onClick={() => setShowHistory(!showHistory)}>
                <Badge tone="good">
                  {showHistory ? "Fechar histórico" : `Histórico (${collectionHistory.length})`}
                </Badge>
              </span>
            )}
          </div>
        </CardHeader>

        <CardBody>
          {/* ── URL + limits ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 150px auto", gap: 10 }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL da liga"
              style={INPUT_STYLE}
            />
            <input
              type="number" min={1} max={5000} value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              style={INPUT_STYLE} placeholder="Max páginas"
            />
            <input
              type="number" min={1} max={5000} value={maxMatches}
              onChange={(e) => setMaxMatches(Number(e.target.value))}
              style={INPUT_STYLE} placeholder="Limite jogos"
            />
            <Button variant="primary" onClick={runCollection} disabled={loading}>
              {loading ? "Coletando..." : "Coletar jogos"}
            </Button>
          </div>

          {/* ── Saved competitions with remove ── */}
          <div className="chips" style={{ marginTop: 10 }}>
            <Button onClick={addCurrentCompetition} disabled={!normalizeCompetitionUrl(url)}>
              + Salvar competição
            </Button>
            {savedCompetitions.map((item) => (
              <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <Chip active={item === url} onClick={() => setUrl(item)}>
                  {formatCompetitionLabel(item)}
                </Chip>
                <span
                  onClick={() => removeCompetition(item)}
                  style={{
                    cursor: "pointer", color: "var(--muted)", fontSize: 11,
                    padding: "2px 4px", borderRadius: 4, lineHeight: 1,
                  }}
                  title="Remover competição"
                >
                  ✕
                </span>
              </span>
            ))}
          </div>

          {/* ── Cookie fields ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
            <input
              value={cfClearanceValue}
              onChange={(e) => setCfClearanceValue(e.target.value)}
              placeholder="Opcional: cole só o VALOR do cf_clearance (sem cf_clearance=)"
              style={INPUT_STYLE}
            />
            <Button onClick={runCollection} disabled={loading}>Usar cf_clearance</Button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
            <input
              value={cookieFull}
              onChange={(e) => setCookieFull(e.target.value)}
              placeholder="Opcional: cole o Cookie COMPLETO (cf_clearance=...; __cf_bm=...)"
              style={INPUT_STYLE}
            />
            <Button onClick={runCollection} disabled={loading}>Usar Cookie completo</Button>
          </div>

          {/* ── Info badges ── */}
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge>{`Limite: ${Math.min(5000, Math.max(1, maxMatches))} jogos`}</Badge>
            <Badge>{`Fallback: até ${Math.min(5000, Math.max(1, maxPages))} páginas`}</Badge>
            <Badge>URLs aceitas: /l/, /le/, /ls/</Badge>
            {result ? <Badge tone="good">{`${result.total} jogos`}</Badge> : null}
            {result ? <Badge>{`${result.pagesProcessed} páginas lidas`}</Badge> : null}
            {result && (result.emptyPages ?? 0) > 0 ? <Badge tone="warn">{`${result.emptyPages} págs vazias`}</Badge> : null}
            {result && (result.fetchErrors ?? 0) > 0 ? <Badge tone="bad">{`${result.fetchErrors} erros de fetch`}</Badge> : null}
          </div>

          {/* ── Error ── */}
          {error ? (
            <div style={{ marginTop: 12 }}>
              <Badge tone="bad">{error}</Badge>
            </div>
          ) : null}

          {/* ══════ Histórico de coletas ══════ */}
          {showHistory && collectionHistory.length > 0 && (
            <div style={{ marginTop: 14, border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 12 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Histórico de coletas (últimas {collectionHistory.length})</h4>
              <div style={{ overflowX: "auto" }}>
                <Table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>URL</th>
                      <th className="right">Jogos</th>
                      <th className="right">Páginas</th>
                      <th className="right">Novos</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectionHistory.map((snap) => (
                      <tr key={snap.id}>
                        <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                          {new Date(snap.collectedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td style={{ fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {formatCompetitionLabel(snap.url)}
                        </td>
                        <td className="right">{snap.total}</td>
                        <td className="right">{snap.pagesProcessed}</td>
                        <td className="right">
                          <Badge tone={snap.newVsPrevious > 0 ? "good" : undefined}>
                            +{snap.newVsPrevious}
                          </Badge>
                        </td>
                        <td>
                          <Button onClick={() => restoreSnapshot(snap)}>Restaurar</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          )}

          {/* ══════ Resultado da coleta ══════ */}
          {result ? (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>

              {/* ── Ações ── */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <small style={{ color: "var(--muted)" }}>
                  Exporte ou importe diretamente para o banco local.
                </small>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button onClick={copyToClipboard}>Copiar tudo</Button>
                  <Button onClick={downloadTxt}>Baixar TXT</Button>
                  <Button onClick={downloadCsv}>Baixar CSV</Button>
                  <Button
                    variant="primary"
                    onClick={importDirectToDb}
                    disabled={importStatus === "loading"}
                  >
                    {importStatus === "loading" ? "Importando..." : "Importar direto no DB"}
                  </Button>
                </div>
              </div>

              {/* ── Import feedback ── */}
              {importMessage && (
                <Badge tone={importStatus === "success" ? "good" : importStatus === "error" ? "bad" : undefined}>
                  {importMessage}
                </Badge>
              )}

              {copyMessage ? <Badge tone="good">{copyMessage}</Badge> : null}

              {/* ══════ AVISO: Jogadores sem histórico ══════ */}
              {quickStats && quickStats.noHistoryPlayers.length > 0 && (
                <div style={{
                  marginTop: 4,
                  padding: "10px 14px",
                  background: "rgba(255, 170, 0, .08)",
                  border: "1px solid rgba(255, 170, 0, .25)",
                  borderRadius: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 16 }}>⚠️</span>
                    <strong style={{ fontSize: 13, color: "var(--text)" }}>
                      {quickStats.noHistoryPlayers.length} jogador{quickStats.noHistoryPlayers.length > 1 ? "es" : ""} sem histórico na base local
                    </strong>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 6px" }}>
                    Esses jogadores apareceram na coleta mas não existem no IndexedDB. Análises de predição para eles terão dados insuficientes. Importe os jogos para a base ou cole mais dados na importação.
                  </p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {quickStats.noHistoryPlayers.map((nick) => (
                      <Badge key={nick} tone="warn">{nick}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* ══════ Quality Gate ══════ */}
              {qualityGate && (
                <div style={{
                  padding: "10px 14px",
                  background: qualityGate.level === "critical"
                    ? "rgba(255,60,60,.06)"
                    : qualityGate.level === "warn"
                      ? "rgba(255,170,0,.06)"
                      : "rgba(0,200,100,.06)",
                  border: `1px solid ${qualityGate.level === "critical" ? "rgba(255,60,60,.2)" : qualityGate.level === "warn" ? "rgba(255,170,0,.2)" : "rgba(0,200,100,.2)"}`,
                  borderRadius: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <strong style={{ fontSize: 13 }}>
                      Quality Gate: {qualityGate.score}/100
                    </strong>
                    <Badge tone={qualityGate.level === "ok" ? "good" : qualityGate.level === "warn" ? "warn" : "bad"}>
                      {qualityGate.level === "ok" ? "OK" : qualityGate.level === "warn" ? "Atenção" : "Crítico"}
                    </Badge>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
                    <span>Jogos: {qualityGate.sampleSize}</span>
                    <span>Confrontos únicos: {qualityGate.uniquePairs}</span>
                    <span>Janela: {qualityGate.spanDays.toFixed(0)} dias</span>
                    <span>Média gols: {qualityGate.avgGoals.toFixed(2)}</span>
                    <span>BTTS: {(qualityGate.bttsRate * 100).toFixed(1)}%</span>
                    {qualityGate.duplicates > 0 && <span>Duplicatas: {qualityGate.duplicates}</span>}
                  </div>
                  {qualityGate.reasons.length > 0 && (
                    <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 11, color: "var(--muted)" }}>
                      {qualityGate.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {/* ══════ Mini-Dashboard Estatísticas ══════ */}
              {quickStats && quickStats.totalMatches > 0 && (
                <div style={{
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 12,
                  padding: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: 13 }}>Estatísticas rápidas</h4>
                    <Button onClick={() => setShowStats(!showStats)}>
                      {showStats ? "Recolher" : "Expandir"}
                    </Button>
                  </div>

                  {showStats && (
                    <div style={{ display: "grid", gap: 12 }}>
                      {/* KPIs */}
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "8px 14px", minWidth: 90, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{quickStats.totalMatches}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>Jogos</div>
                        </div>
                        <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "8px 14px", minWidth: 90, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{quickStats.avgGoals.toFixed(2)}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>Média gols</div>
                        </div>
                        <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "8px 14px", minWidth: 90, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{(quickStats.bttsRate * 100).toFixed(1)}%</div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>BTTS</div>
                        </div>
                        {Object.entries(quickStats.overRates).map(([line, rate]) => (
                          <div key={line} style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "8px 14px", minWidth: 90, textAlign: "center" }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{(rate * 100).toFixed(1)}%</div>
                            <div style={{ fontSize: 10, color: "var(--muted)" }}>Over {line}</div>
                          </div>
                        ))}
                      </div>

                      {/* Top Scorelines + Top Players side by side */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        {/* Top Scorelines */}
                        <div>
                          <h5 style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>Placares mais frequentes</h5>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {quickStats.topScorelines.map((s) => (
                              <div key={s.scoreline} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                                <span style={{ fontWeight: 600, minWidth: 34 }}>{s.scoreline}</span>
                                <div style={{
                                  height: 6, borderRadius: 3,
                                  background: "var(--accent, #646cff)",
                                  width: `${Math.max(8, s.pct * 100 * 3)}%`,
                                  transition: "width .3s",
                                }} />
                                <span style={{ color: "var(--muted)", fontSize: 11 }}>
                                  {s.count}× ({(s.pct * 100).toFixed(1)}%)
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Top Players */}
                        <div>
                          <h5 style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>Top 10 jogadores (por frequência)</h5>
                          <div style={{ overflowX: "auto" }}>
                            <Table>
                              <thead>
                                <tr>
                                  <th>Nick</th>
                                  <th className="right">Jogos</th>
                                  <th className="right">GF/j</th>
                                  <th className="right">GA/j</th>
                                  <th className="right">Win%</th>
                                </tr>
                              </thead>
                              <tbody>
                                {quickStats.topPlayers.map((p) => (
                                  <tr key={p.nick}>
                                    <td style={{ fontSize: 11 }}>{p.nick}</td>
                                    <td className="right">{p.games}</td>
                                    <td className="right">{p.gf.toFixed(2)}</td>
                                    <td className="right">{p.ga.toFixed(2)}</td>
                                    <td className="right">{(p.winRate * 100).toFixed(1)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══════ Tabela de resultados com filtro/busca/sort ══════ */}
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar jogador, data, placar..."
                    style={{ ...INPUT_STYLE, flex: 1, maxWidth: 320 }}
                  />
                  <small style={{ color: "var(--muted)" }}>
                    {filteredRows.length} de {previewRows.length} jogos
                  </small>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <Table>
                    <thead>
                      <tr>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("dateTime")}>
                          Data/Hora{sortIcon("dateTime")}
                        </th>
                        <th className="right">-</th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("fixture")}>
                          Jogo{sortIcon("fixture")}
                        </th>
                        <th style={{ cursor: "pointer" }} className="right" onClick={() => handleSort("score")}>
                          Placar{sortIcon("score")}
                        </th>
                        <th style={{ cursor: "pointer" }} className="right" onClick={() => handleSort("totalGoals")}>
                          Gols{sortIcon("totalGoals")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((item, index) => {
                        const isNoHistory = quickStats?.noHistoryPlayers.some(
                          (nick) => nick === normalizeText(item.homeNick) || nick === normalizeText(item.awayNick)
                        );
                        return (
                          <tr
                            key={`${item.dateTime}-${item.fixture}-${index}`}
                            style={isNoHistory ? { background: "rgba(255,170,0,.04)" } : undefined}
                          >
                            <td>{item.dateTime}</td>
                            <td className="right">{item.sep}</td>
                            <td>
                              {item.fixture}
                              {isNoHistory && (
                                <span style={{ marginLeft: 6, fontSize: 10, color: "rgba(255,170,0,.8)" }} title="Jogador sem histórico no DB">⚠</span>
                              )}
                            </td>
                            <td className="right">{item.score}</td>
                            <td className="right">
                              <Badge tone={item.totalGoals >= 5 ? "good" : item.totalGoals <= 1 ? "bad" : undefined}>
                                {item.totalGoals}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <EmptyState title="Sem coleta" subtitle="Informe a URL, selecione o limite de páginas e clique em Coletar jogos." />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
