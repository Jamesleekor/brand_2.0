import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { guild5RpcError, guild5TeacherRpc, type Guild5TeacherDashboard } from '@/lib/rpc/guild5_rpc';
import { useToastStore } from '@/stores/ui_store';

const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const num = (value: unknown) => Number(value ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const dt = (value?: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '-';
const readinessLabel: Record<string, string> = {
  guild_count: '길드 수', roster_context: '학생 소속', session: '길드 세션', teacher_observation: '길드 기여 기록',
  mission: 'Guild3 미션', peer: 'Guild4 동료평가', arcade: 'Arcade', official_mission_gs: '공식 Mission GS',
  compensation_config: '4인 길드 보정 설정', territories: '정복 영토',
};
const stateLabel: Record<string, string> = { OPEN: '마감 전', REOPENED: '재오픈', FINALIZED: 'FINAL' };
const turnLabel: Record<string, string> = { WAITING: '대기', ACTIVE: '선택 중', ASSIGNED: '선택 완료', AUTO_ASSIGNED: '자동 배정' };
const territorySlotLabel: Record<number, string> = { 1: '좌측 산악 거점', 2: '중앙 왕성 거점', 3: '우측 해안 거점' };

export default function GuildMonthlyAdmin() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [actionError, setActionError] = useState<string | null>(null);

  const dashboardQ = useQuery({
    queryKey: ['guild5-dashboard', yearMonth],
    queryFn: async () => {
      const r = await guild5TeacherRpc.dashboard(supabase, { p_year_month: yearMonth });
      if (!r.success) throw new Error(guild5RpcError(r));
      return r.data;
    },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['guild5-dashboard', yearMonth] });
  const actionM = useMutation({
    mutationFn: async (job: { label: string; fn: () => Promise<any> }) => {
      const r = await job.fn();
      if (!r.success) throw new Error(guild5RpcError(r));
      return { label: job.label, data: r.data };
    },
    onMutate: () => setActionError(null),
    onSuccess: ({ label }) => { show({ title: label, variant: 'success' }); refresh(); },
    onError: (error) => {
      const message = (error as Error).message;
      setActionError(message);
      show({ title: 'Guild5 작업 오류', description: message, variant: 'error', duration: 8000 });
    },
  });
  const run = (label: string, fn: () => Promise<any>) => actionM.mutate({ label, fn });

  return <TeacherShell><div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs text-text-muted font-black">Guild 5</div><h1 className="font-display text-2xl text-brand-gradient">월간 마감 · 정복</h1><p className="text-sm text-text-secondary mt-1">Guild2 초안을 검증해 FINAL snapshot을 만들고 월간 순위와 정복 결과를 확정합니다.</p></div>
      <div className="flex flex-wrap gap-2 items-end"><label className="text-xs font-black text-text-muted">집계 월<input type="month" className="input-field block mt-1" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}/></label><Link to="/teacher/guild" className="btn-secondary">← 길드 운영</Link></div>
    </div>
    {actionError && <div role="alert" className="rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><b>최근 작업 오류</b><div className="mt-1 break-all">{actionError}</div></div>}
    {dashboardQ.isLoading ? <div className="py-24 flex justify-center"><LoadingSpinner size="lg"/></div>
      : dashboardQ.isError ? <div className="glass-card p-5 text-danger">{(dashboardQ.error as Error).message}</div>
      : dashboardQ.data ? <Dashboard data={dashboardQ.data} yearMonth={yearMonth} busy={actionM.isPending} run={run} refresh={refresh}/> : null}
  </div></TeacherShell>;
}

function Dashboard({ data, yearMonth, busy, run, refresh }: { data: Guild5TeacherDashboard; yearMonth: string; busy: boolean; run: (label: string, fn: () => Promise<any>) => void; refresh: () => void }) {
  const preview = data.preview;
  const closureState = String(data.closure?.lifecycle_state ?? preview.closure_state ?? 'OPEN');
  const currentVersion = data.versions.find((v) => Number(v.id) === Number(data.closure?.current_version_id ?? preview.current_version_id)) ?? data.versions[0];
  const [territoryDrafts, setTerritoryDrafts] = useState(() => territoryInitial(data));
  const territories = data.territories ?? [];
  const usedTerritoryIds = new Set<number>((data.conquest_turns ?? []).filter((t) => t.territory_id).map((t) => Number(t.territory_id)));
  const activeTurn = (data.conquest_turns ?? []).find((t) => t.turn_status === 'ACTIVE');

  const changeOverride = (component: 'MISSION' | 'PEER') => {
    const key = component.toLowerCase();
    const active = Boolean(preview.overrides?.[key]?.active);
    const reason = window.prompt(active ? `${component} 긴급 override를 해제하는 사유를 입력하세요.` : `${component} NOT_READY를 현재 계산 가능한 값으로 확정하는 긴급 사유를 입력하세요.`, '')?.trim() ?? '';
    if (reason.length < 2) return;
    if (!active && !window.confirm(`${component}를 OVERRIDDEN 상태로 월 마감에 포함할까요?\n0점으로 강제하는 기능이 아니라 현재 계산 가능한 값을 snapshot합니다.`)) return;
    run(active ? `${component} override를 해제했어요` : `${component} override를 적용했어요`, () => guild5TeacherRpc.setOverride(supabase, { p_year_month: yearMonth, p_component: component, p_enabled: !active, p_reason: reason }));
  };
  const finalize = () => {
    if (!preview.can_finalize) return;
    if (window.confirm(`${yearMonth} 월간 GS를 FINAL로 확정할까요?\n학생/길드 점수와 순위가 snapshot되고 Guild3/4 정정이 잠깁니다.`)) run('월간 마감을 FINAL로 확정했어요', () => guild5TeacherRpc.finalize(supabase, { p_year_month: yearMonth }));
  };
  const reopen = () => {
    const reason = window.prompt('월 마감을 다시 여는 사유를 2자 이상 입력하세요.', '')?.trim() ?? '';
    if (reason.length >= 2 && window.confirm('기존 FINAL snapshot은 보존됩니다. 월을 REOPEN할까요?')) run('월간 마감을 다시 열었어요', () => guild5TeacherRpc.reopen(supabase, { p_year_month: yearMonth, p_reason: reason }));
  };
  const reconquest = () => {
    const reason = window.prompt('순위 변경 후 정복을 다시 시작하는 사유를 입력하세요.', '')?.trim() ?? '';
    if (reason.length >= 2 && currentVersion && window.confirm('기존 정복 version은 보존됩니다. 새 순위로 정복을 다시 시작할까요?')) run('재정복 절차를 시작했어요', () => guild5TeacherRpc.reconquest(supabase, { p_version_id: Number(currentVersion.id), p_reason: reason }));
  };
  const lockSeason = () => {
    const reason = window.prompt('시즌을 잠그는 사유를 입력하세요. 잠근 뒤 월 REOPEN이 차단됩니다.', '')?.trim() ?? '';
    if (reason.length >= 2 && data.season && window.confirm('시즌 lock은 월 마감 기록을 보호합니다. 실행할까요?')) run('시즌을 잠갔어요', () => guild5TeacherRpc.lockSeason(supabase, { p_season_id: Number(data.season.id), p_reason: reason }));
  };

  return <>
    {data.is_test_fixture && <section className="glass-card p-4 border-bv/30"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-bv">🧪 Guild5 TEST fixture</h2><p className="text-xs text-text-secondary mt-1">순위·Top3 정복 검증용 TEST GUILD를 최대 5개까지 준비합니다. TEST01~05의 기존 길드는 유지되고, 빈 TEST GUILD 2~5에는 선택한 월 기준 900 / 750 / 600 / 450 GS를 테스트용 Draft GS로 자동 주입합니다.</p></div><button className="btn-secondary" disabled={busy} onClick={() => run('Guild5 TEST 길드와 Draft GS를 준비했어요', () => guild5TeacherRpc.prepareTestGuilds(supabase, { p_year_month: yearMonth }))}>TEST 5길드 준비</button></div></section>}

    <section className="glass-card p-4 space-y-4">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-display text-xl">월 마감 Preview</h2><p className="text-xs text-text-secondary mt-1">상태 <b className={closureState === 'FINALIZED' ? 'text-success' : closureState === 'REOPENED' ? 'text-warning' : 'text-bv'}>{stateLabel[closureState] ?? closureState}</b> · {preview.can_finalize ? '모든 필수 source 준비 완료' : '아직 마감 차단 항목이 있습니다.'}</p></div><div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={refresh}>↻ 새로고침</button>{closureState !== 'FINALIZED' && <button className="btn-primary" disabled={busy || !preview.can_finalize} onClick={finalize}>🏁 FINALIZE</button>}{closureState === 'FINALIZED' && <button className="btn-secondary" disabled={busy || Boolean(data.season_lock)} onClick={reopen}>↩ REOPEN</button>}</div></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">{Object.entries(preview.readiness ?? {}).map(([key, item]) => <ReadinessCard key={key} label={readinessLabel[key] ?? key} item={item} onOverride={key === 'mission' ? () => changeOverride('MISSION') : key === 'peer' ? () => changeOverride('PEER') : undefined} busy={busy}/>)}</div>
      {Number((preview.readiness?.guild_count as any)?.count ?? 0) < 5 && <p className="text-xs text-warning">현재 활성 길드는 {String((preview.readiness?.guild_count as any)?.count ?? 0)}개입니다. 시스템은 최소 3개부터 마감 가능하지만 실제 운영 권장은 5개입니다.</p>}
    </section>

    <TerritoryConfig data={data} drafts={territoryDrafts} setDrafts={setTerritoryDrafts} busy={busy} run={run}/>

    <section className="glass-card p-4"><h2 className="font-display text-xl">Guild2 DRAFT 입력값</h2><p className="text-xs text-text-secondary mt-1 mb-3">FINALIZE 시 아래 값이 그대로 snapshot됩니다. 이후 과거 월은 현재 DB로 재계산하지 않습니다.</p><GuildDraftTable rows={preview.guilds ?? []}/></section>

    {closureState === 'FINALIZED' && <section className="glass-card p-4 space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-display text-xl">🏆 FINAL 결과</h2><p className="text-xs text-text-secondary mt-1">version {currentVersion?.version_no ?? '-'} · 확정 {dt(currentVersion?.finalized_at)} · tie seed 보존</p></div>{currentVersion?.conquest_status === 'RECONQUEST_REQUIRED' && <button className="btn-primary" disabled={busy} onClick={reconquest}>⚔️ 재정복 시작</button>}</div><FinalRanking rows={data.guild_snapshots ?? []}/><Conquest data={data} busy={busy} run={run} activeTurn={activeTurn} territories={territories} usedTerritoryIds={usedTerritoryIds}/></section>}

    {data.versions.length > 0 && <section className="glass-card p-4"><h2 className="font-display text-lg mb-3">월 마감 Version History</h2><div className="space-y-2">{data.versions.map((v) => <div key={v.id} className="rounded-card-md border border-line bg-bg-deep p-3 flex flex-wrap justify-between gap-2"><div><b>v{v.version_no}</b> <span className="text-xs text-text-secondary">#{v.id}</span><div className="text-xs text-text-muted mt-1">FINAL {dt(v.finalized_at)} · 정복 {v.conquest_status}</div></div><div className="text-xs text-text-secondary">{v.rank_changed_from_previous ? '⚠️ 이전 version 대비 순위 변경' : '순위 변경 없음'}</div></div>)}</div></section>}

    <section className="glass-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-lg">Season lock</h2><p className="text-xs text-text-secondary mt-1">시즌 자체가 CLOSED가 된 뒤 최종 잠금할 수 있습니다. 잠근 뒤 월 REOPEN은 차단됩니다.</p></div><button className="btn-secondary" disabled={busy || !data.season || data.season.lifecycle_status !== 'CLOSED' || Boolean(data.season_lock)} onClick={lockSeason}>{data.season_lock ? '🔒 잠금 완료' : '🔒 시즌 잠금'}</button></div></section>

    <section className="glass-card p-4"><h2 className="font-display text-lg mb-3">Audit</h2>{!data.audit.length ? <p className="text-sm text-text-secondary">아직 Guild5 audit이 없습니다.</p> : <div className="space-y-2 max-h-80 overflow-auto">{data.audit.map((a) => <div key={a.id} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="flex justify-between gap-2"><b className="text-sm">{a.event_type}</b><span className="text-2xs text-text-muted">{dt(a.occurred_at)}</span></div>{a.reason && <div className="text-xs text-text-secondary mt-1">{a.reason}</div>}</div>)}</div>}</section>
  </>;
}

function ReadinessCard({ label, item, onOverride, busy }: { label: string; item: any; onOverride?: () => void; busy: boolean }) {
  const status = String(item?.status ?? 'NOT_READY');
  const cls = status === 'READY' ? 'text-success border-success/25 bg-success/5' : status === 'OVERRIDDEN' ? 'text-warning border-warning/25 bg-warning/5' : 'text-danger border-danger/25 bg-danger/5';
  const detail = Object.entries(item ?? {}).filter(([k]) => !['status', 'override_reason', 'raw_ready'].includes(k)).slice(0, 2).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  return <div className={`rounded-card-md border p-3 ${cls}`}><div className="text-xs font-black text-text-secondary">{label}</div><div className="font-display mt-1">{status}</div>{detail && <div className="text-[10px] text-text-muted mt-1 break-all">{detail}</div>}{item?.override_reason && <div className="text-[10px] text-warning mt-1">사유: {item.override_reason}</div>}{onOverride && <button className="text-[10px] underline mt-2" disabled={busy} onClick={onOverride}>{status === 'OVERRIDDEN' ? 'override 해제' : '긴급 override'}</button>}</div>;
}

function territoryInitial(data: Guild5TeacherDashboard) {
  const map = new Map<number, Record<string, any>>((data.territories ?? []).map((t) => [Number(t.slot_no), t] as [number, Record<string, any>]));
  return [1, 2, 3].map((slot) => ({
    slot,
    name: String(map.get(slot)?.territory_name ?? ''),
    description: String(map.get(slot)?.description ?? ''),
    taxRatePercent: Number(map.get(slot)?.tax_rate_percent ?? 5),
  }));
}
type TerritoryDraft = { slot: number; name: string; description: string; taxRatePercent: number };
function TerritoryConfig({ data, drafts, setDrafts, busy, run }: { data: Guild5TeacherDashboard; drafts: TerritoryDraft[]; setDrafts: Dispatch<SetStateAction<TerritoryDraft[]>>; busy: boolean; run: (label:string,fn:()=>Promise<any>)=>void }) {
  if (!data.season) return null;
  return <section className="glass-card p-4"><div className="mb-3"><h2 className="font-display text-xl">🗺️ 정복 영토 3개</h2><p className="text-xs text-text-secondary mt-1">시즌당 정확히 3개를 설정합니다. 1위 → 2위 → 3위 순서로 하나씩 선택합니다. 지역 세율은 점령 정보에 snapshot으로 보존됩니다.</p></div><div className="grid lg:grid-cols-3 gap-3">{drafts.map((d, i) => <div key={d.slot} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs font-black text-bv">영토 {d.slot} · {territorySlotLabel[d.slot]}</div><input className="input-field w-full mt-2" placeholder="영토 이름" value={d.name} onChange={(e) => setDrafts((rows) => rows.map((x, j) => j === i ? {...x,name:e.target.value} : x))}/><input className="input-field w-full mt-2" placeholder="설명 (선택)" value={d.description} onChange={(e) => setDrafts((rows) => rows.map((x, j) => j === i ? {...x,description:e.target.value} : x))}/><label className="mt-2 block text-[10px] font-black text-text-muted">지역 세율 (%)<input type="number" min={0} max={100} step={0.1} className="input-field w-full mt-1" value={d.taxRatePercent} onChange={(e) => { const next = Number(e.target.value); setDrafts((rows) => rows.map((x, j) => j === i ? {...x,taxRatePercent:Number.isFinite(next)?Math.min(100,Math.max(0,next)):0} : x)); }}/></label><button className="btn-secondary w-full mt-2" disabled={busy || d.name.trim().length < 1 || Boolean(data.season_lock)} onClick={() => run(`영토 ${d.slot} 설정을 저장했어요`, () => guild5TeacherRpc.setTerritory(supabase, { p_season_id: Number(data.season!.id), p_slot_no: d.slot, p_territory_name: d.name.trim(), p_description: d.description.trim() || null, p_tax_rate_percent: d.taxRatePercent }))}>저장</button></div>)}</div></section>;
}

function GuildDraftTable({ rows }: { rows: Array<Record<string, any>> }) {
  if (!rows.length) return <EmptyState emoji="📊" title="Guild2 월간 초안이 없습니다" description="점수 다시 계산 후 마감 Preview를 새로고침하세요."/>;
  return <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-text-muted border-b border-line"><tr><Th>길드</Th><Th>인원</Th><Th>개인 합</Th><Th>Mission GS</Th><Th>보정</Th><Th>기타 조정</Th><Th>Draft GS</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.guild_id} className="border-b border-line/50"><Td>{r.guild_name}</Td><Td>{r.roster_count}</Td><Td>{num(r.individual_subtotal)}</Td><Td>{num(r.official_mission_gs)}</Td><Td>{num(r.compensation_amount)}</Td><Td>{num(r.manual_adjustment_total)}</Td><Td><b className="text-gold">{num(r.draft_gs_total)}</b></Td></tr>)}</tbody></table></div>;
}
function FinalRanking({ rows }: { rows: Array<Record<string, any>> }) {
  return <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-2">{rows.map((r) => <div key={r.guild_id} className={`rounded-card-md border p-3 ${Number(r.rank_position) <= 3 ? 'border-gold/30 bg-gold/5' : 'border-line bg-bg-deep'}`}><div className="text-xs font-black text-text-muted">{r.rank_position}위</div><div className="font-black mt-1 truncate">{r.guild_name_at_close}</div><div className="font-display text-xl text-gold mt-2">{num(r.total_gs)} GS</div><div className="text-[10px] text-text-muted mt-1">BV {num(r.roster_bv_sum)} · Mission {num(r.official_mission_gs)}</div></div>)}</div>;
}
function Conquest({ data, busy, run, activeTurn, territories, usedTerritoryIds }: { data: Guild5TeacherDashboard; busy:boolean; run:(label:string,fn:()=>Promise<any>)=>void; activeTurn:any; territories:Array<Record<string,any>>; usedTerritoryIds:Set<number> }) {
  const currentVersionId = Number(data.closure?.current_version_id ?? 0);
  const guildNames = new Map((data.guild_snapshots ?? []).map((g) => [Number(g.guild_id), String(g.guild_name_at_close ?? `Guild #${g.guild_id}`)]));
  return <div className="rounded-card-md border border-line bg-bg-deep p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-black">⚔️ 정복 순서</h3><p className="text-xs text-text-secondary mt-1">각 순위의 선택 기한은 활성화 시점부터 48시간입니다. 선순위 선택이 끝나야 다음 순위가 열립니다.</p></div>{currentVersionId > 0 && <button className="btn-secondary" disabled={busy} onClick={() => run('기한이 지난 정복 차례를 확인했어요', () => guild5TeacherRpc.processDue(supabase, { p_version_id: currentVersionId }))}>⏱ 기한 만료 처리</button>}</div><div className="grid md:grid-cols-3 gap-2 mt-3">{(data.conquest_turns ?? []).map((t) => <div key={t.id} className={`rounded-card-md border p-3 ${t.turn_status === 'ACTIVE' ? 'border-bv bg-bv/10' : 'border-line bg-bg-card'}`}><div className="flex justify-between"><b>{t.rank_position}위 · {guildNames.get(Number(t.guild_id)) ?? `Guild #${t.guild_id}`}</b><span className="text-xs">{turnLabel[t.turn_status] ?? t.turn_status}</span></div><div className="text-xs text-text-secondary mt-1">{t.territory_name_snapshot ?? (t.deadline_at ? `마감 ${dt(t.deadline_at)}` : '앞 순위 대기')}</div>{t.assignment_method && <div className="text-[10px] text-text-muted mt-1">{t.assignment_method === 'AUTO' ? '서버 자동 배정' : '교사 수동 선택'}</div>}</div>)}</div>{activeTurn && <div className="mt-4 border-t border-line pt-3"><div className="font-black text-sm">현재 {activeTurn.rank_position}위 선택</div><div className="flex flex-wrap gap-2 mt-2">{territories.filter((t) => !usedTerritoryIds.has(Number(t.id))).map((t) => <button key={t.id} className="btn-primary" disabled={busy} onClick={() => { if (window.confirm(`${t.territory_name}을(를) ${activeTurn.rank_position}위 길드에 배정할까요?`)) run('정복 영토를 배정했어요', () => guild5TeacherRpc.chooseTerritory(supabase, { p_turn_id: Number(activeTurn.id), p_territory_id: Number(t.id) })); }}>{t.territory_name}</button>)}{data.is_test_fixture && <button className="btn-secondary" disabled={busy} onClick={() => run('TEST에서 선택 기한을 만료시켜 자동 배정했어요', () => guild5TeacherRpc.forceTestTurnDue(supabase, { p_turn_id: Number(activeTurn.id) }))}>🧪 48시간 만료 테스트</button>}</div></div>}</div>;
}
function Th({ children }: { children: ReactNode }) { return <th className="px-3 py-2 text-left font-black whitespace-nowrap">{children}</th>; }
function Td({ children }: { children: ReactNode }) { return <td className="px-3 py-2 whitespace-nowrap">{children}</td>; }
