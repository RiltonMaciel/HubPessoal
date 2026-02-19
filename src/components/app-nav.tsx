"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const routes = [
  { href: "/import", label: "Importar" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/aovivo", label: "AoVivo" },
  { href: "/notes", label: "Notas" },
  { href: "/calendar", label: "Calendário" },
  { href: "/secure", label: "Confidencial" },
];

export function AppNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/dashboard" className="text-xl font-bold">
            HubPessoal
          </Link>
          <nav className="flex flex-wrap gap-2 text-sm">
            {routes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={`rounded-lg px-3 py-2 ${
                  pathname.startsWith(route.href)
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200"
                }`}
              >
                {route.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
