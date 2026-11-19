// RAID_INSCRIPTION_V1_20261118 — 레이드 구성 패널의 「✒ 주문 각인」 탭
// ON/OFF · 난이도(쉬움/보통/어려움/직접 설정) · 각인 인원 · 자동 발동 지점(최대 3개) · 성공 보상 · 실패(타락) · 선발 방식
// 아래에는 진행 패널(발동·지목), 지난 기록, 리허설, 연습 모드가 이어진다.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import type { RaidInscriptionDifficulty } from '@/lib/rpc/raid_student_rpc';
import {
  raidInscriptionAdminRpc,
  type RaidInscriptionConfigPayload,
  type RaidInscriptionSelectionMode,
  type RaidInscriptionTeacherConfig,
} from '@/lib/rpc/raid_inscription_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import InscriptionPractice from '@/features/raid/inscription/InscriptionPractice';
import { INSCRIPTION_PRESETS, formatSeconds } from '@/features/raid/inscription/inscriptionCore';
import RaidInscriptionLivePanel from './RaidInscriptionLivePanel';
import RaidInscriptionRehearsal, { type InscriptionRehearsalSettings } from './RaidInscriptionRehearsal';

const DIFFICULTIES: RaidInscriptionDifficulty[] = ['EASY', 'NORMAL', 'HARD', 'CUSTOM'];
const DIFFICULTY_LABEL: Record<RaidInscriptionDifficulty, string> = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움', CUSTOM: '직접 설정' };
/** 8명 기준 모의 실험으로 본 대략의 성공률(학급 타자 실력에 따라 달라짐) */
const ESTIMATED_SUCCESS: Partial<Record<RaidInscriptionDifficulty, string>> = { EASY: '약 85%', NORMAL: '약 70%', HARD: '약 35%' };
/** 처음 켤 때 권하는 자동 발동 지점(격돌 50%와 겹치지 않게) */
const SUGGESTED_TRIGGERS = [70, 30];

/** 화면에서 고치는 값(숫자는 % · 초 단위) */
interface FormState {
  enabled: boolean;
  difficulty: RaidInscriptionDifficulty;
  letterCount: number;
  useGh: boolean;
  timeLimitSeconds: number;
  playerCount: number;
  autoTriggers: string[];
  bossDamagePercent: string;
  barrierHealPercent: string;
  corruptionCount: number;
  corruptionSeconds: number;
  corruptionLabel: string;
  selectionMode: RaidInscriptionSelectionMode;
}

function formFromConfig(data: RaidInscriptionTeacherConfig): FormState {
  return {
    enabled: data.enabled,
    difficulty: data.difficulty,
    letterCount: Number(data.letter_count),
    useGh: Boolean(data.use_gh),
    timeLimitSeconds: Number(data.time_limit_seconds),
    playerCount: Number(data.player_count),
    autoTriggers: (data.configured ? data.auto_trigger_percents : SUGGESTED_TRIGGERS).map(String),
    bossDamagePercent: String(data.boss_damage_percent),
    barrierHealPercent: String(data.barrier_heal_percent),
    corruptionCount: Number(data.corruption_count),
    corruptionSeconds: Number(data.corruption_seconds),
    corruptionLabel: data.corruption_label || '타락',
    selectionMode: data.selection_mode,
  };
}

