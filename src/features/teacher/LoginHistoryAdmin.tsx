import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  getTeacherAppAccessDaily,
  getTeacherLoginHistory,
  type AppAccessDailyRow,
  type LoginHistoryEventType,
  type LoginHistoryRow,
  type LoginHistoryStudentSummary,
} from '@/lib/rpc/login_history_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

const PAGE_SIZE = 50;
type ViewMode = 'events' | 'students';
type SortDirection = 'asc' | 'desc';

function formatKstDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatKstDate(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(date);
}

function eventLabel(eventType: LoginHistoryEventType): string {
  if (eventType === 'LOGIN_SUCCESS') return '인증 로그인 성공';
  if (eventType === 'LOGIN_FAILED') return '인증 로그인 실패';
  return '로그아웃';
}

function eventTone(eventType: LoginHistoryEventType): string {
  if (eventType === 'LOGIN_SUCCESS') return 'border-success/30 bg-success/10 text-success';
  if (eventType === 'LOGIN_FAILED') return 'border-danger/30 bg-danger/10 text-danger';
  return 'border-line bg-bg-deep text-text-secondary';
}

function compareText(a: string, b: string, direction: SortDirection): number {
  return a.localeCompare(b, 'ko', { numeric: true }) * (direction === 'asc' ? 1 : -1);
}

function compareNumber(a: number, b: number, direction: SortDirection): number {
  return (a - b) * (direction === 'asc' ? 1 : -1);
}

function evidenceLabel(source: string): string {
  const labels: Record<string, string> = {
    APP_INIT: '앱 시작',
    SESSION_RESTORE: '세션 복원',
    AUTH_STATE: '인증 상태',
    EXPLICIT_LOGIN: '직접 로그인',
    APP_ACCESS: '앱 재진입',
    SESSION_CREATED: '세션 생성',
    TOKEN_REFRESH: '세션 갱신',
    LOGIN_HISTORY: '인증 이력',
    ACHIEVEMENT_APPLICATION: '업적 신청',
    ARCADE_RUN: '아케이드',
    ASSIGNMENT_SUBMISSION: '과제 제출',
    AUCTION_BID: '경매 입찰',
    AUCTION_SUPER_PASS: '경매 패스',
    EMERGENCY_QUEST_REQUEST: '돌발퀘 완료 요청',
    EMERGENCY_QUEST_COMPLETION: '돌발퀘 완료',
    ALERT_READ: '알림 확인',
    GUILD_MISSION_ACTIVITY: '길드 미션',
    LOAN_APPLICATION: '대출 신청',
    RANDOM_BOX_OPENING: '랜덤 상자',
    GUESTBOOK_ENTRY: '방명록',
    SECONDARY_JOB_APPLICATION: '2차 직업 신청',
    SECONDARY_PUBLIC_ACCEPT: '공개 의뢰 수락',
    SECONDARY_PUBLIC_SUBMIT: '공개 의뢰 제출',
    SECONDARY_SERVICE_AD: '서비스 광고',
    SNACK_PURCHASE: '간식 구매',
    COSMETIC_PURCHASE: '꾸미기 구매',
    DEPOSIT_OPEN: '예금 가입',
    INSTALLMENT_OPEN: '적금 가입',
  };
  return labels[source] ?? source;
}

