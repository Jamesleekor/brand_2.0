import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import {
  getAnalyticsDashboard,
  getArcadeStatistics,
  getAssetsStatistics,
  getAttendanceStatistics,
  getAchievementStatistics,
  getDataValidationReport,
  getEconomyStatistics,
  getGuildStatistics,
  getRecordCandidates,
  getStudentStatistics,
  refreshRecordCandidates,
  reviewRecordCandidate,
  type AnalyticsJson,
} from '@/lib/rpc/analytics_rpc';
import { cn } from '@/lib/utils/cn';

type TabKey =
  | 'dashboard'
  | 'student'
  | 'economy'
  | 'growth'
  | 'guild'
  | 'arcade'
  | 'attendance'
  | 'candidates'
  | 'validation';

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'dashboard', label: '종합', icon: '📊' },
  { key: 'student', label: '학생별 기록', icon: '👤' },
  { key: 'economy', label: '경제', icon: '💰' },
  { key: 'growth', label: '업적·편린·컬렉션', icon: '✨' },
  { key: 'guild', label: '길드', icon: '⚔️' },
  { key: 'arcade', label: '아케이드', icon: '🕹️' },
  { key: 'attendance', label: '출석', icon: '✅' },
  { key: 'candidates', label: '기록실 후보', icon: '🏛️' },
  { key: 'validation', label: '데이터 검증', icon: '🛡️' },
];

function kstYearMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

function numberText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : String(value);
}

function dateTimeText(value: unknown): string {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function asArray(value: unknown): AnalyticsJson[] {
  return Array.isArray(value) ? (value as AnalyticsJson[]) : [];
}

export default function AnalyticsPage() {
  const classroomId = useClassroomId();
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [yearMonth, setYearMonth] = useState(kstYearMonth());
  const [includeTest, setIncludeTest] = useState(false);

  return (
    <TeacherShell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">📊 통계 & 기록</h1>
            <p className="mt-1 text-sm font-bold text-text-secondary">
              누적 · 최고 · 최초 · 공식 기록을 원본 데이터에서 조회합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-2xs font-black text-text-muted">기준 월</span>
              <input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="rounded-card-md border border-line bg-bg-card px-3 py-2 text-xs font-bold text-white outline-none focus:border-line-brand"
              />
            </label>
            <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-card-md border border-line bg-bg-card px-3">
              <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
              <span className="text-xs font-bold text-text-secondary">TEST 포함</span>
            </label>
          </div>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-line pb-2">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                'flex-none rounded-card-md px-3 py-2 text-xs font-extrabold transition',
                tab === item.key
                  ? 'border border-line-brand bg-brand-primary/20 text-gold'
                  : 'border border-transparent text-text-secondary hover:bg-bg-card hover:text-white',
              )}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && <DashboardTab classroomId={classroomId} yearMonth={yearMonth} includeTest={includeTest} />}
        {tab === 'student' && <StudentTab classroomId={classroomId} yearMonth={yearMonth} includeTest={includeTest} />}
        {tab === 'economy' && <EconomyTab classroomId={classroomId} includeTest={includeTest} />}
        {tab === 'growth' && <GrowthTab classroomId={classroomId} includeTest={includeTest} />}
        {tab === 'guild' && <GuildTab classroomId={classroomId} yearMonth={yearMonth} includeTest={includeTest} />}
        {tab === 'arcade' && <ArcadeTab classroomId={classroomId} yearMonth={yearMonth} includeTest={includeTest} />}
        {tab === 'attendance' && <AttendanceTab classroomId={classroomId} includeTest={includeTest} />}
        {tab === 'candidates' && <CandidatesTab classroomId={classroomId} />}
        {tab === 'validation' && <ValidationTab classroomId={classroomId} includeTest={includeTest} />}
      </div>
    </TeacherShell>
  );
}

