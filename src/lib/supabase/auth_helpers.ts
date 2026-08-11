// =====================================================================
// B.R.A.N.D 2.0 — Authentication TypeScript Helpers
// Stage 5 Sub-step 5-B · 생성일 2026-05-20
// =====================================================================
// Supabase Auth + 합성 이메일 로그인 flow.
// 
// 학생 로그인 흐름:
//   1. UI에서 학생이 이름 + 비밀번호 입력
//   2. generateSyntheticEmail() — 학급 ID 기반 합성 이메일
//   3. supabase.auth.signInWithPassword()
//   4. getCurrentUserContext() — 학생 정보 종합 조회
//   5. AuthContext에 저장 → 앱 전체 사용
// 
// 교사 로그인 흐름:
//   1. 실제 이메일 입력 (선생님 본인 이메일)
//   2. 동일하게 signInWithPassword()
//   3. classrooms.teacher_user_id로 학급 확인
// =====================================================================

import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';

// =====================================================================
// 1. Supabase 클라이언트 설정
// =====================================================================

/**
 * Supabase 클라이언트 싱글톤
 * 환경변수에서 URL과 anon key 로드
 */
export function createSupabaseClient(
  url: string,
  anonKey: string
): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      // 세션 자동 갱신 (JWT 만료 전)
      autoRefreshToken: true,
      // 브라우저 localStorage에 세션 저장
      persistSession: true,
      // 페이지 로드 시 세션 자동 감지
      detectSessionInUrl: true,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-application-name': 'brand-2.0',
      },
    },
  });
}

// =====================================================================
// 2. 합성 이메일 생성 (PostgreSQL 함수와 동일 로직)
// =====================================================================

/**
 * 학생 이름 + 학급 ID → 합성 이메일
 * 
 * 형식: <이름_소문자_언더스코어>@cls<학급ID>.brand.local
 * 예: '이태우' + 1 → '이태우@cls1.brand.local'
 */
export function generateSyntheticEmail(
  studentName: string,
  classroomId: number
): string {
  // 한글 → Unicode 코드포인트 hex 변환 (계정 생성 스크립트와 동일)
  // 예: 김나연 → ae40b098c5f0@cls1.brand.local
  const hex = Array.from(studentName.trim())
    .map((c) => c.codePointAt(0)!.toString(16).padStart(4, '0'))
    .join('');
  return `${hex}@cls${classroomId}.brand.local`;
}

// =====================================================================
// 3. 사용자 컨텍스트 타입 (DB의 get_current_user_context와 일치)
// =====================================================================

export interface UserContext {
  studentId: number | null;       // 교사 전용 계정은 NULL
  studentName: string | null;
  brandName: string | null;
  classroomId: number;
  classroomName: string;
  effectiveRole: 'STUDENT' | 'GUARD' | 'TEACHER' | 'ADMIN' | 'TEST';
  cachedTier: string | null;
  isTeacher: boolean;
  isGuard: boolean;
}

// =====================================================================
// 4. 학생 로그인
// =====================================================================

export interface StudentLoginParams {
  studentName: string;
  classroomId: number;
  password: string;
}

export interface LoginResult {
  session: Session;
  user: User;
  context: UserContext;
}

/**
 * 학생 로그인 — 합성 이메일 + 비밀번호
 * 
 * @throws Error 로그인 실패 시 (잘못된 비밀번호, 학생 없음 등)
 */
export async function loginStudent(
  supabase: SupabaseClient,
  params: StudentLoginParams
): Promise<LoginResult> {
  const email = generateSyntheticEmail(params.studentName, params.classroomId);
  
  // 1. Supabase Auth 로그인
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: params.password,
  });
  
  if (error) {
    throw new Error(`로그인 실패: ${error.message}`);
  }
  
  if (!data.session || !data.user) {
    throw new Error('세션을 받지 못했습니다');
  }
  
  // 2. 사용자 컨텍스트 종합 조회
  const context = await getCurrentUserContext(supabase);
  
  if (!context.studentId) {
    // 학생 레코드 없음 — 교사가 학생 합성 이메일로 로그인 시도한 경우
    throw new Error('학생 계정을 찾을 수 없습니다');
  }
  
  return { session: data.session, user: data.user, context };
}

// =====================================================================
// 5. 교사 로그인 (실제 이메일)
// =====================================================================

export interface TeacherLoginParams {
  email: string;
  password: string;
}

/**
 * 교사 로그인 — 실제 이메일 + 비밀번호
 * 학급의 teacher_user_id가 일치해야 함
 */
export async function loginTeacher(
  supabase: SupabaseClient,
  params: TeacherLoginParams
): Promise<LoginResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });
  
  if (error) {
    throw new Error(`로그인 실패: ${error.message}`);
  }
  
  if (!data.session || !data.user) {
    throw new Error('세션을 받지 못했습니다');
  }
  
  const context = await getCurrentUserContext(supabase);
  
  if (!context.isTeacher) {
    // 교사 권한 없음 — 잘못된 계정
    await supabase.auth.signOut();
    throw new Error('교사 권한이 없는 계정입니다');
  }
  
  return { session: data.session, user: data.user, context };
}

// =====================================================================
// 6. 현재 사용자 컨텍스트 조회
// =====================================================================

/**
 * 로그인 직후 또는 페이지 로드 시 호출
 * DB의 get_current_user_context() RPC 호출
 */
