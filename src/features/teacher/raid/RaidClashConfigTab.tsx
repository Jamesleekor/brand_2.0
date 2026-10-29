// RAID_CLASH_V1_20261028 — 레이드 구성 패널의 「⚔ 격돌 설정」 탭
// ON/OFF, 난이도(EASY/NORMAL/HARD), HP 45~55% 패턴 경고, 결과 효과(읽기 전용), 연습 모드(서버 호출 없음).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import type { RaidClashDifficulty, RaidClashJudgment, RaidClashSession } from '@/lib/rpc/raid_student_rpc';
import { raidV15AdminRpc } from '@/lib/rpc/raid_v15_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import ClashStage from '@/features/raid/clash/ClashStage';
import {
  CLASH_DIFFICULTY_LABEL,
  CLASH_JUDGMENT_STYLE,
  CLASH_KEYS,
  clashIdealOffsetMs,
  clashNowMs,
  clashOutcome,
  clashOutcomeCopy,
  clashPoints,
  localClashProfile,
  type LocalClashNote,
} from '@/features/raid/clash/clashCore';
import { useClashPlayer } from '@/features/raid/clash/useClashPlayer';
import { playClashJudgmentSfx, unlockClashSfx } from '@/features/raid/clash/clashSfx';
import RaidClashRehearsal from './RaidClashRehearsal';

const DIFFICULTIES: RaidClashDifficulty[] = ['EASY', 'NORMAL', 'HARD'];

