import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { arcadeErrorMessage, arcadeTeacherRpc } from '@/lib/rpc/arcade_rpc';
import type { ArcadeVerificationHistoryResult } from '@/lib/zod_schemas/arcade_schemas';

// 공인 인증 1·2·3차 기록 조회 (교사 전용, 읽기 전용)
// 업적 판정 규칙은 서버의 _achievement_helper_arcade_evidence_v5 와 동일합니다.
//   ARC-003 검증된 실력   : 1차 기회에서 인증 기준점 이상
//   ARC-010 진짜 최고기록 : 인증 시작 당시 잠정 최고기록보다 높은 인증 점수
//   ARC-018 최후의 도전   : 같은 세션에서 1·2차 기준 미달(유효 기록) 후 3차 기준 이상

type StudentRow = ArcadeVerificationHistoryResult['students'][number];
type SessionRow = StudentRow['sessions'][number];
type AttemptRow = SessionRow['attempts'][number];
type PeriodRow = { id: number; display_name: string; period_kind: string; status: string; starts_at: string };

const PERIOD_STATUS: Record<string, string> = { ACTIVE: '기록 접수 중', VERIFICATION: '인증 중', READY_TO_FINALIZE: '확정 대기', FINALIZED: '확정 완료' };
const SESSION_STATUS: Record<string, string> = { ACTIVE: '진행 중', COMPLETED: '완료', RESET: '초기화된 세션', OVERRIDDEN: '교사 처리로 대체' };
const OUTCOME: Record<string, string> = {
  FALSE_START_PRE_SIGNAL: '부정 출발',
  FALSE_START_UNDER_120MS: '부정 출발(120ms 미만)',
  REACTION_TIMEOUT: '반응 시간 초과',
  SERVER_TIME_MISMATCH: '시간 검증 실패',
  SERVER_TIME_TOO_EARLY: '시간 검증 실패',
  REPLAY_REJECTED: '입력 검증 실패',
  INPUT_EVENTS_INVALID: '입력 형식 오류',
  TECHNICAL_CANCELLED: '기술 취소',
};

function score(value: number | null | undefined) { return value === null || value === undefined ? '—' : Number(value).toLocaleString('ko-KR'); }

