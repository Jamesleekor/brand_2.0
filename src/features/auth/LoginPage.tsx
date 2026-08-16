// =====================================================================
// B.R.A.N.D 2.0 — 로그인 페이지
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// 학생: 이름 + 학급 ID + 비밀번호 → 합성 이메일 자동 생성
// 교사: 실제 이메일 + 비밀번호
// 
// v4 디자인 톤 유지 (다크 + 골드 액센트)
// =====================================================================

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 메인 컴포넌트 — 학생/교사 탭 분기
// =====================================================================

type LoginMode = 'student' | 'teacher';

const TEACHER_ACCOUNTS = [
  { email: 'teacher@brand.local', label: '실제 교사 계정' },
  { email: 'brand-test-teacher@example.com', label: 'TEST TEACHER' },
] as const;
const TEACHER_ACCOUNT_STORAGE_KEY = 'brand_teacher_login_email';

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('student');
  const navigate = useNavigate();
  const location = useLocation();
  const { session, context, isInitialized, initialize } = useAuthStore();
  
  // 앱 시작 시 세션 복원
  useEffect(() => {
    initialize();
  }, [initialize]);
  
  // 이미 로그인된 경우 홈으로 리다이렉트
  useEffect(() => {
    if (isInitialized && session && context) {
      const requested = (location.state as any)?.from?.pathname as string | undefined;
      const destination = context.isTeacher
        ? (requested?.startsWith('/teacher') ? requested : '/teacher')
        : (requested && !requested.startsWith('/teacher') ? requested : '/home');
      navigate(destination, { replace: true });
    }
  }, [isInitialized, session, context, navigate, location]);
  
  // 초기화 중
  if (!isInitialized) {
    return <LoginLoadingScreen />;
  }
  
  return (
    <div className="app-container flex flex-col items-center justify-center px-6 py-8">
      {/* 배경 별 */}
      <BackgroundStars />
      
      {/* 로고 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-8 relative z-10"
      >
        <div className="text-5xl mb-3">🌟</div>
        <h1 className="font-display text-4xl text-brand-gradient tracking-tighter">
          B.R.A.N.D
        </h1>
        <p className="text-xs text-text-secondary mt-2 break-keep tracking-wider">
          경제로 시작해, 시민으로 성장하다
        </p>
      </motion.div>
      
      {/* 학생/교사 탭 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="flex gap-2 mb-5 bg-bg-card backdrop-blur-card border border-line rounded-pill p-1">
          <TabButton
            active={mode === 'student'}
            onClick={() => setMode('student')}
            icon="👨‍🎓"
            label="학생"
          />
          <TabButton
            active={mode === 'teacher'}
            onClick={() => setMode('teacher')}
            icon="👩‍🏫"
            label="선생님"
          />
        </div>
        
        {/* 폼 */}
        {mode === 'student' ? (
          <StudentLoginForm />
        ) : (
          <TeacherLoginForm />
        )}
      </motion.div>
      
      {/* 하단 푸터 */}
      <div className="mt-8 text-center text-2xs text-text-faded relative z-10">
        © 2026 B.R.A.N.D · 디지털 학급 사회
      </div>
    </div>
  );
}

// =====================================================================
// 학생 로그인 폼
// =====================================================================

