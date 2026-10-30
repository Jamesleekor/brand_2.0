import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

type Student = {
  student_id: number; student_name: string; brand_name: string | null;
  is_test_account: boolean; transferred: boolean; run_count: number;
};
type Member = {
  slot: number; name: string; character_uid: string | null;
  primary_element: string | null; secondary_element: string | null;
  specialty: string | null; specialty_matched: boolean;
};
type Reward = {
  mode: string; tier: string; kind: string; code: string;
  quantity: number; claim_status: string; claimed_at: string | null;
};
type RecordSnapshot = {
  field_title: string | null; field_text: string | null;
  discovery_attempted: boolean; discovery_success: boolean;
  discovery_already_unlocked: boolean; permanent_unlock_granted: boolean;
  discovery_chance_percent: number | null;
  discovery_title: string | null; discovery_text: string | null;
};
type Run = {
  run_id: number; week_index: number; week_start_date: string;
  season_name: string | null; phase: string; reward_mode: string;
  submitted_at: string | null; site_name: string; environment_name: string | null;
  major_element: string | null; minor_element: string | null;
  fit_percent: number; fit_grade: string; trace_contribution: number;
  counts_for_world: boolean; members: Member[];
  reward: Reward | null; record: RecordSnapshot | null;
};
type HistoryResponse = {
  classroom_id: number; selected_student_id: number | null;
  students: Student[]; runs: Run[];
};