export default function RaidClashConfigTab({ raidId, raidStatus }: { raidId: number; raidStatus: RaidStatus }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['teacher-raid-clash-config', raidId],
    queryFn: async () => {
      const result = await raidV15AdminRpc.clashConfig(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
    // 전투 중에는 수동 발동·진행 상태를 보여 주기 위해 3초마다 새로 받는다.
    refetchInterval: raidStatus === 'ACTIVE' ? 3_000 : false,
  });
  const [enabled, setEnabled] = useState(false);
  const [difficulty, setDifficulty] = useState<RaidClashDifficulty>('EASY');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [practiceDifficulty, setPracticeDifficulty] = useState<RaidClashDifficulty>('EASY');

  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.enabled);
    setDifficulty(query.data.difficulty);
    setPracticeDifficulty(query.data.difficulty);
  }, [query.data]);

  if (query.isLoading) {
    return <div className="flex justify-center py-10"><LoadingSpinner /></div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="mt-5 space-y-5">
        <div className="rounded-card-md border border-red-300/40 bg-red-950/60 p-4 text-sm font-black text-red-100">
          격돌 설정을 불러오지 못했습니다. 서버에 격돌 기능이 아직 적용되지 않았을 수 있습니다.
          <div className="mt-1 font-mono text-xs text-red-100">{query.error instanceof Error ? query.error.message : ''}</div>
        </div>
        {/* 리허설·연습은 서버 없이 이 화면 안에서만 돌아가므로, 서버 적용 전에도 미리 해 볼 수 있게 둔다. */}
        <RaidClashRehearsal raidId={raidId} defaultDifficulty={practiceDifficulty} />
        <ClashPractice difficulty={practiceDifficulty} onDifficultyChange={setPracticeDifficulty} />
      </div>
    );
  }

  const data = query.data;
  const editable = data.editable && (raidStatus === 'DRAFT' || raidStatus === 'LOBBY_OPEN');
  const dirty = enabled !== data.enabled || difficulty !== data.difficulty;
  const profile = data.profiles?.[difficulty] ?? localClashProfile(difficulty);
  // RAID_CLASH_V2_20261029: 대표 인원과 팀 기준 점수(1인 기준 × 인원)
  const teamSize = Math.max(1, Number(profile.player_count ?? 1));
  const perSuccess = profile.success_score;
  const perGreat = profile.great_score;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const result = await raidV15AdminRpc.saveClashConfig(supabase, raidId, { enabled, difficulty });
    setSaving(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    queryClient.setQueryData(['teacher-raid-clash-config', raidId], result.data);
    setMessage({ tone: 'ok', text: enabled ? `격돌을 켰습니다 (${CLASH_DIFFICULTY_LABEL[difficulty]}).` : '격돌을 껐습니다.' });
  };

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-card-lg border border-sky-300/30 bg-sky-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-black text-sky-100">⚔ 격돌(CLASH)</div>
            <p className="mt-1 text-sm font-bold leading-6 text-white">
              보스 HP가 처음 50%가 되면 전투가 멈추고, 5초 동안 지원한 학생 중 {teamSize}명이 함께 Q·W·E·R 고리 8개에 도전합니다.
              {teamSize > 1 ? '대표들이 같은 고리를 동시에 치고, 점수를 합쳐 결과가 정해집니다. ' : ''}학생 기기는 PC·크롬북 키보드를 사용합니다.
            </p>
          </div>
          {!editable && (
            <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-100">🔒 전투 시작 후에는 바꿀 수 없습니다</span>
          )}
        </div>

        <label className={cn('mt-4 flex items-center gap-3 text-base font-black', editable ? 'text-white' : 'text-amber-100')}>
          <input type="checkbox" className="h-5 w-5 accent-sky-400" checked={enabled} disabled={!editable || !data.barrier_enabled}
            onChange={(event) => setEnabled(event.target.checked)} />
          이 레이드에서 격돌 사용
        </label>
        {!data.barrier_enabled && (
          <div className="mt-2 rounded-card-md border border-amber-300/40 bg-amber-950/50 px-3 py-2 text-sm font-black text-amber-100">
            공명방벽이 꺼진 레이드라 격돌을 켤 수 없습니다. (실패 페널티가 공명방벽 피해이기 때문)
          </div>
        )}

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {DIFFICULTIES.map((item) => {
            const p = data.profiles?.[item] ?? localClashProfile(item);
            return (
              <button
                key={item}
                type="button"
                disabled={!editable}
                onClick={() => setDifficulty(item)}
                className={cn(
                  'rounded-card-md border p-3 text-left transition',
                  difficulty === item ? 'border-sky-300 bg-sky-500/20' : 'border-white/15 bg-black/30 hover:bg-white/5',
                  !editable && 'cursor-not-allowed',
                )}
              >
                <div className="text-base font-black text-white">{CLASH_DIFFICULTY_LABEL[item]} <span className="text-xs text-sky-100">({item})</span></div>
                <div className="mt-1 font-mono text-xs font-bold text-sky-100">
                  수축 {p.approach_ms}ms · PERFECT ±{p.perfect_ms} · GOOD ±{p.good_ms} · BAD ±{p.bad_ms}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-xs font-bold text-amber-100">🧪 판정 폭은 플레이 테스트용 초기값입니다. 점수·성공 기준·효과는 난이도와 관계없이 같습니다.</div>

        {data.hp_ratio_warnings.length > 0 && (
          <div className="mt-3 rounded-card-md border border-amber-300/50 bg-amber-950/55 px-3 py-2 text-sm font-black text-amber-100">
            ⚠ 보스 HP 45~55%에 발동하는 패턴이 있습니다. 격돌과 겹치지 않게 조정하는 것을 권장합니다:
            {' '}{data.hp_ratio_warnings.map((item) => `#${item.seq} ${item.name}(${Math.round(Number(item.trigger_value) * 100)}%)`).join(', ')}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!editable || !dirty || saving}
            className="rounded-card-md border border-sky-300/50 bg-sky-500/25 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '저장 중…' : '격돌 설정 저장'}
          </button>
          {message && (
            <span className={cn('text-sm font-black', message.tone === 'ok' ? 'text-emerald-200' : 'text-red-200')}>{message.text}</span>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <EffectCard tone="gold" title={`대성공 (${perGreat * teamSize}~${16 * teamSize}점)`} lines={['10초 격돌 약점 노출', `10초 격돌 300% · 약점 명중 시 ${Math.round((3 + profile.weak_zone.multiplier) * 100)}%`, '16초 보스 일반 공격 봉쇄']} />
        <EffectCard tone="blue" title={`성공 (${perSuccess * teamSize}~${perGreat * teamSize - 1}점)`} lines={['10초 격돌 약점 노출', `10초 격돌 150% · 약점 명중 시 ${Math.round((1.5 + profile.weak_zone.multiplier) * 100)}%`, '10초 보스 일반 공격 봉쇄']} />
        <EffectCard tone="red" title={`실패 (0~${perSuccess * teamSize - 1}점·지원자 없음)`} lines={['효과 없음', '남은 공명방벽의 20% 피해', '(최대치가 아닌 그 순간 남은 양 기준)']} />
      </div>
      {teamSize > 1 && (
        <div className="text-xs font-bold text-sky-100">
          점수 기준은 {teamSize}명 기준입니다(1명당 성공 {perSuccess}점·대성공 {perGreat}점 × 인원). 지원자가 {teamSize}명보다 적으면 뽑힌 인원만큼 기준이 줄어듭니다
          {' '}(2명: 성공 {perSuccess * 2}·대성공 {perGreat * 2} / 1명: 성공 {perSuccess}·대성공 {perGreat}). 준비 시간 안에 연결되지 않은 대표는 8개 모두 MISS로 처리되고 나머지는 그대로 진행합니다.
        </div>
      )}
      <div className="text-xs font-bold text-sky-100">그로기와 겹치면 「약점 배율 × 그로기」와 「약점 배율 + 격돌」 중 큰 값 하나만 적용됩니다. 격돌 중에는 교사 일시정지가 막힙니다.</div>

      <ClashLiveTrigger raidId={raidId} raidStatus={raidStatus} enabled={data.enabled} session={data.clash?.session ?? null}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ['teacher-raid-clash-config', raidId] })} />

      <RaidClashRehearsal raidId={raidId} defaultDifficulty={data.difficulty} />

      <ClashPractice difficulty={practiceDifficulty} onDifficultyChange={setPracticeDifficulty} />
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  VOLUNTEERING: '지원자 모집 중',
  SELECTED: '대표 공개·준비 중',
  PLAYING: '대표들 도전 중',
  RESOLVED: '끝남',
  CANCELLED: '취소됨',
};

/** 실전 테스트용: 전투 중(ACTIVE)인 이 레이드에서 HP와 관계없이 지금 격돌을 발동한다. 레이드당 1회. */
function ClashLiveTrigger({
  raidId,
  raidStatus,
  enabled,
  session,
  onChanged,
}: {
  raidId: number;
  raidStatus: RaidStatus;
  enabled: boolean;
  session: RaidClashSession | null;
  onChanged: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const trigger = async () => {
    const ok = window.confirm(
      '지금 이 레이드에서 격돌을 발동할까요?\n\n'
      + '· 실제 상황입니다. 학생 화면과 중계 화면에 격돌이 뜨고 전투가 멈춥니다.\n'
      + '· 실패하면 남은 공명방벽의 20%가 실제로 깎이고, 성공하면 실제 버프가 걸립니다.\n'
      + '· 이 레이드에서 격돌은 한 번만 일어나므로, 발동 후에는 HP 50%에서 다시 일어나지 않습니다.\n\n'
      + '테스트용 레이드에서 사용하는 것을 권장합니다.',
    );
    if (!ok) return;
    setSending(true);
    setMessage(null);
    const result = await raidV15AdminRpc.triggerClash(supabase, raidId);
    setSending(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    setMessage(result.data.triggered
      ? { tone: 'ok', text: '격돌을 발동했습니다. 학생 화면과 중계 화면을 확인하세요.' }
      : { tone: 'error', text: '격돌이 발동되지 않았습니다. 잠시 후 다시 확인해 주세요.' });
    onChanged();
  };

  const active = raidStatus === 'ACTIVE';
  let hint: string | null = null;
  if (!active) hint = '전투가 진행 중(ACTIVE)일 때만 사용할 수 있습니다.';
  else if (!enabled) hint = '이 레이드는 격돌이 꺼져 있습니다. 격돌은 전투 시작 전에 켜야 합니다.';
  else if (session) hint = `이 레이드의 격돌은 이미 발동했습니다 · ${PHASE_LABEL[session.phase] ?? session.phase}${session.outcome ? ` · ${clashOutcomeCopy(session.outcome, Number(session.clash_component ?? 0), Number(session.weak_zone?.multiplier ?? 2)).title}` : ''}`;

  return (
    <div className="rounded-card-lg border border-orange-300/35 bg-orange-950/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-black text-orange-100">🧪 실전 테스트: 지금 격돌 발동</div>
          <p className="mt-1 text-sm font-bold leading-6 text-white">
            보스 HP 50%를 기다리지 않고 바로 격돌을 일으킵니다. 학생 계정(크롬북)으로 접속해 지원·QTE·결과까지 실제 서버로 확인할 때 쓰세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void trigger()}
          disabled={!active || !enabled || Boolean(session) || sending}
          className="rounded-card-md border border-orange-200/60 bg-orange-500/30 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? '발동 중…' : '⚔ 지금 격돌 발동'}
        </button>
      </div>
      {hint && <div className="mt-2 text-sm font-black text-orange-100">{hint}</div>}
      {message && (
        <div className={cn('mt-2 text-sm font-black', message.tone === 'ok' ? 'text-emerald-200' : 'text-red-200')}>{message.text}</div>
      )}
    </div>
  );
}

function EffectCard({ tone, title, lines }: { tone: 'gold' | 'blue' | 'red'; title: string; lines: string[] }) {
  const cls = tone === 'gold'
    ? 'border-yellow-300/50 bg-yellow-500/10 text-yellow-50'
    : tone === 'blue'
      ? 'border-sky-300/50 bg-sky-500/10 text-sky-50'
      : 'border-red-300/50 bg-red-500/10 text-red-50';
  return (
    <div className={cn('rounded-card-md border p-3', cls)}>
      <div className="text-sm font-black">{title}</div>
      <ul className="mt-1 space-y-0.5 text-xs font-bold">
        {lines.map((line) => <li key={line}>· {line}</li>)}
      </ul>
    </div>
  );
}

/** 교사용 연습 모드 — 실제 레이드·공명방벽·보상과 무관하게 화면에서만 돈다. */
function ClashPractice({ difficulty, onDifficultyChange }: { difficulty: RaidClashDifficulty; onDifficultyChange: (next: RaidClashDifficulty) => void }) {
  const profile = useMemo(() => localClashProfile(difficulty), [difficulty]);
  const [run, setRun] = useState<{ id: number; startMs: number; notes: LocalClashNote[] } | null>(null);
  const [results, setResults] = useState<Partial<Record<number, RaidClashJudgment>>>({});

  const { judgments, reset } = useClashPlayer({
    // 8개를 모두 판정하면 키 입력을 놓아 준다(다른 탭의 글자 입력을 막지 않도록).
    active: run !== null && Object.keys(results).length < 8,
    notes: run?.notes ?? [],
    profile,
    onJudged: ({ note, judgment }) => {
      playClashJudgmentSfx(judgment); // RAID_CLASH_SFX_20261029: 중계 화면과 같은 판정음(교사 PC에서 들림)
      setResults((current) => ({ ...current, [note.index]: judgment }));
    },
  });

  const start = () => {
    unlockClashSfx();
    reset();
    setResults({});
    const startMs = clashNowMs() + 300;
    const notes = Array.from({ length: 8 }, (_, index) => ({
      index,
      key: CLASH_KEYS[Math.floor(Math.random() * CLASH_KEYS.length)],
      idealMs: startMs + clashIdealOffsetMs(profile, index),
    }));
    setRun({ id: Date.now(), startMs, notes });
  };

  const judgedCount = Object.keys(results).length;
  const score = Object.values(results).reduce((sum, item) => sum + (item ? clashPoints(item) : 0), 0);
  const finished = run !== null && judgedCount >= 8;
  const outcome = finished ? clashOutcome(score, profile) : null;
  const copy = outcome ? clashOutcomeCopy(outcome, outcome === 'GREAT_SUCCESS' ? 3 : 1.5, profile.weak_zone.multiplier) : null;

  return (
    <div className="rounded-card-lg border border-violet-300/30 bg-violet-950/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-black text-violet-100">🎯 연습 모드 (실전 영향 없음)</div>
          <div className="mt-1 text-sm font-bold text-white">키보드 Q·W·E·R로 직접 해 보거나, 학생에게 미리 체험시켜 보세요. (혼자 하는 연습이라 1명 기준 16점 만점으로 판정합니다)</div>
        </div>
        <div className="flex items-center gap-2">
          {DIFFICULTIES.map((item) => (
            <button key={item} type="button" onClick={() => onDifficultyChange(item)}
              className={cn('rounded-full border px-3 py-1 text-xs font-black', difficulty === item ? 'border-violet-200 bg-violet-500/30 text-white' : 'border-white/20 text-violet-100')}>
              {CLASH_DIFFICULTY_LABEL[item]}
            </button>
          ))}
          <button type="button" onClick={start} className="rounded-card-md border border-violet-200/60 bg-violet-500/30 px-4 py-2 text-sm font-black text-white">
            {run ? '다시 시작' : '연습 시작'}
          </button>
        </div>
      </div>

      <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-card-md border border-sky-300/25 bg-[radial-gradient(circle_at_center,#0c2a44,#020617)]">
        {run ? (
          <ClashStage key={run.id} notes={run.notes} profile={profile} judgments={judgments} playStartsAtMs={run.startMs} />
        ) : (
          <div className="flex h-full items-center justify-center text-lg font-black text-sky-100">「연습 시작」을 누르면 3초 뒤 고리가 나타납니다</div>
        )}
        {run && (
          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5">
            {Array.from({ length: 8 }, (_, index) => {
              const item = results[index];
              return (
                <span key={index} className="flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black"
                  style={item ? { borderColor: CLASH_JUDGMENT_STYLE[item].color, background: CLASH_JUDGMENT_STYLE[item].glow, color: CLASH_JUDGMENT_STYLE[item].text } : { borderColor: 'rgba(186,230,253,0.5)', color: '#e0f2fe' }}>
                  {item ? item[0] : index + 1}
                </span>
              );
            })}
            <span className="ml-2 font-mono text-sm font-black text-yellow-100">{score}점</span>
          </div>
        )}
        {copy && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <div className={cn('rounded-card-md border-2 px-5 py-2 text-center font-black',
              copy.tone === 'gold' ? 'border-yellow-200 bg-yellow-900/80 text-yellow-50' : copy.tone === 'blue' ? 'border-sky-200 bg-sky-950/85 text-sky-50' : 'border-red-300 bg-red-950/85 text-red-50')}>
              <div className="text-2xl">{copy.title} · {score}/16점</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