export function TeacherArcadeVerificationHistoryPanel({ classroomId, gameCode, gameLabel }: { classroomId: number | null; gameCode: string; gameLabel: string }) {
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [onlyAchievers, setOnlyAchievers] = useState(false);

  const periods = useQuery({
    queryKey: ['teacher-arcade-history-periods', classroomId],
    enabled: classroomId !== null,
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('arcade_ranking_periods')
        .select('id,display_name,period_kind,status,starts_at')
        .eq('classroom_id', classroomId!).eq('period_kind', 'MONTHLY').neq('status', 'DRAFT')
        .order('starts_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PeriodRow[];
    },
  });
  const available = periods.data ?? [];
  // 기본값: 인증이 진행됐거나 끝난 가장 최근 달
  const period = available.find((item) => item.id === selectedPeriodId)
    ?? available.find((item) => item.status !== 'ACTIVE') ?? available[0];

  const history = useQuery({
    queryKey: ['teacher-arcade-verification-history', classroomId, period?.id, gameCode],
    enabled: classroomId !== null && Boolean(period),
    staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await arcadeTeacherRpc.getVerificationHistory(supabase, { p_period_id: period!.id, p_game_code: gameCode });
      if (result.success === false) throw new Error(arcadeErrorMessage(result));
      return result.data;
    },
  });

  const students = history.data?.students ?? [];
  const summary = useMemo(() => ({
    arc003: students.filter((s) => s.sessions.some((x) => x.arc003_first_try_success)).length,
    arc010: students.filter((s) => s.sessions.some((x) => x.arc010_beat_provisional)).length,
    arc018: students.filter((s) => s.sessions.some((x) => x.arc018_third_try_success)).length,
  }), [students]);
  const visible = onlyAchievers
    ? students.filter((s) => s.sessions.some((x) => x.arc003_first_try_success || x.arc010_beat_provisional || x.arc018_third_try_success))
    : students;
  const error = periods.error ?? history.error;
  const busy = periods.isFetching || history.isFetching;

  return (
    <section className="glass-card border-gold/35 p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="text-xs font-black tracking-[0.16em] text-gold">VERIFICATION ATTEMPT HISTORY</div>
          <h2 className="mt-1 font-display text-lg text-white">📜 {gameLabel} · 공인 인증 기록 조회</h2>
          <p className="mt-2 text-xs leading-5 text-white/85">학생별 1·2·3차 공인 인증 점수를 확정된 달까지 모두 조회합니다. 업적 판정은 업적 확인 도우미와 같은 규칙을 씁니다. 이 화면은 기록을 바꾸지 않습니다.</p>
        </div>
        <button className="btn-secondary shrink-0 text-xs" disabled={busy || !period} onClick={() => { void periods.refetch(); void history.refetch(); }}>
          {busy ? '불러오는 중...' : '새로고침'}
        </button>
      </div>

      <label className="mt-4 block text-xs font-bold text-white">조회할 달
        <select className="input-field mt-1 w-full" value={period?.id ?? ''} disabled={!available.length} onChange={(event) => setSelectedPeriodId(Number(event.target.value))}>
          {!available.length && <option value="">월간 기간 없음</option>}
          {available.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {PERIOD_STATUS[item.status] ?? item.status}</option>)}
        </select>
      </label>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <AchievementSummary code="ARC-003" title="검증된 실력" rule="1차에서 인증 기준 이상" count={summary.arc003} />
        <AchievementSummary code="ARC-010" title="진짜 최고기록" rule="인증 시작 당시 잠정 최고기록 갱신" count={summary.arc010} />
        <AchievementSummary code="ARC-018" title="최후의 도전" rule="1·2차 기준 미달 후 3차 성공" count={summary.arc018} />
      </div>

      <label className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-white">
        <input type="checkbox" checked={onlyAchievers} onChange={(event) => setOnlyAchievers(event.target.checked)} />
        업적 조건을 만족한 학생만 보기
      </label>

      {error && <div className="mt-4 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">인증 기록을 불러오지 못했습니다. {error instanceof Error ? error.message : String(error)}</div>}
      {!error && busy && !history.data && <p className="mt-4 text-sm text-white">인증 기록을 불러오는 중...</p>}
      {!periods.isPending && !error && !available.length && <p className="mt-4 text-sm text-white">조회할 월간 기간이 없습니다.</p>}
      {history.data && !error && !students.length && <p className="mt-4 rounded-card-md border border-line bg-bg-deep p-4 text-sm text-white">이 달에는 {gameLabel} 공인 인증 기록이 없습니다.</p>}

      {history.data && !error && students.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-card-md border border-line">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="bg-bg-deep text-white"><tr>
              <th className="px-3 py-3">학생</th>
              <th className="px-3 py-3 text-right">잠정 최고<br />(인증 시작 당시)</th>
              <th className="px-3 py-3 text-right">인증 기준점</th>
              <th className="px-3 py-3">1차</th><th className="px-3 py-3">2차</th><th className="px-3 py-3">3차</th>
              <th className="px-3 py-3">성공 차수</th>
              <th className="px-3 py-3">업적 조건</th>
              <th className="px-3 py-3 text-right">최종 공식 기록</th>
            </tr></thead>
            <tbody className="divide-y divide-line/70 text-white">
              {visible.map((student) => <StudentRows key={student.student_id} student={student} />)}
            </tbody>
          </table>
        </div>
      )}
      {history.data && !error && students.length > 0 && (
        <p className="mt-3 text-[11px] leading-5 text-white/80">
          · 차수 칸은 그 기회에서 최종으로 기록된 판(기술 취소 뒤 다시 한 판 포함)을 보여 줍니다. 기술 취소·복구된 판은 칸 아래에 따로 표시하며 업적 판정에는 쓰지 않습니다.<br />
          · 교사가 초기화하거나 대체 처리한 이전 세션도 업적 확인 도우미와 똑같이 판정에 포함합니다. ‘이전 세션’ 줄에서 확인하세요.
        </p>
      )}
    </section>
  );
}

function AchievementSummary({ code, title, rule, count }: { code: string; title: string; rule: string; count: number }) {
  return (
    <div className={`rounded-card-md border px-3 py-2 ${count > 0 ? 'border-gold/60 bg-gold/10' : 'border-line bg-bg-deep'}`}>
      <div className="text-[10px] font-black tracking-[0.12em] text-gold">{code}</div>
      <div className="mt-0.5 text-sm font-black text-white">{title} · {count}명</div>
      <div className="mt-0.5 text-[11px] font-semibold text-white/80">{rule}</div>
    </div>
  );
}

function StudentRows({ student }: { student: StudentRow }) {
  const [main, ...older] = student.sessions;
  const [showOlder, setShowOlder] = useState(false);
  return <>
    <SessionTableRow student={student} session={main} isMain olderCount={older.length} showOlder={showOlder} onToggleOlder={() => setShowOlder((value) => !value)} />
    {showOlder && older.map((session) => <SessionTableRow key={session.session_id} student={student} session={session} isMain={false} />)}
  </>;
}

