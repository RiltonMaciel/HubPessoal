"use client";

import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { decryptText, encryptText, packEncrypted, unpackEncrypted } from "@/lib/crypto";
import { useAppStore } from "@/store/appStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

type SecureNote = { id: string; title: string; body: string; updatedAt: string };

export default function SecretNotesPage() {
  const { secureUnlocked, secureKey } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [notes, setNotes] = useState<SecureNote[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const reload = useCallback(async () => {
    if (!secureUnlocked || !secureKey) return;
    const rows = await db.secureItems.where("area").equals("secret-notes").reverse().sortBy("updatedAt");
    const decrypted = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        title: await decryptText(secureKey, unpackEncrypted(row.titleEncrypted)),
        body: await decryptText(secureKey, unpackEncrypted(row.bodyEncrypted)),
        updatedAt: row.updatedAt,
      }))
    );
    setNotes(decrypted);
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
      area: "secret-notes",
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

  if (!secureUnlocked || !secureKey) return <div className="empty">Área bloqueada. Acesse /secure para desbloquear.</div>;

  return (
    <section className="pageGrid">
      <Card className="col-4">
        <CardHeader><div><h3>🔒 Secret Notes</h3><small>Anotações sensíveis</small></div><Badge tone="good">AES-GCM</Badge></CardHeader>
        <CardBody>
          <div className="list">
            <input className="select" placeholder="Título" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Título da nota secreta" />
            <textarea className="select" rows={8} placeholder="Conteúdo" value={body} onChange={(event) => setBody(event.target.value)} aria-label="Conteúdo da nota secreta" />
            <Button variant="primary" onClick={() => void save()}>Salvar criptografado</Button>
          </div>
        </CardBody>
      </Card>

      <Card className="col-8">
        <CardHeader><div><h3>Notas criptografadas</h3><small>{notes.length} itens</small></div></CardHeader>
        <CardBody>
          {isLoading && <><Skeleton /><div style={{ marginTop: 8 }}><Skeleton width="70%" /></div></>}
          {!isLoading && !notes.length && <EmptyState title="Sem notas secretas" subtitle="Use o editor para criar a primeira." />}
          <div className="list">
            {notes.map((note) => (
              <div key={note.id} className="row">
                <div className="left">
                  <div className="avatar">SN</div>
                  <div className="nick"><b>{note.title}</b><small>{new Date(note.updatedAt).toLocaleString("pt-BR")}</small></div>
                </div>
                <div className="metric"><b><Button onClick={() => void remove(note.id)}>Excluir</Button></b><small>{note.body.slice(0, 64)}{note.body.length > 64 ? "..." : ""}</small></div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
