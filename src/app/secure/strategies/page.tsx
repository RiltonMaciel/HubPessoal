"use client";

import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { decryptText, encryptText, packEncrypted, unpackEncrypted } from "@/lib/crypto";
import { useAppStore } from "@/store/appStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

type StrategyRow = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
};

export default function StrategiesPage() {
  const { secureUnlocked, secureKey } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [rows, setRows] = useState<StrategyRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const reload = useCallback(async () => {
    if (!secureUnlocked || !secureKey) return;
    const items = await db.secureItems.where("area").equals("strategies").reverse().sortBy("updatedAt");
    const decrypted = await Promise.all(
      items.map(async (item) => ({
        id: item.id,
        title: await decryptText(secureKey, unpackEncrypted(item.titleEncrypted)),
        body: await decryptText(secureKey, unpackEncrypted(item.bodyEncrypted)),
        updatedAt: item.updatedAt,
      }))
    );
    setRows(decrypted);
    setIsLoading(false);
  }, [secureUnlocked, secureKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (!secureKey || !title.trim()) return;
    const now = new Date().toISOString();
    await db.secureItems.put({
      id: uuidv4(),
      area: "strategies",
      titleEncrypted: packEncrypted(await encryptText(secureKey, title)),
      bodyEncrypted: packEncrypted(await encryptText(secureKey, body)),
      createdAt: now,
      updatedAt: now,
    });
    setTitle("");
    setBody("");
    await reload();
  };

  const remove = async (id: string) => {
    await db.secureItems.delete(id);
    await reload();
  };

  const exportExcel = () => {
    const data = rows.map((item) => ({ Title: item.title, Body: item.body, UpdatedAt: item.updatedAt }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "STRATEGIES");
    XLSX.writeFile(workbook, "secure-strategies.xlsx");
  };

  const importExcel = async (file: File) => {
    if (!secureKey) return;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });

    for (const row of data) {
      const titleValue = String(row.Title ?? "").trim();
      const bodyValue = String(row.Body ?? "");
      if (!titleValue) continue;
      const now = new Date().toISOString();
      await db.secureItems.put({
        id: uuidv4(),
        area: "strategies",
        titleEncrypted: packEncrypted(await encryptText(secureKey, titleValue)),
        bodyEncrypted: packEncrypted(await encryptText(secureKey, bodyValue)),
        createdAt: now,
        updatedAt: now,
      });
    }
    await reload();
  };

  if (!secureUnlocked || !secureKey) return <div className="empty">Área bloqueada. Acesse /secure para desbloquear.</div>;

  return (
    <section className="pageGrid">
      <Card className="col-4">
        <CardHeader><div><h3>🔒 Strategies</h3><small>Dados criptografados no client</small></div><Badge tone="good">Vault</Badge></CardHeader>
        <CardBody>
          <div className="list">
            <input className="select" placeholder="Título" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Título da estratégia" />
            <textarea className="select" rows={8} placeholder="Conteúdo" value={body} onChange={(event) => setBody(event.target.value)} aria-label="Conteúdo da estratégia" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Button variant="primary" onClick={() => void save()}>Salvar</Button>
              <Button onClick={exportExcel}>Exportar Excel</Button>
              <label className="btn" style={{ cursor: "pointer" }}>
                Importar Excel
                <input type="file" accept=".xlsx" hidden onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importExcel(file);
                }} />
              </label>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="col-8">
        <CardHeader><div><h3>Lista de Strategies</h3><small>{rows.length} itens</small></div></CardHeader>
        <CardBody>
          {isLoading && <><Skeleton /><div style={{ marginTop: 8 }}><Skeleton width="70%" /></div></>}
          {!isLoading && !rows.length && <EmptyState title="Sem strategies" subtitle="Adicione sua primeira estratégia." />}
          <div className="list">
            {rows.map((row) => (
              <div key={row.id} className="row">
                <div className="left">
                  <div className="avatar">ST</div>
                  <div className="nick"><b>{row.title}</b><small>{new Date(row.updatedAt).toLocaleString("pt-BR")}</small></div>
                </div>
                <div className="metric">
                  <b><Button onClick={() => void remove(row.id)}>Excluir</Button></b>
                  <small>{row.body.slice(0, 64)}{row.body.length > 64 ? "..." : ""}</small>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
