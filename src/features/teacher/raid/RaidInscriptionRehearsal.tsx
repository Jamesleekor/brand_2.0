// RAID_INSCRIPTION_V1_20261118 — 교사용 「주문 각인」 리허설(서버 호출 없음, 실제 레이드 영향 없음)
// 학생 전투 화면과 똑같은 오버레이를 이 화면 안에서 가상 학생들과 함께 처음부터 끝까지 돌려 본다.
// · 「각인 지원」을 누르면 선생님이 각인자 한 명으로 참여(키보드로 직접 입력), 누르지 않으면 관전 화면을 보게 된다.
// · 가상 학생은 글자마다 0.28~0.7초 · 가끔 오타를 내는 속도로 입력한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  RaidCorruptionPublicState,
  RaidInscriptionDifficulty,
  RaidInscriptionPlayer,
  RaidInscriptionPublicState,
} from '@/lib/rpc/raid_student_rpc';
import { cn } from '@/lib/utils/cn';
import RaidInscriptionOverlay, { type RaidInscriptionActions } from '@/features/raid/inscription/RaidInscriptionOverlay';
import CorruptionBadge from '@/features/raid/inscription/CorruptionBadge';
import { INSCRIPTION_DEFAULTS, formatSeconds, makeInscriptionPool } from '@/features/raid/inscription/inscriptionCore';

export interface InscriptionRehearsalSettings {
  difficulty: RaidInscriptionDifficulty;
  letterCount: number;
  useGh: boolean;
  timeLimitMs: number;
  playerCount: number;
  bossDamagePercent: number;
  barrierHealPercent: number;
  corruptionCount: number;
  corruptionSeconds: number;
  corruptionLabel: string;
}

const BOT_NAMES = ['가람', '나래', '다온', '라온', '마루', '바다', '새봄', '아라', '자람', '하늘', '한별', '초롱', '보람', '은솔'];
const VOLUNTEER_MS = 5000;
const DRAW_MS = 1500; // 실전은 무작위 4~8초 기다림. 리허설은 짧게.
const FAKE_BOSS_HP = 1_000_000;
const FAKE_BARRIER = 10_000;
const ME_ID = 1;

interface BotTrack {
  /** 입력 시작 뒤 경과 ms → (그때까지 친 글자 수, 오타 수) */
  events: Array<{ t: number; typed: number; mistakes: number }>;
  completedMs: number | null;
}

interface RehearsalRun {
  id: number;
  t0: number;
  pool: string[];
  settings: InscriptionRehearsalSettings;
  bots: Array<{ id: number; name: string; volunteerAt: number }>;
  teacherVolunteered: boolean;
  selected: number[] | null; // participant id 목록(선생님 = 1)
  tracks: Record<number, BotTrack>;
  me: { attempt: number; typed: number; mistakes: number; completedMs: number | null };
  resolved: null | { outcome: 'SUCCESS' | 'FAILED'; at: number; corrupted: number[] };
}

function simulateBot(letterCount: number, timeLimitMs: number): BotTrack {
  const msPerLetter = 280 + Math.random() * 420;
  const missProb = 0.03 + Math.random() * 0.06;
  const events: BotTrack['events'] = [];
  let t = 400 + Math.random() * 500; // 화면을 보고 손을 올리는 시간
  let typed = 0;
  let mistakes = 0;
  while (t < timeLimitMs + 2000) {
    t += msPerLetter * (0.7 + Math.random() * 0.6);
    if (Math.random() < missProb) {
      mistakes += 1;
      typed = 0;
      t += INSCRIPTION_DEFAULTS.missLockMs + 250;
      events.push({ t, typed, mistakes });
      continue;
    }
    typed += 1;
    events.push({ t, typed, mistakes });
    if (typed >= letterCount) return { events, completedMs: Math.round(t) };
  }
  return { events, completedMs: null };
}

