import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  getTeacherAppAccessDaily,
  getTeacherAppAccessHistory,
  getTeacherLoginHistory,
  type AppAccessDailyRow,
  type AppAccessEventRow,
  type AppAccessSource,
  type AppAccessStudentSummary,
  type LoginHistoryEventType,
  type LoginHistoryRow,
} from '@/lib/rpc/login_history_rpc';
import { useClassroomId } from '@/stores/auth_store';

const ACCESS_PAGE_SIZE = 100;
const AUTH_PAGE_SIZE = 50;

type SortKey = 'name' | 'days' | 'count' | 'today' | 'first' | 'last';

function formatKstDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function formatKstDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).format(date);
}

function sourceLabel(source: AppAccessSource | string): string {
  const labels: Record<string, string> = {
    EXPLICIT_LOGIN: '직접 로그인',
    SESSION_RESTORE: '앱 열기 / 새로고침',
    APP_RESUME: '앱 복귀',
    APP_OPEN: '앱 열기',
  };
  return labels[source] ?? source;
}

function authEventLabel(eventType: LoginHistoryEventType): string {
  if (eventType === 'LOGIN_SUCCESS') return '로그인 성공';
  if (eventType === 'LOGIN_FAILED') return '로그인 실패';
  return '로그아웃';
}

