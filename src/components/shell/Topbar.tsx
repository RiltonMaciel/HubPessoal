"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useAppStore } from "@/store/appStore";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/Button";

const routeTitles: Record<string, { crumbs: string; title: string }> = {
  "/dashboard": { crumbs: "Analytics / Dashboard", title: "Command Center" },
  "/import": { crumbs: "Analytics / Import", title: "Importador Excel" },
  "/h2h": { crumbs: "Analytics / Confronto", title: "Head-to-Head" },
  "/notes": { crumbs: "Organização / Notas", title: "Knowledge Notes" },
  "/calendar": { crumbs: "Organização / Calendário", title: "Calendar Hub" },
  "/secure": { crumbs: "Privado / Secure", title: "Vault Gate" },
};

const quickRoutes = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Importar", href: "/import" },
  { label: "Confronto H2H", href: "/h2h" },
  { label: "Notas", href: "/notes" },
  { label: "Calendário", href: "/calendar" },
  { label: "Secure", href: "/secure" },
];

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
    void (async () => {
      const rows = await db.matches.toArray();
      const nicks = new Set<string>();
      rows.forEach((row) => {
        nicks.add(row.homeNick);
        nicks.add(row.awayNick);
      });
      setPlayers([...nicks]);
    })();
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
            placeholder="Buscar jogador (@nick) ou nota (note:tag)..."
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
