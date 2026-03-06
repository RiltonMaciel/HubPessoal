"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useAppStore } from "@/store/appStore";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/Button";

const PLAYERS_CACHE_KEY = "hubpessoal-topbar-players-cache-v1";

const routeTitles: Record<string, { crumbs: string; title: string }> = {
  "/dashboard": { crumbs: "Analytics / Dashboard", title: "Command Center" },
  "/import": { crumbs: "Analytics / Import", title: "Importador Excel" },
  "/aovivo": { crumbs: "Analytics / AoVivo", title: "Monitor Ao Vivo" },
  "/h2h": { crumbs: "Analytics / Confronto", title: "Head-to-Head" },
  "/monitor-h2h": { crumbs: "Analytics / Monitor", title: "Monitor H2H" },
  "/auditoria": { crumbs: "Analytics / Auditoria", title: "Audit Lab" },
  "/analise-jogos": { crumbs: "Analytics / Análise", title: "Análise por Texto" },
  "/notes": { crumbs: "Organização / Notas", title: "Knowledge Notes" },
  "/calendar": { crumbs: "Organização / Calendário", title: "Calendar Hub" },
  "/secure": { crumbs: "Privado / Secure", title: "Vault Gate" },
};

const quickRoutes = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Importar", href: "/import" },
  { label: "AoVivo", href: "/aovivo" },
  { label: "Confronto H2H", href: "/h2h" },
  { label: "Monitor H2H", href: "/monitor-h2h" },
  { label: "Auditoria", href: "/auditoria" },
  { label: "Análise Jogos", href: "/analise-jogos" },
  { label: "Notas", href: "/notes" },
  { label: "Calendário", href: "/calendar" },
  { label: "Secure", href: "/secure" },
];

