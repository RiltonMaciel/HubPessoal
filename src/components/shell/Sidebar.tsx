"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/store/appStore";

const links = [
  { section: "Analytics", items: [{ href: "/import", label: "📥 Importar" }, { href: "/dashboard", label: "📊 Dashboard" }, { href: "/h2h", label: "🤝 Confronto" }, { href: "/player/MJ", label: "👤 Player" }] },
  { section: "Organização", items: [{ href: "/notes", label: "📝 Notas" }, { href: "/calendar", label: "🗓️ Calendário" }] },
  { section: "Privado", items: [{ href: "/secure", label: "🔒 Secure" }] },
];

export function Sidebar({ mobileOpen }: { mobileOpen: boolean }) {
  const pathname = usePathname();
  const { toggleTheme } = useTheme();
  const meta = useAppStore((state) => state.currentDatasetMeta);

  return (
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`} id="app-sidebar">
      <div className="brand">
        <div className="logo" />
        <div>
          <h1>HubPessoal</h1>
          <span>Offline • PWA • IndexedDB</span>
        </div>
      </div>

      <nav className="nav" aria-label="Navegação principal">
        {links.map((section) => (
          <div key={section.section}>
            <div className="navSection">{section.section}</div>
            {section.items.map((item) => (
              (() => {
                const isPlayer = item.href.startsWith("/player/");
                const active = isPlayer ? pathname.startsWith("/player/") : pathname.startsWith(item.href);
                return (
              <Link
                key={item.href}
                href={item.href}
                className={`navLink ${active ? "active" : ""}`}
              >
                <span>{item.label}</span>
                <span className="pill">{item.href}</span>
              </Link>
                );
              })()
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebarFooter">
        <div className="footerRow">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="statusDot" />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Offline OK</div>
              <div className="mini">Dataset: {meta.datasetSizeLabel}</div>
            </div>
          </div>
          <button className="btn" onClick={toggleTheme} aria-label="Alternar tema">🌓</button>
        </div>
      </div>
    </aside>
  );
}
