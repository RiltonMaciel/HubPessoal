"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { buildDashboardData } from "@/lib/analytics";
import { downloadTemplate, parseWorkbook, readWorkbook, validateWorkbook } from "@/lib/excel";
import type { ImportSummary } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const steps = ["Upload", "Validar", "Limpar", "Concluir"];

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const handleImport = async (file: File) => {
    setLoading(true);
    setMessage("");
    setStep(1);

    try {
      const workbook = await readWorkbook(file);
      setStep(2);
      const errors = validateWorkbook(workbook);
      if (errors.length) {
        setMessage(errors.join(" "));
        setLoading(false);
        return;
      }

      setStep(3);
      const parsed = parseWorkbook(workbook);
      const dashboardCache = buildDashboardData({
        matches: parsed.matches,
        league: "all",
        period: "all",
        recencyOn: true,
        line: 6.5,
        decisionMode: "conservador",
        recencyFactor: parsed.config.recencyFactor,
        shrinkK: parsed.config.shrinkK,
      });

      await db.transaction(
        "rw",
        [db.matches, db.upcoming, db.odds1x2, db.oddsOu, db.config, db.players, db.rawDatasets, db.computedCache],
        async () => {
          await db.matches.clear();
          await db.upcoming.clear();
          await db.odds1x2.clear();
          await db.oddsOu.clear();
          await db.config.clear();
          await db.players.clear();
          await db.rawDatasets.clear();

          await db.matches.bulkAdd(parsed.matches);
          if (parsed.upcoming.length) await db.upcoming.bulkAdd(parsed.upcoming);
          if (parsed.odds1x2.length) await db.odds1x2.bulkAdd(parsed.odds1x2);
          if (parsed.oddsOu.length) await db.oddsOu.bulkAdd(parsed.oddsOu);
          await db.config.add(parsed.config);
          if (parsed.players.length) await db.players.bulkAdd(parsed.players);

          await db.rawDatasets.add({
            id: "latest",
            ...parsed,
            importedAt: new Date().toISOString(),
          });

          await db.computedCache.put({
            key: "latest",
            importedAt: new Date().toISOString(),
            payload: dashboardCache,
          });
        }
      );

      setSummary(parsed.importSummary);
      setStep(4);
      setMessage(`Importação concluída. Jogos válidos: ${parsed.matches.length}.`);
      setTimeout(() => router.push("/dashboard"), 900);
    } catch {
      setMessage("Falha ao importar o arquivo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div><h3>Importar Excel (.xlsx)</h3><small>Schema V1 • Offline-first</small></div>
          <Button onClick={() => downloadTemplate()}>Baixar modelo Excel (.xlsx)</Button>
        </CardHeader>
        <CardBody>
          <div className="chips" style={{ marginBottom: 12 }}>
            {steps.map((item, index) => (
              <span key={item} className={`chip ${index + 1 <= step ? "active" : ""}`}>{index + 1}. {item}</span>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="btn primary" style={{ cursor: "pointer" }}>
              {loading ? "Processando..." : "Selecionar Arquivo"}
              <input
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                disabled={loading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImport(file);
                }}
              />
            </label>
            <Button onClick={() => router.push("/dashboard")}>Voltar ao dashboard</Button>
          </div>

          {message && <p style={{ marginTop: 12, color: "var(--muted)" }}>{message}</p>}
        </CardBody>
      </Card>

      {summary && (
        <Card className="col-12">
          <CardHeader>
            <div><h3>Import Summary</h3><small>Resultado da carga atual</small></div>
          </CardHeader>
          <CardBody>
            <div className="chips" style={{ marginBottom: 10 }}>
              <Badge>Linhas lidas: {summary.linesRead}</Badge>
              <Badge tone="good">Válidas: {summary.linesValid}</Badge>
              <Badge tone="warn">Removidas: {summary.linesRemoved}</Badge>
            </div>
            <p style={{ fontSize: 13, margin: 0, color: "var(--muted)" }}>Ligas detectadas: {summary.leaguesDetected.join(", ") || "-"}</p>
            <p style={{ fontSize: 13, marginBottom: 0, color: "var(--muted)" }}>
              Intervalo de datas: {summary.minDate ? new Date(summary.minDate).toLocaleString("pt-BR") : "-"} até {summary.maxDate ? new Date(summary.maxDate).toLocaleString("pt-BR") : "-"}
            </p>
          </CardBody>
        </Card>
      )}
    </section>
  );
}