function DashboardTab({ classroomId, yearMonth, includeTest }: CommonMonthProps) {
  const query = useQuery({
    queryKey: ['analytics-dashboard', classroomId, yearMonth, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getAnalyticsDashboard(supabase, classroomId, yearMonth, includeTest);
    },
    enabled: classroomId !== null,
  });

  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;

  const data = query.data;
  const h = data.headline ?? {};
  const queue = data.candidate_queue ?? {};
  const validation = data.validation?.summary ?? {};
  const recent = asArray(queue.recent);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="공식 학생" value={h.official_student_count} suffix="명" />
        <Metric label="현재 GOLD" value={h.current_gold} />
        <Metric label="현재 BV" value={h.current_bv} />
        <Metric label="누적 기부" value={h.donation_total} />
        <Metric label="순수 세금" value={h.pure_tax_total} />
        <Metric label="균형발전 부담금" value={h.balance_development_burden_total} />
        <Metric label="업적" value={h.active_achievement_count} suffix="종" />
        <Metric label="편린" value={h.character_catalog_count} suffix="종" />
        <Metric label="컬렉션" value={h.collection_catalog_count} suffix="종" />
        <Metric label="아이템" value={h.item_catalog_count} suffix="종" />
        <Metric label="길드" value={h.guild_count} suffix="개" />
        <Metric label="Arcade" value={h.arcade_game_count} suffix="종" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="기록실 후보">
          <div className="text-2xl font-black text-gold">{numberText(queue.needs_action_count)}건</div>
          <div className="mt-1 text-xs font-bold text-text-muted">검토 대기 · PENDING + NEEDS_REVIEW</div>
          <div className="mt-3 text-2xs font-bold text-text-secondary">전체 후보 {numberText(queue.total_count)}건</div>
        </Panel>
        <Panel title="데이터 검증">
          <div className={cn('text-2xl font-black', validation.status === 'OK' ? 'text-success' : 'text-danger')}>
            {validation.status ?? '-'}
          </div>
          <div className="mt-2 text-xs font-bold text-text-secondary">
            ERROR {numberText(validation.error_issue_types)} · WARNING {numberText(validation.warning_issue_types)} · INFO {numberText(validation.info_issue_types)}
          </div>
        </Panel>
        <Panel title="기록실 현황">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="역사 기록" value={data.records_room?.active_historical_entries} suffix="건" compact />
            <Metric label="월간 MVP" value={data.records_room?.monthly_mvp_entries} suffix="건" compact />
          </div>
        </Panel>
      </div>

      <Panel title="최근 기록 후보">
        <SimpleTable
          headers={['시각', '유형', '대상', '기록', '상태']}
          rows={recent.map((row) => [
            dateTimeText(row.occurred_at),
            String(row.candidate_type ?? '-'),
            String(row.student_name_snapshot ?? row.guild_name_snapshot ?? '-'),
            String(row.record_title ?? '-'),
            String(row.status ?? '-'),
          ])}
          empty="대기 중인 후보가 없습니다."
        />
      </Panel>
    </div>
  );
}

function StudentTab({ classroomId, yearMonth, includeTest }: CommonMonthProps) {
  const [studentId, setStudentId] = useState<number | null>(null);
  const optionsQuery = useQuery({
    queryKey: ['analytics-student-options', classroomId, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getEconomyStatistics(supabase, classroomId, includeTest);
    },
    enabled: classroomId !== null,
  });
  const students = asArray(optionsQuery.data?.students);

  useEffect(() => {
    if (studentId === null && students.length > 0) setStudentId(Number(students[0].student_id));
  }, [studentId, students]);

  const query = useQuery({
    queryKey: ['analytics-student', classroomId, studentId, yearMonth, includeTest],
    queryFn: () => {
      if (classroomId === null || studentId === null) throw new Error('학생을 선택하세요.');
      return getStudentStatistics(supabase, classroomId, studentId, yearMonth, includeTest);
    },
    enabled: classroomId !== null && studentId !== null,
  });

  return (
    <div className="space-y-4">
      <Panel title="학생 선택">
        <select
          value={studentId ?? ''}
          onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : null)}
          className="w-full max-w-sm rounded-card-md border border-line bg-bg-deep px-3 py-2 text-sm font-bold text-white"
        >
          <option value="">학생 선택</option>
          {students.map((student) => (
            <option key={student.student_id} value={student.student_id}>
              {student.student_name}{student.is_test_account ? ' (TEST)' : ''}
            </option>
          ))}
        </select>
      </Panel>

      {(optionsQuery.isLoading || query.isLoading) && <LoadingSpinner />}
      {(optionsQuery.isError || query.isError) && <ErrorBox error={optionsQuery.error ?? query.error} retry={() => { void optionsQuery.refetch(); void query.refetch(); }} />}
      {query.data && <StudentRecord data={query.data} />}
    </div>
  );
}