export default function LoginHistoryAdmin() {
  const classroomId = useClassroomId();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accessPage, setAccessPage] = useState(0);
  const [authPage, setAuthPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDesc, setSortDesc] = useState(true);

  const accessQuery = useQuery({
    queryKey: ['teacher-app-access-history-v2', classroomId, studentId, dateFrom, dateTo, accessPage],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 확인할 수 없습니다.');
      return getTeacherAppAccessHistory(supabase, {
        p_classroom_id: classroomId,
        p_limit: ACCESS_PAGE_SIZE,
        p_offset: accessPage * ACCESS_PAGE_SIZE,
        p_student_id: studentId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
    },
    enabled: classroomId !== null,
  });

  const dailyQuery = useQuery({
    queryKey: ['teacher-app-access-daily-legacy', classroomId, studentId, dateFrom, dateTo],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 확인할 수 없습니다.');
      return getTeacherAppAccessDaily(supabase, {
        p_classroom_id: classroomId,
        p_student_id: studentId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
    },
    enabled: classroomId !== null,
  });

  const authQuery = useQuery({
    queryKey: ['teacher-login-history-audit', classroomId, studentId, dateFrom, dateTo, authPage],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 확인할 수 없습니다.');
      return getTeacherLoginHistory(supabase, {
        p_classroom_id: classroomId,
        p_limit: AUTH_PAGE_SIZE,
        p_offset: authPage * AUTH_PAGE_SIZE,
        p_student_id: studentId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_include_test: false,
      });
    },
    enabled: classroomId !== null,
  });

  const accessBoard = accessQuery.data;
  const studentOptions = useMemo(
    () => [...(accessBoard?.student_summaries ?? [])].sort((a, b) => a.student_name.localeCompare(b.student_name, 'ko')),
    [accessBoard?.student_summaries],
  );

  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    const rows = studentOptions.filter((row) => !needle || row.student_name.toLocaleLowerCase('ko-KR').includes(needle));
    const direction = sortDesc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return a.student_name.localeCompare(b.student_name, 'ko') * direction;
      if (sortKey === 'days') return (a.total_access_days - b.total_access_days) * direction;
      if (sortKey === 'today') return (a.today_access_count - b.today_access_count) * direction;
      if (sortKey === 'first') return ((a.first_access_at ?? '').localeCompare(b.first_access_at ?? '')) * direction;
      if (sortKey === 'last') return ((a.last_access_at ?? '').localeCompare(b.last_access_at ?? '')) * direction;
      return (a.total_access_count - b.total_access_count) * direction;
    });
  }, [studentOptions, search, sortKey, sortDesc]);

  const accessPages = Math.max(1, Math.ceil((accessBoard?.total_count ?? 0) / ACCESS_PAGE_SIZE));
  const authPages = Math.max(1, Math.ceil((authQuery.data?.total_count ?? 0) / AUTH_PAGE_SIZE));

  const reset = () => {
    setStudentId(null); setDateFrom(''); setDateTo(''); setAccessPage(0); setAuthPage(0); setSearch('');
  };

  const selectStudent = (id: number | null) => {
    setStudentId(id); setAccessPage(0); setAuthPage(0);
  };

  const refreshAll = () => {
    void accessQuery.refetch(); void dailyQuery.refetch(); void authQuery.refetch();
  };

  return (
    <TeacherShell>
      <div className="space-y-3">
        <section className="rounded-card-lg border border-line bg-bg-card/80 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-card-md border border-line-brand/40 bg-brand-primary/15 text-xl">👣</div>
              <div>
                <h1 className="font-display text-xl tracking-tight text-brand-gradient">B.R.A.N.D 접속 발자취</h1>
                <p className="text-2xs font-bold text-text-muted">실제 앱 방문과 모든 접속 신호를 보존합니다. 인증 로그인 횟수와는 별개입니다.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={refreshAll} className="h-8 rounded-card-md border border-line bg-bg-deep px-3 text-2xs font-black text-text-secondary hover:text-white">↻ 새로고침</button>
              <button type="button" onClick={reset} className="h-8 rounded-card-md border border-line px-3 text-2xs font-black text-text-muted hover:text-white">필터 초기화</button>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-end gap-2 rounded-card-lg border border-line bg-bg-card px-3 py-2">
          <Field label="학생">
            <select value={studentId ?? ''} onChange={(e) => selectStudent(e.target.value ? Number(e.target.value) : null)} className="h-8 min-w-[150px] rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white">
              <option value="">전체 학생</option>
              {studentOptions.map((s) => <option key={s.student_id} value={s.student_id}>{s.student_name}</option>)}
            </select>
          </Field>
          <Field label="시작일"><input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setAccessPage(0); setAuthPage(0); }} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white" /></Field>
          <Field label="종료일"><input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setAccessPage(0); setAuthPage(0); }} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white" /></Field>
          {studentId !== null && <button type="button" onClick={() => selectStudent(null)} className="h-8 rounded-card-md border border-line-brand bg-brand-primary/10 px-3 text-2xs font-black text-gold">전체 학생으로 돌아가기</button>}
        </section>

        {accessQuery.isError && <ErrorBox title="접속 발자취를 불러오지 못했습니다." error={accessQuery.error} />}

        <section className="overflow-hidden rounded-card-lg border border-success/30 bg-bg-card">
          <div className="border-b border-line px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm text-white">실제 접속 요약</h2>
                <p className="mt-0.5 text-[9px] font-bold text-text-muted">30분 이상 비활동 후 다시 들어오면 새로운 ‘접근 1회’로 계산합니다.</p>
              </div>
              <span className="rounded-pill border border-success/30 bg-success/10 px-2 py-1 text-[9px] font-black text-success">정확한 개별 기록 시작 {formatKstDateTime(accessBoard?.tracking_start_at ?? null)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4">
            <Metric label="유효 접속" value={accessBoard?.summary.access_count ?? 0} suffix="회" accent />
            <Metric label="접속 학생·일" value={accessBoard?.summary.access_student_days ?? 0} suffix="건" />
            <Metric label="원본 접속 신호" value={accessBoard?.summary.raw_event_count ?? 0} suffix="건" />
            <Metric label="접속 학생" value={accessBoard?.summary.distinct_students ?? 0} suffix="명" />
          </div>
          <div className="border-t border-line bg-bg-deep/40 px-3 py-2 text-[9px] font-bold leading-relaxed text-text-muted">
            기존 일별 접속 집계는 {formatKstDate(accessBoard?.legacy_daily_tracking_start_date ?? null)}부터 남아 있지만, 그 과거 데이터에는 개별 접속 시각이 모두 저장되지 않았습니다. 따라서 과거 횟수를 임의로 만들어 합산하지 않습니다.
          </div>
        </section>

        <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div><h2 className="font-display text-sm text-white">학생별 누적 발자취</h2><p className="text-[9px] font-bold text-text-muted">시즌 말 ‘B.R.A.N.D에 접근한 기록 N회’에 사용할 기준값입니다.</p></div>
            <div className="flex gap-1.5">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="학생 검색" className="h-8 w-32 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white" />
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white">
                <option value="count">누적 접속</option><option value="today">오늘 접속</option><option value="days">접속일</option><option value="last">마지막 접속</option><option value="first">최초 접속</option><option value="name">이름</option>
              </select>
              <button type="button" onClick={() => setSortDesc((v) => !v)} className="h-8 rounded-card-md border border-line px-2.5 text-2xs font-black text-text-secondary">{sortDesc ? '↓' : '↑'}</button>
            </div>
          </div>
          {accessQuery.isLoading ? <LoadingSpinner /> : <StudentAccessTable rows={visibleStudents} selectedStudentId={studentId} onSelect={selectStudent} />}
        </section>

        <section className="overflow-hidden rounded-card-lg border border-line-brand/35 bg-bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div><h2 className="font-display text-sm text-white">모든 접속 시각</h2><p className="text-[9px] font-bold text-text-muted">원본 이벤트를 삭제·합치지 않고 시간순으로 보존합니다. ⭐ 표시는 새로운 30분 방문의 시작입니다.</p></div>
            <span className="text-[9px] font-black text-text-muted">총 {(accessBoard?.total_count ?? 0).toLocaleString()}건</span>
          </div>
          {accessQuery.isLoading ? <LoadingSpinner /> : <AccessEventTable rows={accessBoard?.rows ?? []} />}
          <Pager page={accessPage} totalPages={accessPages} onPage={setAccessPage} />
        </section>

        <details className="rounded-card-lg border border-line bg-bg-card">
          <summary className="cursor-pointer px-3 py-2 text-2xs font-black text-text-secondary">과거 일별 접속 증거 보기 · 주말 출석 판정 호환 데이터</summary>
          {dailyQuery.isError && <ErrorBox title="과거 일별 접속 자료를 불러오지 못했습니다." error={dailyQuery.error} />}
          {dailyQuery.isLoading ? <LoadingSpinner /> : <DailyAccessTable rows={dailyQuery.data?.rows ?? []} />}
        </details>

        <details className="rounded-card-lg border border-line bg-bg-card">
          <summary className="cursor-pointer px-3 py-2 text-2xs font-black text-text-secondary">인증 감사 이력 보기 · 실제 접속 횟수와 별개</summary>
          <div className="border-t border-line px-3 py-2 text-[9px] font-bold text-text-muted">비밀번호 로그인·로그아웃 등 인증 세션 이벤트입니다. 이 숫자를 학생의 접속 횟수로 사용하지 않습니다.</div>
          {authQuery.isError && <ErrorBox title="인증 이력을 불러오지 못했습니다." error={authQuery.error} />}
          {authQuery.isLoading ? <LoadingSpinner /> : <AuthTable rows={authQuery.data?.rows ?? []} />}
          <Pager page={authPage} totalPages={authPages} onPage={setAuthPage} />
        </details>
      </div>
    </TeacherShell>
  );
}

