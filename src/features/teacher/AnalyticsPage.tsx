import { useEffect, useState, type ReactNode } from 'react';
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

type SortDirection = 'asc' | 'desc';
type SortOption = { value: string; label: string };

type TableColumn = {
  key: string;
  label: string;
  render: (row: AnalyticsJson) => ReactNode;
  align?: 'left' | 'right' | 'center';
};

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'dashboard', label: '종합', icon: '📊' },
  { key: 'student', label: '학생별 기록', icon: '👤' },
  { key: 'economy', label: '경제', icon: '💰' },
  { key: 'growth', label: '성장·수집', icon: '✨' },
  { key: 'guild', label: '길드', icon: '⚔️' },
  { key: 'arcade', label: '아케이드', icon: '🕹️' },
  { key: 'attendance', label: '출석', icon: '✅' },
  { key: 'candidates', label: '기록실 후보', icon: '🏛️' },
  { key: 'validation', label: '데이터 검증', icon: '🛡️' },
];

const CANDIDATE_TYPES = [
  ['ACHIEVEMENT_FIRST_EARNED', '업적 최초 달성'],
  ['UNIQUE_ACHIEVEMENT_FIRST_EARNED', '유일 업적 최초 달성'],
  ['FIRST_TRANSCENDENT_ACHIEVER', '최초 초월 달성자'],
  ['FRAGMENT_FIRST_ACQUIRED', '편린 최초 획득'],
  ['COLLECTION_FIRST_COMPLETED', '컬렉션 최초 완성'],
  ['SPECIAL_ITEM_FIRST_ACQUIRED', '특별 아이템 최초 획득'],
  ['TIER_FIRST_REACHED', '티어 최초 도달'],
  ['GOLD_THRESHOLD_FIRST_REACHED', 'GOLD 임계점 최초 도달'],
  ['GUILD_MONTHLY_WIN', '길드 월간 1위'],
  ['ARCADE_MONTHLY_WIN', '아케이드 월간 1위'],
] as const;

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

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function numericValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function sortRows(
  rows: AnalyticsJson[],
  getter: (row: AnalyticsJson) => unknown,
  direction: SortDirection,
): AnalyticsJson[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);
    if (av === null || av === undefined || av === '') return bv === null || bv === undefined || bv === '' ? 0 : 1;
    if (bv === null || bv === undefined || bv === '') return -1;
    if (typeof av === 'number' || typeof bv === 'number') {
      return (numericValue(av) - numericValue(bv)) * factor;
    }
    return textValue(av).localeCompare(textValue(bv), 'ko', { numeric: true }) * factor;
  });
}

function filterByQuery(rows: AnalyticsJson[], query: string, getter: (row: AnalyticsJson) => string): AnalyticsJson[] {
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  if (!needle) return rows;
  return rows.filter((row) => getter(row).toLocaleLowerCase('ko-KR').includes(needle));
}

function statusLabel(status: unknown): string {
  if (status === 'PENDING') return '대기';
  if (status === 'NEEDS_REVIEW') return '확인 필요';
  if (status === 'APPROVED') return '승인';
  if (status === 'IGNORED') return '무시';
  if (status === 'REJECTED') return '거절';
  return String(status ?? '-');
}

function candidateTypeLabel(type: unknown): string {
  const found = CANDIDATE_TYPES.find(([value]) => value === type);
  return found?.[1] ?? String(type ?? '-');
}

function coverageLabel(value: unknown): string {
  if (value === 'EXACT') return '완전';
  if (value === 'EXACT_RECONSTRUCTED') return '완전 복구';
  if (value === 'PARTIAL_BACKFILL') return '부분 복구';
  if (value === 'PROSPECTIVE_ONLY') return '이후 집계';
  return String(value ?? '-');
}

