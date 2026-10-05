import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  expeditionRpc,
  type ExpeditionBoard,
  type ExpeditionCharacterBoardRow,
  type ExpeditionElementCode,
  type ExpeditionSiteBoardRow,
} from '@/lib/rpc/expedition_rpc';
import { cn } from '@/lib/utils/cn';
import { calculateExpeditionFitClient } from './expedition/expeditionFit';

const ELEMENT_META: Record<ExpeditionElementCode, { label: string; icon: string }> = {
  WATER: { label: '물', icon: '💧' }, FIRE: { label: '불', icon: '🔥' },
  WIND: { label: '바람', icon: '💫' }, EARTH: { label: '땅', icon: '🪨' },
  LIGHT: { label: '빛', icon: '✦' }, DARK: { label: '어둠', icon: '☾' },
};
const SPECIALTY_META = {
  RUINS: { label: '유적', icon: '🏛' },
  NATURE: { label: '자연', icon: '🌿' },
  SANCTUARY: { label: '성소', icon: '✦' },
} as const;

function formatKst(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function phaseLabel(phase: string) {
  if (phase === 'PREVIEW') return '원정 공개';
  if (phase === 'SAT') return '토요일 원정';
  if (phase === 'SUN') return '일요일 원정';
  if (phase === 'CLOSED') return '이번 주 원정 종료';
  return '원정 준비';
}

export default function ExpeditionChroniclePanel() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [party, setParty] = useState<number[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ['expedition-board'],
    queryFn: async () => {
      const result = await expeditionRpc.board(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const board = boardQuery.data;
  const sites = board?.sites ?? [];
  const characters = board?.characters ?? [];
  const selectedSite = sites.find((x) => x.week_site_id === siteId) ?? sites[0] ?? null;

  useEffect(() => {
    if (!siteId && sites[0]) setSiteId(sites[0].week_site_id);
  }, [siteId, sites]);
  useEffect(() => {
    setParty([]);
    setSubmitError(null);
  }, [siteId, board?.week?.phase]);

  const selectedCharacters = useMemo(
    () => party.map((id) => characters.find((x) => x.character_id === id))
      .filter((x): x is ExpeditionCharacterBoardRow => Boolean(x)),
    [party, characters],
  );
  const localFit = useMemo(
    () => selectedSite ? calculateExpeditionFitClient(selectedSite, selectedCharacters) : null,
    [selectedSite, selectedCharacters],
  );

  const previewQuery = useQuery({
    queryKey: ['expedition-preview', selectedSite?.week_site_id, party.join(',')],
    enabled: Boolean(selectedSite && party.length === 3 && ['SAT', 'SUN'].includes(board?.week?.phase ?? '')),
    queryFn: async () => {
      if (!selectedSite) throw new Error('탐사지를 선택해주세요.');
      const result = await expeditionRpc.preview(supabase, selectedSite.week_site_id, party);
      if (result.success === false) throw Object.assign(new Error(result.error), { code: result.code });
      return result.data;
    },
    retry: false,
    staleTime: 1_000,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSite || party.length !== 3) throw new Error('편린 3종을 선택해주세요.');
      const result = await expeditionRpc.submit(supabase, selectedSite.week_site_id, party, crypto.randomUUID());
      if (result.success === false) throw Object.assign(new Error(result.error), { code: result.code });
      return result.data;
    },
    onSuccess: () => {
      setParty([]);
      setSubmitError(null);
      void queryClient.invalidateQueries({ queryKey: ['expedition-board'] });
    },
    onError: (error) => {
      const e = error as Error & { code?: string };
      setSubmitError(e.code === 'P0E42'
        ? '토요일에 출전한 편린은 회복이 필요해 일요일 원정에 다시 보낼 수 없습니다.'
        : e.message);
    },
  });

  if (boardQuery.isLoading) return <div className="flex min-h-[340px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (boardQuery.isError) return (
    <div className="rounded-card-xl border border-danger/40 bg-danger-bg p-6 text-center">
      <div className="text-3xl">⚠️</div><div className="mt-2 text-lg font-black text-text-primary">원정 정보를 불러오지 못했어요.</div>
      <button type="button" onClick={() => void boardQuery.refetch()} className="mt-4 rounded-pill border border-line px-4 py-2 text-sm font-black text-text-primary">다시 불러오기</button>
    </div>
  );
  if (!board?.enabled) return (
    <div className="rounded-card-xl border border-brand-primary/30 bg-gradient-to-br from-bg-card to-brand-primary/10 p-6 shadow-card">
      <div className="text-3xl">🧭</div><h2 className="mt-3 font-display text-2xl text-text-primary">편린 원정대 준비 중</h2>
      <p className="mt-2 text-sm font-semibold text-text-secondary">운영국에서 원정을 개방하면 이곳에서 탐사지를 고르고 3편린 원정대를 편성할 수 있습니다.</p>
    </div>
  );
  if (!board.week) return (
    <div className="rounded-card-xl border border-line bg-bg-card p-6 shadow-card">
      <div className="text-3xl">🗺️</div><h2 className="mt-3 text-xl font-black text-text-primary">이번 주 공개된 원정이 없습니다.</h2>
    </div>
  );

  const phase = board.week.phase;
  const open = phase === 'SAT' || phase === 'SUN';
  const alreadySubmitted = phase === 'SAT' ? Boolean(board.my_sat_run) : phase === 'SUN' ? Boolean(board.my_sun_run) : false;
  const serverFit = previewQuery.data;
  const mismatch = Boolean(localFit && serverFit && (
    localFit.fitPercent !== serverFit.fit_percent || localFit.traceContribution !== serverFit.trace_contribution
  ));

  return <div className="space-y-4">
    <section className="rounded-card-xl border border-brand-primary/30 bg-gradient-to-br from-bg-card to-brand-primary/10 p-4 shadow-card lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs font-black text-brand-primary">원정 연대기 · 제 {board.week.week_index}주</div>
          <h2 className="mt-1 font-display text-2xl text-text-primary">{phaseLabel(phase)}</h2>
          <p className="mt-1 text-sm font-semibold text-text-secondary">매주 유적·자연·성소 한 곳씩 열립니다.</p></div>
        <div className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-black text-text-primary">
          {phase === 'PREVIEW' ? `토요일 ${formatKst(board.week.sat_open_at)}` : phase === 'SAT' ? `일요일 ${formatKst(board.week.sun_open_at)}` : `마감 ${formatKst(board.week.sun_close_at)}`}
        </div>
      </div>
      {board.week.reward_mode === 'DRY_RUN' && <div className="mt-3 rounded-card-md border border-warning/35 bg-warning/10 px-3 py-2 text-xs font-bold text-warning">현재는 DRY RUN입니다. 적합도와 흔적만 기록하며 실제 자산 보상은 지급하지 않습니다.</div>}
    </section>

    <section className="grid gap-3 lg:grid-cols-3">{sites.map((site) => <SiteCard key={site.week_site_id} site={site} selected={selectedSite?.week_site_id === site.week_site_id} onSelect={() => setSiteId(site.week_site_id)} />)}</section>

    {phase === 'PREVIEW' && <div className="rounded-card-lg border border-line bg-bg-card p-5 text-center text-sm font-bold text-text-secondary">토요일 00:00 KST부터 원정대 편성이 열립니다.</div>}

    {open && selectedSite && <section className="rounded-card-xl border border-line bg-bg-card p-4 shadow-card lg:p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black text-brand-primary">{selectedSite.site_name}</div><h3 className="mt-1 text-xl font-black text-text-primary">원정대 3편린 편성</h3>
        <p className="mt-1 text-sm font-semibold text-text-secondary">{phase === 'SUN' ? '토요일 출전 편린은 회복 필요 상태로 비활성화됩니다.' : '편린 3종을 선택하세요.'}</p></div><div className="rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-xs font-black text-text-primary">{party.length} / 3</div></div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">{characters.map((character) => <PartyCard key={character.character_id} character={character} selected={party.includes(character.character_id)} disabled={alreadySubmitted || character.recovery_required} onToggle={() => {
        if (alreadySubmitted || character.recovery_required) return;
        setSubmitError(null);
        setParty((current) => current.includes(character.character_id) ? current.filter((id) => id !== character.character_id) : current.length < 3 ? [...current, character.character_id] : current);
      }} />)}</div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="rounded-card-lg border border-line bg-bg-deep p-4">
          {alreadySubmitted ? <div className="text-sm font-black text-success">✓ 오늘 원정을 완료했습니다.</div> : localFit ? <div className="grid grid-cols-4 gap-3"><Stat label="원정 적합도" value={`${serverFit?.fit_percent ?? localFit.fitPercent}%`} /><Stat label="등급" value={serverFit?.fit_grade_ko ?? localFit.fitGradeKo} /><Stat label="예상 흔적" value={`+${serverFit?.trace_contribution ?? localFit.traceContribution}`} /><Stat label="특기 일치" value={`${serverFit?.specialty_match_count ?? localFit.specialtyMatchCount}명`} /></div> : <div className="text-sm font-bold text-text-secondary">편린 3종을 선택하면 적합도를 계산합니다.</div>}
          {mismatch && <div className="mt-2 rounded-card-md border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-black text-danger">서버 계산과 화면 계산이 일치하지 않아 제출을 막았습니다.</div>}
          {previewQuery.isError && <div className="mt-2 text-xs font-bold text-warning">{(previewQuery.error as Error).message}</div>}
          {submitError && <div className="mt-2 text-xs font-bold text-danger">{submitError}</div>}
        </div>
        <button type="button" disabled={alreadySubmitted || party.length !== 3 || previewQuery.isFetching || previewQuery.isError || mismatch || submitMutation.isPending} onClick={() => submitMutation.mutate()} className="min-h-[88px] rounded-card-lg border border-brand-primary/50 bg-brand-primary/20 px-6 py-4 text-sm font-black text-white disabled:opacity-40">{submitMutation.isPending ? '처리 중…' : alreadySubmitted ? '오늘 원정 완료' : '원정 출발'}</button>
      </div>
    </section>}

    {(board.my_sat_run || board.my_sun_run) && <section className="grid gap-3 md:grid-cols-2">{board.my_sat_run && <RunSummary title="토요일 원정 기록" run={board.my_sat_run} />}{board.my_sun_run && <RunSummary title="일요일 원정 기록" run={board.my_sun_run} />}</section>}
  </div>;
}

