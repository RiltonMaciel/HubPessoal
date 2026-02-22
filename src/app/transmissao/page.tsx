"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { InfoHint } from "@/components/ui/InfoHint";

type LiveItem = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
};

const STORAGE_KEY = "hubpessoal-transmissao-lives-v1";

const DEFAULT_URLS = [
  "https://www.youtube.com/watch?v=sv-WY54W6ys",
  "https://www.youtube.com/watch?v=L_a2hq42stA",
  "https://www.youtube.com/watch?v=mmeKcKxiv2U",
  "https://www.youtube.com/watch?v=WzO3fM9F2uI",
  "https://www.youtube.com/watch?v=gTVGkCHMjR0",
];

function splitUrls(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const normalized = trimmed.replace(/\+/g, " ");
  const pieces = normalized
    .split(/\s+/g)
    .flatMap((chunk) => {
      if (!chunk.includes("https://")) return [chunk];
      const parts = chunk.split("https://").filter(Boolean);
      return parts.map((p) => `https://${p}`);
    })
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(pieces));
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? id : null;
    }

    if (host !== "youtube.com" && host !== "m.youtube.com") return null;

    const watchId = u.searchParams.get("v");
    if (watchId) return watchId;

    const match = u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)$/);
    if (match?.[2]) return match[2];

    return null;
  } catch {
    return null;
  }
}

function buildEmbedUrl(url: string): string | null {
  const id = extractYouTubeId(url);
  if (!id) return null;
  return `https://www.youtube.com/embed/${id}`;
}

function makeTitle(url: string): string {
  const id = extractYouTubeId(url);
  return id ? `YouTube • ${id}` : "YouTube";
}

function seedDefaultLives(): LiveItem[] {
  const now = new Date().toISOString();
  return DEFAULT_URLS.map((url) => ({
    id: `seed:${url}`,
    title: makeTitle(url),
    url,
    createdAt: now,
  }));
}

export default function TransmissaoPage() {
  const [lives, setLives] = useState<LiveItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [newUrls, setNewUrls] = useState("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seeded = seedDefaultLives();
        setLives(seeded);
        setActiveId(seeded[0]?.id ?? "");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("invalid storage");

      const sanitized: LiveItem[] = parsed
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const value = item as Partial<LiveItem>;
          if (!value.id || !value.url) return null;
          if (!buildEmbedUrl(value.url)) return null;
          return {
            id: String(value.id),
            title: String(value.title ?? makeTitle(String(value.url))),
            url: String(value.url),
            createdAt: String(value.createdAt ?? new Date().toISOString()),
          };
        })
        .filter((v): v is LiveItem => Boolean(v));

      const finalLives = sanitized.length ? sanitized : seedDefaultLives();
      setLives(finalLives);
      setActiveId(finalLives[0]?.id ?? "");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(finalLives));
    } catch {
      const seeded = seedDefaultLives();
      setLives(seeded);
      setActiveId(seeded[0]?.id ?? "");
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (!lives.length) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lives));
    } catch {
      // ignore
    }
  }, [lives]);

  const active = useMemo(() => lives.find((l) => l.id === activeId) ?? lives[0] ?? null, [lives, activeId]);
  const embedUrl = active ? buildEmbedUrl(active.url) : null;

  const help =
    "Página de transmissão: assista as lives do YouTube aqui dentro.\n\nComo usar:\n- Clique em um chip para trocar a live.\n- Clique em 'Adicionar live' e cole um ou mais links do YouTube (separados por espaço/linha).\n\nObs: os links ficam salvos no seu navegador (localStorage).";

  const addLives = () => {
    setError("");
    const urls = splitUrls(newUrls);
    if (!urls.length) {
      setError("Cole pelo menos 1 link do YouTube.");
      return;
    }

    const valid = urls.filter((url) => buildEmbedUrl(url));
    if (!valid.length) {
      setError("Não encontrei nenhum link do YouTube válido (watch?v=..., youtu.be/..., embed/...).");
      return;
    }

    const now = new Date().toISOString();
    const next: LiveItem[] = [];
    valid.forEach((url) => {
      const id = extractYouTubeId(url);
      const key = id ? `yt:${id}` : `url:${url}`;
      next.push({ id: key, title: makeTitle(url), url, createdAt: now });
    });

    setLives((prev) => {
      const existing = new Set(prev.map((p) => p.id));
      const merged = [...prev, ...next.filter((n) => !existing.has(n.id))];
      return merged;
    });

    if (!activeId) {
      const first = next[0];
      if (first) setActiveId(first.id);
    }

    setNewUrls("");
    setAdding(false);
  };

  return (
    <section className="pageGrid">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3>
              📺 Transmissão <InfoHint text={help} />
            </h3>
            <small>Player YouTube embutido + lista de lives</small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={() => setAdding((v) => !v)}>
              {adding ? "Fechar" : "Adicionar live"}
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {adding && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <small className="mini">Links do YouTube (1 ou vários)</small>
                <textarea
                  className="select"
                  value={newUrls}
                  onChange={(e) => setNewUrls(e.target.value)}
                  rows={3}
                  placeholder="Cole links do YouTube aqui..."
                />
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="primary" onClick={addLives}>
                  Salvar
                </Button>
                {error && <small style={{ color: "var(--danger)" }}>{error}</small>}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {lives.map((live) => (
              <Chip key={live.id} active={live.id === (active?.id ?? "")} onClick={() => setActiveId(live.id)}>
                {live.title}
              </Chip>
            ))}
          </div>

          {!active || !embedUrl ? (
            <div style={{ padding: 12 }}>
              <small>Nenhuma live selecionada.</small>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ display: "grid" }}>
                  <strong>{active.title}</strong>
                  <small className="mini">{active.url}</small>
                </div>
                <a className="btn" href={active.url} target="_blank" rel="noreferrer">
                  Abrir no YouTube
                </a>
              </div>

              <div style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 12, overflow: "hidden" }}>
                <iframe
                  title={active.title}
                  src={embedUrl}
                  style={{ width: "100%", height: "100%", border: 0 }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
