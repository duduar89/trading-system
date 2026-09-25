import { create } from 'zustand';
import { uid } from '../lib/id';

export type ToastTone = 'success' | 'error' | 'info' | 'ai';
export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** ms; 0 = no se cierra sola */
  duration: number;
}

interface UIState {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  dismissToast: (id: string) => void;
  /** Id del espacio de trabajo activo (espejo reactivo de db.getCurrentWorkspaceId). */
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
}

export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const id = uid();
    const toast: Toast = { duration: t.tone === 'error' ? 7000 : 4000, ...t, id };
    set({ toasts: [...get().toasts.slice(-4), toast] });
    if (toast.duration > 0) setTimeout(() => get().dismissToast(id), toast.duration);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  workspaceId: null,
  setWorkspaceId: (id) => set({ workspaceId: id }),
}));

/** Atajos para lanzar notificaciones desde cualquier parte (también fuera de React). */
export const toast = {
  success: (title: string, description?: string) => useUI.getState().pushToast({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useUI.getState().pushToast({ tone: 'error', title, description }),
  info: (title: string, description?: string) => useUI.getState().pushToast({ tone: 'info', title, description }),
  ai: (title: string, description?: string) => useUI.getState().pushToast({ tone: 'ai', title, description }),
};

/** Mensaje de error legible a partir de cualquier excepción. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Error desconocido';
  }
}