export default function AnalyticsPage() {
  const classroomId = useClassroomId();
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [yearMonth, setYearMonth] = useState(kstYearMonth());
  const [includeTest, setIncludeTest] = useState(false);

  return (
    <TeacherShell>
      <div className="space-y-3">
        <section className="rounded-card-lg border border-line bg-bg-card/80 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-card-md border border-line-brand/40 bg-brand-primary/15 text-lg">📊</div>
              <div className="min-w-0">
                <h1 className="font-display text-xl tracking-tight text-brand-gradient">통계 & 기록</h1>
                <p className="truncate text-2xs font-bold text-text-muted">누적 · 최고 · 최초 · FINALIZED 공식 기록</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CompactField label="기준 월">
                <input
                  type="month"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  className="h-8 rounded-card-md border border-line bg-bg-deep px-2.5 text-xs font-bold text-white outline-none focus:border-line-brand"
                />
              </CompactField>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-card-md border border-line bg-bg-deep px-2.5">
                <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
                <span className="text-2xs font-black text-text-secondary">TEST 포함</span>
              </label>
            </div>
          </div>
        </section>

        <nav className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto border-b border-line bg-bg-deep/95 px-1 py-1.5 backdrop-blur">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                'flex h-8 flex-none items-center gap-1.5 rounded-card-md px-2.5 text-2xs font-black transition',
                tab === item.key
                  ? 'border border-line-brand bg-brand-primary/20 text-gold'
                  : 'border border-transparent text-text-muted hover:bg-bg-card hover:text-white',
              )}
            >
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>

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
  const [sortKey, setSortKey] = useState('occurred_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
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
  const recent = sortRows(asArray(queue.recent), (row) => {
    if (sortKey === 'type') return candidateTypeLabel(row.candidate_type);
    if (sortKey === 'subject') return row.student_name_snapshot ?? row.guild_name_snapshot ?? '';
    if (sortKey === 'status') return row.status;
    return row.occurred_at;
  }, sortDirection);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 xl:grid-cols-4">
        <ClusterPanel title="학급 자산" icon="💎" tone="brand">
          <InlineMetric label="공식 학생" value={h.official_student_count} suffix="명" />
          <InlineMetric label="GOLD" value={h.current_gold} />
          <InlineMetric label="BV" value={h.current_bv} />
        </ClusterPanel>
        <ClusterPanel title="경제 누적" icon="💰">
          <InlineMetric label="기부" value={h.donation_total} />
          <InlineMetric label="세금" value={h.pure_tax_total} />
          <InlineMetric label="균형발전" value={h.balance_development_burden_total} />
        </ClusterPanel>
        <ClusterPanel title="성장 · 수집" icon="✨">
          <InlineMetric label="업적" value={h.active_achievement_count} suffix="종" />
          <InlineMetric label="편린" value={h.character_catalog_count} suffix="종" />
          <InlineMetric label="컬렉션" value={h.collection_catalog_count} suffix="종" />
          <InlineMetric label="아이템" value={h.item_catalog_count} suffix="종" />
        </ClusterPanel>
        <ClusterPanel title="운영 상태" icon="🛡️">
          <InlineMetric label="길드" value={h.guild_count} suffix="개" />
          <InlineMetric label="Arcade" value={h.arcade_game_count} suffix="종" />
          <InlineMetric label="후보" value={queue.needs_action_count} suffix="건" accent />
          <InlineMetric label="검증" value={validation.status ?? '-'} good={validation.status === 'OK'} />
        </ClusterPanel>
      </div>

      <DenseSection
        title="최근 기록 후보"
        right={(
          <SortControls
            sortKey={sortKey}
            onSortKey={setSortKey}
            direction={sortDirection}
            onDirection={setSortDirection}
            options={[
              { value: 'occurred_at', label: '발생일' },
              { value: 'type', label: '후보 유형' },
              { value: 'subject', label: '대상' },
              { value: 'status', label: '상태' },
            ]}
          />
        )}
      >
        <DenseTable
          rows={recent}
          rowKey={(row, index) => String(row.id ?? index)}
          columns={[
            { key: 'time', label: '발생', render: (row) => dateTimeText(row.occurred_at) },
            { key: 'type', label: '유형', render: (row) => candidateTypeLabel(row.candidate_type) },
            { key: 'subject', label: '대상', render: (row) => <StrongText>{row.student_name_snapshot ?? row.guild_name_snapshot ?? '-'}</StrongText> },
            { key: 'record', label: '기록', render: (row) => row.record_title ?? '-' },
            { key: 'status', label: '상태', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty="최근 기록 후보가 없습니다."
        />
      </DenseSection>

      <div className="grid gap-2 lg:grid-cols-3">
        <MiniNotice title="기록실" value={`${numberText(data.records_room?.active_historical_entries)}건`} detail={`월간 MVP ${numberText(data.records_room?.monthly_mvp_entries)}건`} />
        <MiniNotice title="후보 큐" value={`${numberText(queue.total_count)}건`} detail={`검토 대기 ${numberText(queue.needs_action_count)}건`} accent />
        <MiniNotice title="데이터 검증" value={String(validation.status ?? '-')} detail={`ERROR ${numberText(validation.error_issue_types)} · WARNING ${numberText(validation.warning_issue_types)} · INFO ${numberText(validation.info_issue_types)}`} good={validation.status === 'OK'} />
      </div>
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
  const students = sortRows(asArray(optionsQuery.data?.students), (row) => row.student_name, 'asc');

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
    <div className="space-y-3">
      <ControlBar>
        <CompactField label="학생">
          <select
            value={studentId ?? ''}
            onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : null)}
            className="h-8 min-w-[180px] rounded-card-md border border-line bg-bg-deep px-2.5 text-xs font-bold text-white outline-none focus:border-line-brand"
          >
            <option value="">학생 선택</option>
            {students.map((student) => (
              <option key={student.student_id} value={student.student_id}>
                {student.student_name}{student.is_test_account ? ' (TEST)' : ''}
              </option>
            ))}
          </select>
        </CompactField>
        <span className="text-2xs font-bold text-text-muted">학생별 통합 원장에서 경제·성장·출석·길드·아케이드를 함께 조회합니다.</span>
      </ControlBar>

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
    <div className="space-y-3">
      <section className="rounded-card-lg border border-line-brand/30 bg-gradient-to-r from-brand-primary/15 to-bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-display text-lg text-white">{student.student_name ?? '-'} <span className="text-sm text-gold">· {student.brand_name ?? '-'}</span></div>
            <div className="mt-0.5 text-2xs font-bold text-text-muted">최근 활동 {dateTimeText(activity.recent_activity_at)}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs font-bold text-text-secondary">
            <span>인증 로그인 <b className="text-white">{numberText(activity.total_login_days)}일</b></span>
            <span>인증 횟수 <b className="text-white">{numberText(activity.total_login_count)}회</b></span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
          <SlimMetric label="GOLD" value={economy.current_gold} />
          <SlimMetric label="최고 GOLD" value={economy.gold?.historical_max} />
          <SlimMetric label="BV" value={economy.current_bv} />
          <SlimMetric label="최고 BV" value={economy.bv?.historical_max} />
          <SlimMetric label="업적" value={achievement.current_achievement_count} />
          <SlimMetric label="편린" value={characters.current_owned_count} />
          <SlimMetric label="컬렉션" value={collections.current_completed_count} />
          <SlimMetric label="최장 출석" value={attendance.max_streak} suffix="일" />
        </div>
      </section>

      <div className="grid gap-2 lg:grid-cols-2">
        <JsonDetails title="경제 상세" value={economy} />
        <JsonDetails title="업적 상세" value={achievement} />
        <JsonDetails title="편린 · 컬렉션 · 아이템" value={{ characters, collections, items }} />
        <JsonDetails title="길드 · 아케이드 · 출석" value={{ guild, arcade: data.arcade, attendance }} />
      </div>
    </div>
  );
}