export default function LoginHistoryAdmin() {
  const classroomId = useClassroomId();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [eventType, setEventType] = useState<LoginHistoryEventType | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>('events');
  const [queryText, setQueryText] = useState('');
  const [eventSort, setEventSort] = useState('occurred_at');
  const [studentSort, setStudentSort] = useState('login_days');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: [
      'teacher-login-history',
      classroomId,
      studentId,
      eventType,
      dateFrom,
      dateTo,
      includeTest,
      page,
    ],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 확인할 수 없습니다.');
      return getTeacherLoginHistory(supabase, {
        p_classroom_id: classroomId,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_student_id: studentId,
        p_event_type: eventType,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_include_test: includeTest,
      });
    },
    enabled: classroomId !== null,
  });

  const accessQuery = useQuery({
    queryKey: ['teacher-app-access-daily', classroomId, studentId, dateFrom, dateTo],
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

  const board = query.data;
  const accessBoard = accessQuery.data;
  const totalPages = Math.max(1, Math.ceil((board?.total_count ?? 0) / PAGE_SIZE));
  const studentOptions = useMemo(
    () => [...(board?.student_summaries ?? [])].sort((a, b) => a.student_name.localeCompare(b.student_name, 'ko')),
    [board?.student_summaries],
  );

  const visibleAccessRows = useMemo(
    () => [...(accessBoard?.rows ?? [])].sort((a, b) => {
      const dateCompare = b.access_date.localeCompare(a.access_date);
      return dateCompare !== 0 ? dateCompare : a.student_name.localeCompare(b.student_name, 'ko');
    }),
    [accessBoard?.rows],
  );

  const visibleEvents = useMemo(() => {
    const needle = queryText.trim().toLocaleLowerCase('ko-KR');
    const filtered = (board?.rows ?? []).filter((row) => {
      if (!needle) return true;
      const actor = row.actor_kind === 'TEACHER' ? '선생님' : (row.student_name_snapshot ?? '');
      const haystack = `${actor} ${eventLabel(row.event_type)} ${row.device_type ?? ''} ${row.browser ?? ''}`.toLocaleLowerCase('ko-KR');
      return haystack.includes(needle);
    });
    return [...filtered].sort((a, b) => sortEventRows(a, b, eventSort, sortDirection));
  }, [board?.rows, queryText, eventSort, sortDirection]);

  const visibleStudents = useMemo(() => {
    const needle = queryText.trim().toLocaleLowerCase('ko-KR');
    const filtered = studentOptions.filter((student) => !needle || student.student_name.toLocaleLowerCase('ko-KR').includes(needle));
    return [...filtered].sort((a, b) => sortStudentRows(a, b, studentSort, sortDirection));
  }, [studentOptions, queryText, studentSort, sortDirection]);

  const selectedEvent = visibleEvents.find((row) => row.id === selectedEventId) ?? null;

  const resetFilters = () => {
    setStudentId(null);
    setEventType(null);
    setDateFrom('');
    setDateTo('');
    setIncludeTest(false);
    setPage(0);
    setSelectedEventId(null);
  };

  const changeView = (next: ViewMode) => {
    setView(next);
    setQueryText('');
    setSortDirection('desc');
    setSelectedEventId(null);
  };

  const refreshAll = () => {
    void query.refetch();
    void accessQuery.refetch();
  };

  return (
    <TeacherShell>
      <div className="space-y-3">
        <section className="rounded-card-lg border border-line bg-bg-card/80 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-card-md border border-line-brand/40 bg-brand-primary/15 text-lg">🔐</div>
              <div className="min-w-0">
                <h1 className="font-display text-xl tracking-tight text-brand-gradient">접속 · 인증 이력</h1>
                <p className="truncate text-2xs font-bold text-text-muted">실제 앱 접속과 로그인 인증 이벤트를 분리해 확인합니다.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={refreshAll} className="h-8 rounded-card-md border border-line bg-bg-deep px-3 text-2xs font-black text-text-secondary hover:border-line-brand hover:text-white">↻ 새로고침</button>
              <button type="button" onClick={resetFilters} className="h-8 rounded-card-md border border-line px-3 text-2xs font-black text-text-muted hover:text-white">필터 초기화</button>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-end gap-2 rounded-card-lg border border-line bg-bg-card px-3 py-2">
          <CompactField label="학생">
            <select value={studentId ?? ''} onChange={(e) => { setStudentId(e.target.value ? Number(e.target.value) : null); setPage(0); setSelectedEventId(null); }} className="h-8 min-w-[150px] rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
              <option value="">전체 학생/교사</option>
              {studentOptions.map((student) => (
                <option key={student.student_id} value={student.student_id}>{student.student_name}{student.is_test_account ? ' (TEST)' : ''}</option>
              ))}
            </select>
          </CompactField>
          <CompactField label="인증 이벤트">
            <select value={eventType ?? ''} onChange={(e) => { setEventType(e.target.value ? (e.target.value as LoginHistoryEventType) : null); setPage(0); setSelectedEventId(null); }} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
              <option value="">전체 이벤트</option>
              <option value="LOGIN_SUCCESS">인증 로그인 성공</option>
              <option value="LOGIN_FAILED">인증 로그인 실패</option>
              <option value="LOGOUT">로그아웃</option>
            </select>
          </CompactField>
          <CompactField label="시작일">
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand" />
          </CompactField>
          <CompactField label="종료일">
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand" />
          </CompactField>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-card-md border border-line bg-bg-deep px-2.5">
            <input type="checkbox" checked={includeTest} onChange={(e) => { setIncludeTest(e.target.checked); setStudentId(null); setPage(0); }} />
            <span className="text-2xs font-black text-text-secondary">TEST 포함(인증)</span>
          </label>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => changeView('events')} className={cn('h-8 rounded-card-md px-3 text-2xs font-black', view === 'events' ? 'border border-line-brand bg-brand-primary/20 text-gold' : 'border border-line text-text-muted hover:text-white')}>인증 이벤트</button>
            <button type="button" onClick={() => changeView('students')} className={cn('h-8 rounded-card-md px-3 text-2xs font-black', view === 'students' ? 'border border-line-brand bg-brand-primary/20 text-gold' : 'border border-line text-text-muted hover:text-white')}>인증 요약</button>
          </div>
        </section>

        <section className="overflow-hidden rounded-card-lg border border-success/25 bg-bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div>
              <h2 className="font-display text-sm text-white">실제 앱 접속 · 주말 출석 판정 기준</h2>
              <p className="mt-0.5 text-[9px] font-bold text-text-muted">로그아웃 여부와 무관하게 해당 날짜에 B.R.A.N.D를 실제로 열거나 사용한 증거를 집계합니다.</p>
            </div>
            <span className="rounded-pill border border-success/30 bg-success/10 px-2 py-1 text-[9px] font-black text-success">Asia/Seoul 날짜 기준</span>
          </div>
          <div className="flex overflow-hidden border-b border-line">
            <SummaryCell label="접속 학생·일" value={accessBoard?.summary.student_days ?? 0} suffix="건" />
            <SummaryCell label="접속 학생" value={accessBoard?.summary.distinct_students ?? 0} suffix="명" />
            <SummaryCell label="신규 직접 기록" value={accessBoard?.summary.direct_student_days ?? 0} suffix="건" />
            <SummaryCell label="과거 복원" value={accessBoard?.summary.backfilled_student_days ?? 0} suffix="건" />
          </div>
          {accessQuery.isLoading ? <LoadingSpinner /> : <AccessTable rows={visibleAccessRows} />}
          {accessQuery.isError && (
            <div className="border-t border-danger/40 bg-danger/10 px-3 py-2 text-2xs font-bold text-danger">
              실제 접속 이력을 불러오지 못했습니다: {accessQuery.error instanceof Error ? accessQuery.error.message : '알 수 없는 오류'}
            </div>
          )}
        </section>

        <details className="rounded-card-md border border-line bg-bg-card px-3 py-2">
          <summary className="cursor-pointer text-2xs font-black text-text-muted">접속과 인증을 왜 분리하나요?</summary>
          <div className="mt-2 text-2xs font-bold leading-relaxed text-text-secondary">
            인증 로그인은 비밀번호로 새 인증 세션을 만든 시점입니다. 실제 접속은 이미 로그인된 세션을 복원해 앱을 다시 연 경우까지 포함합니다. 따라서 주말 접속 여부는 위의 실제 앱 접속 이력을 사용하며, 아래 인증 이력은 보안·세션 확인용으로만 봅니다. 2026-09-02~2026-09-07의 일부 접속은 남아 있던 세션 갱신과 학생 직접 활동 증거로 복원했습니다.
          </div>
        </details>

        <section className="flex overflow-hidden rounded-card-lg border border-line bg-bg-card">
          <SummaryCell label="인증 로그인 성공" value={board?.summary.login_success_count ?? 0} />
          <SummaryCell label="인증된 학생" value={board?.summary.distinct_student_count ?? 0} suffix="명" />
          <SummaryCell label="학생 인증 일수" value={board?.summary.distinct_student_login_days ?? 0} suffix="일" />
          <SummaryCell label="로그아웃" value={board?.summary.logout_count ?? 0} />
        </section>

        <details className="rounded-card-md border border-line bg-bg-card px-3 py-2">
          <summary className="cursor-pointer text-2xs font-black text-text-muted">인증 이력 기준 · 기록 시작 {formatKstDateTime(board?.tracking_start_at ?? null)}</summary>
          <div className="mt-2 text-2xs font-bold leading-relaxed text-text-secondary">
            아래 값은 실제 접속 횟수가 아니라 인증 세션 이벤트입니다. 기존 세션을 복원한 재접속은 인증 로그인 성공 횟수에 추가하지 않습니다. 로그인 실패는 안전한 Auth 감사 로그 연동 전까지 기록되지 않습니다.
          </div>
        </details>

        {query.isError && (
          <section className="rounded-card-lg border border-danger/40 bg-danger/10 p-3">
            <div className="text-xs font-extrabold text-danger">인증 이력을 불러오지 못했습니다.</div>
            <div className="mt-1 text-2xs font-bold text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</div>
          </section>
        )}

        <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm text-white">{view === 'events' ? '인증 이벤트 상세' : '학생별 누적 인증'}</h2>
              <span className="text-[9px] font-black text-text-muted">{view === 'events' ? `총 ${(board?.total_count ?? 0).toLocaleString()}건 · 현재 페이지 정렬` : `${visibleStudents.length}명`}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder={view === 'events' ? '사용자/환경 검색' : '학생 검색'} className="h-8 w-36 rounded-card-md border border-line bg-bg-deep px-2.5 text-2xs font-bold text-white outline-none placeholder:text-text-muted focus:border-line-brand sm:w-44" />
              <SortControls
                view={view}
                eventSort={eventSort}
                studentSort={studentSort}
                setEventSort={setEventSort}
                setStudentSort={setStudentSort}
                direction={sortDirection}
                setDirection={setSortDirection}
              />
            </div>
          </div>

          {query.isLoading ? (
            <LoadingSpinner />
          ) : view === 'events' ? (
            <EventTable rows={visibleEvents} selectedId={selectedEventId} onSelect={setSelectedEventId} />
          ) : (
            <StudentTable rows={visibleStudents} />
          )}
        </section>

        {view === 'events' && selectedEvent && (
          <section className="rounded-card-lg border border-line-brand/35 bg-brand-primary/5 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <EventBadge eventType={selectedEvent.event_type} />
                  <span className="text-xs font-extrabold text-white">{selectedEvent.actor_kind === 'TEACHER' ? '선생님' : (selectedEvent.student_name_snapshot ?? `학생 #${selectedEvent.student_id ?? '-'}`)}</span>
                </div>
                <div className="mt-1 text-2xs font-bold text-text-secondary">{formatKstDateTime(selectedEvent.occurred_at)} · {selectedEvent.device_type ?? '-'} · {selectedEvent.browser ?? '-'}</div>
              </div>
              <div className="max-w-full truncate font-mono text-[9px] text-text-muted" title={selectedEvent.session_id ?? undefined}>session {selectedEvent.session_id ?? '-'}</div>
            </div>
          </section>
        )}

        {view === 'events' && <Pagination page={page} totalPages={totalPages} onPage={setPage} />}
      </div>
    </TeacherShell>
  );
}

