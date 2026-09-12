import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { tikatukaRpcErrorMessage, tikatukaStudentRpc } from '@/lib/rpc/tikatuka_rpc';
import { useStudentId } from '@/stores/auth_store';
import type { TikatukaDifficulty } from '@/lib/zod_schemas/tikatuka_schemas';
import type { TikatukaCompetition } from '@/lib/zod_schemas/tikatuka_competition_schemas';

const DIFFICULTIES = [1,2,3,4,5,6,7,8,9,10] as const satisfies readonly TikatukaDifficulty[];

export function RakarukaCompetitionPanel({ periodId }: { periodId: number }) {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const competitionKey = useMemo(() => ['arcade','tikatuka','competition',studentId,periodId] as const,[studentId,periodId]);
  const progressKey = useMemo(() => ['arcade','tikatuka','progress',studentId] as const,[studentId]);
  const [selectedDifficulty,setSelectedDifficulty] = useState<TikatukaDifficulty>(1);
  const [starting,setStarting] = useState(false);
  const [actionError,setActionError] = useState<string|null>(null);

  const competitionQuery = useQuery({
    queryKey: competitionKey,
    enabled: Boolean(studentId && periodId),
    queryFn: async () => {
      const rpc = await tikatukaStudentRpc.getCompetition(supabase,{ p_period_id: periodId });
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
    setSelectedDifficulty(active?.difficulty ?? highestUnlocked);
    setActionError(null);
  },[periodId,active?.session_id,active?.difficulty,highestUnlocked]);

  const startChallenge = async () => {
    const current = competitionQuery.data;
    if (starting || active || !current?.official_can_start) return;
    setStarting(true); setActionError(null);
    const rpc = await tikatukaStudentRpc.startOfficialChallenge(supabase,{ p_period_id: periodId,p_difficulty:selectedDifficulty });
    setStarting(false);
    if (rpc.success === false) {
      setActionError(tikatukaRpcErrorMessage(rpc));
      void competitionQuery.refetch();
      return;
    }
    queryClient.setQueryData(competitionKey,rpc.data);
    void queryClient.invalidateQueries({ queryKey:['arcade','tikatuka','competition'] });
  };

  if (!studentId) return null;
  if (competitionQuery.isLoading && !competitionQuery.data) return <section className="glass-card p-5 text-sm font-bold text-text-secondary">라카루카 랭킹을 불러오는 중...</section>;
  if (competitionQuery.isError || !competitionQuery.data) return <section className="glass-card border-danger/35 p-5"><div className="font-black text-danger">라카루카 랭킹을 불러오지 못했습니다.</div><p className="mt-2 text-sm text-text-secondary">{competitionQuery.error instanceof Error ? competitionQuery.error.message : '알 수 없는 오류'}</p><button className="btn-secondary mt-3 text-sm" onClick={() => void competitionQuery.refetch()}>다시 시도</button></section>;

  const data = competitionQuery.data;
  return <section className="glass-card overflow-hidden border-gold/25 p-0">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
      <div><div className="text-xs font-black tracking-[0.16em] text-gold">RAKARUKA · {data.period_display_name}</div><h2 className="mt-1 font-display text-xl text-white">🏆 라카루카 랭킹 & 공인 기록</h2><p className="mt-1 text-xs font-semibold text-text-secondary">선택한 Arcade 랭킹 기간과 동일한 시작·종료 시각을 사용합니다.</p></div>
      <div className="flex items-center gap-2"><span className={`rounded-pill px-3 py-1 text-xs font-black ${data.official_window_open ? 'bg-success/15 text-success' : 'bg-white/5 text-text-muted'}`}>{data.official_window_open ? '공인 도전 OPEN' : '공인 도전 CLOSED'}</span><button className="btn-secondary text-xs" onClick={() => void competitionQuery.refetch()}>새로고침</button></div>
    </div>

    <div className="grid gap-4 p-5 xl:grid-cols-[.9fr_1.1fr]">
      <OfficialChallengeCard data={data} highestUnlocked={highestUnlocked} selectedDifficulty={selectedDifficulty} setSelectedDifficulty={setSelectedDifficulty} starting={starting} actionError={actionError} onStart={() => void startChallenge()} />
      <div className="rounded-card-lg border border-line bg-bg-deep/70 p-4"><div className="text-base font-black text-white">📐 공인 기록 판정</div><div className="mt-3 grid grid-cols-3 gap-2"><RuleStat label="승리" value="+3점"/><RuleStat label="무승부" value="+1점"/><RuleStat label="패배" value="0점"/></div><div className="mt-4 space-y-2 text-sm font-semibold leading-6 text-text-secondary"><p>• 학생당 이 기간에 <b className="text-gold">딱 1회 · 5판</b>만 도전합니다.</p><p>• 5판 총점이 <b className="text-gold">3점 이상</b>이어야 공인 기록으로 인정됩니다.</p><p>• 순위는 <b className="text-white">도전 난이도 → 결과점수</b> 순이며 동점은 공동 순위입니다.</p><p>• <b className="text-success">Lv.10 · 3점</b>은 <b>Lv.9 · 15점</b>보다 높은 순위입니다.</p></div></div>
    </div>

    <div className="grid border-t border-line lg:grid-cols-2">
      <RankingTable title="🎮 일반 플레이 랭킹" subtitle="이 기간의 실제 최고 클리어 Lv · 같은 Lv 공동 순위">{data.general_leaderboard.length ? data.general_leaderboard.map(row => <div key={row.student_id} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0"><RankBadge rank={row.rank}/><div><div className="font-black text-white">{row.brand_name || row.student_name}</div>{row.brand_name && <div className="text-xs text-text-muted">{row.student_name}</div>}</div><div className="font-display text-lg text-gold">{row.cleared_level ? `Lv.${row.cleared_level}` : '미클리어'}</div></div>) : <EmptyRanking/>}</RankingTable>
      <RankingTable title="🏅 공인 기록 랭킹" subtitle="1회 5판 · 도전 Lv 우선 · 동점 공동 순위">{data.official_leaderboard.length ? data.official_leaderboard.map(row => <div key={row.student_id} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0"><RankBadge rank={row.rank}/><div><div className="font-black text-white">{row.brand_name || row.student_name}</div><div className="text-xs text-text-muted">{row.wins}승 {row.draws}무 {row.losses}패</div></div><div className="text-right"><div className="font-display text-lg text-gold">Lv.{row.difficulty}</div><div className="text-sm font-black text-success">{row.points}점</div></div></div>) : <EmptyRanking text="아직 성립한 공인 기록이 없습니다."/>}</RankingTable>
    </div>
  </section>;
}

function OfficialChallengeCard({ data,highestUnlocked,selectedDifficulty,setSelectedDifficulty,starting,actionError,onStart }:{ data:TikatukaCompetition; highestUnlocked:TikatukaDifficulty; selectedDifficulty:TikatukaDifficulty; setSelectedDifficulty:(v:TikatukaDifficulty)=>void; starting:boolean; actionError:string|null; onStart:()=>void }) {
  const active=data.active_challenge;
  if (active) return <div className="rounded-card-lg border border-gold/40 bg-gold/10 p-5"><div className="flex justify-between gap-3"><div><div className="text-sm font-black text-gold">🔥 공인 기록 도전 진행 중</div><div className="mt-1 font-display text-3xl text-white">Lv.{active.difficulty}</div></div><span className="rounded-pill bg-black/25 px-3 py-1 text-sm font-black text-gold">{active.games_played}/5판</span></div><div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/35"><div className="h-full bg-gold" style={{width:`${active.games_played*20}%`}}/></div><div className="mt-4 grid grid-cols-4 gap-2"><MiniStat label="승" value={active.wins}/><MiniStat label="무" value={active.draws}/><MiniStat label="패" value={active.losses}/><MiniStat label="점수" value={active.points}/></div><p className="mt-4 text-sm font-semibold text-text-secondary">남은 <b className="text-white">{active.remaining_games}판</b>도 Lv.{active.difficulty}로 진행합니다.</p></div>;

  const completed=data.recent_challenges[0]??null;
  if (data.official_attempt_used) return <div className="rounded-card-lg border border-line bg-bg-deep/70 p-5"><div className="text-sm font-black text-text-secondary">✓ 이번 기간 공인 도전 사용 완료</div>{completed && <><div className="mt-2 font-display text-3xl text-white">Lv.{completed.difficulty} · {completed.points}점</div><div className="mt-2 text-sm font-bold text-text-secondary">{completed.wins}승 {completed.draws}무 {completed.losses}패</div><div className={`mt-3 rounded-card-md p-3 text-sm font-black ${completed.qualified?'bg-success/10 text-success':'bg-white/5 text-text-muted'}`}>{completed.qualified?'🏅 공인 기록 성립':'공인 기록 미인정 · 3점 미만'}</div></>}<p className="mt-4 text-xs font-bold text-text-muted">이 기간에는 다시 도전할 수 없습니다.</p></div>;

  if (!data.official_window_open || data.period_status!=='ACTIVE') return <div className="rounded-card-lg border border-line bg-bg-deep/70 p-5"><div className="text-sm font-black text-text-muted">🔒 공인 기록 도전 CLOSED</div><div className="mt-2 font-display text-2xl text-white">선생님이 공인데이를 열면 시작할 수 있습니다.</div><p className="mt-3 text-sm font-semibold text-text-secondary">일반 플레이와 일반 랭킹은 계속 이용할 수 있습니다.</p></div>;

  return <div className="rounded-card-lg border border-brand-primary/30 bg-brand-primary/5 p-5"><div className="text-sm font-black text-brand-primary">🎯 공인 기록 도전 · 1회 한정</div><p className="mt-2 text-sm font-semibold text-text-secondary">해금된 난이도 중 하나를 고르면 그 난이도로 5판이 고정됩니다. 시작한 순간 이번 기간의 기회를 사용합니다.</p><div className="mt-4 flex flex-wrap gap-2">{DIFFICULTIES.map(level => { const unlocked=level<=highestUnlocked; return <button key={level} type="button" disabled={!unlocked||starting} onClick={()=>setSelectedDifficulty(level)} className={`h-10 min-w-10 rounded-lg border px-2 text-sm font-black ${selectedDifficulty===level&&unlocked?'border-gold bg-gold/15 text-gold':unlocked?'border-line bg-bg-deep text-white':'cursor-not-allowed border-line/40 bg-bg-deep text-text-muted'}`}>{unlocked?level:'🔒'}</button>; })}</div><div className="mt-4 rounded-card-md border border-warning/35 bg-warning/10 p-3 text-xs font-black text-warning">주의: 0~2점으로 미인정되어도 재도전할 수 없습니다.</div>{actionError&&<div className="mt-3 rounded-card-md bg-danger/10 p-3 text-sm font-bold text-danger">{actionError}</div>}<button className="btn-primary mt-4 w-full" disabled={starting||!data.official_can_start} onClick={onStart}>{starting?'공인 도전 생성 중...':`Lv.${selectedDifficulty} · 5판 공인 도전 시작`}</button></div>;
}

function RankingTable({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}) { return <div className="min-w-0 p-5 lg:first:border-r lg:first:border-line"><h3 className="font-display text-lg text-white">{title}</h3><p className="mt-1 text-xs font-semibold text-text-secondary">{subtitle}</p><div className="mt-4 max-h-[430px] overflow-y-auto rounded-card-md border border-line bg-bg-deep/50">{children}</div></div>; }
function RuleStat({label,value}:{label:string;value:string}) { return <div className="rounded-card-md border border-line bg-black/20 p-3 text-center"><div className="text-xs font-black text-text-muted">{label}</div><div className="mt-1 font-display text-xl text-white">{value}</div></div>; }
function MiniStat({label,value}:{label:string;value:number}) { return <div className="rounded-card-md bg-black/20 p-2 text-center"><div className="text-[11px] font-black text-gold/70">{label}</div><div className="font-display text-xl text-white">{value}</div></div>; }
function RankBadge({rank}:{rank:number}) { return <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${rank===1?'bg-gold/20 text-gold':rank===2?'bg-white/10 text-slate-200':rank===3?'bg-amber-700/20 text-amber-300':'bg-white/5 text-text-muted'}`}>{rank}</div>; }
function EmptyRanking({text='아직 클리어 기록이 없습니다.'}:{text?:string}) { return <div className="p-8 text-center text-sm font-semibold text-text-muted">{text}</div>; }