function trackAt(track: BotTrack | undefined, elapsed: number) {
  if (!track) return { typed: 0, mistakes: 0 };
  let current = { typed: 0, mistakes: 0 };
  for (const event of track.events) {
    if (event.t > elapsed) break;
    current = { typed: event.typed, mistakes: event.mistakes };
  }
  return current;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function RaidInscriptionRehearsal({ settings }: { settings: InscriptionRehearsalSettings }) {
  const runRef = useRef<RehearsalRun | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (runId == null) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [runId]);

  const start = () => {
    const botCount = Math.max(4, settings.playerCount + 3);
    const t0 = Date.now();
    runRef.current = {
      id: t0,
      t0,
      pool: makeInscriptionPool(settings.letterCount, settings.useGh),
      settings: { ...settings },
      bots: Array.from({ length: botCount }, (_, index) => ({
        id: 100 + index,
        name: `${BOT_NAMES[index % BOT_NAMES.length]}${index >= BOT_NAMES.length ? index : ''}`,
        volunteerAt: 600 + Math.random() * 3800,
      })),
      teacherVolunteered: false,
      selected: null,
      tracks: {},
      me: { attempt: 0, typed: 0, mistakes: 0, completedMs: null },
      resolved: null,
    };
    setRunId(t0);
  };

  const stop = () => {
    runRef.current = null;
    setRunId(null);
  };

  // ── 가상 서버: 매 그림마다 시간에 맞춰 상태를 진행시킨다 ──
  const run = runRef.current;
  const now = Date.now();
  const marks = run
    ? (() => {
        const closes = run.t0 + VOLUNTEER_MS;
        const selectedAt = closes + DRAW_MS;
        const playStarts = selectedAt + INSCRIPTION_DEFAULTS.revealMs + INSCRIPTION_DEFAULTS.countdownMs;
        const deadline = playStarts + run.settings.timeLimitMs;
        return { closes, selectedAt, playStarts, deadline };
      })()
    : null;

  if (run && marks) {
    // 선발
    if (!run.selected && now >= marks.selectedAt) {
      const volunteers = run.bots.filter((bot) => bot.volunteerAt < VOLUNTEER_MS).map((bot) => bot.id);
      const others = shuffle(volunteers).slice(0, Math.max(0, run.settings.playerCount - (run.teacherVolunteered ? 1 : 0)));
      run.selected = run.teacherVolunteered ? [ME_ID, ...others] : others;
      for (const id of others) run.tracks[id] = simulateBot(run.settings.letterCount, run.settings.timeLimitMs);
    }
    // 판정
    if (run.selected && !run.resolved && now >= marks.playStarts) {
      const elapsed = now - marks.playStarts;
      const completions = run.selected.map((id) => (id === ME_ID ? run.me.completedMs : run.tracks[id]?.completedMs ?? null));
      const allDone = completions.length > 0 && completions.every((ms) => ms != null && ms <= elapsed);
      if (allDone) {
        run.resolved = { outcome: 'SUCCESS', at: marks.playStarts + Math.max(...completions.map((ms) => ms ?? 0)), corrupted: [] };
      } else if (now > marks.deadline + INSCRIPTION_DEFAULTS.latencySlackMs || run.selected.length === 0) {
        const pool = run.selected.length > 0 ? run.selected : run.bots.map((bot) => bot.id);
        run.resolved = { outcome: 'FAILED', at: now, corrupted: shuffle(pool).slice(0, run.settings.corruptionCount) };
      }
    }
  }

  const nameOf = useCallback((id: number) => {
    if (id === ME_ID) return '선생님';
    return runRef.current?.bots.find((bot) => bot.id === id)?.name ?? '모험가';
  }, []);

  const publicState: RaidInscriptionPublicState | null = useMemo(() => {
    if (!run || !marks) return null;
    const s = run.settings;
    const elapsed = now - marks.playStarts;
    const resumeAt = run.resolved ? run.resolved.at + 3000 : null;
    const phase: RaidInscriptionPublicState['phase'] = run.resolved
      ? 'RESOLVED'
      : now < marks.selectedAt
        ? 'VOLUNTEERING'
        : now < marks.playStarts
          ? 'SELECTED'
          : 'PLAYING';
    const players: RaidInscriptionPlayer[] = (run.selected ?? []).map((id, index) => {
      const mine = id === ME_ID;
      const progress = mine ? { typed: run.me.typed, mistakes: run.me.mistakes } : trackAt(run.tracks[id], elapsed);
      const completedMs = mine ? run.me.completedMs : run.tracks[id]?.completedMs ?? null;
      const completed = completedMs != null && completedMs <= Math.max(elapsed, mine ? Number.MAX_SAFE_INTEGER : 0);
      return {
        participant_id: id,
        slot: index + 1,
        student_name: nameOf(id),
        guild_name: mine ? '리허설' : '가상 학생',
        typed_count: completed ? s.letterCount : progress.typed,
        mistakes: progress.mistakes,
        completed,
        completed_ms: completed ? completedMs : null,
        corrupted: run.resolved?.corrupted.includes(id) ?? false,
      };
    });
    const meSelected = Boolean(run.selected?.includes(ME_ID));
    const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
    return {
      id: run.id,
      seq_no: 1,
      phase,
      server_now: new Date(now).toISOString(),
      frozen: true,
      resume_at: iso(resumeAt),
      volunteer_closes_at: iso(marks.closes),
      volunteer_accept_until: iso(marks.closes),
      volunteer_button_delay_ms: INSCRIPTION_DEFAULTS.volunteerButtonDelayMs,
      selected_at: iso(marks.selectedAt),
      play_starts_at: iso(marks.playStarts),
      play_deadline_at: iso(marks.deadline),
      reveal_ms: INSCRIPTION_DEFAULTS.revealMs,
      countdown_ms: INSCRIPTION_DEFAULTS.countdownMs,
      miss_lock_ms: INSCRIPTION_DEFAULTS.missLockMs,
      difficulty: s.difficulty,
      letter_count: s.letterCount,
      use_gh: s.useGh,
      time_limit_ms: s.timeLimitMs,
      planned_player_count: s.playerCount,
      corruption_label: s.corruptionLabel,
      corruption_seconds: s.corruptionSeconds,
      volunteer_count: run.bots.filter((bot) => bot.volunteerAt <= now - run.t0).length + (run.teacherVolunteered ? 1 : 0),
      first_sequence: phase === 'PLAYING' || phase === 'RESOLVED' ? run.pool[0] : null,
      players: phase === 'VOLUNTEERING' ? [] : players,
      me: run.teacherVolunteered
        ? {
            volunteered: true,
            selected: meSelected,
            slot: meSelected ? 1 : null,
            attempt_index: run.me.attempt,
            typed_count: run.me.typed,
            mistakes: run.me.mistakes,
            completed: run.me.completedMs != null,
            completed_ms: run.me.completedMs,
            corrupted: run.resolved?.corrupted.includes(ME_ID) ?? false,
            sequences: phase === 'PLAYING' && meSelected && run.me.completedMs == null ? run.pool : null,
          }
        : { volunteered: false, selected: false },
      outcome: run.resolved?.outcome ?? null,
      outcome_reason: run.resolved ? (run.resolved.outcome === 'SUCCESS' ? 'ALL_COMPLETED' : run.selected?.length ? 'TIME_UP' : 'NO_VOLUNTEERS') : null,
      boss_damage: run.resolved?.outcome === 'SUCCESS' ? Math.round((FAKE_BOSS_HP * s.bossDamagePercent) / 100) : null,
      barrier_heal: run.resolved?.outcome === 'SUCCESS' ? Math.round((FAKE_BARRIER * s.barrierHealPercent) / 100) : null,
      corrupted: (run.resolved?.corrupted ?? []).map((id) => ({ participant_id: id, student_name: nameOf(id), guild_name: null })),
    };
    // 매 0.1초 다시 계산(now가 바뀜)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, marks?.playStarts, now, nameOf]);

  const corruption: RaidCorruptionPublicState | null = useMemo(() => {
    if (!run?.resolved || run.resolved.outcome !== 'FAILED' || run.resolved.corrupted.length === 0) return null;
    const startsAt = run.resolved.at + 3000;
    const until = startsAt + run.settings.corruptionSeconds * 1000;
    if (now >= until) return null;
    const entry = (id: number) => ({
      participant_id: id,
      student_name: nameOf(id),
      guild_name: null,
      starts_at: new Date(startsAt).toISOString(),
      until: new Date(until).toISOString(),
      started: now >= startsAt,
      seconds_remaining: Math.max(0, (until - now) / 1000),
    });
    const mine = run.resolved.corrupted.includes(ME_ID);
    return {
      label: run.settings.corruptionLabel,
      count: run.resolved.corrupted.length,
      server_now: new Date(now).toISOString(),
      active: run.resolved.corrupted.map(entry),
      me: mine ? { active: now >= startsAt, starts_at: entry(ME_ID).starts_at, until: entry(ME_ID).until, seconds_remaining: entry(ME_ID).seconds_remaining } : null,
    };
  }, [run, now, nameOf]);

  const actions = useMemo<RaidInscriptionActions>(() => ({
    volunteer: async () => {
      const current = runRef.current;
      if (current && Date.now() < current.t0 + VOLUNTEER_MS) current.teacherVolunteered = true;
      return { success: true, data: { accepted: Boolean(current?.teacherVolunteered), reason: current?.teacherVolunteered ? null : 'CLOSED', inscription: null } };
    },
    report: async (attemptIndex, typedCount) => {
      const current = runRef.current;
      if (current) {
        if (attemptIndex > current.me.attempt) current.me.mistakes += attemptIndex - current.me.attempt;
        current.me.attempt = Math.max(current.me.attempt, attemptIndex);
        current.me.typed = typedCount;
      }
      return { success: true, data: { ok: true } };
    },
    submit: async (attemptIndex, typed, elapsedMs) => {
      const current = runRef.current;
      if (!current) return { success: true, data: { accepted: false, reason: 'NOT_PLAYING', inscription: null } };
      const deadline = current.t0 + VOLUNTEER_MS + DRAW_MS + INSCRIPTION_DEFAULTS.revealMs + INSCRIPTION_DEFAULTS.countdownMs + current.settings.timeLimitMs;
      if (Date.now() > deadline + INSCRIPTION_DEFAULTS.latencySlackMs) return { success: true, data: { accepted: false, reason: 'TOO_LATE', inscription: null } };
      if (typed !== current.pool[attemptIndex % current.pool.length]) return { success: true, data: { accepted: false, reason: 'WRONG_SEQUENCE', inscription: null } };
      if (attemptIndex > current.me.attempt) current.me.mistakes += attemptIndex - current.me.attempt;
      current.me.attempt = attemptIndex;
      current.me.typed = typed.length;
      current.me.completedMs = Math.round(elapsedMs);
      return { success: true, data: { accepted: true, inscription: null } };
    },
  }), []);

  const finished = Boolean(run?.resolved) && publicState?.resume_at != null && now >= Date.parse(publicState.resume_at) && !corruption;

  return (
    <div className="rounded-card-lg border border-violet-300/30 bg-violet-950/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-black text-violet-100">🎬 리허설 (실전 영향 없음 · 서버 호출 없음)</div>
          <p className="mt-1 text-sm font-bold leading-6 text-white">
            학생 화면과 똑같은 각인 화면을 가상 학생들과 처음부터 끝까지 돌려 봅니다.
            「각인 지원」을 누르면 선생님이 각인자로 참여해 키보드로 직접 쳐 보고, 누르지 않으면 관전 화면을 보게 됩니다.
          </p>
          <p className="mt-1 text-xs font-bold text-violet-200">
            지금 고른 설정: {settings.letterCount}글자 · {formatSeconds(settings.timeLimitMs, 0)}초 · 각인자 {settings.playerCount}명 · {settings.corruptionLabel} {settings.corruptionCount}명 {settings.corruptionSeconds}초 (저장하지 않아도 바로 반영)
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={start} className="rounded-card-md border border-violet-200/60 bg-violet-500/30 px-4 py-2 text-sm font-black text-white">
            {run ? '처음부터 다시' : '리허설 시작'}
          </button>
          {run && (
            <button type="button" onClick={stop} className="rounded-card-md border border-white/20 bg-black/30 px-4 py-2 text-sm font-black text-violet-100">
              그만하기
            </button>
          )}
        </div>
      </div>

      <div
        className="relative mt-4 min-h-[600px] w-full overflow-hidden rounded-card-md border border-violet-300/25"
        style={{ background: 'radial-gradient(circle at 50% 40%, #3b1d5e, #04070d 72%)' }}
      >
        <div className="pointer-events-none absolute left-1/2 top-[14%] h-[60%] w-[30%] -translate-x-1/2 rounded-[40px] bg-gradient-to-b from-[#5b2a86] to-[#1a0b2e] opacity-70" />
        {!run && (
          <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-violet-100">「리허설 시작」을 누르면 바로 지원자 모집 화면이 나옵니다</div>
        )}
        {run && (
          <>
            <CorruptionBadge corruption={corruption} myParticipantId={ME_ID} serverNow={now} />
            <RaidInscriptionOverlay
              raidId={0}
              inscription={publicState}
              serverOffsetMs={0}
              attackBlocked={false}
              myParticipantId={ME_ID}
              onInscriptionUpdate={() => undefined}
              onRefresh={() => undefined}
              actions={actions}
            />
            {finished && (
              <div className="absolute inset-x-0 bottom-6 flex justify-center">
                <div className={cn('rounded-card-md border-2 px-5 py-2 text-center text-lg font-black',
                  run.resolved?.outcome === 'SUCCESS' ? 'border-yellow-200 bg-yellow-900/80 text-yellow-50' : 'border-violet-200 bg-violet-950/85 text-violet-50')}>
                  리허설 끝 · {run.resolved?.outcome === 'SUCCESS' ? '각인 성공' : '각인 실패'} — 「처음부터 다시」로 한 번 더 해 볼 수 있어요
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