function sortEventRows(a: LoginHistoryRow, b: LoginHistoryRow, sortKey: string, direction: SortDirection): number {
  if (sortKey === 'actor') {
    const av = a.actor_kind === 'TEACHER' ? '선생님' : (a.student_name_snapshot ?? '');
    const bv = b.actor_kind === 'TEACHER' ? '선생님' : (b.student_name_snapshot ?? '');
    return compareText(av, bv, direction);
  }
  if (sortKey === 'event') return compareText(eventLabel(a.event_type), eventLabel(b.event_type), direction);
  if (sortKey === 'environment') return compareText(`${a.device_type ?? ''} ${a.browser ?? ''}`, `${b.device_type ?? ''} ${b.browser ?? ''}`, direction);
  return compareText(a.occurred_at, b.occurred_at, direction);
}

function sortStudentRows(a: LoginHistoryStudentSummary, b: LoginHistoryStudentSummary, sortKey: string, direction: SortDirection): number {
  if (sortKey === 'name') return compareText(a.student_name, b.student_name, direction);
  if (sortKey === 'login_count') return compareNumber(a.total_login_count, b.total_login_count, direction);
  if (sortKey === 'last_login') return compareText(a.last_login_at ?? '', b.last_login_at ?? '', direction);
  return compareNumber(a.total_login_days, b.total_login_days, direction);
}

