"use client";

import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { useMobileSidebar } from "@/hooks/useMobileSidebar";
import { useTheme } from "@/hooks/useTheme";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, openSidebar, closeSidebar } = useMobileSidebar();
  useTheme();

  return (
    <div className="appShell">
      <div className={`backdrop ${sidebarOpen ? "show" : ""}`} onClick={closeSidebar} />
      <Sidebar mobileOpen={sidebarOpen} />
      <main className="mainArea">
        <Topbar onOpenMenu={openSidebar} />
        {children}
      </main>
    </div>
  );
}