function SiteCard({ site, selected, onSelect }: { site: ExpeditionSiteBoardRow; selected: boolean; onSelect: () => void }) {
  const specialty = SPECIALTY_META[site.specialty_code]; const major = ELEMENT_META[site.major_element]; const minor = ELEMENT_META[site.minor_element];
  return <button type="button" onClick={onSelect} className={cn('rounded-card-xl border p-4 text-left shadow-card transition', selected ? 'border-brand-primary/60 bg-brand-primary/10' : 'border-line bg-bg-card hover:border-line-strong')}>
    <div className="text-xs font-black text-brand-primary">{specialty.icon} {specialty.label}</div><h3 className="mt-1 text-lg font-black text-text-primary">{site.site_name}</h3><div className="mt-2 text-sm font-bold text-text-secondary">{site.environment_label}</div>
    <div className="mt-3 flex gap-2"><span className="rounded-pill border border-brand-primary/35 bg-brand-primary/10 px-2 py-1 text-xs font-black text-text-primary">주요 {major.icon} {major.label}</span><span className="rounded-pill border border-line bg-bg-deep px-2 py-1 text-xs font-black text-text-primary">보조 {minor.icon} {minor.label}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs"><div><div className="font-bold text-text-secondary">핵심 보상</div><div className="font-black text-text-primary">{site.core_reward_label}</div></div><div><div className="font-bold text-text-secondary">주도 시 효과</div><div className="font-black text-text-primary">{site.world_effect_label}</div></div><div><div className="font-bold text-text-secondary">이번 주 흔적</div><div className="font-black text-gold">{site.weekly_trace}</div></div><div><div className="font-bold text-text-secondary">원정 인원</div><div className="font-black text-text-primary">{site.weekly_participants}명</div></div></div>
  </button>;
}