function sameForm(a: FormState, b: FormState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function RaidInscriptionConfigTab({ raidId, raidStatus }: { raidId: number; raidStatus: RaidStatus }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['teacher-raid-inscription-config', raidId],
    queryFn: async () => {
      const result = await raidInscriptionAdminRpc.config(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
    retry: false,
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (query.data) setForm(formFromConfig(query.data));
  }, [query.data]);

  const rehearsalSettings = useMemo<InscriptionRehearsalSettings>(() => {
    const f = form;
    return {
      difficulty: f?.difficulty ?? 'EASY',
      letterCount: f?.letterCount ?? 8,
      useGh: f?.useGh ?? false,
      timeLimitMs: Math.round((f?.timeLimitSeconds ?? 20) * 1000),
      playerCount: f?.playerCount ?? 8,
      bossDamagePercent: Number(f?.bossDamagePercent ?? 3) || 0,
      barrierHealPercent: Number(f?.barrierHealPercent ?? 15) || 0,
      corruptionCount: Math.min(f?.corruptionCount ?? 2, f?.playerCount ?? 8),
      corruptionSeconds: f?.corruptionSeconds ?? 10,
      corruptionLabel: f?.corruptionLabel || '타락',
    };
  }, [form]);

  if (query.isLoading) {
    return <div className="flex justify-center py-10"><LoadingSpinner /></div>;
  }
  if (query.isError || !query.data || !form) {
    return (
      <div className="mt-5 space-y-5">
        <div className="rounded-card-md border border-red-300/40 bg-red-950/60 p-4 text-sm font-black text-red-100">
          주문 각인 설정을 불러오지 못했습니다. 서버에 주문 각인 SQL이 아직 적용되지 않았을 수 있습니다.
          <div className="mt-1 font-mono text-xs text-red-100">{query.error instanceof Error ? query.error.message : ''}</div>
        </div>
        {/* 리허설·연습은 서버 없이 돌아가므로 서버 적용 전에도 해 볼 수 있게 둔다. */}
        <RaidInscriptionRehearsal settings={rehearsalSettings} />
        <PracticeBox />
      </div>
    );
  }

  const data = query.data;
  const editable = data.editable && (raidStatus === 'DRAFT' || raidStatus === 'LOBBY_OPEN');
  const dirty = !sameForm(form, formFromConfig(data)) || !data.configured;
  const update = (patch: Partial<FormState>) => setForm((current) => (current ? { ...current, ...patch } : current));

  const chooseDifficulty = (next: RaidInscriptionDifficulty) => {
    if (next === 'CUSTOM') {
      update({ difficulty: 'CUSTOM' });
      return;
    }
    // 난이도 카드를 고르면 그 난이도의 기본 숫자로 채운다(보상·타락은 이후 자유롭게 고칠 수 있음)
    const preset = data.presets[next];
    update({
      difficulty: next,
      letterCount: Number(preset.letter_count),
      useGh: Boolean(preset.use_gh),
      timeLimitSeconds: Number(preset.time_limit_ms) / 1000,
      bossDamagePercent: String(Math.round(Number(preset.boss_damage_ratio) * 1000) / 10),
      barrierHealPercent: String(Math.round(Number(preset.barrier_heal_ratio) * 1000) / 10),
      corruptionCount: Math.min(Number(preset.corruption_count), form.playerCount),
      corruptionSeconds: Number(preset.corruption_seconds),
    });
  };

  const triggerNumbers = form.autoTriggers.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  const nearClash = triggerNumbers.filter((value) => value >= 45 && value <= 55);
  const badTrigger = form.autoTriggers.some((value) => {
    const n = Number(value);
    return value.trim() === '' || !Number.isInteger(n) || n < 1 || n > 99;
  });
  const duplicateTrigger = new Set(triggerNumbers).size !== triggerNumbers.length;

  const save = async () => {
    if (badTrigger) {
      setMessage({ tone: 'error', text: '자동 발동 지점은 1~99 사이의 정수(%)로 입력해 주세요.' });
      return;
    }
    if (duplicateTrigger) {
      setMessage({ tone: 'error', text: '같은 자동 발동 지점이 두 번 들어 있습니다.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    const payload: RaidInscriptionConfigPayload = {
      enabled: form.enabled,
      difficulty: form.difficulty,
      ...(form.difficulty === 'CUSTOM' ? { letter_count: form.letterCount, use_gh: form.useGh, time_limit_seconds: form.timeLimitSeconds } : {}),
      player_count: form.playerCount,
      auto_trigger_percents: triggerNumbers,
      boss_damage_percent: Number(form.bossDamagePercent),
      barrier_heal_percent: Number(form.barrierHealPercent),
      corruption_count: form.corruptionCount,
      corruption_seconds: form.corruptionSeconds,
      corruption_label: form.corruptionLabel.trim() || '타락',
      selection_mode: form.selectionMode,
    };
    const result = await raidInscriptionAdminRpc.saveConfig(supabase, raidId, payload);
    setSaving(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    queryClient.setQueryData(['teacher-raid-inscription-config', raidId], result.data);
    void queryClient.invalidateQueries({ queryKey: ['teacher-raid-inscription-pick', raidId] });
    setMessage({ tone: 'ok', text: form.enabled ? `주문 각인을 켰습니다 (${DIFFICULTY_LABEL[form.difficulty]} · 각인자 ${form.playerCount}명).` : '설정을 저장했습니다 (주문 각인 꺼짐).' });
  };

  const fieldCls = 'h-9 rounded-card-md border border-white/15 bg-black/40 px-2 text-sm font-black text-white disabled:opacity-60';

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-card-lg border border-violet-300/30 bg-violet-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-black text-violet-100">✒ 주문 각인(INSCRIPTION)</div>
            <p className="mt-1 text-sm font-bold leading-6 text-white">
              보스 HP가 정한 지점에 닿으면 전투가 멈추고, 지원한 학생 중 {form.playerCount}명이 화면의 알파벳을 제한 시간 안에 키보드로 순서대로 칩니다.
              틀리면 새 주문이 나오고, <b>각인자 전원</b>이 시간 안에 하나씩 완성하면 성공입니다.
            </p>
          </div>
          {!editable && (
            <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-100">🔒 전투 시작 후에는 바꿀 수 없습니다 (선발 방식은 아래 진행 패널에서 바꿀 수 있어요)</span>
          )}
        </div>

        <label className={cn('mt-4 flex items-center gap-3 text-base font-black', editable ? 'text-white' : 'text-amber-100')}>
          <input type="checkbox" className="h-5 w-5 accent-violet-400" checked={form.enabled} disabled={!editable}
            onChange={(event) => update({ enabled: event.target.checked })} />
          이 레이드에서 주문 각인 사용
        </label>

        {/* 난이도 */}
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {DIFFICULTIES.map((item) => {
            const preset = item === 'CUSTOM' ? null : data.presets[item];
            return (
              <button
                key={item}
                type="button"
                disabled={!editable}
                onClick={() => chooseDifficulty(item)}
                className={cn(
                  'rounded-card-md border p-3 text-left transition',
                  form.difficulty === item ? 'border-violet-300 bg-violet-500/20' : 'border-white/15 bg-black/30 hover:bg-white/5',
                  !editable && 'cursor-not-allowed',
                )}
              >
                <div className="text-base font-black text-white">{DIFFICULTY_LABEL[item]}</div>
                <div className="mt-1 text-xs font-bold text-violet-100">
                  {preset
                    ? `${preset.letter_count}글자 · ${formatSeconds(Number(preset.time_limit_ms), 0)}초 · 키 ${preset.use_gh ? '9개(G·H)' : '7개'}`
                    : '글자 수 8~16 · 시간 10~60초'}
                </div>
                <div className="mt-0.5 text-[11px] font-bold text-violet-200/80">
                  {ESTIMATED_SUCCESS[item] ? `8명 기준 예상 성공률 ${ESTIMATED_SUCCESS[item]}` : '16글자(극한)는 여기서만'}
                </div>
              </button>
            );
          })}
        </div>

        {form.difficulty === 'CUSTOM' && (
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-card-md border border-violet-300/25 bg-black/25 p-3 text-sm font-black text-violet-50">
            <label className="flex items-center gap-2">
              글자 수
              <select className={fieldCls} disabled={!editable} value={form.letterCount} onChange={(event) => update({ letterCount: Number(event.target.value) })}>
                {Array.from({ length: 9 }, (_, i) => 8 + i).map((n) => <option key={n} value={n}>{n}글자</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              제한 시간
              <input type="number" min={10} max={60} step={1} className={cn(fieldCls, 'w-20')} disabled={!editable} value={form.timeLimitSeconds}
                onChange={(event) => update({ timeLimitSeconds: Number(event.target.value) })} />초
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-violet-400" disabled={!editable} checked={form.useGh} onChange={(event) => update({ useGh: event.target.checked })} />
              G·H 키도 사용(키 9개)
            </label>
            {form.letterCount >= 16 && <span className="text-xs text-amber-100">극한: 16글자는 40초 정도를 권장해요.</span>}
          </div>
        )}

        {/* 각인 인원 */}
        <div className="mt-4">
          <div className="text-sm font-black text-violet-100">
            각인 인원 <span className="ml-1 rounded-full border border-violet-200/50 bg-violet-500/20 px-2 py-0.5 text-white">{form.playerCount}명</span>
            <span className="ml-2 text-xs font-bold text-violet-200">지원자가 모자라면 지원한 학생만 칩니다 · 지원자가 0명이면 바로 실패</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((count) => (
              <button
                key={count}
                type="button"
                disabled={!editable}
                onClick={() => update({ playerCount: count, corruptionCount: Math.min(form.corruptionCount, count) })}
                aria-pressed={form.playerCount === count}
                className={cn(
                  'h-9 min-w-9 rounded-card-md border px-2 text-sm font-black transition',
                  form.playerCount === count ? 'border-violet-300 bg-violet-500/30 text-white' : 'border-white/15 bg-black/30 text-violet-100 hover:bg-white/5',
                  !editable && 'cursor-not-allowed opacity-70',
                )}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        {/* 자동 발동 지점 */}
        <div className="mt-4">
          <div className="text-sm font-black text-violet-100">
            자동 발동 지점 (보스 HP %, 최대 3개)
            <span className="ml-2 text-xs font-bold text-violet-200">HP가 이 값 아래로 내려가면 한 번씩 발동 · 비워 두면 선생님 버튼으로만 발동</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {form.autoTriggers.map((value, index) => (
              <span key={index} className="flex items-center gap-1 rounded-card-md border border-white/15 bg-black/30 px-2 py-1">
                <span className="text-xs font-black text-violet-200">HP</span>
                <input type="number" min={1} max={99} className={cn(fieldCls, 'h-8 w-16')} disabled={!editable} value={value}
                  onChange={(event) => update({ autoTriggers: form.autoTriggers.map((item, i) => (i === index ? event.target.value : item)) })} />
                <span className="text-xs font-black text-violet-200">%</span>
                {editable && (
                  <button type="button" className="ml-1 text-xs font-black text-red-200" onClick={() => update({ autoTriggers: form.autoTriggers.filter((_, i) => i !== index) })}>삭제</button>
                )}
              </span>
            ))}
            {editable && form.autoTriggers.length < 3 && (
              <button type="button" className="rounded-card-md border border-violet-300/40 bg-violet-500/15 px-3 py-1.5 text-xs font-black text-violet-50"
                onClick={() => update({ autoTriggers: [...form.autoTriggers, ''] })}>
                + 지점 추가
              </button>
            )}
            {form.autoTriggers.length === 0 && <span className="text-xs font-bold text-violet-200">자동 발동 없음</span>}
          </div>
          {nearClash.length > 0 && (
            <div className="mt-2 rounded-card-md border border-amber-300/50 bg-amber-950/55 px-3 py-2 text-xs font-black text-amber-100">
              ⚠ 격돌(HP 50%)과 가까운 지점이 있습니다({nearClash.map((v) => `${v}%`).join(', ')}). 겹치면 격돌이 끝난 뒤에 주문 각인이 시작돼요. 조금 떨어뜨리는 것을 권장합니다.
            </div>
          )}
          {!data.configured && <div className="mt-1 text-[11px] font-bold text-violet-200">처음이라 권장 지점(70%, 30%)을 미리 넣어 두었어요. 저장해야 적용됩니다.</div>}
        </div>

        {/* 성공 · 실패 */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-card-md border border-yellow-300/40 bg-yellow-500/10 p-3">
            <div className="text-sm font-black text-yellow-50">성공 보상 (각인자 전원 완성)</div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-black text-yellow-50">
              <label className="flex items-center gap-1.5">보스 피해 <input type="number" min={0} max={15} step={0.5} className={cn(fieldCls, 'w-20')} disabled={!editable}
                value={form.bossDamagePercent} onChange={(event) => update({ bossDamagePercent: event.target.value })} />% <span className="text-[11px] text-yellow-100/80">(최대 체력 기준, 0~15)</span></label>
              <label className="flex items-center gap-1.5">공명방벽 회복 <input type="number" min={0} max={50} step={1} className={cn(fieldCls, 'w-20')} disabled={!editable}
                value={form.barrierHealPercent} onChange={(event) => update({ barrierHealPercent: event.target.value })} />% <span className="text-[11px] text-yellow-100/80">(0~50)</span></label>
            </div>
            <div className="mt-1 text-[11px] font-bold text-yellow-100/80">보스 피해는 각인자들의 누적 대미지에 똑같이 나눠 들어갑니다. 격돌 50% 선을 넘지 않게 자동으로 줄여요.</div>
          </div>
          <div className="rounded-card-md border border-violet-300/40 bg-violet-500/10 p-3">
            <div className="text-sm font-black text-violet-50">실패 시 「{form.corruptionLabel || '타락'}」</div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-black text-violet-50">
              <label className="flex items-center gap-1.5">인원
                <select className={fieldCls} disabled={!editable} value={form.corruptionCount} onChange={(event) => update({ corruptionCount: Number(event.target.value) })}>
                  {Array.from({ length: form.playerCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}명</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5">시간
                <input type="number" min={5} max={30} step={1} className={cn(fieldCls, 'w-16')} disabled={!editable} value={form.corruptionSeconds}
                  onChange={(event) => update({ corruptionSeconds: Number(event.target.value) })} />초
              </label>
              <label className="flex items-center gap-1.5">표시 이름
                <input type="text" maxLength={6} className={cn(fieldCls, 'w-24')} disabled={!editable} value={form.corruptionLabel}
                  onChange={(event) => update({ corruptionLabel: event.target.value })} />
              </label>
            </div>
            <div className="mt-1 text-[11px] font-bold text-violet-100/80">걸린 학생의 공격은 그 시간 동안 대미지만큼 보스 HP를 회복시킵니다. 회복량은 선생님 화면에서만 보여요.</div>
          </div>
        </div>

        {/* 선발 방식 */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-black text-violet-100">
          각인자 선발
          {([
            ['RANDOM', '🎲 무작위 추첨'],
            ['TEACHER', '🧑‍🏫 선생님이 선택'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" disabled={!editable} onClick={() => update({ selectionMode: value })} aria-pressed={form.selectionMode === value}
              className={cn('rounded-card-md border px-3 py-1.5 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60',
                form.selectionMode === value ? 'border-violet-200 bg-violet-500/30 text-white' : 'border-white/15 bg-black/25 text-violet-100')}>
              {label}
            </button>
          ))}
          <span className="text-xs font-bold text-violet-200">학생·중계 화면에는 어떤 방식인지 나타나지 않습니다.</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!editable || !dirty || saving}
            className="rounded-card-md border border-violet-300/50 bg-violet-500/25 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '저장 중…' : '주문 각인 설정 저장'}
          </button>
          {message && <span className={cn('text-sm font-black', message.tone === 'ok' ? 'text-emerald-200' : 'text-red-200')}>{message.text}</span>}
        </div>
      </div>

      <RaidInscriptionLivePanel raidId={raidId} raidStatus={raidStatus} />

      <RaidInscriptionHistory raidId={raidId} />

      <RaidInscriptionRehearsal settings={rehearsalSettings} />

      <PracticeBox />
    </div>
  );
}

/** 이 레이드의 지난 주문 각인 기록 */
function RaidInscriptionHistory({ raidId }: { raidId: number }) {
  const query = useQuery({
    queryKey: ['teacher-raid-inscription-history', raidId],
    queryFn: async () => {
      const result = await raidInscriptionAdminRpc.history(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data.sessions;
    },
    retry: false,
  });
  const sessions = query.data ?? [];
  if (sessions.length === 0) return null;
  return (
    <div className="rounded-card-lg border border-white/12 bg-black/25 p-4">
      <div className="text-base font-black text-white">📜 이 레이드의 주문 각인 기록</div>
      <div className="mt-2 space-y-2">
        {sessions.map((session) => {
          const heal = session.corruptions.reduce((sum, item) => sum + Number(item.healed_amount ?? 0), 0);
          return (
            <div key={session.id} className="rounded-card-md border border-white/10 bg-black/25 px-3 py-2 text-xs font-bold text-violet-50">
              <div className="text-sm font-black text-white">
                {session.seq_no}번째 · {session.trigger_source === 'AUTO' ? `자동(HP ${session.trigger_percent ?? '?'}%)` : '선생님 발동'} ·{' '}
                {session.phase === 'CANCELLED' ? '취소' : session.outcome === 'SUCCESS' ? <span className="text-yellow-100">성공</span> : session.outcome === 'FAILED' ? <span className="text-violet-200">실패</span> : session.phase}
                <span className="ml-2 text-xs font-bold text-violet-200">{session.letter_count}글자 · {formatSeconds(session.time_limit_ms, 0)}초</span>
              </div>
              {session.players.length > 0 && (
                <div className="mt-1">
                  각인자: {session.players.map((p) => `${p.student_name}${p.completed ? `(${formatSeconds(p.completed_ms ?? 0)}초)` : '(미완성)'}${p.mistakes ? `·오타${p.mistakes}` : ''}`).join(', ')}
                </div>
              )}
              {session.outcome === 'SUCCESS' && (
                <div className="mt-0.5">보스 피해 {Number(session.boss_damage ?? 0).toLocaleString('ko-KR')} · 공명방벽 +{Number(session.barrier_heal ?? 0).toLocaleString('ko-KR')}</div>
              )}
              {session.corruptions.length > 0 && (
                <div className="mt-0.5">😈 타락: {session.corruptions.map((c) => `${c.student_name} +${Number(c.healed_amount ?? 0).toLocaleString('ko-KR')}`).join(', ')} · 보스 회복 합계 {heal.toLocaleString('ko-KR')}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 학생 연습장과 같은 연습 화면(선생님 PC에서 바로 해 보기 · 학생 시범용) */
function PracticeBox() {
  return (
    <div className="rounded-card-lg border border-violet-300/30 bg-[#0d0b1c] p-4">
      <div className="text-base font-black text-violet-100">🎯 연습 모드 (실전 영향 없음)</div>
      <div className="mt-1 mb-4 text-sm font-bold text-white">
        학생 「주문 각인 연습장」(레이드 관문 → 연습장)과 같은 화면입니다. 난이도별로 직접 쳐 보면서 시간이 적당한지 감을 잡아 보세요.
      </div>
      <InscriptionPractice presets={INSCRIPTION_PRESETS} />
    </div>
  );
}