function SessionTableRow({ student, session, isMain, olderCount = 0, showOlder = false, onToggleOlder }: {
  student: StudentRow; session: SessionRow; isMain: boolean; olderCount?: number; showOlder?: boolean; onToggleOlder?: () => void;
}) {
  const byOpportunity = [1, 2, 3].map((opp) => pickAttempt(session.attempts, opp));
  const sideAttempts = session.attempts.filter((attempt) => attempt.status === 'TECHNICAL_CANCELLED' || attempt.status === 'RESTORED');
  return (
    <tr className={`align-top ${isMain ? '' : 'bg-bg-deep/60'}`}>
      <td className="px-3 py-3">
        {isMain ? <>
          <b className="text-white">{student.brand_name || student.student_name}</b>
          <div className="mt-1 text-[10px] text-white/80">{student.student_name} · ID {student.student_id}</div>
        </> : <div className="pl-3 text-[11px] font-bold text-white/85">↳ 이전 세션</div>}
        <div className="mt-1 text-[10px] font-bold text-gold">{SESSION_STATUS[session.status] ?? session.status}{session.is_decisive ? ' · 최종 판정 세션' : ''}</div>
        {isMain && olderCount > 0 && (
          <button type="button" className="mt-1 text-[10px] font-black text-brand-primary underline" onClick={onToggleOlder}>
            {showOlder ? '이전 세션 접기' : `이전 세션 ${olderCount}개 보기`}
          </button>
        )}
      </td>
      <td className="px-3 py-3 text-right font-bold">{session.provisional_score === null ? '일반 기록 없음' : score(session.provisional_score)}</td>
      <td className="px-3 py-3 text-right">{session.verification_threshold === null ? '기준 없음' : <>{score(session.verification_threshold)}<div className="text-[10px] text-white/80">{session.threshold_percent}%</div></>}</td>
      {byOpportunity.map((attempt, index) => <AttemptCell key={index} attempt={attempt} hasThreshold={session.verification_threshold !== null} />)}
      <td className="px-3 py-3 font-black">
        {session.first_success_opportunity ? <span className="text-success">{session.first_success_opportunity}차 성공</span> : session.verification_threshold === null ? '판정 없음' : '성공 없음'}
        {sideAttempts.length > 0 && <div className="mt-1 text-[10px] font-semibold text-white/80">기술 취소·복구 {sideAttempts.length}판</div>}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <Badge on={session.arc003_first_try_success} label="ARC-003 검증된 실력" />
          <Badge on={session.arc010_beat_provisional} label="ARC-010 진짜 최고기록" />
          <Badge on={session.arc018_third_try_success} label="ARC-018 최후의 도전" />
        </div>
      </td>
      <td className="px-3 py-3 text-right">
        {isMain ? (student.decision_kind === null ? <span className="text-white/85">미확정</span>
          : student.ranking_eligible ? <b className="text-gold">{score(student.official_score)}</b>
          : <span className="text-warning">공식 기록 없음</span>) : ''}
      </td>
    </tr>
  );
}

// 같은 차수에 여러 판이 있으면(기술 취소 뒤 재발급) 실제로 소비된 마지막 판을 보여 줍니다.
function pickAttempt(attempts: AttemptRow[], opportunity: number) {
  const same = attempts.filter((attempt) => attempt.opportunity_number === opportunity);
  const terminal = same.filter((attempt) => attempt.status === 'TERMINAL' || attempt.status === 'ISSUED');
  const pool = terminal.length ? terminal : same;
  return pool.length ? pool[pool.length - 1] : null;
}

function AttemptCell({ attempt, hasThreshold }: { attempt: AttemptRow | null; hasThreshold: boolean }) {
  if (!attempt) return <td className="px-3 py-3 text-white/80">—</td>;
  if (attempt.status === 'ISSUED') return <td className="px-3 py-3 text-gold">진행 중</td>;
  if (attempt.status !== 'TERMINAL') return <td className="px-3 py-3 text-white/85">{OUTCOME[attempt.terminal_outcome ?? ''] ?? attempt.status}</td>;
  if (!attempt.valid_run || attempt.official_score === null) {
    return <td className="px-3 py-3"><span className="font-bold text-warning">{OUTCOME[attempt.terminal_outcome ?? ''] ?? '유효 기록 없음'}</span><div className="text-[10px] text-white/80">기회 사용됨</div></td>;
  }
  return (
    <td className="px-3 py-3">
      <b className="text-sm text-white">{score(attempt.official_score)}</b>
      {hasThreshold
        ? <div className={`mt-0.5 text-[10px] font-black ${attempt.meets_threshold ? 'text-success' : 'text-warning'}`}>{attempt.meets_threshold ? '✔ 기준 통과' : '기준 미달'}</div>
        : <div className="mt-0.5 text-[10px] font-black text-white/85">기준 없음 · 신규 기록</div>}
      {attempt.beats_provisional && <div className="mt-0.5 text-[10px] font-black text-gold">🔥 잠정 최고 돌파</div>}
    </td>
  );
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return <span className={`w-fit rounded-pill px-2 py-0.5 text-[10px] font-black ${on ? 'bg-success/15 text-success' : 'bg-bg-card text-white/70'}`}>{on ? '✔ ' : ''}{label}</span>;
}