function StudentAccessTable({ rows, selectedStudentId, onSelect }: { rows: AppAccessStudentSummary[]; selectedStudentId: number | null; onSelect: (id: number | null) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-bg-deep/70"><tr className="border-b border-line text-[9px] font-black text-text-muted"><th className="px-2.5 py-2">학생</th><th className="px-2.5 py-2 text-right">접속일</th><th className="px-2.5 py-2 text-right">오늘</th><th className="px-2.5 py-2 text-right">누적 접속</th><th className="px-2.5 py-2">최초 접속</th><th className="px-2.5 py-2">마지막 접속</th><th className="px-2.5 py-2"></th></tr></thead><tbody>
    {rows.map((s) => <tr key={s.student_id} className="border-b border-line/50 last:border-0 hover:bg-white/[0.025]"><td className="px-2.5 py-2 text-[11px] font-extrabold text-white">{s.student_name}</td><td className="px-2.5 py-2 text-right text-xs font-black text-gold">{s.total_access_days.toLocaleString()}일</td><td className="px-2.5 py-2 text-right text-xs font-black text-white">{s.today_access_count.toLocaleString()}회</td><td className="px-2.5 py-2 text-right text-sm font-black text-success">{s.total_access_count.toLocaleString()}회</td><td className="whitespace-nowrap px-2.5 py-2 text-[10px] font-bold text-text-secondary">{formatKstDateTime(s.first_access_at)}</td><td className="whitespace-nowrap px-2.5 py-2 text-[10px] font-bold text-text-secondary">{formatKstDateTime(s.last_access_at)}</td><td className="px-2.5 py-2 text-right"><button type="button" onClick={() => onSelect(selectedStudentId === s.student_id ? null : s.student_id)} className="rounded-card-md border border-line-brand/40 bg-brand-primary/10 px-2 py-1 text-[9px] font-black text-gold">{selectedStudentId === s.student_id ? '전체 보기' : '기록 보기'}</button></td></tr>)}
    {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-xs font-bold text-text-muted">표시할 학생이 없습니다.</td></tr>}
  </tbody></table></div>;
}

function AccessEventTable({ rows }: { rows: AppAccessEventRow[] }) {
  return <div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[800px] text-left"><thead className="sticky top-0 bg-bg-deep/95"><tr className="border-b border-line text-[9px] font-black text-text-muted"><th className="px-2.5 py-2">방문</th><th className="px-2.5 py-2">접속 시각</th><th className="px-2.5 py-2">학생</th><th className="px-2.5 py-2">접속 방식</th><th className="px-2.5 py-2">환경</th></tr></thead><tbody>
    {rows.map((r) => <tr key={r.id} className="border-b border-line/50 last:border-0"><td className="px-2.5 py-2 text-center text-sm">{r.is_visit_start ? '⭐' : '·'}</td><td className="whitespace-nowrap px-2.5 py-2 text-[11px] font-bold text-text-secondary">{formatKstDateTime(r.occurred_at)}</td><td className="px-2.5 py-2 text-[11px] font-extrabold text-white">{r.student_name}</td><td className="px-2.5 py-2"><span className={r.is_visit_start ? 'rounded-pill border border-success/30 bg-success/10 px-1.5 py-0.5 text-[9px] font-black text-success' : 'text-[10px] font-bold text-text-muted'}>{sourceLabel(r.source)}{r.is_visit_start ? ' · 새 방문' : ''}</span></td><td className="px-2.5 py-2 text-[10px] font-bold text-text-secondary">{r.device_type ?? '-'} · {r.browser ?? '-'}</td></tr>)}
    {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-xs font-bold text-text-muted">정확한 개별 접속 기록이 아직 없습니다.</td></tr>}
  </tbody></table></div>;
}

function DailyAccessTable({ rows }: { rows: AppAccessDailyRow[] }) {
  return <div className="max-h-[360px] overflow-auto border-t border-line"><table className="w-full min-w-[780px] text-left"><thead className="sticky top-0 bg-bg-deep/95"><tr className="text-[9px] font-black text-text-muted"><th className="px-2.5 py-2">날짜</th><th className="px-2.5 py-2">학생</th><th className="px-2.5 py-2">최초 확인</th><th className="px-2.5 py-2">최근 확인</th><th className="px-2.5 py-2 text-right">신호</th><th className="px-2.5 py-2">구분</th></tr></thead><tbody>
    {rows.map((r) => <tr key={`${r.student_id}-${r.access_date}`} className="border-t border-line/50"><td className="px-2.5 py-2 text-[10px] font-black text-gold">{formatKstDate(r.access_date)}</td><td className="px-2.5 py-2 text-[11px] font-extrabold text-white">{r.student_name}</td><td className="px-2.5 py-2 text-[10px] text-text-secondary">{formatKstDateTime(r.first_seen_at)}</td><td className="px-2.5 py-2 text-[10px] text-text-secondary">{formatKstDateTime(r.last_seen_at)}</td><td className="px-2.5 py-2 text-right text-[10px] font-black text-text-secondary">{r.signal_count}</td><td className="px-2.5 py-2 text-[9px] font-black text-text-muted">{r.has_direct_app_signal ? '직접 기록 포함' : '과거 복원'}</td></tr>)}
  </tbody></table></div>;
}

function AuthTable({ rows }: { rows: LoginHistoryRow[] }) {
  return <div className="max-h-[420px] overflow-auto border-t border-line"><table className="w-full min-w-[760px] text-left"><thead className="sticky top-0 bg-bg-deep/95"><tr className="text-[9px] font-black text-text-muted"><th className="px-2.5 py-2">시각</th><th className="px-2.5 py-2">사용자</th><th className="px-2.5 py-2">인증 이벤트</th><th className="px-2.5 py-2">환경</th></tr></thead><tbody>
    {rows.map((r) => <tr key={r.id} className="border-t border-line/50"><td className="px-2.5 py-2 text-[10px] text-text-secondary">{formatKstDateTime(r.occurred_at)}</td><td className="px-2.5 py-2 text-[11px] font-extrabold text-white">{r.actor_kind === 'TEACHER' ? '선생님' : (r.student_name_snapshot ?? `학생 #${r.student_id ?? '-'}`)}</td><td className="px-2.5 py-2 text-[10px] font-bold text-text-secondary">{authEventLabel(r.event_type)}</td><td className="px-2.5 py-2 text-[10px] text-text-muted">{r.device_type ?? '-'} · {r.browser ?? '-'}</td></tr>)}
  </tbody></table></div>;
}

function Metric({ label, value, suffix, accent = false }: { label: string; value: number; suffix: string; accent?: boolean }) {
  return <div className="border-r border-t border-line px-3 py-2.5 last:border-r-0 md:border-t-0"><div className="text-[9px] font-black text-text-muted">{label}</div><div className={`mt-0.5 text-lg font-black ${accent ? 'text-success' : 'text-white'}`}>{value.toLocaleString()}<span className="ml-0.5 text-[9px] text-text-muted">{suffix}</span></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-0.5 block text-[9px] font-black text-text-muted">{label}</span>{children}</label>; }

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) { return <div className="flex items-center justify-center gap-3 border-t border-line py-2"><button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} className="h-7 rounded-card-md border border-line px-2.5 text-2xs font-black text-text-secondary disabled:opacity-30">← 이전</button><span className="text-2xs font-black text-text-muted">{page + 1} / {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)} className="h-7 rounded-card-md border border-line px-2.5 text-2xs font-black text-text-secondary disabled:opacity-30">다음 →</button></div>; }

function ErrorBox({ title, error }: { title: string; error: unknown }) { return <div className="border-t border-danger/40 bg-danger/10 px-3 py-2 text-2xs font-bold text-danger"><div>{title}</div><div className="mt-0.5 text-text-secondary">{error instanceof Error ? error.message : '알 수 없는 오류'}</div></div>; }