function PartyCard({ character, selected, disabled, onToggle }: { character: ExpeditionCharacterBoardRow; selected: boolean; disabled: boolean; onToggle: () => void }) {
  const src = character.card_image_url || character.avatar_image_url || character.resource_url; const specialty = SPECIALTY_META[character.specialty_code];
  return <button type="button" disabled={disabled} onClick={onToggle} className={cn('relative overflow-hidden rounded-card-md border bg-bg-deep text-left', selected ? 'border-brand-primary/70 ring-2 ring-brand-primary/25' : disabled ? 'cursor-not-allowed border-line opacity-45' : 'border-line hover:border-brand-primary/45')}>
    <div className="aspect-square overflow-hidden bg-bg-base">{character.resource_kind === 'EMOJI' ? <div className="flex h-full items-center justify-center text-4xl">{character.emoji || '✦'}</div> : src ? <img src={src} alt={character.name} className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-3xl">✦</div>}</div>
    <div className="p-2"><div className="truncate text-[11px] font-black text-text-primary">{character.name}</div><div className="mt-1 truncate text-[9px] font-bold text-text-secondary">{specialty.icon} {specialty.label} · {ELEMENT_META[character.primary_element].icon}{character.primary_points}{character.secondary_element && character.secondary_points > 0 ? ` ${ELEMENT_META[character.secondary_element].icon}${character.secondary_points}` : ''}</div></div>
    {character.recovery_required && <div className="absolute inset-x-1 bottom-1 rounded-pill border border-warning/50 bg-bg-base/95 px-1 py-1 text-center text-[9px] font-black text-warning">회복 필요</div>}
  </button>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] font-black text-text-secondary">{label}</div><div className="mt-1 text-lg font-black text-text-primary">{value}</div></div>; }
function RunSummary({ title, run }: { title: string; run: NonNullable<ExpeditionBoard['my_sat_run']> }) { return <div className="rounded-card-lg border border-line bg-bg-card p-4"><div className="text-xs font-black text-brand-primary">{title}</div><div className="mt-1 text-lg font-black text-text-primary">{run.site.site_name}</div><div className="mt-3 grid grid-cols-3 gap-2"><Stat label="원정 적합도" value={`${run.fit_percent}%`} /><Stat label="등급" value={run.fit_grade_ko} /><Stat label="남긴 흔적" value={`+${run.trace_contribution}`} /></div></div>; }
