import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { tikatukaRpcErrorMessage, tikatukaStudentRpc } from '@/lib/rpc/tikatuka_rpc';
import { useStudentId } from '@/stores/auth_store';
import type { TikatukaDifficulty } from '@/lib/zod_schemas/tikatuka_schemas';
import type { TikatukaCompetition } from '@/lib/zod_schemas/tikatuka_competition_schemas';

const DIFFICULTIES = [1,2,3,4,5,6,7,8,9,10] as const satisfies readonly TikatukaDifficulty[];

export function RakarukaCompetitionPanel({ gameInProgress = false }: { gameInProgress?: boolean }) {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const competitionKey = useMemo(() => ['arcade', 'tikatuka', 'competition', studentId] as const, [studentId]);
  const progressKey = useMemo(() => ['arcade', 'tikatuka', 'progress', studentId] as const, [studentId]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<TikatukaDifficulty>(1);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const competitionQuery = useQuery({
    queryKey: competitionKey,
    enabled: Boolean(studentId),
    queryFn: async () => {
      const rpc = await tikatukaStudentRpc.getCompetition(supabase);
      if (rpc.success === false) throw new Error(tikatukaRpcErrorMessage(rpc));
      return rpc.data;
    },
    refetchInterval: 8_000,
  });

  const progressQuery = useQuery({
    queryKey: progressKey,
    enabled: Boolean(studentId),
    queryFn: async () => {
      const rpc = await tikatukaStudentRpc.getProgress(supabase);
      if (rpc.success === false) throw new Error(tikatukaRpcErrorMessage(rpc));
      return rpc.data;
    },
  });

  const active = competitionQuery.data?.active_challenge ?? null;
  const highestUnlocked = progressQuery.data?.highest_unlocked_difficulty ?? 1;

  useEffect(() => {
    if (active) {
      setSelectedDifficulty(active.difficulty);
      return;
    }
    setSelectedDifficulty(highestUnlocked);
  }, [active?.session_id, active?.difficulty, highestUnlocked]);

  const startChallenge = async () => {
    if (starting || active || gameInProgress) return;
    setStarting(true);
    setActionError(null);
    const rpc = await tikatukaStudentRpc.startOfficialChallenge(supabase, { p_difficulty: selectedDifficulty });
    setStarting(false);
    if (rpc.success === false) {
      setActionError(tikatukaRpcErrorMessage(rpc));
      return;
    }
    queryClient.setQueryData(competitionKey, rpc.data);
    void queryClient.invalidateQueries({ queryKey: ['arcade', 'tikatuka', 'competition'] });
  };

  if (!studentId) return null;

  if (competitionQuery.isLoading && !competitionQuery.data) {
    return <section className="rounded-card-xl border border-white/10 bg-bg-deep/80 p-5 text-sm font-bold text-slate-300">라카루카 랭킹을 불러오는 중...</section>;
  }

  if (competitionQuery.isError || !competitionQuery.data) {
    return <section className="rounded-card-xl border border-danger/35 bg-danger/5 p-5">
      <div className="font-black text-red-200">라카루카 랭킹을 불러오지 못했습니다.</div>
      <p className="mt-2 text-sm text-slate-300">{competitionQuery.error instanceof Error ? competitionQuery.error.message : '알 수 없는 오류'}</p>
      <button className="btn-secondary mt-3 text-sm" onClick={() => void competitionQuery.refetch()}>다시 시도</button>
    </section>;
  }

  const data = competitionQuery.data;

  return <section className="overflow-hidden rounded-card-xl border border-gold/25 bg-gradient-to-br from-[#0c1119] via-[#0b0f16] to-[#171108] shadow-card">
    <div className="border-b border-white/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black tracking-[0.18em] text-gold">RAKARUKA RANKING · {data.period_key}</div>
          <h3 className="mt-1 font-display text-2xl text-white">🏆 라카루카 랭킹 & 공인 기록</h3>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">일반 랭킹은 실제 최고 클리어 Lv만 비교하며 같은 Lv는 공동 순위입니다. 공인 랭킹은 선택한 난이도로 5판을 완료한 기록끼리 비교합니다.</p>
        </div>
        <button className="btn-secondary text-xs" onClick={() => void competitionQuery.refetch()}>새로고침</button>
      </div>
    </div>

    <div className="grid gap-4 p-5 xl:grid-cols-[.9fr_1.1fr]">
      <OfficialChallengeCard
        data={data}
        highestUnlocked={highestUnlocked}
        selectedDifficulty={selectedDifficulty}
        setSelectedDifficulty={setSelectedDifficulty}
        starting={starting}
        gameInProgress={gameInProgress}
        actionError={actionError}
        onStart={() => void startChallenge()}
      />

      <div className="rounded-card-lg border border-white/10 bg-black/20 p-4">
        <div className="text-base font-black text-white">📐 공인 기록 판정</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <RuleStat label="승리" value="+3점" />
          <RuleStat label="무승부" value="+1점" />
          <RuleStat label="패배" value="0점" />
        </div>
        <div className="mt-4 space-y-2 text-sm font-semibold leading-6 text-slate-300">
          <p>• <b className="text-white">5판을 모두 완료</b>해야 하나의 공인 기록이 됩니다.</p>
          <p>• 총 <b className="text-yellow-200">3점 이상</b>이어야 랭킹에 인정됩니다. 5패·1무 4패·2무 3패는 미인정입니다.</p>
          <p>• 순위는 <b className="text-white">도전 난이도 우선 → 같은 난이도에서는 결과점수</b> 순입니다.</p>
          <p>• 그래서 <b className="text-emerald-200">Lv.10 · 1승 4패(3점)</b>가 <b>Lv.9 · 5승(15점)</b>보다 위입니다.</p>
          <p>• 같은 달에 다시 도전할 수 있으며 <b className="text-white">가장 좋은 성립 기록만</b> 랭킹에 사용됩니다.</p>
        </div>
      </div>
    </div>

    <div className="grid border-t border-white/10 lg:grid-cols-2">
      <RankingTable title="🎮 일반 플레이 랭킹" subtitle="실제 최고 클리어 Lv · 같은 Lv 공동 순위">
        {data.general_leaderboard.length ? data.general_leaderboard.map((row) => <div key={row.student_id} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0">
          <RankBadge rank={row.rank} />
          <div><div className="font-black text-white">{row.brand_name || row.student_name}</div>{row.brand_name && <div className="text-xs font-semibold text-slate-500">{row.student_name}</div>}</div>
          <div className="font-display text-lg text-yellow-200">{row.cleared_level > 0 ? `Lv.${row.cleared_level}` : '미클리어'}</div>
        </div>) : <EmptyRanking />}
      </RankingTable>

      <RankingTable title="🏅 공인 기록 랭킹" subtitle="도전 Lv 우선 · 5판 결과점수 · 동점 공동 순위">
        {data.official_leaderboard.length ? data.official_leaderboard.map((row) => <div key={row.student_id} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0">
          <RankBadge rank={row.rank} />
          <div><div className="font-black text-white">{row.brand_name || row.student_name}</div><div className="mt-0.5 text-xs font-semibold text-slate-400">{row.wins}승 {row.draws}무 {row.losses}패</div></div>
          <div className="text-right"><div className="font-display text-lg text-yellow-200">Lv.{row.difficulty}</div><div className="text-sm font-black text-emerald-200">{row.points}점</div></div>
        </div>) : <EmptyRanking text="아직 성립한 공인 기록이 없습니다." />}
      </RankingTable>
    </div>

    {data.recent_challenges.length > 0 && <div className="border-t border-white/10 p-5">
      <div className="text-sm font-black text-slate-200">내 최근 공인 도전</div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {data.recent_challenges.map((item) => <div key={item.session_id} className={`min-w-[190px] rounded-card-md border p-3 ${item.qualified ? 'border-success/30 bg-success/5' : 'border-white/10 bg-black/20'}`}>
          <div className="flex items-center justify-between"><b className="text-white">Lv.{item.difficulty}</b><span className={`text-xs font-black ${item.qualified ? 'text-emerald-300' : 'text-slate-500'}`}>{item.qualified ? '공인 성립' : '미인정'}</span></div>
          <div className="mt-2 text-sm font-bold text-slate-300">{item.wins}승 {item.draws}무 {item.losses}패 · <b className="text-white">{item.points}점</b></div>
        </div>)}
      </div>
    </div>}
  </section>;
}

function OfficialChallengeCard({ data, highestUnlocked, selectedDifficulty, setSelectedDifficulty, starting, gameInProgress, actionError, onStart }: {
  data: TikatukaCompetition;
  highestUnlocked: TikatukaDifficulty;
  selectedDifficulty: TikatukaDifficulty;
  setSelectedDifficulty: (value: TikatukaDifficulty) => void;
  starting: boolean;
  gameInProgress: boolean;
  actionError: string | null;
  onStart: () => void;
}) {
  const active = data.active_challenge;
  if (active) {
    return <div className="rounded-card-lg border border-gold/40 bg-gold/10 p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-yellow-200">🔥 공인 기록 도전 진행 중</div><div className="mt-1 font-display text-3xl text-white">Lv.{active.difficulty}</div></div><div className="rounded-pill bg-black/25 px-3 py-1 text-sm font-black text-yellow-100">{active.games_played}/5판</div></div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/35"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${active.games_played * 20}%` }} /></div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center"><MiniStat label="승" value={active.wins} /><MiniStat label="무" value={active.draws} /><MiniStat label="패" value={active.losses} /><MiniStat label="점수" value={active.points} /></div>
      <p className="mt-4 text-sm font-semibold leading-6 text-yellow-50">남은 <b>{active.remaining_games}판</b>도 Lv.{active.difficulty}로 진행하세요. 공인 도전이 끝날 때까지 서버가 다른 난이도 게임 시작을 막습니다.</p>
      <p className="mt-2 text-xs font-bold text-yellow-200/80">3점 이상이어도 5판을 모두 끝내야 공인 기록이 확정됩니다.</p>
    </div>;
  }

  return <div className="rounded-card-lg border border-brand-primary/30 bg-brand-primary/5 p-5">
    <div className="text-sm font-black text-cyan-200">🎯 새 공인 기록 도전</div>
    <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">현재 해금된 난이도 이하에서 원하는 Lv를 고르세요. 공인 도전은 <b className="text-white">게임을 시작하기 전에</b> 생성해야 하며, 시작한 뒤 새로 발급되는 5판이 집계됩니다.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {DIFFICULTIES.map((level) => {
        const unlocked = level <= highestUnlocked;
        return <button key={level} type="button" disabled={!unlocked || starting || gameInProgress} onClick={() => setSelectedDifficulty(level)} className={`h-10 min-w-10 rounded-lg border px-2 text-sm font-black ${selectedDifficulty === level && unlocked ? 'border-gold bg-gold/15 text-yellow-200' : unlocked ? 'border-white/15 bg-black/20 text-white' : 'cursor-not-allowed border-white/5 bg-black/20 text-slate-700'}`}>{unlocked ? level : '🔒'}</button>;
      })}
    </div>
    <div className="mt-4 rounded-card-md border border-white/10 bg-black/20 p-3 text-sm font-semibold text-slate-300">선택: <b className="text-white">Lv.{selectedDifficulty}</b> · 최고 해금: Lv.{highestUnlocked}</div>
    {gameInProgress && <div className="mt-3 rounded-card-md border border-warning/40 bg-warning/10 p-3 text-sm font-bold text-warning">현재 판이 진행 중입니다. 이 판을 끝내고 새 게임을 시작하기 전에 공인 도전을 생성하세요.</div>}
    {actionError && <div className="mt-3 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm font-bold text-red-200">{actionError}</div>}
    <button className="btn-primary mt-4 w-full py-3" disabled={starting || gameInProgress} onClick={onStart}>{starting ? '공인 도전 생성 중...' : `Lv.${selectedDifficulty} · 5판 공인 도전 시작`}</button>
  </div>;
}

