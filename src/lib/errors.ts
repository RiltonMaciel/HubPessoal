export function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const msg = error.message?.trim();
    if (msg) return msg;
  }

  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

export function reportError(error: unknown, context: string, extra?: Record<string, unknown>) {
  // Offline-first: por enquanto, só consolida em console.
  // Se quiser, dá para persistir em IndexedDB depois.
  try {
    console.error(`[HubPessoal] ${context}`, { error, ...(extra ? { extra } : {}) });
  } catch {
    // ignore
  }
}