function StudentRecord({ data }: { data: AnalyticsJson }) {
  const student = data.student ?? {};
  const activity = data.activity ?? {};
  const economy = data.economy ?? {};
  const achievement = data.achievements ?? {};
  const characters = data.characters ?? {};
  const collections = data.collections ?? {};
  const items = data.items ?? {};
  const attendance = data.attendance ?? {};
  const guild = data.guild ?? {};
  const arcade = data.arcade?.summary ?? {};

  return (
    <div className="space-y-4">
      <Panel title={`${student.student_name ?? '-'} · ${student.brand_name ?? '-'}`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Metric label="로그인 일수" value={activity.total_login_days} suffix="일" compact />
          <Metric label="로그인 횟수" value={activity.total_login_count} suffix="회" compact />
          <Metric label="현재 GOLD" value={economy.current_gold} compact />
          <Metric label="역대 최고 GOLD" value={economy.gold?.historical_max} compact />
          <Metric label="현재 BV" value={economy.current_bv} compact />
          <Metric label="역대 최고 BV" value={economy.bv?.historical_max} compact />
          <Metric label="업적" value={achievement.current_achievement_count} suffix="개" compact />
          <Metric label="편린 보유" value={characters.current_owned_count} suffix="종" compact />
          <Metric label="컬렉션 완성" value={collections.current_completed_count} suffix="개" compact />
          <Metric label="아이템 획득" value={items.cumulative_acquired_quantity} suffix="개" compact />
          <Metric label="최장 연속출석" value={attendance.max_streak} suffix="일" compact />
          <Metric label="Arcade 게임" value={arcade.different_games_played} suffix="종" compact />
        </div>
        <div className="mt-3 text-xs font-bold text-text-secondary">최근 활동: {dateTimeText(activity.recent_activity_at)}</div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <JsonDetails title="경제 상세" value={economy} />
        <JsonDetails title="업적 상세" value={achievement} />
        <JsonDetails title="편린·컬렉션·아이템" value={{ characters, collections, items }} />
        <JsonDetails title="길드·아케이드·출석" value={{ guild, arcade: data.arcade, attendance }} />
      </div>
    </div>
  );
}

function EconomyTab({ classroomId, includeTest }: CommonProps) {
  const query = useQuery({
    queryKey: ['analytics-economy', classroomId, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getEconomyStatistics(supabase, classroomId, includeTest);
    },
    enabled: classroomId !== null,
  });
  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;
  const students = asArray(query.data.students);
  const summary = query.data.class_summary ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="학급 GOLD" value={summary.current_gold} />
        <Metric label="학급 BV" value={summary.current_bv} />
        <Metric label="누적 순수 세금" value={summary.pure_tax_total} />
        <Metric label="누적 부담금" value={summary.balance_development_burden_total} />
        <Metric label="누적 기부" value={summary.donation_total} />
      </div>
      <Panel title="학생별 경제 기록">
        <SimpleTable
          headers={['학생', 'GOLD', 'GOLD 최고', '누적 획득', '누적 소비', 'BV', 'BV 최고', '세금', '부담금', '기부']}
          rows={students.map((s) => [
            s.student_name,
            numberText(s.current_gold),
            numberText(s.gold?.historical_max),
            numberText(s.gold?.cumulative_earned),
            numberText(s.gold?.cumulative_spent),
            numberText(s.current_bv),
            numberText(s.bv?.historical_max),
            numberText(s.tax_donation?.pure_tax_total),
            numberText(s.tax_donation?.balance_development_burden),
            numberText(s.tax_donation?.donation_total),
          ])}
        />
      </Panel>
      <JsonDetails title="월별 세금·기부 / TOP3 / coverage" value={{ class_summary: summary, coverage: query.data.coverage }} />
    </div>
  );
}

