"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
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

function parseLine(line: string) {
  const [dateTime = "", sep = "", fixture = "", score = ""] = line.split("\t");
  return { dateTime, sep, fixture, score };
}

export default function BetsApiPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [maxPages, setMaxPages] = useState(5000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  const previewRows = useMemo(() => {
    if (!result) return [];
    return result.lines.slice(0, 30).map(parseLine);
  }, [result]);

  async function runCollection() {
    setLoading(true);
    setError("");
    setCopyMessage("");

    try {
      const response = await fetch("/api/betsapi/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, maxPages }),
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
            <h3>Coletor BetsAPI (até 5000 páginas)</h3>
            <small>Formato de saída: MM/DD HH:mm - Time A v Time B X-Y • histórico via aba Fixtures automático</small>
          </div>
          <Badge tone="warn">Web scraping</Badge>
        </CardHeader>

        <CardBody>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 10 }}>
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

            <Button variant="primary" onClick={runCollection} disabled={loading}>
              {loading ? "Coletando..." : "Coletar jogos"}
            </Button>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge>{`Limite: ${Math.min(5000, Math.max(1, maxPages))} páginas`}</Badge>
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
