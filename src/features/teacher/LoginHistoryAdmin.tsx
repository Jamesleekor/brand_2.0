import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  getTeacherLoginHistory,
  type LoginHistoryEventType,
} from '@/lib/rpc/login_history_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

const PAGE_SIZE = 50;

function formatKstDateTime(value: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function shortSession(value: string | null): string {
  if (!value) return '-';
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

function eventLabel(eventType: LoginHistoryEventType): string {
  if (eventType === 'LOGIN_SUCCESS') return '로그인 성공';
  if (eventType === 'LOGIN_FAILED') return '로그인 실패';
  return '로그아웃';
}

function eventTone(eventType: LoginHistoryEventType): string {
  if (eventType === 'LOGIN_SUCCESS') return 'border-success/30 bg-success/10 text-success';
  if (eventType === 'LOGIN_FAILED') return 'border-danger/30 bg-danger/10 text-danger';
  return 'border-line bg-bg-deep text-text-secondary';
}

export default function LoginHistoryAdmin() {
  const classroomId = useClassroomId();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [eventType, setEventType] = useState<LoginHistoryEventType | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [page, setPage] = useState(0);

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

  const board = query.data;
  const totalPages = Math.max(1, Math.ceil((board?.total_count ?? 0) / PAGE_SIZE));
  const studentOptions = useMemo(
    () => [...(board?.student_summaries ?? [])].sort((a, b) => a.student_name.localeCompare(b.student_name, 'ko')),
    [board?.student_summaries],
  );

  const resetFilters = () => {
    setStudentId(null);
    setEventType(null);
    setDateFrom('');
    setDateTo('');
    setIncludeTest(false);
    setPage(0);
  };

  const applyStudent = (value: string) => {
    setStudentId(value ? Number(value) : null);
    setPage(0);
  };

  const applyEventType = (value: string) => {
    setEventType(value ? (value as LoginHistoryEventType) : null);
    setPage(0);
  };

  return (
    <TeacherShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">🔐 로그인 히스토리</h1>
            <p className="mt-1 text-sm font-bold text-text-secondary">
              학생·교사의 로그인 기록과 학생별 누적 로그인 일수/횟수를 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-card-md border border-line bg-bg-card px-3 py-2 text-xs font-extrabold text-text-secondary transition hover:border-line-brand hover:text-white"
          >
            ↻ 새로고침
          </button>
        </header>

        <section className="rounded-card-lg border border-line-brand/40 bg-brand-primary/10 p-4">
          <div className="text-sm font-extrabold text-white">집계 기준</div>
          <p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">
            로그인 히스토리 기능 도입 이후의 이벤트부터 정확하게 집계합니다. 기존 Supabase Auth 감사 로그에 과거 데이터가 없어 이전 로그인 기록은 임의로 복원하지 않습니다.
          </p>
          <div className="mt-2 text-2xs font-bold text-text-muted">
            기록 시작: {formatKstDateTime(board?.tracking_start_at ?? null)} · 날짜 경계: Asia/Seoul
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="로그인 성공 이벤트" value={board?.summary.login_success_count ?? 0} hint="교사 로그인 포함" />
          <SummaryCard label="로그인 학생" value={board?.summary.distinct_student_count ?? 0} suffix="명" hint="선택 기간 내 고유 학생" />
          <SummaryCard label="학생 로그인 일수" value={board?.summary.distinct_student_login_days ?? 0} suffix="일" hint="학생×날짜 기준" />
          <SummaryCard label="로그아웃 이벤트" value={board?.summary.logout_count ?? 0} hint="정상 로그아웃 버튼 기준" />
        </section>

        <section className="rounded-card-lg border border-line bg-bg-card p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base text-white">필터</h2>
              <p className="mt-0.5 text-2xs font-bold text-text-muted">공식 조회에서는 테스트 계정을 기본 제외합니다.</p>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-card-md border border-line px-3 py-1.5 text-2xs font-black text-text-muted hover:text-white"
            >
              필터 초기화
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <FilterField label="학생">
              <select
                value={studentId ?? ''}
                onChange={(e) => applyStudent(e.target.value)}
                className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none focus:border-line-brand"
              >
                <option value="">전체 학생/교사</option>
                {studentOptions.map((student) => (
                  <option key={student.student_id} value={student.student_id}>
                    {student.student_name}{student.is_test_account ? ' (TEST)' : ''}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="이벤트">
              <select
                value={eventType ?? ''}
                onChange={(e) => applyEventType(e.target.value)}
                className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none focus:border-line-brand"
              >
                <option value="">전체 이벤트</option>
                <option value="LOGIN_SUCCESS">로그인 성공</option>
                <option value="LOGIN_FAILED">로그인 실패</option>
                <option value="LOGOUT">로그아웃</option>
              </select>
            </FilterField>

            <FilterField label="시작일">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none focus:border-line-brand"
              />
            </FilterField>

            <FilterField label="종료일">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none focus:border-line-brand"
              />
            </FilterField>

            <FilterField label="테스트 계정">
              <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-card-md border border-line bg-bg-deep px-3">
                <input
                  type="checkbox"
                  checked={includeTest}
                  onChange={(e) => { setIncludeTest(e.target.checked); setStudentId(null); setPage(0); }}
                />
                <span className="text-xs font-bold text-text-secondary">TEST 포함</span>
              </label>
            </FilterField>
          </div>
        </section>

        {query.isError && (
          <section className="rounded-card-lg border border-danger/40 bg-danger/10 p-4">
            <div className="text-sm font-extrabold text-danger">로그인 히스토리를 불러오지 못했습니다.</div>
            <div className="mt-1 text-xs font-bold text-text-secondary">
              {query.error instanceof Error ? query.error.message : '알 수 없는 오류'}
            </div>
          </section>
        )}

        <section className="rounded-card-lg border border-line bg-bg-card p-4">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-base text-white">학생별 누적 로그인</h2>
              <p className="mt-0.5 text-2xs font-bold text-text-muted">로그인 성공 이벤트 기준 · 같은 날 여러 번 로그인해도 로그인 일수는 1일</p>
            </div>
          </div>

          {query.isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-line text-2xs font-black text-text-muted">
                    <th className="px-3 py-2">학생</th>
                    <th className="px-3 py-2 text-right">총 로그인 일수</th>
                    <th className="px-3 py-2 text-right">총 로그인 횟수</th>
                  </tr>
                </thead>
                <tbody>
                  {studentOptions.map((student) => (
                    <tr key={student.student_id} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2.5 text-xs font-extrabold text-white">
                        {student.student_name}
                        {student.is_test_account && <span className="ml-2 rounded-pill border border-warning/30 px-1.5 py-0.5 text-[9px] text-warning">TEST</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-black text-gold">{student.total_login_days.toLocaleString()}일</td>
                      <td className="px-3 py-2.5 text-right text-sm font-black text-text-primary">{student.total_login_count.toLocaleString()}회</td>
                    </tr>
                  ))}
                  {studentOptions.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-8 text-center text-xs font-bold text-text-muted">표시할 학생이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-card-lg border border-line bg-bg-card p-4">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-base text-white">이벤트 상세</h2>
              <p className="mt-0.5 text-2xs font-bold text-text-muted">
                총 {(board?.total_count ?? 0).toLocaleString()}건 · 최신순
              </p>
            </div>
            <div className="text-2xs font-bold text-text-muted">
              로그인 실패는 안전한 Auth 감사 로그 연동 전까지 기록되지 않습니다.
            </div>
          </div>

          {query.isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead>
                  <tr className="border-b border-line text-2xs font-black text-text-muted">
                    <th className="px-3 py-2">시각</th>
                    <th className="px-3 py-2">사용자</th>
                    <th className="px-3 py-2">결과</th>
                    <th className="px-3 py-2">기기</th>
                    <th className="px-3 py-2">브라우저</th>
                    <th className="px-3 py-2">세션</th>
                  </tr>
                </thead>
                <tbody>
                  {(board?.rows ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-line/60 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs font-bold text-text-secondary">{formatKstDateTime(row.occurred_at)}</td>
                      <td className="px-3 py-2.5 text-xs font-extrabold text-white">
                        {row.actor_kind === 'TEACHER' ? '선생님' : (row.student_name_snapshot ?? `학생 #${row.student_id ?? '-'}`)}
                        {row.is_test_account && <span className="ml-2 text-[9px] font-black text-warning">TEST</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex rounded-pill border px-2 py-1 text-[10px] font-black', eventTone(row.event_type))}>
                          {eventLabel(row.event_type)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold text-text-secondary">{row.device_type ?? '-'}</td>
                      <td className="px-3 py-2.5 text-xs font-bold text-text-secondary">{row.browser ?? '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-text-muted" title={row.session_id ?? undefined}>{shortSession(row.session_id)}</td>
                    </tr>
                  ))}
                  {(board?.rows.length ?? 0) === 0 && (
                    <tr><td colSpan={6} className="px-3 py-10 text-center text-xs font-bold text-text-muted">조건에 맞는 로그인 이벤트가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <button
              type="button"
              disabled={page <= 0 || query.isFetching}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="rounded-card-md border border-line px-3 py-2 text-xs font-extrabold text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← 이전
            </button>
            <div className="text-xs font-extrabold text-text-muted">
              {page + 1} / {totalPages} 페이지
            </div>
            <button
              type="button"
              disabled={page + 1 >= totalPages || query.isFetching}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-card-md border border-line px-3 py-2 text-xs font-extrabold text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음 →
            </button>
          </div>
        </section>
      </div>
    </TeacherShell>
  );
}

function SummaryCard({
  label,
  value,
  suffix = '건',
  hint,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint: string;
}) {
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-4">
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl tracking-tight text-white">
        {value.toLocaleString()}<span className="ml-1 text-xs text-text-secondary">{suffix}</span>
      </div>
      <div className="mt-1 text-[10px] font-bold text-text-muted">{hint}</div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-black text-text-muted">{label}</span>
      {children}
    </label>
  );
}