function EconomyTab({ classroomId, includeTest }: CommonProps) {
  const [queryText, setQueryText] = useState('');
  const [sortKey, setSortKey] = useState('current_gold');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
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

  const summary = query.data.class_summary ?? {};
  const filtered = filterByQuery(asArray(query.data.students), queryText, (row) => String(row.student_name ?? ''));
  const students = sortRows(filtered, (row) => {
    if (sortKey === 'name') return row.student_name;
    if (sortKey === 'gold_max') return row.gold?.historical_max;
    if (sortKey === 'current_bv') return row.current_bv;
    if (sortKey === 'bv_max') return row.bv?.historical_max;
    if (sortKey === 'tax') return row.tax_donation?.pure_tax_total;
    if (sortKey === 'donation') return row.tax_donation?.donation_total;
    return row.current_gold;
  }, sortDirection);

  return (
    <div className="space-y-3">
      <SummaryStrip items={[
        ['학급 GOLD', summary.current_gold],
        ['학급 BV', summary.current_bv],
        ['순수 세금', summary.pure_tax_total],
        ['균형발전', summary.balance_development_burden_total],
        ['누적 기부', summary.donation_total],
      ]} />

      <DenseSection
        title="학생별 경제 기록"
        right={(
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchBox value={queryText} onChange={setQueryText} placeholder="학생 검색" />
            <SortControls
              sortKey={sortKey}
              onSortKey={setSortKey}
              direction={sortDirection}
              onDirection={setSortDirection}
              options={[
                { value: 'name', label: '이름' },
                { value: 'current_gold', label: '현재 GOLD' },
                { value: 'gold_max', label: '역대 최고 GOLD' },
                { value: 'current_bv', label: '현재 BV' },
                { value: 'bv_max', label: '역대 최고 BV' },
                { value: 'tax', label: '누적 세금' },
                { value: 'donation', label: '누적 기부' },
              ]}
            />
          </div>
        )}
      >
        <DenseTable
          rows={students}
          rowKey={(row) => String(row.student_id)}
          columns={[
            { key: 'name', label: '학생', render: (row) => <StrongText>{row.student_name}</StrongText> },
            { key: 'gold', label: 'GOLD', align: 'right', render: (row) => numberText(row.current_gold) },
            { key: 'goldmax', label: '최고 GOLD', align: 'right', render: (row) => numberText(row.gold?.historical_max) },
            { key: 'earned', label: '누적 획득', align: 'right', render: (row) => numberText(row.gold?.cumulative_earned) },
            { key: 'spent', label: '누적 소비', align: 'right', render: (row) => numberText(row.gold?.cumulative_spent) },
            { key: 'bv', label: 'BV', align: 'right', render: (row) => numberText(row.current_bv) },
            { key: 'bvmax', label: '최고 BV', align: 'right', render: (row) => numberText(row.bv?.historical_max) },
            { key: 'tax', label: '세금', align: 'right', render: (row) => numberText(row.tax_donation?.pure_tax_total) },
            { key: 'burden', label: '부담금', align: 'right', render: (row) => numberText(row.tax_donation?.balance_development_burden) },
            { key: 'donation', label: '기부', align: 'right', render: (row) => <GoldText>{numberText(row.tax_donation?.donation_total)}</GoldText> },
          ]}
        />
      </DenseSection>
      <JsonDetails title="월별 세금·기부 / TOP3 / 데이터 범위" value={{ class_summary: summary, coverage: query.data.coverage }} />
    </div>
  );
}

function GrowthTab({ classroomId, includeTest }: CommonProps) {
  type GrowthView = 'students' | 'transcendent' | 'characters' | 'collections' | 'items';
  const [view, setView] = useState<GrowthView>('students');
  const [sortKey, setSortKey] = useState('primary');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [queryText, setQueryText] = useState('');
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
  const rawByView: Record<GrowthView, AnalyticsJson[]> = {
    students: asArray(achievements.students),
    transcendent: asArray(achievements.transcendent?.achievements),
    characters: asArray(assets.characters?.catalog),
    collections: asArray(assets.collections?.catalog),
    items: asArray(assets.items?.catalog),
  };
  const nameGetter = (row: AnalyticsJson) => String(row.student_name ?? row.name ?? row.collection_name ?? '');
  const filtered = filterByQuery(rawByView[view], queryText, nameGetter);
  const rows = sortRows(filtered, (row) => {
    if (sortKey === 'name') return nameGetter(row);
    if (sortKey === 'secondary') {
      if (view === 'students') return row.lifetime_ever_achievement_count;
      if (view === 'transcendent') return row.current_achievers;
      if (view === 'characters') return row.total_known_acquirers;
      if (view === 'collections') return row.total_ever_completers;
      return row.total_consumed_quantity;
    }
    if (view === 'students') return row.current_achievement_count;
    if (view === 'transcendent') return row.total_ever_achievers;
    if (view === 'characters') return row.current_owners;
    if (view === 'collections') return row.current_completers;
    return row.total_issued_quantity;
  }, sortDirection);

  const columns: Record<GrowthView, TableColumn[]> = {
    students: [
      { key: 'name', label: '학생', render: (row) => <StrongText>{row.student_name}</StrongText> },
      { key: 'current', label: '현재 업적', align: 'right', render: (row) => numberText(row.current_achievement_count) },
      { key: 'life', label: '평생 업적', align: 'right', render: (row) => numberText(row.lifetime_ever_achievement_count) },
      { key: 'trans', label: '초월', align: 'right', render: (row) => numberText(row.transcend_count) },
      { key: 'hidden', label: '히든', align: 'right', render: (row) => numberText(row.hidden_count) },
      { key: 'rate', label: '완성률', align: 'right', render: (row) => `${numberText(row.completion_percent)}%` },
    ],
    transcendent: [
      { key: 'name', label: '업적', render: (row) => <StrongText>{row.name}</StrongText> },
      { key: 'ever', label: '역대 달성자', align: 'right', render: (row) => numberText(row.total_ever_achievers) },
      { key: 'current', label: '현재 달성자', align: 'right', render: (row) => numberText(row.current_achievers) },
      { key: 'first', label: '최초 달성자', render: (row) => row.first_valid_achiever?.student_name ?? '-' },
      { key: 'time', label: '최초 시각', render: (row) => dateTimeText(row.first_valid_achiever?.achieved_at) },
    ],
    characters: [
      { key: 'name', label: '편린', render: (row) => <StrongText>{row.name}</StrongText> },
      { key: 'current', label: '현재 보유자', align: 'right', render: (row) => numberText(row.current_owners) },
      { key: 'ever', label: '알려진 역대 획득자', align: 'right', render: (row) => numberText(row.total_known_acquirers) },
      { key: 'first', label: '최초 획득자', render: (row) => row.first_known_acquirer?.student_name ?? '-' },
      { key: 'time', label: '최초 시각', render: (row) => dateTimeText(row.first_known_acquirer?.first_known_at) },
      { key: 'quality', label: '정확도', render: (row) => <CoverageBadge value={row.first_known_acquirer?.quality} /> },
    ],
    collections: [
      { key: 'name', label: '컬렉션', render: (row) => <StrongText>{row.collection_name}</StrongText> },
      { key: 'current', label: '현재 완성자', align: 'right', render: (row) => numberText(row.current_completers) },
      { key: 'ever', label: '역대 완성자', align: 'right', render: (row) => numberText(row.total_ever_completers) },
      { key: 'first', label: '최초 완성자', render: (row) => row.first_completer?.student_name ?? '-' },
      { key: 'time', label: '최초 완성', render: (row) => dateTimeText(row.first_completer?.completed_at) },
    ],
    items: [
      { key: 'name', label: '아이템', render: (row) => <StrongText>{row.name}</StrongText> },
      { key: 'issued', label: '총 지급', align: 'right', render: (row) => numberText(row.total_issued_quantity) },
      { key: 'used', label: '총 소비', align: 'right', render: (row) => numberText(row.total_consumed_quantity) },
      { key: 'recipients', label: '역대 수령자', align: 'right', render: (row) => numberText(row.total_recipients) },
      { key: 'holders', label: '현재 보유자', align: 'right', render: (row) => numberText(row.current_holders) },
      { key: 'first', label: '최초 수령자', render: (row) => row.first_recipient?.student_name ?? '-' },
    ],
  };

  return (
    <div className="space-y-3">
      <SummaryStrip items={[
        ['활성 업적', achievements.active_catalog_count, '종'],
        ['초월 업적', asArray(achievements.transcendent?.achievements).length, '종'],
        ['편린', asArray(assets.characters?.catalog).length, '종'],
        ['컬렉션', asArray(assets.collections?.catalog).length, '종'],
        ['아이템', asArray(assets.items?.catalog).length, '종'],
      ]} />
      <DenseSection
        title="성장 · 수집 기록"
        right={(
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchBox value={queryText} onChange={setQueryText} placeholder="이름 검색" />
            <SortControls
              sortKey={sortKey}
              onSortKey={setSortKey}
              direction={sortDirection}
              onDirection={setSortDirection}
              options={[
                { value: 'name', label: '이름' },
                { value: 'primary', label: '현재/주요 수치' },
                { value: 'secondary', label: '누적/보조 수치' },
              ]}
            />
          </div>
        )}
      >
        <SubTabs
          value={view}
          onChange={(value) => { setView(value as GrowthView); setSortKey('primary'); setQueryText(''); }}
          options={[
            ['students', '학생별 업적'],
            ['transcendent', '초월 업적'],
            ['characters', '편린'],
            ['collections', '컬렉션'],
            ['items', '아이템'],
          ]}
        />
        <DenseTable rows={rows} rowKey={(row, index) => String(row.student_id ?? row.id ?? row.collection_id ?? index)} columns={columns[view]} />
      </DenseSection>
    </div>
  );
}