function GrowthTab({ classroomId, includeTest }: CommonProps) {
  const query = useQuery({
    queryKey: ['analytics-growth', classroomId, includeTest],
    queryFn: async () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      const [achievements, assets] = await Promise.all([
        getAchievementStatistics(supabase, classroomId, includeTest),
        getAssetsStatistics(supabase, classroomId, includeTest),
      ]);
      return { achievements, assets };
    },
    enabled: classroomId !== null,
  });
  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;

  const achievements = query.data.achievements;
  const assets = query.data.assets;
  const students = asArray(achievements.students);
  const transcendent = asArray(achievements.transcendent?.achievements);
  const characters = asArray(assets.characters?.catalog);
  const collections = asArray(assets.collections?.catalog);
  const items = asArray(assets.items?.catalog);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="활성 업적" value={achievements.active_catalog_count} suffix="종" />
        <Metric label="초월 업적" value={transcendent.length} suffix="종" />
        <Metric label="편린" value={characters.length} suffix="종" />
        <Metric label="컬렉션" value={collections.length} suffix="종" />
      </div>

      <Panel title="학생별 성장 기록">
        <SimpleTable
          headers={['학생', '현재 업적', '평생 업적', '초월', '히든', '완성률']}
          rows={students.map((s) => [s.student_name, numberText(s.current_achievement_count), numberText(s.lifetime_ever_achievement_count), numberText(s.transcend_count), numberText(s.hidden_count), `${numberText(s.completion_percent)}%`])}
        />
      </Panel>

      <Panel title="초월 업적">
        <SimpleTable
          headers={['업적', '역대 달성자', '현재 달성자', '최초 달성자', '최초 시각']}
          rows={transcendent.map((a) => [a.name, numberText(a.total_ever_achievers), numberText(a.current_achievers), a.first_valid_achiever?.student_name ?? '-', dateTimeText(a.first_valid_achiever?.achieved_at)])}
        />
      </Panel>

      <Panel title="편린 최초 기록">
        <SimpleTable
          headers={['편린', '현재 보유자', '알려진 역대 획득자', '최초 획득자', '최초 시각', '정확도']}
          rows={characters.map((c) => [c.name, numberText(c.current_owners), numberText(c.total_known_acquirers), c.first_known_acquirer?.student_name ?? '-', dateTimeText(c.first_known_acquirer?.first_known_at), c.first_known_acquirer?.quality ?? '-'])}
        />
      </Panel>

      <Panel title="컬렉션 최초 완성">
        <SimpleTable
          headers={['컬렉션', '현재 완성자', '역대 완성자', '최초 완성자', '최초 완성']}
          rows={collections.map((c) => [c.collection_name, numberText(c.current_completers), numberText(c.total_ever_completers), c.first_completer?.student_name ?? '-', dateTimeText(c.first_completer?.completed_at)])}
        />
      </Panel>

      <Panel title="아이템 기록">
        <SimpleTable
          headers={['아이템', '총 지급', '총 소비', '역대 수령자', '현재 보유자', '최초 수령자']}
          rows={items.map((i) => [i.name, numberText(i.total_issued_quantity), numberText(i.total_consumed_quantity), numberText(i.total_recipients), numberText(i.current_holders), i.first_recipient?.student_name ?? '-'])}
        />
      </Panel>
    </div>
  );
}

