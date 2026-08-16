import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import {
  testFixtureErrorMessage,
  testFixtureRpc,
  type TestFixtureAccountResult,
} from '@/lib/rpc/test_fixture_rpc';

const resetPhrase = 'TEST 초기화';

export default function TestClassroomFixturePage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const isTestTeacherAccount = currentUser?.user_metadata?.fixture_code === 'BRAND_TEST_V1'
    && currentUser?.user_metadata?.fixture_subject === 'TEST_TEACHER';
  const [password, setPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<TestFixtureAccountResult[] | null>(null);
  const [busyAction, setBusyAction] = useState<'reconcile' | 'reset' | 'password' | null>(null);

  const statusQuery = useQuery({
    queryKey: ['test-classroom-fixture-status'],
    queryFn: async () => {
      const result = await testFixtureRpc.getStatus(supabase);
      if (result.success === false) throw result;
      return result.data;
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['test-classroom-fixture-status'] });
  };

  const reconcile = async () => {
    if (isTestTeacherAccount) {
      setError('TEST 학급 만들기/다시 확인은 실제 운영 교사 계정에서만 실행할 수 있어요. 로그아웃 후 실제 교사 계정으로 다시 로그인해주세요.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusyAction('reconcile');
    const result = await testFixtureRpc.reconcile(supabase, { initialPassword: password });
    setBusyAction(null);
    if (result.success === false) {
      setError(testFixtureErrorMessage(result));
      return;
    }
    setAccounts(result.data.accounts);
    setPassword('');
    setNotice('TEST 학급과 6개 TEST 로그인 계정을 준비했고 비밀번호도 방금 입력한 값으로 맞췄습니다. 아래 계정으로 로그아웃 후 로그인해보세요.');
    await refresh();
  };

  const reset = async () => {
    if (resetConfirmation !== resetPhrase) {
      setError(`초기화하려면 확인 칸에 “${resetPhrase}”를 정확히 입력해주세요.`);
      return;
    }
    if (!window.confirm('B.R.A.N.D TEST의 Guild 1 세션, Guild 2, Guild 3, Arcade 기록을 모두 지우고 5명의 TEST 학생을 TEST GUILD 기본 소속으로 되돌릴까요? 실제 학급은 대상이 아닙니다.')) return;

    setError(null);
    setNotice(null);
    setBusyAction('reset');
    const result = await testFixtureRpc.reset(supabase);
    setBusyAction(null);
    if (result.success === false) {
      setError(testFixtureErrorMessage(result));
      return;
    }
    setResetConfirmation('');
    setNotice('TEST 활동 기록을 지우고 TEST01~05의 TEST GUILD 기본 소속을 다시 만들었습니다.');
    await refresh();
  };

  const resetPasswords = async () => {
    if (!window.confirm('TEST TEACHER와 TEST01~05의 비밀번호를 지금 입력한 값으로 모두 바꿀까요?')) return;
    setError(null);
    setNotice(null);
    setBusyAction('password');
    const result = await testFixtureRpc.resetPasswords(supabase, { newPassword: password });
    setBusyAction(null);
    if (result.success === false) {
      setError(testFixtureErrorMessage(result));
      return;
    }
    setAccounts(result.data.emails);
    setPassword('');
    setNotice('6개 TEST 계정의 비밀번호를 새 값으로 변경했습니다.');
  };

  const status = statusQuery.data;

  return (
    <TeacherShell>
      <div className="space-y-6">
        <header className="rounded-card-xl border border-brand-primary/40 bg-bg-card p-6">
          <p className="text-xs font-black tracking-[0.18em] text-brand-primary">TEST ONLY · 실제 학급과 분리</p>
          <h1 className="mt-2 font-display text-3xl text-brand-gradient">🧪 B.R.A.N.D TEST 운영</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-text-secondary">실제 학생 계정 대신 별도의 TEST TEACHER와 TEST01~05로 Guild·Mission·Arcade를 반복 검증하는 공간입니다. 이 화면의 초기화는 서버가 등록한 TEST 표식을 다시 확인하므로 실제 학급을 선택하거나 지울 수 없습니다.</p>
        </header>

        {error && <div className="rounded-card-lg border border-danger/50 bg-danger/10 p-4 text-sm font-bold text-danger">{error}</div>}
        {notice && <div className="rounded-card-lg border border-success/50 bg-success/10 p-4 text-sm font-bold text-success">{notice}</div>}
        {isTestTeacherAccount && <div className="rounded-card-lg border border-warning/50 bg-warning/10 p-4 text-sm font-bold text-warning">현재 TEST TEACHER로 로그인되어 있습니다. 이 계정에서는 TEST 학급 만들기/다시 확인을 실행할 수 없습니다. 실제 운영 교사 계정으로 로그인해 fixture를 관리하고, TEST TEACHER는 TEST 학급 기능 검증에 사용해주세요.</div>}

        {statusQuery.isLoading && <div className="py-16 text-center"><LoadingSpinner size="lg" /></div>}
        {statusQuery.isError && <div className="rounded-card-lg border border-danger/50 bg-danger/10 p-4 text-sm font-bold text-danger">TEST fixture 상태를 불러오지 못했어요. SQL migration이 적용되었는지 확인해주세요.</div>}

        {status && <section className="glass-card p-5">
          <h2 className="font-display text-xl text-white">현재 상태</h2>
          {!status.fixture_exists ? (
            <p className="mt-3 text-sm font-bold text-text-secondary">아직 TEST 학급이 준비되지 않았습니다. 아래에서 TEST 계정 비밀번호를 정한 뒤 “만들기”를 누르세요.</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatusCard label="학급" value={`${status.classroom_name} · 번호 ${status.classroom_id ?? '-'}`} />
              <StatusCard label="기본 길드" value={status.guild_name} />
              <StatusCard label="TEST 학생" value={`${status.test_student_count}명`} />
              <StatusCard label="인증 연결" value={`${status.linked_student_count} / 5명`} />
            </div>
          )}
          {status.fixture_exists && <p className="mt-4 text-xs font-bold text-text-muted">마지막 TEST 초기화: {status.last_reset_at ? new Date(status.last_reset_at).toLocaleString('ko-KR') : '아직 없음'}</p>}
        </section>}

        <section className="glass-card border-brand-primary/30 p-5">
          <h2 className="font-display text-xl text-white">1. TEST 계정 만들기 또는 확인</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">비밀번호는 이 화면에 저장되지 않습니다. “만들기/다시 확인”을 누를 때마다 TEST TEACHER와 TEST01~05의 비밀번호를 방금 입력한 값으로 동기화합니다. 이미 만들어진 TEST fixture를 다시 눌러도 계정이나 학생이 중복 생성되지 않습니다.</p>
          <label className="mt-4 block max-w-md text-sm font-black text-text-primary">새 TEST 계정 비밀번호 (6자 이상)
            <input className="input-field mt-2 w-full" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="직접 정한 테스트 전용 비밀번호" />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busyAction !== null || password.length < 6 || isTestTeacherAccount} onClick={() => void reconcile()}>{busyAction === 'reconcile' ? '준비 중...' : status?.fixture_exists ? 'TEST 학급 다시 확인' : 'TEST 학급 만들기'}</button>
            {status?.fixture_exists && <button className="btn-secondary" disabled={busyAction !== null || password.length < 6} onClick={() => void resetPasswords()}>{busyAction === 'password' ? '비밀번호 변경 중...' : 'TEST 계정 비밀번호 모두 바꾸기'}</button>}
          </div>
          <p className="mt-3 text-xs font-bold text-text-muted">TEST 학급 만들기/다시 확인은 실제 운영 교사 계정에서만 실행합니다. TEST TEACHER는 생성이 끝난 뒤 TEST 학급 안에서 Guild·Mission·Arcade를 검증할 때 사용하는 계정입니다.</p>
        </section>

        {accounts && <section className="glass-card border-success/40 p-5">
          <h2 className="font-display text-xl text-white">이번에 확인한 TEST 로그인 계정</h2>
          <p className="mt-2 text-sm text-text-secondary">비밀번호는 보안상 다시 보여드리지 않습니다. 방금 직접 입력한 값을 사용하세요.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {accounts.map((account) => <li key={account.subject} className="rounded-card-md border border-line bg-bg-deep p-3 text-sm"><b className="text-gold">{account.subject === 'TEST_TEACHER' ? 'TEST TEACHER' : account.subject}</b><span className="ml-2 text-text-secondary">{account.email}</span>{account.created === true && <span className="ml-2 text-xs font-black text-success">새 계정</span>}</li>)}
          </ul>
        </section>}

        <section className="rounded-card-xl border border-danger/50 bg-danger/5 p-5">
          <h2 className="font-display text-xl text-danger">2. TEST 활동 기록 초기화</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">Guild 1 세션, Guild 2 점수·관찰·원장, Guild 3 미션 기록, Arcade 기록·월간 snapshot만 지웁니다. TEST 학급, TEST GUILD, TEST01~05, TEST 로그인 계정과 연결은 남습니다. 실제 학급에는 사용할 수 없는 기능입니다.</p>
          <label className="mt-4 block max-w-md text-sm font-black text-text-primary">확인 문구 입력: {resetPhrase}
            <input className="input-field mt-2 w-full" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder={resetPhrase} disabled={!status?.fixture_exists || busyAction !== null} />
          </label>
          <button className="btn-danger mt-4" disabled={!status?.fixture_exists || busyAction !== null || resetConfirmation !== resetPhrase} onClick={() => void reset()}>{busyAction === 'reset' ? 'TEST 기록 초기화 중...' : 'TEST 기록 초기화'}</button>
        </section>
      </div>
    </TeacherShell>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-line bg-bg-deep p-3"><p className="text-xs font-black text-text-muted">{label}</p><p className="mt-1 text-sm font-extrabold text-white">{value}</p></div>;
}