function AccessTable({ rows }: { rows: AppAccessDailyRow[] }) {
  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead className="sticky top-0 bg-bg-deep/95">
          <tr className="border-b border-line text-[9px] font-black text-text-muted">
            <th className="px-2.5 py-2">접속일</th>
            <th className="px-2.5 py-2">학생</th>
            <th className="px-2.5 py-2">최초 확인</th>
            <th className="px-2.5 py-2">최근 확인</th>
            <th className="px-2.5 py-2">근거</th>
            <th className="px-2.5 py-2">구분</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.student_id}-${row.access_date}`} className="border-b border-line/50 last:border-0 hover:bg-white/[0.025]">
              <td className="whitespace-nowrap px-2.5 py-2 text-[11px] font-black text-gold">{formatKstDate(row.access_date)}</td>
              <td className="px-2.5 py-2 text-[11px] font-extrabold text-white">{row.student_name}</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-[10px] font-bold text-text-secondary">{formatKstDateTime(row.first_seen_at)}</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-[10px] font-bold text-text-secondary">{formatKstDateTime(row.last_seen_at)}</td>
              <td className="max-w-[360px] px-2.5 py-2 text-[9px] font-bold text-text-secondary">{row.evidence_sources.map(evidenceLabel).join(' · ') || '-'}</td>
              <td className="px-2.5 py-2">
                {row.has_direct_app_signal ? (
                  <span className="rounded-pill border border-success/30 bg-success/10 px-1.5 py-0.5 text-[9px] font-black text-success">직접 기록</span>
                ) : (
                  <span className="rounded-pill border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-black text-warning">과거 복원</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-xs font-bold text-text-muted">조건에 맞는 실제 접속 기록이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function EventTable({ rows, selectedId, onSelect }: { rows: LoginHistoryRow[]; selectedId: number | null; onSelect: (id: number | null) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left">
        <thead className="bg-bg-deep/70">
          <tr className="border-b border-line text-[9px] font-black text-text-muted">
            <th className="px-2.5 py-2">시각</th>
            <th className="px-2.5 py-2">사용자</th>
            <th className="px-2.5 py-2">결과</th>
            <th className="px-2.5 py-2">환경</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => onSelect(selectedId === row.id ? null : row.id)} className={cn('cursor-pointer border-b border-line/50 last:border-0 hover:bg-white/[0.025]', selectedId === row.id && 'bg-brand-primary/8')}>
              <td className="whitespace-nowrap px-2.5 py-2 text-[11px] font-bold text-text-secondary">{formatKstDateTime(row.occurred_at)}</td>
              <td className="px-2.5 py-2 text-[11px] font-extrabold text-white">
                {row.actor_kind === 'TEACHER' ? '선생님' : (row.student_name_snapshot ?? `학생 #${row.student_id ?? '-'}`)}
                {row.is_test_account && <span className="ml-1.5 text-[9px] font-black text-warning">TEST</span>}
              </td>
              <td className="px-2.5 py-2"><EventBadge eventType={row.event_type} /></td>
              <td className="px-2.5 py-2 text-[11px] font-bold text-text-secondary">{row.device_type ?? '-'} <span className="text-text-muted">·</span> {row.browser ?? '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-10 text-center text-xs font-bold text-text-muted">조건에 맞는 인증 이벤트가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function StudentTable({ rows }: { rows: LoginHistoryStudentSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left">
        <thead className="bg-bg-deep/70">
          <tr className="border-b border-line text-[9px] font-black text-text-muted">
            <th className="px-2.5 py-2">학생</th>
            <th className="px-2.5 py-2 text-right">인증 일수</th>
            <th className="px-2.5 py-2 text-right">인증 횟수</th>
            <th className="px-2.5 py-2">최근 인증 로그인</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((student) => (
            <tr key={student.student_id} className="border-b border-line/50 last:border-0 hover:bg-white/[0.025]">
              <td className="px-2.5 py-2 text-[11px] font-extrabold text-white">{student.student_name}{student.is_test_account && <span className="ml-1.5 text-[9px] font-black text-warning">TEST</span>}</td>
              <td className="px-2.5 py-2 text-right text-xs font-black text-gold">{student.total_login_days.toLocaleString()}일</td>
              <td className="px-2.5 py-2 text-right text-xs font-black text-white">{student.total_login_count.toLocaleString()}회</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-[11px] font-bold text-text-secondary">{formatKstDateTime(student.last_login_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-10 text-center text-xs font-bold text-text-muted">표시할 학생이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SortControls({ view, eventSort, studentSort, setEventSort, setStudentSort, direction, setDirection }: { view: ViewMode; eventSort: string; studentSort: string; setEventSort: (value: string) => void; setStudentSort: (value: string) => void; direction: SortDirection; setDirection: (value: SortDirection) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="hidden text-[9px] font-black text-text-muted sm:inline">정렬</span>
      {view === 'events' ? (
        <select value={eventSort} onChange={(e) => setEventSort(e.target.value)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
          <option value="occurred_at">시각</option>
          <option value="actor">사용자</option>
          <option value="event">이벤트</option>
          <option value="environment">환경</option>
        </select>
      ) : (
        <select value={studentSort} onChange={(e) => setStudentSort(e.target.value)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
          <option value="login_days">인증 일수</option>
          <option value="login_count">인증 횟수</option>
          <option value="last_login">최근 인증</option>
          <option value="name">이름</option>
        </select>
      )}
      <select value={direction} onChange={(e) => setDirection(e.target.value as SortDirection)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
        <option value="desc">내림차순</option>
        <option value="asc">오름차순</option>
      </select>
    </div>
  );
}

function EventBadge({ eventType }: { eventType: LoginHistoryEventType }) {
  return <span className={cn('inline-flex rounded-pill border px-1.5 py-0.5 text-[9px] font-black', eventTone(eventType))}>{eventLabel(eventType)}</span>;
}

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[9px] font-black text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function SummaryCell({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="min-w-[110px] flex-1 border-l border-line px-3 py-2.5 first:border-l-0">
      <div className="text-[9px] font-black text-text-muted">{label}</div>
      <div className="mt-0.5 text-base font-black text-white">{value.toLocaleString()}<span className="ml-0.5 text-[9px] text-text-muted">{suffix}</span></div>
    </div>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 py-1">
      <button type="button" disabled={page <= 0} onClick={() => onPage(Math.max(0, page - 1))} className="h-7 rounded-card-md border border-line px-2.5 text-2xs font-black text-text-secondary disabled:opacity-30">← 이전</button>
      <span className="text-2xs font-black text-text-muted">{page + 1} / {totalPages}</span>
      <button type="button" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)} className="h-7 rounded-card-md border border-line px-2.5 text-2xs font-black text-text-secondary disabled:opacity-30">다음 →</button>
    </div>
  );
}
