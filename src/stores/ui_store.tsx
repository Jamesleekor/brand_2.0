// =====================================================================
// B.R.A.N.D 2.0 — UI 전역 상태 (Zustand)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 토스트·모달·테마 등 UI 상태.
// =====================================================================

import { create } from 'zustand';
import type { ToastConfig } from '@/components/shared/components';

// =====================================================================
// Toast 스토어
// =====================================================================

interface ToastState {
  toasts: ToastConfig[];
  show: (config: Omit<ToastConfig, 'id'>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  
  show: (config) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: ToastConfig = { ...config, id };
    
    set((state) => ({ toasts: [...state.toasts, toast] }));
    
    // 자동 닫힘
    const duration = config.duration ?? 3000;
    setTimeout(() => {
      get().dismiss(id);
    }, duration);
  },
  
  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
  
  clear: () => set({ toasts: [] }),
}));

// =====================================================================
// Toast 렌더링 컴포넌트 (App.tsx에 한 번만 마운트)
// =====================================================================

import { AnimatePresence } from 'framer-motion';
import { Toast } from '@/components/shared/components';

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1200] flex flex-col gap-2 w-[calc(100%-32px)] max-w-md pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast toast={toast} onClose={() => dismiss(toast.id)} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
