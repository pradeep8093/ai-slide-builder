import { create } from "zustand";
import { createId } from "../ids";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = createId();
    set((state) => {
      // Don't stack identical messages (e.g. pressing a disabled shortcut repeatedly).
      const others = state.toasts.filter((t) => t.message !== message);
      return { toasts: [...others, { id, kind, message }].slice(-MAX_TOASTS) };
    });
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().push("info", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
};