function GuildTab({ classroomId, yearMonth, includeTest }: CommonMonthProps) {
  const query = useQuery({
    queryKey: ['analytics-guild', classroomId, yearMonth, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getGuildStatistics(supabase, classroomId, yearMonth, includeTest);
    },
    enabled: classroomId !== null,
  });
  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;
  const guilds = asArray(query.data.guild_rows);
  const students = asArray(query.data.student_rows);

  return (
    <div className="space-y-4">
      <InfoStrip>진행 중 점수는 LIVE, 역사 기록은 guild5 FINALIZED snapshot만 사용합니다.</InfoStrip>
      <Panel title="길드 현황">
        <SimpleTable
          headers={['길드', 'LIVE 점수', 'LIVE 순위', '공식 시즌 누적', '월간 1위', 'TOP3', '미션 성공률']}
          rows={guilds.map((g) => [g.name, numberText(g.live_month_score), numberText(g.live_month_rank), numberText(g.season_official_score), numberText(g.monthly_first_count), numberText(g.monthly_top3_count), g.mission_success_rate_pct === null ? '-' : `${numberText(g.mission_success_rate_pct)}%`])}
        />
      </Panel>
      <Panel title="학생별 길드 기여">
        <SimpleTable
          headers={['학생', '길드', 'LIVE 기여', '시즌 공식', '평생 공식', '최고 월', '미션 참가']}
          rows={students.map((s) => [s.student_name, s.live_guild_name ?? '-', numberText(s.live_month_contribution), numberText(s.season_official_contribution), numberText(s.lifetime_official_contribution), numberText(s.best_monthly_contribution), numberText(s.mission_participation_count)])}
        />
      </Panel>
    </div>
  );
}

function ArcadeTab({ classroomId, yearMonth, includeTest }: CommonMonthProps) {
  const query = useQuery({
    queryKey: ['analytics-arcade', classroomId, yearMonth, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getArcadeStatistics(supabase, classroomId, yearMonth, includeTest);
    },
    enabled: classroomId !== null,
  });
  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;
  const games = asArray(query.data.games);
  const rows = asArray(query.data.student_game_rows);

  return (
    <div className="space-y-4">
      <InfoStrip>
        현재 기간: {String(query.data.scope?.monthly_period_status ?? '없음')} · 공식 월간 기록은 FINALIZED snapshot만 집계합니다.
      </InfoStrip>
      <Panel title="게임 현황">
        <SimpleTable
          headers={['게임', '비교 규칙', '플레이', '검증 성공', '검증 실패', '집계 시작']}
          rows={games.map((g) => [g.game_name, g.comparison_mode ?? '미설정', numberText(g.play_count), numberText(g.verified_count), numberText(g.rejected_count), dateTimeText(g.tracking_start_at)])}
        />
      </Panel>
      <Panel title="학생 × 게임 기록">
        <SimpleTable
          headers={['학생', '게임', '플레이', 'PB', '현재 순위', '월간 1위', 'TOP3', 'TOP10', '최장 연속 TOP10']}
          rows={rows.map((r) => [r.student_name, r.game_name, numberText(r.play_count), numberText(r.all_time_pb), numberText(r.current_period_rank), numberText(r.monthly_win_count), numberText(r.monthly_top3_count), numberText(r.monthly_top10_count), numberText(r.max_consecutive_top10)])}
        />
      </Panel>
    </div>
  );
}

function AttendanceTab({ classroomId, includeTest }: CommonProps) {
  const query = useQuery({
    queryKey: ['analytics-attendance', classroomId, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getAttendanceStatistics(supabase, classroomId, includeTest);
    },
    enabled: classroomId !== null,
  });
  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;
  const students = asArray(query.data.students);
  return (
    <div className="space-y-4">
      <InfoStrip>연속출석은 기존 운영 규칙 그대로 PRESENT·LATE·EXCUSED 유지, ABSENT 중단입니다.</InfoStrip>
      <Panel title="학생별 출석 기록">
        <SimpleTable
          headers={['학생', '출석', '불참', '인정결석', '현재 연속', '최장 연속', '최초 기록', '최근 기록']}
          rows={students.map((s) => [s.student_name, numberText(s.attendance_count), numberText(s.absent_count), numberText(s.excused_count), numberText(s.current_streak), numberText(s.max_streak), String(s.first_recorded_date ?? '-'), String(s.recent_recorded_date ?? '-')])}
        />
      </Panel>
    </div>
  );
}

