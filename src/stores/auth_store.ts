// =====================================================================
// B.R.A.N.D 2.0 — 인증 전역 상태 (Zustand)
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// Stage 5-B의 auth_helpers를 React에서 사용하기 위한 전역 스토어.
//
// 사용:
//   const { context, isLoading, login, logout } = useAuthStore();
// =====================================================================

import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import {
  loginStudent as loginStudentApi,
  loginTeacher as loginTeacherApi,
  logout as logoutApi,
  getCurrentUserContext,
  onAuthStateChange,
  type UserContext,
  type StudentLoginParams,
  type TeacherLoginParams,
} from '@/lib/supabase/auth_helpers';
import { recordTrustedLoginEvent } from '@/lib/supabase/login_history';

// 실제 앱 접속은 인증 세션 생성과 별개다. persisted session 복원, 토큰 갱신,
// 탭 재진입도 해당 날짜의 실제 접속 증거가 되므로 별도 RPC로 기록한다.
let lastAppAccessSignalAt = 0;
let accessVisibilityListenerInstalled = false;

async function recordStudentAppAccess(source: string): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  // auth-state + initialize가 거의 동시에 발생할 수 있으므로 짧은 중복 호출을 억제한다.
  const now = Date.now();
  if (now - lastAppAccessSignalAt < 30_000) return;
  lastAppAccessSignalAt = now;

  try {
    const { error } = await supabase.rpc('record_app_access', {
      p_source: source,
      p_device_type: null,
      p_browser: null,
    });
    if (error) console.warn(`[app-access] ${source} 기록 실패`, error);
  } catch (error) {
    console.warn(`[app-access] ${source} 기록 중 예외`, error);
  }
}

function installAccessVisibilityListener(): void {
  if (accessVisibilityListenerInstalled || typeof document === 'undefined') return;
  accessVisibilityListenerInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const state = useAuthStore.getState();
    if (!state.context?.studentId || !state.session) return;
    void recordStudentAppAccess('APP_ACCESS');
  });
}

// =====================================================================
// State + Actions 타입
// =====================================================================

interface AuthState {
  // State
  session: Session | null;
  user: User | null;
  context: UserContext | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  loginStudent: (params: StudentLoginParams) => Promise<void>;
  loginTeacher: (params: TeacherLoginParams) => Promise<void>;
  logout: () => Promise<void>;
  refreshContext: () => Promise<void>;
  clearError: () => void;
}

// =====================================================================
// 스토어 생성
// =====================================================================

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  context: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  // ---------------------------------------------------------------
  // initialize — 앱 시작 시 한 번 호출 (세션 복원)
  // ---------------------------------------------------------------
  initialize: async () => {
    if (get().isInitialized) return;

    set({ isLoading: true });
    installAccessVisibilityListener();

    try {
      // 1. 저장된 세션 조회
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        // 2. 컨텍스트 조회
        try {
          const context = await getCurrentUserContext(supabase);
          set({
            session: data.session,
            user: data.session.user,
            context,
            isLoading: false,
            isInitialized: true,
            error: null,
          });

          // 비밀번호를 다시 입력하지 않은 persisted session 복원도 실제 접속이다.
          if (context.studentId) void recordStudentAppAccess('SESSION_RESTORE');
        } catch (e) {
          // 컨텍스트 조회 실패 → 세션 만료된 것으로 간주
          await supabase.auth.signOut();
          set({
            session: null,
            user: null,
            context: null,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        }
      } else {
        // 저장된 세션 없음
        set({
          isLoading: false,
          isInitialized: true,
        });
      }

      // 3. 세션 변경 자동 구독 (토큰 갱신·로그아웃 감지)
      onAuthStateChange(supabase, async (newSession) => {
        if (newSession) {
          try {
            const context = await getCurrentUserContext(supabase);
            set({
              session: newSession,
              user: newSession.user,
              context,
            });

            // 브라우저 전경에서 발생하는 토큰 갱신 등도 접속 증거로 기록한다.
            if (context.studentId) void recordStudentAppAccess('AUTH_STATE');
          } catch {
            // 컨텍스트 조회 실패
            set({
              session: null,
              user: null,
              context: null,
            });
          }
        } else {
          set({
            session: null,
            user: null,
            context: null,
          });
        }
      });
    } catch (e) {
      set({
        isLoading: false,
        isInitialized: true,
        error: e instanceof Error ? e.message : '초기화 실패',
      });
    }
  },

  // ---------------------------------------------------------------
  // 학생 로그인
  // ---------------------------------------------------------------
  loginStudent: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const result = await loginStudentApi(supabase, params);
      await recordTrustedLoginEvent(supabase, 'LOGIN_SUCCESS');
      await recordStudentAppAccess('EXPLICIT_LOGIN');
      set({
        session: result.session,
        user: result.user,
        context: result.context,
        isLoading: false,
        error: null,
      });
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : '로그인 실패',
      });
      throw e;
    }
  },

  // ---------------------------------------------------------------
  // 교사 로그인
  // ---------------------------------------------------------------
  loginTeacher: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const result = await loginTeacherApi(supabase, params);
      await recordTrustedLoginEvent(supabase, 'LOGIN_SUCCESS');
      set({
        session: result.session,
        user: result.user,
        context: result.context,
        isLoading: false,
        error: null,
      });
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : '로그인 실패',
      });
      throw e;
    }
  },

  // ---------------------------------------------------------------
  // 로그아웃
  // ---------------------------------------------------------------
  logout: async () => {
    set({ isLoading: true });

    try {
      // 세션이 사라지기 전에 best-effort로 로그아웃 이벤트를 남긴다.
      await recordTrustedLoginEvent(supabase, 'LOGOUT');
      await logoutApi(supabase);
      set({
        session: null,
        user: null,
        context: null,
        isLoading: false,
        error: null,
      });
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : '로그아웃 실패',
      });
    }
  },

  // ---------------------------------------------------------------
  // 컨텍스트 새로고침 (티어 변경 등 후)
  // ---------------------------------------------------------------
  refreshContext: async () => {
    if (!get().session) return;

    try {
      const context = await getCurrentUserContext(supabase);
      set({ context });
    } catch (e) {
      console.error('Context refresh failed:', e);
    }
  },

  // ---------------------------------------------------------------
  // 에러 초기화
  // ---------------------------------------------------------------
  clearError: () => set({ error: null }),
}));

// =====================================================================
// 편의 selectors
// =====================================================================

export const useIsAuthenticated = () => useAuthStore((s) => s.session !== null);
export const useCurrentStudent = () => {
  const context = useAuthStore((s) => s.context);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return context
    ? {
        ...context,
        userId,
      }
    : null;
};
export const useIsTeacher = () => useAuthStore((s) => s.context?.isTeacher ?? false);
export const useStudentId = () => useAuthStore((s) => s.context?.studentId ?? null);
export const useClassroomId = () => useAuthStore((s) => s.context?.classroomId ?? null);