function StudentLoginForm() {
  const [studentName, setStudentName] = useState('');
  const [classroomId, setClassroomId] = useState<number | ''>('');
  const [password, setPassword] = useState('');
  const { loginStudent, isLoading, error, clearError } = useAuthStore();
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    
    if (!studentName.trim() || !classroomId || !password) {
      return;
    }
    
    try {
      await loginStudent({
        studentName: studentName.trim(),
        classroomId: Number(classroomId),
        password,
      });
    } catch {
      // 에러는 store에서 처리됨
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
      <div>
        <label className="block text-xs font-bold text-text-secondary mb-2 tracking-wide">
          학급 번호
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={classroomId}
          onChange={(e) => setClassroomId(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="예: 4"
          className="login-input"
          required
          min={1}
          max={20}
        />
      </div>
      
      <div>
        <label className="block text-xs font-bold text-text-secondary mb-2 tracking-wide">
          이름
        </label>
        <input
          type="text"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          placeholder="예: 이태우"
          className="login-input"
          required
          maxLength={20}
        />
      </div>
      
      <div>
        <label className="block text-xs font-bold text-text-secondary mb-2 tracking-wide">
          비밀번호
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 입력"
          className="login-input"
          required
          autoComplete="current-password"
        />
      </div>
      
      {error && <ErrorMessage message={error} />}
      
      <LoginButton loading={isLoading} disabled={!studentName || !classroomId || !password}>
        로그인하기 🚀
      </LoginButton>
      
      <div className="text-center pt-2">
        <p className="text-2xs text-text-muted">
          비밀번호를 잊었나요? 선생님께 알려주세요
        </p>
      </div>
    </form>
  );
}

// =====================================================================
// 교사 로그인 폼
// =====================================================================

function TeacherLoginForm() {
  const [email, setEmail] = useState(()=>{const saved=window.localStorage.getItem(TEACHER_ACCOUNT_STORAGE_KEY);return TEACHER_ACCOUNTS.some(x=>x.email===saved)?saved!:TEACHER_ACCOUNTS[0].email;});
  const [password, setPassword] = useState('');
  const { loginTeacher, isLoading, error, clearError } = useAuthStore();
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    
    if (!email.trim() || !password) return;
    
    try {
      window.localStorage.setItem(TEACHER_ACCOUNT_STORAGE_KEY,email);
      await loginTeacher({ email, password });
    } catch {
      // 에러는 store에서 처리됨
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
      <div>
        <label className="block text-xs font-bold text-text-secondary mb-2 tracking-wide">
          교사 계정
        </label>
        <select
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="login-input"
          required
        >
          {TEACHER_ACCOUNTS.map(account=><option key={account.email} value={account.email}>{account.label} · {account.email}</option>)}
        </select>
      </div>
      
      <div>
        <label className="block text-xs font-bold text-text-secondary mb-2 tracking-wide">
          비밀번호
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 입력"
          className="login-input"
          required
          autoComplete="current-password"
        />
      </div>
      
      {error && <ErrorMessage message={error} />}
      
      <LoginButton loading={isLoading} disabled={!email || !password}>
        로그인
      </LoginButton>
    </form>
  );
}

// =====================================================================
// 보조 컴포넌트
// =====================================================================

function TabButton({ 
  active, onClick, icon, label 
}: { 
  active: boolean; onClick: () => void; icon: string; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-pill text-sm font-bold transition-all',
        active
          ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-md'
          : 'text-text-secondary hover:text-text-primary'
      )}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function LoginButton({ 
  loading, disabled, children 
}: { 
  loading: boolean; disabled: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className={cn(
        'w-full py-3.5 rounded-card-lg font-display text-base tracking-wider',
        'bg-gradient-to-r from-brand-primary to-gold text-white',
        'shadow-brand-md hover:shadow-brand-lg transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          확인 중...
        </span>
      ) : children}
    </button>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-danger-bg border border-danger/40 rounded-card-md px-4 py-2.5 flex items-start gap-2"
    >
      <span className="text-base">⚠️</span>
      <span className="text-xs text-text-primary font-bold flex-1 break-keep">
        {message}
      </span>
    </motion.div>
  );
}

function BackgroundStars() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 bg-white rounded-full animate-twinkle"
          style={{
            top: `${10 + (i * 11) % 80}%`,
            left: `${5 + (i * 13) % 90}%`,
            animationDelay: `${(i * 0.4) % 3}s`,
            boxShadow: '0 0 4px rgba(255,255,255,0.8)',
          }}
        />
      ))}
    </div>
  );
}

function LoginLoadingScreen() {
  return (
    <div className="app-container flex items-center justify-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        className="text-5xl"
      >
        ⭐
      </motion.div>
    </div>
  );
}

// =====================================================================
// 인라인 스타일 (login-input 클래스는 globals.css에 추가)
// =====================================================================
// .login-input {
//   @apply w-full px-4 py-3 bg-bg-deep border border-line-strong rounded-card-md
//          text-text-primary placeholder:text-text-muted text-sm font-bold
//          focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20
//          transition-all;
// }
