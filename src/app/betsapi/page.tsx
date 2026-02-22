"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table } from "@/components/ui/Table";

type ExportResponse = {
  ok: boolean;
  total: number;
  pagesProcessed: number;
  fileName: string;
  text: string;
  lines: string[];
};

const DEFAULT_URL = "https://betsapi.com/le/37298/Esoccer-H2H-GG-League--8-mins-play";
const BETSAPI_LAST_COMPETITION_URL_KEY = "hubpessoal-betsapi-last-competition-url-v1";
const BETSAPI_CLEARANCE_VALUE_KEY = "hubpessoal-betsapi-cf-clearance-v1";
const BETSAPI_COOKIE_FULL_KEY = "hubpessoal-betsapi-cookie-full-v1";
const BETSAPI_COOKIE_SHARED_KEY = "hubpessoal-betsapi-cookie-v1";
const BETSAPI_SAVED_COMPETITIONS_KEY = "hubpessoal-betsapi-saved-competitions-v1";

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

function buildCookieHeaderFromClearance(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/\bcf_clearance\s*=/.test(trimmed)) return trimmed;
  return `cf_clearance=${trimmed}`;
}

function buildCookieHeader(clearanceValue: string, cookieFull: string) {
  const full = cookieFull.trim();
  if (full) return full;
  return buildCookieHeaderFromClearance(clearanceValue);
}

function parseLine(line: string) {
  const [dateTime = "", sep = "", fixture = "", score = ""] = line.split("\t");
  return { dateTime, sep, fixture, score };
}

export default function BetsApiPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [maxPages, setMaxPages] = useState(5000);
  const [maxMatches, setMaxMatches] = useState(500);
  const [savedCompetitions, setSavedCompetitions] = useState<string[]>([]);
  const [cfClearanceValue, setCfClearanceValue] = useState("");
  const [cookieFull, setCookieFull] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

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

    setStorageReady(true);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BETSAPI_LAST_COMPETITION_URL_KEY, url);
    } catch {
      // ignore quota/privacy errors
    }
  }, [url]);

  function persistSavedCompetitions(next: string[]) {
    setSavedCompetitions(next);
    try {
      window.localStorage.setItem(BETSAPI_SAVED_COMPETITIONS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota/privacy errors
    }
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
    if (!storageReady) return;
    if (!sharedCookieHeader) return;
    window.localStorage.setItem(BETSAPI_COOKIE_SHARED_KEY, sharedCookieHeader);
  }, [sharedCookieHeader, storageReady]);

  const previewRows = useMemo(() => {
    if (!result) return [];
    return result.lines.slice(0, 30).map(parseLine);
  }, [result]);

  async function runCollection() {
    setLoading(true);
    setError("");
    setCopyMessage("");

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

      setResult(data as ExportResponse);
    } catch {
      setResult(null);
      setError("Falha de rede ao consultar o BetsAPI.");
    } finally {
      setLoading(false);
    }
  }


  function downloadTxt() {
    if (!result) return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const fileUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = result.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(fileUrl);
  }

  async function copyToClipboard() {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.text);
      setCopyMessage("Conteúdo copiado para a área de transferência.");
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

      if (copied) {
        setCopyMessage("Conteúdo copiado para a área de transferência.");
        return;
      }

      setCopyMessage("Não foi possível copiar automaticamente.");
    }
  }

  return (
    <div className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>Coletor BetsAPI (por limite de jogos)</h3>
            <small>Formato de saída: MM/DD HH:mm - Time A v Time B X-Y • histórico via aba Fixtures automático</small>
          </div>
          <Badge tone="warn">Web scraping</Badge>
        </CardHeader>

        <CardBody>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 150px auto", gap: 10 }}>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="URL da liga"
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
            />

            <input
              type="number"
              min={1}
              max={5000}
              value={maxPages}
              onChange={(event) => setMaxPages(Number(event.target.value))}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
            />

            <input
              type="number"
              min={1}
              max={5000}
              value={maxMatches}
              onChange={(event) => setMaxMatches(Number(event.target.value))}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
              placeholder="Limite jogos"
            />

            <Button variant="primary" onClick={runCollection} disabled={loading}>
              {loading ? "Coletando..." : "Coletar jogos"}
            </Button>
          </div>

          <div className="chips" style={{ marginTop: 10 }}>
            <Button onClick={addCurrentCompetition} disabled={!normalizeCompetitionUrl(url)}>
              Adicionar competição
            </Button>
            {savedCompetitions.map((item) => (
              <Chip key={item} active={item === url} onClick={() => setUrl(item)}>
                {formatCompetitionLabel(item)}
              </Chip>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
            <input
              value={cfClearanceValue}
              onChange={(event) => setCfClearanceValue(event.target.value)}
              placeholder="Opcional: cole só o VALOR do cf_clearance (sem cf_clearance=)"
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
            />
            <Button onClick={runCollection} disabled={loading}>
              Usar cf_clearance
            </Button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
            <input
              value={cookieFull}
              onChange={(event) => setCookieFull(event.target.value)}
              placeholder="Opcional: cole o Cookie COMPLETO (cf_clearance=...; __cf_bm=...)"
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(255,255,255,.03)",
                color: "var(--text)",
                padding: "10px 12px",
                fontSize: 12,
              }}
            />
            <Button onClick={runCollection} disabled={loading}>
              Usar Cookie completo
            </Button>
          </div>


          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge>{`Limite: ${Math.min(5000, Math.max(1, maxMatches))} jogos`}</Badge>
            <Badge>{`Fallback: até ${Math.min(5000, Math.max(1, maxPages))} páginas`}</Badge>
            <Badge>URLs aceitas: /l/, /le/, /ls/</Badge>
            {result ? <Badge tone="good">{`${result.total} jogos`}</Badge> : null}
            {result ? <Badge>{`${result.pagesProcessed} páginas lidas`}</Badge> : null}
          </div>

          {error ? (
            <div style={{ marginTop: 12 }}>
              <Badge tone="bad">{error}</Badge>
            </div>
          ) : null}

          {result ? (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <small style={{ color: "var(--muted)" }}>
                  Baixe o arquivo `.txt` e abra no Bloco de Notas.
                </small>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button onClick={copyToClipboard}>Copiar tudo</Button>
                  <Button onClick={downloadTxt}>Baixar TXT</Button>
                </div>
              </div>

              {copyMessage ? <Badge tone="good">{copyMessage}</Badge> : null}

              <div style={{ overflowX: "auto" }}>
                <Table>
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th className="right">-</th>
                      <th>Jogo</th>
                      <th className="right">Placar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((item, index) => (
                      <tr key={`${item.dateTime}-${item.fixture}-${index}`}>
                        <td>{item.dateTime}</td>
                        <td className="right">{item.sep}</td>
                        <td>{item.fixture}</td>
                        <td className="right">{item.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
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