function CandidatesTab({ classroomId }: { classroomId: number | null }) {
  const [status, setStatus] = useState<string>('PENDING');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const limit = 100;
  const query = useQuery({
    queryKey: ['analytics-candidates', classroomId, status, page],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getRecordCandidates(supabase, classroomId, status || null, null, limit, page * limit);
    },
    enabled: classroomId !== null,
  });

  const rows = asArray(query.data?.rows);
  const total = Number(query.data?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const refresh = async () => {
    if (classroomId === null) return;
    setBusy('refresh');
    try {
      await refreshRecordCandidates(supabase, classroomId);
      await query.refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : '후보 새로고침 실패');
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: number, decision: 'APPROVED' | 'IGNORED' | 'REJECTED') => {
    const message = decision === 'APPROVED'
      ? '이 후보를 승인하고 기록실에 등록할까요?'
      : decision === 'IGNORED'
        ? '이 후보를 무시 처리할까요?'
        : '이 후보를 거절 처리할까요?';
    if (!confirm(message)) return;
    setBusy(`${decision}:${id}`);
    try {
      await reviewRecordCandidate(supabase, id, decision);
      await query.refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : '후보 처리 실패');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="후보 큐">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex gap-2">
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(0); }}
              className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white"
            >
              <option value="PENDING">PENDING</option>
              <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
              <option value="APPROVED">APPROVED</option>
              <option value="IGNORED">IGNORED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="">전체</option>
            </select>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void refresh()}
              className="rounded-card-md border border-line-brand bg-brand-primary/15 px-3 py-2 text-xs font-black text-gold disabled:opacity-40"
            >
              {busy === 'refresh' ? '새로고침 중…' : '후보 다시 탐색'}
            </button>
          </div>
          <div className="text-xs font-bold text-text-muted">총 {numberText(total)}건</div>
        </div>
      </Panel>

      {query.isLoading && <LoadingSpinner />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-gold">{row.candidate_type}</span>
                  <span className={cn('rounded-pill border px-2 py-0.5 text-[10px] font-black', row.status === 'NEEDS_REVIEW' ? 'border-warning/40 text-warning' : 'border-line text-text-muted')}>
                    {row.status}
                  </span>
                  <span className="text-[10px] font-bold text-text-muted">{row.coverage}</span>
                </div>
                <div className="mt-1 text-sm font-extrabold text-white">{row.record_title}</div>
                <div className="mt-1 text-xs font-bold text-text-secondary">
                  {row.student_name_snapshot ?? row.guild_name_snapshot ?? '-'} · {dateTimeText(row.occurred_at)}
                  {row.value_numeric !== null && row.value_numeric !== undefined ? ` · ${numberText(row.value_numeric)} ${row.record_unit ?? ''}` : ''}
                </div>
              </div>
              {(row.status === 'PENDING' || row.status === 'NEEDS_REVIEW') && (
                <div className="flex gap-1">
                  <ActionButton disabled={busy !== null} onClick={() => void decide(Number(row.id), 'APPROVED')}>승인</ActionButton>
                  <ActionButton disabled={busy !== null} onClick={() => void decide(Number(row.id), 'IGNORED')}>무시</ActionButton>
                  <ActionButton disabled={busy !== null} danger onClick={() => void decide(Number(row.id), 'REJECTED')}>거절</ActionButton>
                </div>
              )}
            </div>
          </div>
        ))}
        {!query.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm font-bold text-text-muted">표시할 후보가 없습니다.</div>}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-card-md border border-line px-3 py-2 text-xs font-bold text-text-secondary disabled:opacity-30">← 이전</button>
        <span className="text-xs font-bold text-text-muted">{page + 1} / {totalPages}</span>
        <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-card-md border border-line px-3 py-2 text-xs font-bold text-text-secondary disabled:opacity-30">다음 →</button>
      </div>
    </div>
  );
}