const ELEMENTS: Record<string, string> = {
  FIRE: '불', WATER: '물', WIND: '바람', EARTH: '땅', LIGHT: '빛', DARK: '어둠',
};
const TIER_NAMES: Record<string, string> = { COMMON: '일반', INTERMEDIATE: '중급', RARE: '희귀' };
const FIT_NAMES: Record<string, string> = { VULNERABLE: '취약', NORMAL: '보통', STABLE: '안정', STRONG: '강인' };
const CLAIM_NAMES: Record<string, string> = {
  GRANTED: '실제 지급 완료', SIMULATED: '모의 지급', UNCLAIMED: '아직 미수령',
};
function dateKst(date: string | null) {
  if (!date) return '—';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function rewardName(r: Reward | null) {
  if (!r) return '보상 기록 없음';
  if (r.kind === 'EXPEDITION_BOX') return `${TIER_NAMES[r.tier] ?? r.tier} 원정상자 ×${r.quantity}`;
  if (r.kind === 'GOLD') return `${r.quantity.toLocaleString('ko-KR')} GOLD`;
  if (r.kind === 'FRAGMENT') return `편린 조각 +${r.quantity.toLocaleString('ko-KR')}`;
  return `${r.code} ×${r.quantity}`;
}
async function getHistory(classroomId: number, studentId: number | null): Promise<HistoryResponse> {
  const { data, error } = await supabase.rpc('teacher_get_expedition_student_history_v1', {
    p_classroom_id: classroomId,
    p_student_id: studentId,
  });
  if (error) throw new Error(`이력 조회 실패: ${error.message}`);
  if (!data || typeof data !== 'object' || !Array.isArray(data.students) || !Array.isArray(data.runs)) {
    throw new Error('원정 이력 서버 응답 형식이 올바르지 않습니다.');
  }
  return data as HistoryResponse;
}

export function ExpeditionStudentHistoryPanel({ classroomId }: { classroomId: number }) {
  const [studentId, setStudentId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [includeTests, setIncludeTests] = useState(false);
  const [mode, setMode] = useState<'LIVE' | 'ALL' | 'DRY_RUN'>('LIVE');
  const [phase, setPhase] = useState<'ALL' | 'SAT' | 'SUN'>('ALL');
  const [expanded, setExpanded] = useState(false);
  const list = useQuery({
    queryKey: ['expedition-student-history-students', classroomId],
    queryFn: () => getHistory(classroomId, null),
    staleTime: 120_000,
    enabled: expanded,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['expedition-student-history-runs', classroomId, studentId],
    queryFn: () => getHistory(classroomId, studentId),
    enabled: expanded && studentId !== null,
    staleTime: 30_000,
    retry: false,
  });
  const students = useMemo(() => (list.data?.students ?? []).filter(s =>
    (includeTests || !s.is_test_account) &&
    `${s.student_name} ${s.brand_name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  ), [list.data, includeTests, search]);
  const selected = (list.data?.students ?? []).find(s => s.student_id === studentId);
  const allRuns = history.data?.runs ?? [];
  const runs = allRuns.filter(r => (mode === 'ALL' || r.reward_mode === mode) && (phase === 'ALL' || r.phase === phase));
  const liveRuns = allRuns.filter(r => r.reward_mode === 'LIVE');
  const paid = liveRuns.filter(r => r.reward?.claim_status === 'GRANTED').length;
  const discoveries = liveRuns.filter(r => r.record?.discovery_success).length;
  const uniqueSites = new Set(liveRuns.map(r => r.site_name)).size;

  return (
    <section id="expedition-student-history" className="overflow-hidden rounded-card-xl border border-gold/40 bg-bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.15em] text-gold">Expedition · Student Archive</div>
          <h2 className="mt-1 text-xl font-black text-white">📜 학생별 원정 이력</h2>
          <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">원정대 편성, 탐사지, 보상 지급 여부, 발굴 판정을 과거 순서대로 확인합니다.</p>
        </div>
        <button type="button" className="btn-secondary text-xs" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
          {expanded ? '이력 접기' : '학생별 상세 기록 열기'}
        </button>
      </div>
      {expanded && <div className="space-y-4 p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1 text-xs font-black text-[#FFF3DD]">
            학생 검색
            <input className="input-field mt-1 w-full text-white" value={search} onChange={e => setSearch(e.target.value)} placeholder="실명 또는 브랜드명" />
          </label>
          <label className="min-w-0 flex-[2] text-xs font-black text-[#FFF3DD]">
            이력 조회할 학생
            <select className="input-field mt-1 w-full text-white" value={studentId ?? ''}
              onChange={e => setStudentId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">학생을 선택하세요</option>
              {students.map(s => <option key={s.student_id} value={s.student_id}>{s.student_name}{s.brand_name ? ` · ${s.brand_name}` : ''} ({s.run_count}회){s.transferred ? ' · 전출' : ''}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-card-md border border-line bg-bg-deep px-3 py-3 text-sm font-bold text-white">
            <input type="checkbox" checked={includeTests} onChange={e => setIncludeTests(e.target.checked)} /> 테스트 계정 포함
          </label>
        </div>

        {list.isLoading && <div className="py-6 text-center text-white">학생 목록을 불러오는 중입니다…</div>}
        {list.isError && <div className="rounded-card-md border border-danger/40 bg-danger/10 p-4 text-sm text-white">
          {list.error instanceof Error ? list.error.message : '학생 목록 조회 실패'}
          <button className="btn-secondary ml-3 text-xs" onClick={() => void list.refetch()}>재시도</button>
        </div>}
        {!studentId && !list.isLoading && !list.isError && <p className="rounded-card-md border border-line bg-bg-deep p-5 text-sm font-semibold text-white">학생을 선택하면 지금까지 저장된 모든 원정 스냅샷을 조회합니다. 주차가 바뀌어도 과거 기록을 보존하여 표시합니다.</p>}

        {studentId !== null && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-black text-white">{selected?.student_name ?? '학생'}의 원정 연대기</div>
            <button className="btn-secondary text-xs" disabled={history.isFetching} onClick={() => void history.refetch()}>
              {history.isFetching ? '갱신 중…' : '↻ 이력 새로고침'}
            </button>
          </div>
          {history.isLoading && <p className="py-6 text-center font-bold text-white">원정 기록을 불러오는 중입니다…</p>}
          {history.isError && <div className="rounded-card-md border border-danger/40 bg-danger/10 p-4 text-sm font-bold text-white">{history.error instanceof Error ? history.error.message : '기록 조회 실패'}</div>}
          {history.data && <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                ['전체 출정', `${allRuns.length}회`],
                ['LIVE 출정', `${liveRuns.length}회`],
                ['보상 실제 지급', `${paid}건`],
                ['발굴 성공 / 탐사지', `${discoveries}건 / ${uniqueSites}곳`],
              ].map(([label, value]) => <div key={label} className="rounded-card-md border border-line bg-bg-deep p-3">
                <div className="text-xs font-bold text-[#F6EFE7]">{label}</div>
                <div className="mt-1 text-xl font-black text-white">{value}</div>
              </div>)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {([['LIVE','실제 원정'],['ALL','전체'],['DRY_RUN','DRY RUN']] as const).map(([k, label]) =>
                  <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k}
                    className={`rounded-pill border px-3 py-1.5 text-xs font-black ${mode === k ? 'border-gold bg-gold/15 text-white' : 'border-line text-[#F6EFE7]'}`}>{label}</button>)}
              </div>
              <select aria-label="원정 차수" className="input-field w-auto text-white" value={phase} onChange={e => setPhase(e.target.value as typeof phase)}>
                <option value="ALL">전체 차수</option><option value="SAT">1차 원정</option><option value="SUN">2차 원정</option>
              </select>
            </div>
            <div className="space-y-3">
              {runs.map(run => <RunHistoryCard key={run.run_id} run={run} />)}
              {runs.length === 0 && <div className="rounded-card-md border border-line bg-bg-deep p-8 text-center text-sm font-bold text-white">이 조건에 해당하는 원정 기록이 없습니다.</div>}
            </div>
            <p className="text-xs font-semibold text-[#F6EFE7]">보상 기록의 ‘추첨 결과’와 ‘실제 지급’은 별개입니다. DRY RUN 및 테스트 이력은 LIVE 지급 합계에서 제외합니다. 이 화면은 읽기 전용입니다.</p>
          </>}
        </>}
      </div>}
    </section>
  );
}

function RunHistoryCard({ run }: { run: Run }) {
  const reward = run.reward;
  const record = run.record;
  return <details className="group overflow-hidden rounded-card-lg border border-line bg-bg-deep/80">
    <summary className="cursor-pointer list-none p-4 transition hover:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black">
            <span className="text-gold">{run.season_name ?? '원정'} · {run.week_index}주차</span>
            <span className={`rounded-pill border px-2 py-0.5 ${run.reward_mode === 'LIVE' ? 'border-success/50 text-[#B9F5CC]' : 'border-warning/50 text-[#FFE1A0]'}`}>{run.reward_mode === 'LIVE' ? 'LIVE' : 'DRY RUN'}</span>
            <span className="rounded-pill border border-line px-2 py-0.5 text-white">{run.phase === 'SAT' ? '1차' : '2차'} 원정</span>
          </div>
          <h3 className="mt-1 text-lg font-black text-white">{run.site_name}</h3>
          <p className="mt-1 text-xs font-semibold text-[#F6EFE7]">{dateKst(run.submitted_at)} · 적합도 {run.fit_percent}% ({FIT_NAMES[run.fit_grade] ?? run.fit_grade}) · 흔적 +{run.trace_contribution}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-black text-[#FFE0A2]">{rewardName(reward)}</p>
          <p className="mt-1 text-xs font-bold text-[#F6EFE7]">{reward ? (CLAIM_NAMES[reward.claim_status] ?? reward.claim_status) : '보상 미정'}</p>
          <p className="mt-2 text-xs font-black text-white">세부 기록 펼치기 ▾</p>
        </div>
      </div>
    </summary>
    <div className="space-y-4 border-t border-line p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-card-md border border-line bg-bg-card/50 p-3">
          <h4 className="mb-2 text-sm font-black text-white">🧭 원정대 편성 · {run.members.length}명</h4>
          {run.members.map(m => <div key={m.slot} className="mb-1 rounded-card-sm border border-line px-3 py-2 text-xs text-white">
            <b>{m.slot}번 · {m.name}</b>
            <span className="ml-2 text-[#F6EFE7]">{ELEMENTS[m.primary_element ?? ''] ?? m.primary_element ?? '—'} / {ELEMENTS[m.secondary_element ?? ''] ?? m.secondary_element ?? '—'}</span>
            {m.specialty_matched && <span className="ml-2 font-black text-[#FFE0A2]">특기 적중</span>}
          </div>)}
          <p className="mt-2 text-xs font-semibold text-[#F6EFE7]">탐사지 환경: {run.environment_name ?? '기록 없음'} · 주 {ELEMENTS[run.major_element ?? ''] ?? run.major_element ?? '—'} / 부 {ELEMENTS[run.minor_element ?? ''] ?? run.minor_element ?? '—'}</p>
        </div>
        <div className="rounded-card-md border border-line bg-bg-card/50 p-3">
          <h4 className="mb-2 text-sm font-black text-white">🎁 원정 보상</h4>
          <p className="text-base font-black text-[#FFE0A2]">{rewardName(reward)}</p>
          <p className="mt-1 text-xs font-bold text-white">{reward ? (CLAIM_NAMES[reward.claim_status] ?? reward.claim_status) : '스냅샷 없음'}{reward?.claimed_at ? ` · ${dateKst(reward.claimed_at)}` : ''}</p>
          <p className="mt-2 text-xs font-semibold text-[#F6EFE7]">{run.reward_mode === 'DRY_RUN' ? '모의 원정 결과입니다. 실제 자산 지급과 구분합니다.' : 'LIVE 원정 결과입니다. 실제 지급 여부는 위 상태를 따릅니다.'}</p>
          {!run.counts_for_world && <p className="mt-2 text-xs font-black text-[#FFE1A0]">월드 흔적 집계에서는 제외된 원정입니다.</p>}
        </div>
      </div>
      <div className="rounded-card-md border border-line bg-bg-card/50 p-3">
        <h4 className="mb-2 text-sm font-black text-white">📚 탐사 일지 · 숨겨진 비밀</h4>
        {record ? <>
          <div className="mb-1 text-xs font-black text-[#FFD58A]">📖 탐사 일지 · 직접 방문하면 얻는 기록</div>
          <p className="text-sm font-black text-white">{record.field_title ?? '탐사 일지 없음'}</p>
          {record.field_text && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#F6EFE7]">{record.field_text}</p>}
          <div className="mt-4 mb-2 text-xs font-black text-[#FFD58A]">🔎 숨겨진 비밀 · 발굴에 성공해야 얻는 기록</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-white">
            <span className="rounded-pill border border-line px-3 py-1.5">발굴 판정: {record.discovery_attempted ? (record.discovery_success ? '발견 성공' : '발견 실패') : '시도 없음'}</span>
            {record.discovery_attempted && record.discovery_chance_percent !== null && <span className="rounded-pill border border-line px-3 py-1.5">당시 성공 확률 {record.discovery_chance_percent}%</span>}
            {record.permanent_unlock_granted && <span className="rounded-pill border border-success/50 px-3 py-1.5 text-[#B9F5CC]">숨겨진 비밀 영구 해금</span>}
            {record.discovery_already_unlocked && <span className="rounded-pill border border-line px-3 py-1.5">숨겨진 비밀 이미 발견</span>}
          </div>
          {record.discovery_success && <div className="mt-3 rounded-card-md border border-gold/30 bg-gold/10 p-3">
            <p className="text-sm font-black text-[#FFE0A2]">{record.discovery_title ?? '숨겨진 비밀 발견'}</p>
            {record.discovery_text && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-white">{record.discovery_text}</p>}
          </div>}
        </> : <p className="text-xs font-bold text-white">발굴 판정 스냅샷이 없습니다.</p>}
      </div>
      <div className="text-[11px] font-semibold text-[#F6EFE7]">원정 ID #{run.run_id} · 주 시작일 {run.week_start_date} · 역사적 스냅샷(읽기 전용)</div>
    </div>
  </details>;
}