function normalizeInline(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseCommand(raw: string) {
  const text = normalizeInline(raw);
  if (!text) return { kind: "empty" as const };

  if (text.startsWith("@")) {
    const nick = text.slice(1).trim();
    return nick ? { kind: "player" as const, nick } : { kind: "empty" as const };
  }

  const [headRaw = "", ...rest] = text.split(":");
  const head = headRaw.trim().toLowerCase();
  const tail = rest.join(":").trim();

  if (head === "player") {
    return tail ? { kind: "player" as const, nick: tail } : { kind: "empty" as const };
  }

  if (head === "league") {
    return tail ? { kind: "league" as const, league: tail } : { kind: "empty" as const };
  }

  if (head === "line") {
    const value = Number(tail);
    return Number.isFinite(value) ? { kind: "line" as const, line: value } : { kind: "unknown" as const };
  }

  if (head === "note" || head === "notes") {
    return tail ? { kind: "notes" as const, query: tail } : { kind: "notes" as const, query: "" };
  }

  return { kind: "palette" as const, query: text };
}

const quickActions = [
  { label: "Ação: Reimportar Excel", run: (router: ReturnType<typeof useRouter>) => router.push("/import") },
  { label: "Ação: Bloquear vault", run: () => useAppStore.getState().lockSecure() },
  { label: "Ação: Resetar filtros", run: () => useAppStore.getState().resetFilters() },
];

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);

  useHotkeys([
    {
      combo: "Ctrl+Shift+P",
      handler: () => setCommandPaletteOpen(true),
    },
    {
      combo: "Ctrl+K",
      handler: () => setCommandPaletteOpen(!commandPaletteOpen),
    },
  ]);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromCache = () => {
      try {
        const raw = window.localStorage.getItem(PLAYERS_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { players?: string[] };
        if (!Array.isArray(parsed.players) || !parsed.players.length) return;
        setPlayers(parsed.players.filter(Boolean));
      } catch {
        window.localStorage.removeItem(PLAYERS_CACHE_KEY);
      }
    };

    hydrateFromCache();

    void (async () => {
      const [homeNickKeys, awayNickKeys] = await Promise.all([
        db.matches.orderBy("homeNick").keys(),
        db.matches.orderBy("awayNick").keys(),
      ]);

      const nextPlayers = [...new Set([...homeNickKeys, ...awayNickKeys]
        .map((item) => String(item).trim())
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));

      if (cancelled) return;
      setPlayers(nextPlayers);
      window.localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify({ players: nextPlayers }));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const page = useMemo(() => {
    if (pathname.startsWith("/player/")) return { crumbs: "Analytics / Player", title: "Player Profile" };
    if (pathname.startsWith("/secure/")) return { crumbs: "Privado / Secure", title: "Vault Workspace" };
    return routeTitles[pathname] ?? { crumbs: "HubPessoal", title: "Command Center" };
  }, [pathname]);

  const filteredRoutes = quickRoutes.filter((item) => item.label.toLowerCase().includes(paletteQuery.toLowerCase()));
  const filteredActions = quickActions.filter((item) => item.label.toLowerCase().includes(paletteQuery.toLowerCase()));
  const filteredPlayers = players
    .filter((nick) => nick.toLowerCase().includes(paletteQuery.toLowerCase()))
    .slice(0, 6);

  const runTopSearch = () => {
    const cmd = parseCommand(query);
    if (cmd.kind === "empty") return;

    if (cmd.kind === "player") {
      setQuery("");
      router.push(`/player/${encodeURIComponent(cmd.nick)}`);
      return;
    }

    if (cmd.kind === "league") {
      useAppStore.getState().setLeague(cmd.league);
      setQuery("");
      router.push("/dashboard");
      return;
    }

    if (cmd.kind === "line") {
      useAppStore.getState().setLine(cmd.line);
      setQuery("");
      router.push("/dashboard");
      return;
    }

    if (cmd.kind === "notes") {
      setQuery("");
      const q = cmd.query ? `?q=${encodeURIComponent(cmd.query)}` : "";
      router.push(`/notes${q}`);
      return;
    }

    if (cmd.kind === "palette") {
      setCommandPaletteOpen(true);
      setPaletteQuery(cmd.query);
      setQuery("");
      return;
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <small>{page.crumbs}</small>
          <h2>{page.title}</h2>
        </div>

        <div className="search" title="Ctrl+K">
          🔎
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") runTopSearch();
            }}
            placeholder="@nick • league:eSoccer • line:6.5 • note:tag (Enter)"
            aria-label="Busca global"
          />
        </div>

        <div className="actions">
          <Button className="mobileMenuBtn" onClick={onOpenMenu} aria-label="Abrir menu">☰ Menu</Button>
          {pathname === "/dashboard" && (
            <>
              <Button onClick={() => router.push("/import")}>⬇️ Exportar</Button>
              <Button variant="primary" onClick={() => router.push("/import")}>⚡ Reimportar Excel</Button>
            </>
          )}
          <Button onClick={() => setCommandPaletteOpen(true)} aria-label="Abrir command palette">⌘K</Button>
        </div>
      </header>

      <div className={`palette ${commandPaletteOpen ? "open" : ""}`} onClick={() => setCommandPaletteOpen(false)}>
        <div className="palettePanel" onClick={(event) => event.stopPropagation()}>
          <input
            autoFocus
            placeholder="Digite rota ou nick..."
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.target.value)}
          />
          <div className="paletteList">
            {filteredRoutes.map((item) => (
              <div
                key={item.href}
                className="paletteItem"
                onClick={() => {
                  setCommandPaletteOpen(false);
                  router.push(item.href);
                }}
              >
                <span>{item.label}</span>
                <span className="mini">{item.href}</span>
              </div>
            ))}
            {filteredActions.map((action) => (
              <div
                key={action.label}
                className="paletteItem"
                onClick={() => {
                  setCommandPaletteOpen(false);
                  action.run(router);
                }}
              >
                <span>{action.label}</span>
                <span className="mini">ação</span>
              </div>
            ))}
            {filteredPlayers.map((nick) => (
              <div
                key={nick}
                className="paletteItem"
                onClick={() => {
                  setCommandPaletteOpen(false);
                  router.push(`/player/${encodeURIComponent(nick)}`);
                }}
              >
                <span>Jogador: {nick}</span>
                <span className="mini">/player/{nick}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
