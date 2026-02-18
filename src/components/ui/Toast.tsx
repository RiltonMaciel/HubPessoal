"use client";

import { useEffect, useState } from "react";

type ToastItem = { id: number; message: string };

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = (message: string) => {
    const id = Date.now();
    setToasts((current) => [...current, { id, message }]);
  };

  const remove = (id: number) => setToasts((current) => current.filter((item) => item.id !== id));

  return { toasts, push, remove };
}

export function Toast({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: number) => void }) {
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => onRemove(toasts[0].id), 2600);
    return () => clearTimeout(timer);
  }, [toasts, onRemove]);

  return (
    <div className="toastWrap" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