function ValidationTab({ classroomId, includeTest }: CommonProps) {
  const query = useQuery({
    queryKey: ['analytics-validation', classroomId, includeTest],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getDataValidationReport(supabase, classroomId, includeTest);
    },
    enabled: classroomId !== null,
  });
  if (query.isLoading) return <LoadingSpinner />;
  if (query.isError || !query.data) return <ErrorBox error={query.error} retry={() => void query.refetch()} />;
  const summary = query.data.summary ?? {};
  const issues = asArray(query.data.issues);

  return (
    <div className="space-y-4">
      <Panel title="검증 상태">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="상태" value={summary.status ?? '-'} compact />
          <Metric label="ERROR" value={summary.error_issue_types} compact />
          <Metric label="WARNING" value={summary.warning_issue_types} compact />
          <Metric label="INFO" value={summary.info_issue_types} compact />
        </div>
      </Panel>
      <Panel title="발견된 항목">
        {issues.length === 0 ? (
          <div className="py-8 text-center text-sm font-bold text-success">오류나 경고가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {issues.map((issue, index) => (
              <div key={`${issue.code}-${index}`} className="rounded-card-md border border-line bg-bg-deep p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-black', issue.severity === 'ERROR' ? 'text-danger' : issue.severity === 'WARNING' ? 'text-warning' : 'text-text-muted')}>{issue.severity}</span>
                  <span className="text-xs font-extrabold text-white">{issue.code}</span>
                  <span className="text-xs font-black text-text-muted">× {numberText(issue.count)}</span>
                </div>
                <div className="mt-1 text-xs font-bold text-text-secondary">{issue.message}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <JsonDetails title="도메인별 검증 상세" value={query.data.sections} />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card-lg border border-line bg-bg-card p-4">
      <h2 className="mb-3 font-display text-base text-white">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value, suffix = '', compact = false }: { label: string; value: unknown; suffix?: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-card-lg border border-line bg-bg-card', compact ? 'p-3' : 'p-4')}>
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className={cn('mt-1 font-display tracking-tight text-white', compact ? 'text-lg' : 'text-xl')}>
        {typeof value === 'string' && Number.isNaN(Number(value)) ? value : numberText(value)}{suffix && <span className="ml-1 text-xs text-text-secondary">{suffix}</span>}
      </div>
    </div>
  );
}

function SimpleTable({ headers, rows, empty = '데이터가 없습니다.' }: { headers: string[]; rows: Array<Array<ReactNode>>; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left">
        <thead>
          <tr className="border-b border-line text-2xs font-black text-text-muted">
            {headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line/60 last:border-0">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2.5 text-xs font-bold text-text-secondary">{cell}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={headers.length} className="px-3 py-8 text-center text-xs font-bold text-text-muted">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ErrorBox({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="rounded-card-lg border border-danger/40 bg-danger/10 p-4">
      <div className="text-sm font-black text-danger">데이터를 불러오지 못했습니다.</div>
      <div className="mt-1 break-all text-xs font-bold text-text-secondary">{error instanceof Error ? error.message : String(error ?? '알 수 없는 오류')}</div>
      <button type="button" onClick={retry} className="mt-3 rounded-card-md border border-danger/30 px-3 py-1.5 text-xs font-black text-danger">다시 시도</button>
    </div>
  );
}

function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="rounded-card-lg border border-line bg-bg-card p-4">
      <summary className="cursor-pointer text-sm font-extrabold text-white">{title}</summary>
      <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-card-md bg-bg-deep p-3 text-[10px] leading-relaxed text-text-secondary">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </details>
  );
}

function InfoStrip({ children }: { children: ReactNode }) {
  return <div className="rounded-card-md border border-line-brand/40 bg-brand-primary/10 px-4 py-3 text-xs font-bold text-text-secondary">{children}</div>;
}

function ActionButton({ children, onClick, disabled, danger = false }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn('rounded-card-md border px-2.5 py-1.5 text-[11px] font-black disabled:opacity-40', danger ? 'border-danger/40 text-danger' : 'border-line text-text-secondary hover:text-white')}
    >
      {children}
    </button>
  );
}

type CommonProps = { classroomId: number | null; includeTest: boolean };
type CommonMonthProps = CommonProps & { yearMonth: string };