function GuildTab({ classroomId, yearMonth, includeTest }: CommonMonthProps) {
  type GuildView = 'guilds' | 'students';
  const [view, setView] = useState<GuildView>('guilds');
  const [sortKey, setSortKey] = useState('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [queryText, setQueryText] = useState('');
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

  const raw = view === 'guilds' ? asArray(query.data.guild_rows) : asArray(query.data.student_rows);
  const filtered = filterByQuery(raw, queryText, (row) => String(view === 'guilds' ? row.name : `${row.student_name ?? ''} ${row.live_guild_name ?? ''}`));
  const rows = sortRows(filtered, (row) => {
    if (sortKey === 'name') return view === 'guilds' ? row.name : row.student_name;
    if (sortKey === 'rank') return view === 'guilds' ? row.live_month_rank : row.live_month_contribution;
    if (sortKey === 'official') return view === 'guilds' ? row.season_official_score : row.lifetime_official_contribution;
    if (sortKey === 'mission') return view === 'guilds' ? row.mission_success_rate_pct : row.mission_participation_count;
    return view === 'guilds' ? row.live_month_score : row.live_month_contribution;
  }, sortDirection);

  const columns: Record<GuildView, TableColumn[]> = {
    guilds: [
      { key: 'name', label: '길드', render: (row) => <StrongText>{row.name}</StrongText> },
      { key: 'score', label: 'LIVE 점수', align: 'right', render: (row) => <GoldText>{numberText(row.live_month_score)}</GoldText> },
      { key: 'rank', label: 'LIVE 순위', align: 'right', render: (row) => numberText(row.live_month_rank) },
      { key: 'season', label: '공식 시즌 누적', align: 'right', render: (row) => numberText(row.season_official_score) },
      { key: 'wins', label: '월간 1위', align: 'right', render: (row) => numberText(row.monthly_first_count) },
      { key: 'top3', label: 'TOP3', align: 'right', render: (row) => numberText(row.monthly_top3_count) },
      { key: 'mission', label: '미션 성공률', align: 'right', render: (row) => row.mission_success_rate_pct === null ? '-' : `${numberText(row.mission_success_rate_pct)}%` },
    ],
    students: [
      { key: 'name', label: '학생', render: (row) => <StrongText>{row.student_name}</StrongText> },
      { key: 'guild', label: '길드', render: (row) => row.live_guild_name ?? '-' },
      { key: 'live', label: 'LIVE 기여', align: 'right', render: (row) => <GoldText>{numberText(row.live_month_contribution)}</GoldText> },
      { key: 'season', label: '시즌 공식', align: 'right', render: (row) => numberText(row.season_official_contribution) },
      { key: 'life', label: '평생 공식', align: 'right', render: (row) => numberText(row.lifetime_official_contribution) },
      { key: 'best', label: '최고 월', align: 'right', render: (row) => numberText(row.best_monthly_contribution) },
      { key: 'mission', label: '미션 참가', align: 'right', render: (row) => numberText(row.mission_participation_count) },
    ],
  };

  return (
    <div className="space-y-3">
      <InfoStrip>진행 중 값은 <b className="text-gold">LIVE</b>, 역사 기록은 <b className="text-white">guild5 FINALIZED snapshot</b>만 사용합니다.</InfoStrip>
      <DenseSection
        title="길드 분석"
        right={(
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchBox value={queryText} onChange={setQueryText} placeholder="길드/학생 검색" />
            <SortControls sortKey={sortKey} onSortKey={setSortKey} direction={sortDirection} onDirection={setSortDirection} options={[
              { value: 'name', label: '이름' },
              { value: 'score', label: 'LIVE 점수/기여' },
              { value: 'rank', label: '순위/기여' },
              { value: 'official', label: '공식 누적' },
              { value: 'mission', label: '미션' },
            ]} />
          </div>
        )}
      >
        <SubTabs value={view} onChange={(value) => { setView(value as GuildView); setSortKey('score'); setQueryText(''); }} options={[[ 'guilds', '길드 현황' ], [ 'students', '학생별 기여' ]]} />
        <DenseTable rows={rows} rowKey={(row, index) => String(row.guild_id ?? row.student_id ?? index)} columns={columns[view]} />
      </DenseSection>
    </div>
  );
}

function ArcadeTab({ classroomId, yearMonth, includeTest }: CommonMonthProps) {
  type ArcadeView = 'games' | 'records';
  const [view, setView] = useState<ArcadeView>('records');
  const [sortKey, setSortKey] = useState('rank');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [queryText, setQueryText] = useState('');
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

  const raw = view === 'games' ? asArray(query.data.games) : asArray(query.data.student_game_rows);
  const filtered = filterByQuery(raw, queryText, (row) => String(`${row.student_name ?? ''} ${row.game_name ?? ''}`));
  const rows = sortRows(filtered, (row) => {
    if (sortKey === 'name') return view === 'games' ? row.game_name : row.student_name;
    if (sortKey === 'plays') return row.play_count;
    if (sortKey === 'pb') return row.all_time_pb;
    if (sortKey === 'wins') return row.monthly_win_count;
    if (sortKey === 'top10') return row.monthly_top10_count;
    return view === 'games' ? row.verified_count : row.current_period_rank;
  }, sortDirection);

  const columns: Record<ArcadeView, TableColumn[]> = {
    games: [
      { key: 'game', label: '게임', render: (row) => <StrongText>{row.game_name}</StrongText> },
      { key: 'rule', label: '비교 규칙', render: (row) => row.comparison_mode ?? '미설정' },
      { key: 'plays', label: '플레이', align: 'right', render: (row) => numberText(row.play_count) },
      { key: 'verified', label: '검증 성공', align: 'right', render: (row) => numberText(row.verified_count) },
      { key: 'fail', label: '검증 실패', align: 'right', render: (row) => numberText(row.rejected_count) },
      { key: 'start', label: '집계 시작', render: (row) => dateTimeText(row.tracking_start_at) },
    ],
    records: [
      { key: 'student', label: '학생', render: (row) => <StrongText>{row.student_name}</StrongText> },
      { key: 'game', label: '게임', render: (row) => row.game_name },
      { key: 'plays', label: '플레이', align: 'right', render: (row) => numberText(row.play_count) },
      { key: 'pb', label: 'PB', align: 'right', render: (row) => <GoldText>{numberText(row.all_time_pb)}</GoldText> },
      { key: 'rank', label: '현재 순위', align: 'right', render: (row) => numberText(row.current_period_rank) },
      { key: 'wins', label: '월간 1위', align: 'right', render: (row) => numberText(row.monthly_win_count) },
      { key: 'top3', label: 'TOP3', align: 'right', render: (row) => numberText(row.monthly_top3_count) },
      { key: 'top10', label: 'TOP10', align: 'right', render: (row) => numberText(row.monthly_top10_count) },
      { key: 'streak', label: '연속 TOP10', align: 'right', render: (row) => numberText(row.max_consecutive_top10) },
    ],
  };

  return (
    <div className="space-y-3">
      <InfoStrip>현재 기간 <b className="text-white">{String(query.data.scope?.monthly_period_status ?? '없음')}</b> · 공식 월간 기록은 FINALIZED snapshot만 집계합니다.</InfoStrip>
      <DenseSection
        title="아케이드 분석"
        right={(
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchBox value={queryText} onChange={setQueryText} placeholder="학생/게임 검색" />
            <SortControls sortKey={sortKey} onSortKey={setSortKey} direction={sortDirection} onDirection={setSortDirection} options={[
              { value: 'name', label: '이름' },
              { value: 'rank', label: '현재 순위/검증' },
              { value: 'plays', label: '플레이 수' },
              { value: 'pb', label: 'PB' },
              { value: 'wins', label: '월간 1위' },
              { value: 'top10', label: 'TOP10' },
            ]} />
          </div>
        )}
      >
        <SubTabs value={view} onChange={(value) => { const next = value as ArcadeView; setView(next); setSortKey(next === 'games' ? 'plays' : 'rank'); setSortDirection(next === 'games' ? 'desc' : 'asc'); setQueryText(''); }} options={[[ 'records', '학생 × 게임' ], [ 'games', '게임 현황' ]]} />
        <DenseTable rows={rows} rowKey={(row, index) => String(`${row.student_id ?? 'game'}:${row.game_id ?? row.game_uid ?? index}`)} columns={columns[view]} />
      </DenseSection>
    </div>
  );
}

function AttendanceTab({ classroomId, includeTest }: CommonProps) {
  const [queryText, setQueryText] = useState('');
  const [sortKey, setSortKey] = useState('attendance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
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

  const filtered = filterByQuery(asArray(query.data.students), queryText, (row) => String(row.student_name ?? ''));
  const students = sortRows(filtered, (row) => {
    if (sortKey === 'name') return row.student_name;
    if (sortKey === 'absent') return row.absent_count;
    if (sortKey === 'excused') return row.excused_count;
    if (sortKey === 'current') return row.current_streak;
    if (sortKey === 'max') return row.max_streak;
    if (sortKey === 'recent') return row.recent_recorded_date;
    return row.attendance_count;
  }, sortDirection);

  return (
    <div className="space-y-3">
      <InfoStrip>연속출석은 기존 운영 규칙 그대로 PRESENT·LATE·EXCUSED 유지, ABSENT 중단입니다.</InfoStrip>
      <DenseSection
        title="학생별 출석 기록"
        right={(
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchBox value={queryText} onChange={setQueryText} placeholder="학생 검색" />
            <SortControls sortKey={sortKey} onSortKey={setSortKey} direction={sortDirection} onDirection={setSortDirection} options={[
              { value: 'name', label: '이름' },
              { value: 'attendance', label: '출석 횟수' },
              { value: 'absent', label: '불참' },
              { value: 'excused', label: '인정결석' },
              { value: 'current', label: '현재 연속' },
              { value: 'max', label: '최장 연속' },
              { value: 'recent', label: '최근 기록' },
            ]} />
          </div>
        )}
      >
        <DenseTable
          rows={students}
          rowKey={(row) => String(row.student_id)}
          columns={[
            { key: 'name', label: '학생', render: (row) => <StrongText>{row.student_name}</StrongText> },
            { key: 'attendance', label: '출석', align: 'right', render: (row) => numberText(row.attendance_count) },
            { key: 'absent', label: '불참', align: 'right', render: (row) => numberText(row.absent_count) },
            { key: 'excused', label: '인정결석', align: 'right', render: (row) => numberText(row.excused_count) },
            { key: 'current', label: '현재 연속', align: 'right', render: (row) => numberText(row.current_streak) },
            { key: 'max', label: '최장 연속', align: 'right', render: (row) => <GoldText>{numberText(row.max_streak)}</GoldText> },
            { key: 'first', label: '최초 기록', render: (row) => String(row.first_recorded_date ?? '-') },
            { key: 'recent', label: '최근 기록', render: (row) => String(row.recent_recorded_date ?? '-') },
          ]}
        />
      </DenseSection>
    </div>
  );
}

function CandidatesTab({ classroomId }: { classroomId: number | null }) {
  const [status, setStatus] = useState<string>('PENDING');
  const [candidateType, setCandidateType] = useState('');
  const [sortKey, setSortKey] = useState('occurred_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const limit = 100;
  const query = useQuery({
    queryKey: ['analytics-candidates', classroomId, status, candidateType, page],
    queryFn: () => {
      if (classroomId === null) throw new Error('학급 정보가 없습니다.');
      return getRecordCandidates(supabase, classroomId, status || null, candidateType || null, limit, page * limit);
    },
    enabled: classroomId !== null,
  });

  const total = Number(query.data?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rows = sortRows(asArray(query.data?.rows), (row) => {
    if (sortKey === 'type') return candidateTypeLabel(row.candidate_type);
    if (sortKey === 'subject') return row.student_name_snapshot ?? row.guild_name_snapshot ?? '';
    if (sortKey === 'coverage') return row.coverage;
    if (sortKey === 'value') return row.value_numeric;
    return row.occurred_at;
  }, sortDirection);
  const selected = rows.find((row) => Number(row.id) === selectedId) ?? null;

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
      setSelectedId(null);
      await query.refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : '후보 처리 실패');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <ControlBar>
        <CompactField label="상태">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); setSelectedId(null); }} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white">
            <option value="PENDING">대기</option>
            <option value="NEEDS_REVIEW">확인 필요</option>
            <option value="APPROVED">승인</option>
            <option value="IGNORED">무시</option>
            <option value="REJECTED">거절</option>
            <option value="">전체</option>
          </select>
        </CompactField>
        <CompactField label="후보 유형">
          <select value={candidateType} onChange={(e) => { setCandidateType(e.target.value); setPage(0); setSelectedId(null); }} className="h-8 max-w-[210px] rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white">
            <option value="">전체 유형</option>
            {CANDIDATE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </CompactField>
        <SortControls sortKey={sortKey} onSortKey={setSortKey} direction={sortDirection} onDirection={setSortDirection} options={[
          { value: 'occurred_at', label: '발생일' },
          { value: 'type', label: '후보 유형' },
          { value: 'subject', label: '대상' },
          { value: 'coverage', label: '복구 정확도' },
          { value: 'value', label: '기록 값' },
        ]} />
        <button type="button" disabled={busy !== null} onClick={() => void refresh()} className="ml-auto h-8 rounded-card-md border border-line-brand bg-brand-primary/15 px-3 text-2xs font-black text-gold disabled:opacity-40">
          {busy === 'refresh' ? '탐색 중…' : '↻ 후보 다시 탐색'}
        </button>
        <span className="text-2xs font-black text-text-muted">총 {numberText(total)}건</span>
      </ControlBar>

      {query.isLoading && <LoadingSpinner />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}

      <DenseSection title="후보 검토 작업대">
        <DenseTable
          rows={rows}
          rowKey={(row) => String(row.id)}
          onRowClick={(row) => setSelectedId((current) => current === Number(row.id) ? null : Number(row.id))}
          columns={[
            { key: 'status', label: '상태', render: (row) => <StatusBadge status={row.status} /> },
            { key: 'time', label: '발생', render: (row) => dateTimeText(row.occurred_at) },
            { key: 'type', label: '후보 유형', render: (row) => candidateTypeLabel(row.candidate_type) },
            { key: 'subject', label: '대상', render: (row) => <StrongText>{row.student_name_snapshot ?? row.guild_name_snapshot ?? '-'}</StrongText> },
            { key: 'record', label: '기록', render: (row) => row.record_title ?? '-' },
            { key: 'coverage', label: '정확도', render: (row) => <CoverageBadge value={row.coverage} /> },
            { key: 'value', label: '값', align: 'right', render: (row) => row.value_numeric === null || row.value_numeric === undefined ? '-' : `${numberText(row.value_numeric)} ${row.record_unit ?? ''}` },
          ]}
          empty="표시할 후보가 없습니다."
        />
      </DenseSection>

      {selected && (
        <section className="rounded-card-lg border border-line-brand/35 bg-brand-primary/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.status} />
                <CoverageBadge value={selected.coverage} />
                <span className="text-2xs font-black text-text-muted">{candidateTypeLabel(selected.candidate_type)}</span>
              </div>
              <div className="mt-1 text-sm font-extrabold text-white">{selected.record_title}</div>
              <div className="mt-1 text-2xs font-bold text-text-secondary">
                {selected.student_name_snapshot ?? selected.guild_name_snapshot ?? '-'} · {dateTimeText(selected.occurred_at)} · source {selected.source_type}:{selected.source_id}
              </div>
            </div>
            {(selected.status === 'PENDING' || selected.status === 'NEEDS_REVIEW') && (
              <div className="flex gap-1">
                <ActionButton disabled={busy !== null} onClick={() => void decide(Number(selected.id), 'APPROVED')}>승인</ActionButton>
                <ActionButton disabled={busy !== null} onClick={() => void decide(Number(selected.id), 'IGNORED')}>무시</ActionButton>
                <ActionButton disabled={busy !== null} danger onClick={() => void decide(Number(selected.id), 'REJECTED')}>거절</ActionButton>
              </div>
            )}
          </div>
          <details className="mt-2 border-t border-line pt-2">
            <summary className="cursor-pointer text-2xs font-black text-text-muted">근거 데이터 보기</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-card-md bg-bg-deep p-2 text-[10px] leading-relaxed text-text-secondary">{JSON.stringify(selected.metadata ?? {}, null, 2)}</pre>
          </details>
        </section>
      )}

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function ValidationTab({ classroomId, includeTest }: CommonProps) {
  const [severity, setSeverity] = useState('');
  const [sortKey, setSortKey] = useState('severity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
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
  const severityWeight = (value: unknown) => value === 'ERROR' ? 0 : value === 'WARNING' ? 1 : 2;
  const filtered = asArray(query.data.issues).filter((issue) => !severity || issue.severity === severity);
  const issues = sortRows(filtered, (issue) => {
    if (sortKey === 'code') return issue.code;
    if (sortKey === 'count') return issue.count;
    return severityWeight(issue.severity);
  }, sortDirection);

  return (
    <div className="space-y-3">
      <SummaryStrip items={[
        ['상태', summary.status ?? '-'],
        ['ERROR', summary.error_issue_types],
        ['WARNING', summary.warning_issue_types],
        ['INFO', summary.info_issue_types],
      ]} status={summary.status} />

      <DenseSection
        title="검증 항목"
        right={(
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white">
              <option value="">전체 심각도</option>
              <option value="ERROR">ERROR</option>
              <option value="WARNING">WARNING</option>
              <option value="INFO">INFO</option>
            </select>
            <SortControls sortKey={sortKey} onSortKey={setSortKey} direction={sortDirection} onDirection={setSortDirection} options={[
              { value: 'severity', label: '심각도' },
              { value: 'count', label: '건수' },
              { value: 'code', label: '코드' },
            ]} />
          </div>
        )}
      >
        <DenseTable
          rows={issues}
          rowKey={(row, index) => `${row.code}:${index}`}
          columns={[
            { key: 'severity', label: '심각도', render: (row) => <SeverityBadge severity={row.severity} /> },
            { key: 'code', label: '코드', render: (row) => <StrongText>{row.code}</StrongText> },
            { key: 'count', label: '건수', align: 'right', render: (row) => numberText(row.count) },
            { key: 'message', label: '설명', render: (row) => <span className="whitespace-normal">{row.message}</span> },
          ]}
          empty="선택한 조건에 해당하는 검증 항목이 없습니다."
        />
      </DenseSection>

      <JsonDetails title="정상 항목 포함 도메인별 검증 상세" value={query.data.sections} />
    </div>
  );
}

function DenseSection({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="font-display text-sm text-white">{title}</h2>
        {right}
      </div>
      <div>{children}</div>
    </section>
  );
}

function ClusterPanel({ title, icon, children, tone = 'default' }: { title: string; icon: string; children: ReactNode; tone?: 'default' | 'brand' }) {
  return (
    <section className={cn('rounded-card-lg border p-3', tone === 'brand' ? 'border-line-brand/40 bg-brand-primary/10' : 'border-line bg-bg-card')}>
      <div className="mb-2 flex items-center gap-2 text-2xs font-black text-text-muted"><span>{icon}</span><span>{title}</span></div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{children}</div>
    </section>
  );
}

function InlineMetric({ label, value, suffix = '', accent = false, good = false }: { label: string; value: unknown; suffix?: string; accent?: boolean; good?: boolean }) {
  return (
    <div className="min-w-[68px]">
      <div className="text-[9px] font-black text-text-muted">{label}</div>
      <div className={cn('mt-0.5 text-sm font-black', good ? 'text-success' : accent ? 'text-gold' : 'text-white')}>
        {typeof value === 'string' && Number.isNaN(Number(value)) ? value : numberText(value)}{suffix && <span className="ml-0.5 text-[9px] text-text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

function SlimMetric({ label, value, suffix = '' }: { label: string; value: unknown; suffix?: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep/70 px-2.5 py-2">
      <div className="text-[9px] font-black text-text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-black text-white">{numberText(value)}{suffix && <span className="ml-0.5 text-[9px] text-text-muted">{suffix}</span>}</div>
    </div>
  );
}

function SummaryStrip({ items, status }: { items: Array<[string, unknown, string?]>; status?: unknown }) {
  return (
    <section className="flex flex-wrap items-stretch overflow-hidden rounded-card-lg border border-line bg-bg-card">
      {items.map(([label, value, suffix], index) => (
        <div key={label} className={cn('min-w-[120px] flex-1 px-3 py-2.5', index > 0 && 'border-l border-line')}>
          <div className="text-[9px] font-black text-text-muted">{label}</div>
          <div className={cn('mt-0.5 text-base font-black', label === '상태' && status === 'OK' ? 'text-success' : 'text-white')}>
            {typeof value === 'string' && Number.isNaN(Number(value)) ? value : numberText(value)}{suffix && <span className="ml-1 text-[9px] text-text-muted">{suffix}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

function MiniNotice({ title, value, detail, accent = false, good = false }: { title: string; value: string; detail: string; accent?: boolean; good?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-card-md border border-line bg-bg-card px-3 py-2">
      <div>
        <div className="text-[9px] font-black text-text-muted">{title}</div>
        <div className="mt-0.5 text-2xs font-bold text-text-secondary">{detail}</div>
      </div>
      <div className={cn('text-base font-black', good ? 'text-success' : accent ? 'text-gold' : 'text-white')}>{value}</div>
    </div>
  );
}

function DenseTable({ rows, columns, rowKey, empty = '데이터가 없습니다.', onRowClick }: { rows: AnalyticsJson[]; columns: TableColumn[]; rowKey: (row: AnalyticsJson, index: number) => string; empty?: string; onRowClick?: (row: AnalyticsJson) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left">
        <thead className="bg-bg-deep/70">
          <tr className="border-b border-line text-[9px] font-black uppercase tracking-wide text-text-muted">
            {columns.map((column) => (
              <th key={column.key} className={cn('whitespace-nowrap px-2.5 py-2', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center')}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowKey(row, rowIndex)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('border-b border-line/50 last:border-0 hover:bg-white/[0.025]', onRowClick && 'cursor-pointer')}
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('whitespace-nowrap px-2.5 py-2 text-[11px] font-bold text-text-secondary', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center')}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-xs font-bold text-text-muted">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ControlBar({ children }: { children: ReactNode }) {
  return <section className="flex flex-wrap items-end gap-2 rounded-card-lg border border-line bg-bg-card px-3 py-2">{children}</section>;
}

function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[9px] font-black text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 w-32 rounded-card-md border border-line bg-bg-deep px-2.5 text-2xs font-bold text-white outline-none placeholder:text-text-muted focus:border-line-brand sm:w-40" />;
}

function SortControls({ sortKey, onSortKey, direction, onDirection, options }: { sortKey: string; onSortKey: (value: string) => void; direction: SortDirection; onDirection: (value: SortDirection) => void; options: SortOption[] }) {
  return (
    <div className="flex items-center gap-1">
      <span className="hidden text-[9px] font-black text-text-muted sm:inline">정렬</span>
      <select value={sortKey} onChange={(e) => onSortKey(e.target.value)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select value={direction} onChange={(e) => onDirection(e.target.value as SortDirection)} className="h-8 rounded-card-md border border-line bg-bg-deep px-2 text-2xs font-bold text-white outline-none focus:border-line-brand">
        <option value="desc">내림차순</option>
        <option value="asc">오름차순</option>
      </select>
    </div>
  );
}

function SubTabs({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
      {options.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)} className={cn('flex-none rounded-card-md px-2.5 py-1.5 text-[10px] font-black', value === key ? 'bg-brand-primary/20 text-gold' : 'text-text-muted hover:bg-bg-deep hover:text-white')}>{label}</button>
      ))}
    </div>
  );
}

function StrongText({ children }: { children: ReactNode }) {
  return <span className="font-extrabold text-white">{children}</span>;
}

function GoldText({ children }: { children: ReactNode }) {
  return <span className="font-black text-gold">{children}</span>;
}

function StatusBadge({ status }: { status: unknown }) {
  const tone = status === 'APPROVED'
    ? 'border-success/30 bg-success/10 text-success'
    : status === 'NEEDS_REVIEW'
      ? 'border-warning/30 bg-warning/10 text-warning'
      : status === 'REJECTED'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : status === 'PENDING'
          ? 'border-line-brand/40 bg-brand-primary/10 text-gold'
          : 'border-line text-text-muted';
  return <span className={cn('inline-flex rounded-pill border px-1.5 py-0.5 text-[9px] font-black', tone)}>{statusLabel(status)}</span>;
}

function CoverageBadge({ value }: { value: unknown }) {
  const partial = value === 'PARTIAL_BACKFILL';
  return <span className={cn('inline-flex rounded-pill border px-1.5 py-0.5 text-[9px] font-black', partial ? 'border-warning/30 bg-warning/10 text-warning' : 'border-line text-text-muted')}>{coverageLabel(value)}</span>;
}

function SeverityBadge({ severity }: { severity: unknown }) {
  const tone = severity === 'ERROR' ? 'border-danger/30 bg-danger/10 text-danger' : severity === 'WARNING' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-line bg-bg-deep text-text-muted';
  return <span className={cn('inline-flex rounded-pill border px-1.5 py-0.5 text-[9px] font-black', tone)}>{String(severity ?? '-')}</span>;
}

function ErrorBox({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="rounded-card-lg border border-danger/40 bg-danger/10 p-3">
      <div className="text-xs font-black text-danger">데이터를 불러오지 못했습니다.</div>
      <div className="mt-1 break-all text-2xs font-bold text-text-secondary">{error instanceof Error ? error.message : String(error ?? '알 수 없는 오류')}</div>
      <button type="button" onClick={retry} className="mt-2 h-7 rounded-card-md border border-danger/30 px-2.5 text-2xs font-black text-danger">다시 시도</button>
    </div>
  );
}

function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="rounded-card-md border border-line bg-bg-card px-3 py-2.5">
      <summary className="cursor-pointer text-2xs font-extrabold text-text-secondary hover:text-white">{title}</summary>
      <pre className="mt-2 max-h-[380px] overflow-auto whitespace-pre-wrap break-words rounded-card-md bg-bg-deep p-2.5 text-[10px] leading-relaxed text-text-secondary">{JSON.stringify(value ?? {}, null, 2)}</pre>
    </details>
  );
}

function InfoStrip({ children }: { children: ReactNode }) {
  return <div className="rounded-card-md border border-line-brand/30 bg-brand-primary/8 px-3 py-2 text-2xs font-bold text-text-secondary">{children}</div>;
}

function ActionButton({ children, onClick, disabled, danger = false }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('h-7 rounded-card-md border px-2.5 text-[10px] font-black disabled:opacity-40', danger ? 'border-danger/40 text-danger' : 'border-line text-text-secondary hover:border-line-brand hover:text-white')}>
      {children}
    </button>
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

type CommonProps = { classroomId: number | null; includeTest: boolean };
type CommonMonthProps = CommonProps & { yearMonth: string };