export async function getCurrentUserContext(
  supabase: SupabaseClient
): Promise<UserContext> {
  const { data, error } = await supabase
    .rpc('get_current_user_context');
  
  if (error) {
    throw new Error(`컨텍스트 조회 실패: ${error.message}`);
  }
  
  if (!data || data.length === 0) {
    throw new Error('사용자 정보를 찾을 수 없습니다');
  }
  
  // PostgreSQL TABLE 반환은 배열로 옴 — 첫 번째 row 사용
  const row = data[0];
  
  return {
    studentId: row.student_id,
    studentName: row.student_name,
    brandName: row.brand_name,
    classroomId: row.classroom_id,
    classroomName: row.classroom_name,
    effectiveRole: row.effective_role,
    cachedTier: row.cached_tier,
    isTeacher: row.is_teacher,
    isGuard: row.is_guard,
  };
}

// =====================================================================
// 7. 로그아웃
// =====================================================================

export async function logout(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(`로그아웃 실패: ${error.message}`);
  }
}

// =====================================================================
// 8. 세션 상태 모니터링 (React 등 프레임워크 통합)
// =====================================================================

/**
 * 세션 변경 구독 — 토큰 갱신·로그아웃 자동 감지
 * 
 * 사용 예 (React):
 *   useEffect(() => {
 *     const unsubscribe = onAuthStateChange(supabase, (session) => {
 *       if (session) {
 *         // 로그인 상태
 *       } else {
 *         // 로그아웃 상태
 *       }
 *     });
 *     return () => unsubscribe();
 *   }, []);
 */
export function onAuthStateChange(
  supabase: SupabaseClient,
  callback: (session: Session | null) => void
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session);
  });
  
  return () => data.subscription.unsubscribe();
}

/**
 * 현재 세션 즉시 조회
 */
export async function getCurrentSession(
  supabase: SupabaseClient
): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// =====================================================================
// 9. 비밀번호 변경
// =====================================================================

/**
 * 학생/교사 비밀번호 변경
 * 본인만 호출 가능 (현재 세션 기반)
 */
export async function changePassword(
  supabase: SupabaseClient,
  newPassword: string
): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  
  if (error) {
    throw new Error(`비밀번호 변경 실패: ${error.message}`);
  }
}

// =====================================================================
// 10. 신규 학생 가입 (마이그레이션 또는 추가 학생)
// =====================================================================

/**
 * 신규 학생 Auth 계정 생성
 * 주의: 보통 Stage 7 마이그레이션 또는 교사가 일괄 생성.
 * 일반 학생은 가입 화면 X (담임이 등록).
 * 
 * Service Role 키 필요 (Edge Function에서 실행 권장).
 */
export async function createStudentAccount(
  supabaseAdmin: SupabaseClient,  // Service Role 클라이언트
  params: {
    studentId: number;
    studentName: string;
    classroomId: number;
    initialPassword: string;
  }
): Promise<{ userId: string }> {
  const email = generateSyntheticEmail(params.studentName, params.classroomId);
  
  // 1. Auth 사용자 생성
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: params.initialPassword,
    email_confirm: true,  // 합성 이메일이므로 확인 절차 생략
    user_metadata: {
      student_id: params.studentId,    // 트리거가 자동으로 link
      student_name: params.studentName,
      classroom_id: params.classroomId,
    },
  });
  
  if (authError) {
    throw new Error(`Auth 계정 생성 실패: ${authError.message}`);
  }
  
  if (!authData.user) {
    throw new Error('User 데이터가 없습니다');
  }
  
  // 2. 학생-Auth 매핑 (트리거가 자동 처리하지만 안전망)
  const { error: linkError } = await supabaseAdmin.rpc('link_student_to_auth_user', {
    p_student_id: params.studentId,
    p_auth_user_id: authData.user.id,
  });
  
  if (linkError) {
    // 매핑 실패 시 Auth 계정 정리
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw new Error(`학생 매핑 실패: ${linkError.message}`);
  }
  
  return { userId: authData.user.id };
}

// =====================================================================
// 사용 예시 — React Hook 패턴
// =====================================================================
// 
// ```typescript
// // hooks/useAuth.ts
// import { useState, useEffect } from 'react';
// import { supabase } from '@/lib/supabase';
// import { 
//   loginStudent, 
//   logout, 
//   onAuthStateChange, 
//   getCurrentUserContext,
//   UserContext 
// } from '@/lib/auth';
// 
// export function useAuth() {
//   const [context, setContext] = useState<UserContext | null>(null);
//   const [loading, setLoading] = useState(true);
//   
//   useEffect(() => {
//     // 페이지 로드 시 세션 복원
//     getCurrentUserContext(supabase)
//       .then(setContext)
//       .catch(() => setContext(null))
//       .finally(() => setLoading(false));
//     
//     // 세션 변경 구독
//     const unsubscribe = onAuthStateChange(supabase, async (session) => {
//       if (session) {
//         const ctx = await getCurrentUserContext(supabase);
//         setContext(ctx);
//       } else {
//         setContext(null);
//       }
//     });
//     
//     return unsubscribe;
//   }, []);
//   
//   return { context, loading, logout: () => logout(supabase) };
// }
// 
// // 학생 로그인 화면
// const { context } = useAuth();
// 
// const handleLogin = async () => {
//   try {
//     await loginStudent(supabase, {
//       studentName: '이태우',
//       classroomId: 1,
//       password: 'mypassword'
//     });
//     // 자동으로 context 갱신됨 (onAuthStateChange)
//   } catch (e) {
//     showToast({ title: '로그인 실패', description: e.message });
//   }
// };
// ```
