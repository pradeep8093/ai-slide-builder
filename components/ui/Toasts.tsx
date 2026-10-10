"use client";

import { useEffect } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore, type Toast } from "@/lib/store/toastStore";

export const TOAST_DURATION_MS = 5000;
export const ERROR_TOAST_DURATION_MS = 8000;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.kind === "error" ? ERROR_TOAST_DURATION_MS : TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, dismiss]);

  const Icon = toast.kind === "error" ? XCircle : toast.kind === "success" ? CheckCircle2 : Info;
  const color = toast.kind === "error" ? "text-red-500" : toast.kind === "success" ? "text-emerald-500" : "text-sky-500";
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 shadow-lg"
    >
      <Icon size={18} className={`mt-px shrink-0 ${color}`} aria-hidden />
      <span className="flex-1">{toast.message}</span>
      <button type="button" onClick={() => dismiss(toast.id)} className="rounded p-0.5 text-neutral-400 hover:text-neutral-700" aria-label="Dismiss">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
