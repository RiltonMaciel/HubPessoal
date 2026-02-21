"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { NoteRecord, NoteType } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";

const noteTypes: NoteType[] = ["Anotação", "Objetivo", "Ideia", "Checklist"];

export default function NotesPage() {
  const router = useRouter();
  const [urlQuery, setUrlQuery] = useState("");
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [type, setType] = useState<NoteType>("Anotação");
  const [filterType, setFilterType] = useState<"all" | NoteType>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [textFilter, setTextFilter] = useState("");

  const reload = async () => setNotes(await db.notes.orderBy("updatedAt").reverse().toArray());

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setUrlQuery((params.get("q") ?? "").trim());
  }, []);

  useEffect(() => {
    setTextFilter(urlQuery);
  }, [urlQuery]);

  const applyTextFilterToUrl = (next: string) => {
    const value = next.trim();
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (!value) params.delete("q");
    else params.set("q", value);
    const qs = params.toString();
    router.replace(qs ? `/notes?${qs}` : "/notes");
  };

  const save = async () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    await db.notes.add({
      id: uuidv4(),
      title,
      content,
      tags: tags.split(",").map((item) => item.trim()).filter(Boolean),
      type,
      pinned: false,
      done: false,
      createdAt: now,
      updatedAt: now,
    });
    setTitle("");
    setContent("");
    setTags("");
    setType("Anotação");
    await reload();
  };

  const list = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return notes.filter((note) => {
      if (filterType !== "all" && note.type !== filterType) return false;
      if (selectedTag !== "all" && !note.tags.includes(selectedTag)) return false;
      if (q) {
        const hay = `${note.title}\n${note.content}\n${note.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notes, filterType, selectedTag, textFilter]);

  const tagsList = useMemo(() => ["all", ...new Set(notes.flatMap((item) => item.tags))], [notes]);

  const remove = async (id: string) => {
    if (!window.confirm("Confirma exclusão da nota?")) return;
    await db.notes.delete(id);
    await reload();
  };

  const togglePin = async (note: NoteRecord) => {
    await db.notes.update(note.id, { pinned: !note.pinned, updatedAt: new Date().toISOString() });
    await reload();
  };

  return (
    <section className="pageGrid">
      <Card className="col-3">
        <CardHeader>
          <div><h3>Filtros</h3><small>Tipo e tags</small></div>
        </CardHeader>
        <CardBody>
          <div className="list">
            <input
              className="select"
              placeholder="Buscar (título, conteúdo, tags)"
              value={textFilter}
              onChange={(event) => setTextFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyTextFilterToUrl(textFilter);
                if (event.key === "Escape") applyTextFilterToUrl("");
              }}
            />
            <Select value={filterType} onChange={(event) => setFilterType(event.target.value as "all" | NoteType)}>
              <option value="all">Todos os tipos</option>
              {noteTypes.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            <Select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
              {tagsList.map((tag) => <option key={tag} value={tag}>{tag === "all" ? "Todas as tags" : `#${tag}`}</option>)}
            </Select>
            <div className="chips">
              <Badge>Fixadas: {notes.filter((item) => item.pinned).length}</Badge>
              <Badge>Total: {notes.length}</Badge>
              {urlQuery ? <Badge tone="good">Busca: {urlQuery}</Badge> : null}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="col-6">
        <CardHeader>
          <div><h3>Notas</h3><small>Lista principal</small></div>
        </CardHeader>
        <CardBody>
          {!list.length && <EmptyState title="Sem notas" subtitle="Crie uma nota no editor." />}
          <div className="list">
            {list.map((note) => (
              <div className="row" key={note.id}>
                <div className="left">
                  <div className="avatar">{note.type.slice(0, 2).toUpperCase()}</div>
                  <div className="nick">
                    <b>{note.title}</b>
                    <small>{note.content || "Sem descrição"}</small>
                  </div>
                </div>
                <div className="metric">
                  <b>{note.pinned ? <Badge tone="good">Fixada</Badge> : <Badge>{note.type}</Badge>}</b>
                  <small>
                    <button className="btn" onClick={() => void togglePin(note)}>{note.pinned ? "Desafixar" : "Fixar"}</button>
                    <button className="btn" onClick={() => void remove(note.id)}>Excluir</button>
                  </small>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="col-3">
        <CardHeader>
          <div><h3>Editor</h3><small>Criar/atualizar</small></div>
        </CardHeader>
        <CardBody>
          <div className="list">
            <input className="select" placeholder="Título" value={title} onChange={(event) => setTitle(event.target.value)} />
            <Select value={type} onChange={(event) => setType(event.target.value as NoteType)}>
              {noteTypes.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            <textarea className="select" rows={6} placeholder="Conteúdo" value={content} onChange={(event) => setContent(event.target.value)} />
            <input className="select" placeholder="Tags, separadas por vírgula" value={tags} onChange={(event) => setTags(event.target.value)} />
            <Button variant="primary" onClick={() => void save()}>Salvar</Button>
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
