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
