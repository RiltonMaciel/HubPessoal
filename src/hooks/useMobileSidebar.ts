"use client";

import { useAppStore } from "@/store/appStore";

export function useMobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return {
    sidebarOpen,
    openSidebar: () => setSidebarOpen(true),
    closeSidebar: () => setSidebarOpen(false),
    toggleSidebar: () => setSidebarOpen(!sidebarOpen),
  };
}
