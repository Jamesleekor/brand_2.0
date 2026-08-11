// =====================================================================
// B.R.A.N.D 2.0 — 공통 UI 컴포넌트 + RPC Hook
// Stage 6-C · 생성일 2026-05-20
// =====================================================================

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils/cn';
import { getUserFriendlyError } from '@/lib/rpc/error_handler';
import type { RpcResult } from '@/lib/rpc/student_rpc';

// =====================================================================
// 1. Modal — 공통 모달 래퍼
// =====================================================================

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  emoji?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
}

export function Modal({ 
  isOpen, onClose, title, emoji, children, size = 'md' 
}: ModalProps) {
  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    full: 'max-w-[calc(100%-32px)] h-[calc(100dvh-32px)]',
  }[size];
  
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 py-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'w-full glass-card overflow-hidden flex flex-col max-h-[calc(100dvh-32px)]',
              sizeClass
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-line">
              <div className="flex items-center gap-2">
                {emoji && <span className="text-xl">{emoji}</span>}
                <h2 className="font-display text-lg text-brand-gradient tracking-tight">{title}</h2>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-bg-deep hover:bg-bg-soft flex items-center justify-center text-text-secondary hover:text-text-primary transition-all" aria-label="닫기">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// =====================================================================
// 2. PageHeader — 일반 페이지 상단 (뒤로가기 + 제목)
// =====================================================================

interface PageHeaderProps {
  title: string;
  emoji?: string;
  onBack?: () => void;
  right?: ReactNode;
  hideBack?: boolean;
}

export function PageHeader({ title, emoji, onBack, right, hideBack }: PageHeaderProps) {
  const navigate = useNavigate();
  // onBack이 없으면 기본으로 브라우저 뒤로가기 (모든 페이지 자동 적용)
  const handleBack = onBack ?? (() => navigate(-1));
  return (
    <div className="sticky top-0 z-30 bg-bg-base/95 backdrop-blur-card border-b border-line">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {!hideBack && (
            <button
              onClick={handleBack}
              className="w-9 h-9 rounded-card-md bg-bg-card border border-line flex items-center justify-center text-text-primary hover-lift"
              aria-label="뒤로"
            >
              ←
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            {emoji && <span className="text-xl">{emoji}</span>}
            <h1 className="font-display text-lg text-brand-gradient tracking-tight truncate">
              {title}
            </h1>
          </div>
        </div>
        {right && <div className="flex-shrink-0">{right}</div>}
      </div>
    </div>
  );
}

// =====================================================================
// 3. EmptyState — 빈 상태 표시
// =====================================================================

interface EmptyStateProps {
  emoji?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ emoji = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="text-5xl mb-3 opacity-60">{emoji}</div>
      <h3 className="font-display text-base text-text-primary mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-text-secondary break-keep max-w-xs mb-4">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

// =====================================================================
// 4. LoadingSpinner
// =====================================================================

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }[size];
  
  return (
    <div className={cn(
      'inline-block border-2 border-brand-primary border-t-transparent rounded-full animate-spin',
      sizeClass
    )} />
  );
}

export function LoadingPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center">
      <LoadingSpinner size="lg" />
      <p className="text-text-secondary text-sm mt-3">불러오는 중...</p>
    </div>
  );
}

// =====================================================================
// 5. Toast — 알림 토스트
// =====================================================================

export interface ToastConfig {
  id: string;
  title: string;
  description?: string;
  variant: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface ToastProps {
  toast: ToastConfig;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const variantClass = {
    success: 'border-success/40 bg-success-bg',
    error: 'border-danger/40 bg-danger-bg',
    info: 'border-bv/40 bg-bv/15',
    warning: 'border-warning/40 bg-warning-bg',
  }[toast.variant];
  
  const emoji = {
    success: '✅',
    error: '⚠️',
    info: 'ℹ️',
    warning: '⚠️',
  }[toast.variant];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={cn(
        'flex items-start gap-2.5 px-4 py-3 backdrop-blur-card border rounded-card-md shadow-card cursor-pointer',
        variantClass
      )}
      onClick={onClose}
    >
      <span className="text-base">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-text-primary">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-text-secondary mt-0.5">{toast.description}</p>
        )}
      </div>
    </motion.div>
  );
}

// =====================================================================
// 6. useRpcCall — RPC 호출 + 에러 핸들링 + 토스트
// =====================================================================
// Stage 5의 RpcResult 패턴을 React에서 쉽게 사용하기 위한 hook.

import { useToastStore } from '@/stores/ui_store';

export function useRpcCall() {
  const showToast = useToastStore((s) => s.show);
  const [isLoading, setIsLoading] = useState(false);
  
  /**
   * RPC 호출 + 자동 에러 처리
   * 
   * @example
   *   const { call, isLoading } = useRpcCall();
   *   
   *   const handleBuy = async () => {
   *     await call(
   *       () => studentRpc.purchaseSnack(supabase, { ... }),
   *       {
   *         successTitle: '구매 완료!',
   *         onSuccess: () => router.refresh(),
   *       }
   *     );
   *   };
   */
  async function call<T>(
    rpcFn: () => Promise<RpcResult<T>>,
    options: {
      successTitle?: string;
      successDescription?: string;
      onSuccess?: (data: T) => void;
      onError?: (error: string) => void;
      silent?: boolean;  // 토스트 표시 안 함
    } = {}
  ): Promise<T | null> {
    setIsLoading(true);
    
    try {
      const result = await rpcFn();
      
      if (result.success === true) {
        if (!options.silent && options.successTitle) {
          showToast({
            title: options.successTitle,
            description: options.successDescription,
            variant: 'success',
          });
        }
        options.onSuccess?.(result.data);
        return result.data;
      } else {
        // 에러 처리
        if (result.type === 'VALIDATION') {
          // 클라이언트 검증 실패
          showToast({
            title: '입력 오류',
            description: result.error,
            variant: 'warning',
          });
          options.onError?.(result.error);
        } else {
          // 서버 에러
          const userMsg = getUserFriendlyError({
            code: result.code,
            message: result.error,
          } as any);
          showToast({
            title: userMsg.title,
            description: userMsg.description,
            variant: 'error',
          });
          options.onError?.(userMsg.title);
        }
        return null;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      showToast({
        title: '오류 발생',
        description: msg,
        variant: 'error',
      });
      options.onError?.(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }
  
  return { call, isLoading };
}