function RankingTable({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <div className="min-w-0 border-white/10 p-5 lg:first:border-r"><div className="flex items-end justify-between gap-3"><div><h4 className="font-display text-lg text-white">{title}</h4><p className="mt-1 text-xs font-semibold text-slate-400">{subtitle}</p></div></div><div className="mt-4 max-h-[430px] overflow-y-auto rounded-card-md border border-white/10 bg-black/20">{children}</div></div>;
}

function RuleStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-white/10 bg-black/25 p-3 text-center"><div className="text-xs font-black text-slate-400">{label}</div><div className="mt-1 font-display text-xl text-white">{value}</div></div>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-card-md bg-black/25 p-2"><div className="text-[11px] font-black text-yellow-200/70">{label}</div><div className="mt-1 font-display text-xl text-white">{value}</div></div>;
}

function RankBadge({ rank }: { rank: number }) {
  return <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${rank === 1 ? 'bg-gold/20 text-yellow-200' : rank === 2 ? 'bg-slate-300/15 text-slate-200' : rank === 3 ? 'bg-amber-700/20 text-amber-300' : 'bg-white/5 text-slate-400'}`}>{rank}</div>;
}

function EmptyRanking({ text = '아직 클리어 기록이 없습니다.' }: { text?: string }) {
  return <div className="p-8 text-center text-sm font-semibold text-slate-500">{text}</div>;
}
