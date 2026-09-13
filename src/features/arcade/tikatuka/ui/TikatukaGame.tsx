import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Difficulty, GameEvent } from '../engine';
import { TikatukaGame as TikatukaGameCore } from './TikatukaGameCore';
import {
  getEventLogText,
  RAKARUKA_AI_RESULT_HOLD_MS,
  RAKARUKA_DICE_REVEAL_MS,
  RAKARUKA_TAZZA_REVEAL_MS,
  RAKARUKA_UI_EVENT,
  rowLabel,
} from './presentation';
import { getRakarukaOpponent, type RakarukaOpponentProfile } from './opponents';
import { characterC2Rpc, type StudentCharacterCollectionRow } from '@/lib/rpc/character_c2_rpc';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import './tikatuka-effects.css';
import './tikatuka-layout.css';

type KnockEvent = Extract<GameEvent, { type: 'DICE_KNOCKED' }>;
type AiRollRevealEvent = Extract<GameEvent, { type: 'DIE_ROLLED' | 'TAZZA_USED' }>;
type AiRollStage = 'rolling' | 'result';
interface AiRollPresentation { event: AiRollRevealEvent; stage: AiRollStage; }
interface HistoryEntry { id:number; text:string; actor:'player'|'ai'|'system'; }

function eventActor(event:GameEvent):HistoryEntry['actor'] {
  if ('side' in event) return event.side === 'player' ? 'player' : 'ai';
  if (event.type === 'DICE_KNOCKED') return event.attackingSide === 'player' ? 'player' : 'ai';
  return 'system';
}

function readDisplayedDifficulty(root: HTMLElement): Difficulty | null {
  const match=(root.textContent ?? '').match(/Lv\.(10|[1-9])\s*·/);
  return match ? Number(match[1]) as Difficulty : null;
}

export function TikatukaGame(props: ComponentProps<typeof TikatukaGameCore>) {
  const studentId=useStudentId();
  const shellRef=useRef<HTMLDivElement|null>(null);
  const [opponentDifficulty,setOpponentDifficulty]=useState<Difficulty|null>(null);
  const [history,setHistory]=useState<HistoryEntry[]>([]);
  const [impact,setImpact]=useState<KnockEvent|null>(null);
  const [aiRollPresentation,setAiRollPresentation]=useState<AiRollPresentation|null>(null);
  const sequenceRef=useRef(0);
  const impactTimerRef=useRef<number|null>(null);
  const aiRevealStartTimerRef=useRef<number|null>(null);
  const aiRevealEndTimerRef=useRef<number|null>(null);
  const gameEndedRef=useRef(false);
  const seenEventsRef=useRef(new WeakSet<object>());

  const opponentCharactersQuery=useQuery({
    queryKey:['arcade','rakaruka','opponent-characters',studentId],
    enabled:Boolean(studentId),
    staleTime:5*60*1000,
    queryFn:async()=>{
      const rpc=await characterC2Rpc.myCollection(supabase);
      if (rpc.success===false) throw new Error(rpc.error || '편린 정보를 불러오지 못했습니다.');
      return rpc.data;
    },
  });

  const opponent=opponentDifficulty ? getRakarukaOpponent(opponentDifficulty) : null;
  const opponentCharacter=opponent
    ? (opponentCharactersQuery.data ?? []).find(character=>character.character_uid===opponent.characterUid) ?? null
    : null;

  useEffect(()=>{
    const root=shellRef.current;
    if (!root) return undefined;
    const syncDifficulty=()=>{
      const next=readDisplayedDifficulty(root);
      if (next!==null) setOpponentDifficulty(current=>current===next ? current : next);
    };
    syncDifficulty();
    const observer=new MutationObserver(syncDifficulty);
    observer.observe(root,{subtree:true,childList:true,characterData:true});
    return ()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    const clearAiRevealTimers=()=>{
      if (aiRevealStartTimerRef.current!==null) window.clearTimeout(aiRevealStartTimerRef.current);
      if (aiRevealEndTimerRef.current!==null) window.clearTimeout(aiRevealEndTimerRef.current);
      aiRevealStartTimerRef.current=null;
      aiRevealEndTimerRef.current=null;
    };

    const handleEvent=(raw:Event)=>{
      const event=(raw as CustomEvent<GameEvent>).detail;
      if (!event || seenEventsRef.current.has(event)) return;
      seenEventsRef.current.add(event);
      if (event.type==='DIE_ROLLED' && gameEndedRef.current) {
        setHistory([]); sequenceRef.current=0; gameEndedRef.current=false;
        seenEventsRef.current=new WeakSet<object>(); seenEventsRef.current.add(event);
        clearAiRevealTimers();
        setAiRollPresentation(null);
      }
      const text=getEventLogText(event);
      if (text) {
        sequenceRef.current+=1;
        const entry:HistoryEntry={id:sequenceRef.current,text,actor:eventActor(event)};
        setHistory(current=>[...current.slice(-19),entry]);
      }
      if ((event.type==='DIE_ROLLED' || event.type==='TAZZA_USED') && event.side==='ai') {
        clearAiRevealTimers();
        setAiRollPresentation({event,stage:'rolling'});
        const revealDelay=event.type==='DIE_ROLLED' ? RAKARUKA_DICE_REVEAL_MS : RAKARUKA_TAZZA_REVEAL_MS;
        aiRevealStartTimerRef.current=window.setTimeout(()=>{
          aiRevealStartTimerRef.current=null;
          setAiRollPresentation({event,stage:'result'});
          aiRevealEndTimerRef.current=window.setTimeout(()=>{
            setAiRollPresentation(null);
            aiRevealEndTimerRef.current=null;
          },RAKARUKA_AI_RESULT_HOLD_MS);
        },revealDelay);
      }
      if (event.type==='DICE_KNOCKED') {
        setImpact(event);
        if (impactTimerRef.current!==null) window.clearTimeout(impactTimerRef.current);
        impactTimerRef.current=window.setTimeout(()=>{ setImpact(null); impactTimerRef.current=null; },2700);
      }
      if (event.type==='GAME_FINISHED') gameEndedRef.current=true;
    };
    window.addEventListener(RAKARUKA_UI_EVENT,handleEvent as EventListener);
    return ()=>{
      window.removeEventListener(RAKARUKA_UI_EVENT,handleEvent as EventListener);
      if (impactTimerRef.current!==null) window.clearTimeout(impactTimerRef.current);
      clearAiRevealTimers();
    };
  },[]);

  return <div ref={shellRef} className="rakaruka-game-shell relative space-y-3">
    {opponent && <OpponentEncounterCard opponent={opponent} character={opponentCharacter}/>} 
    {history.length > 0 && <RakarukaActionHistory entries={history} opponentName={opponent?.name ?? '상대'}/>} 
    <TikatukaGameCore {...props}/>
    <RakarukaRulesGuide/>
    {aiRollPresentation && <AiRollRevealOverlay event={aiRollPresentation.event} stage={aiRollPresentation.stage} opponentName={opponent?.name ?? '상대 AI'}/>} 
    {impact && <KnockImpactOverlay event={impact} opponentName={opponent?.name ?? '상대 AI'}/>} 
  </div>;
}

function OpponentEncounterCard({opponent,character}:{opponent:RakarukaOpponentProfile;character:StudentCharacterCollectionRow|null}) {
  const src=character?.avatar_image_url || character?.card_image_url || character?.full_image_url || character?.resource_url || null;
  return <section className="overflow-hidden rounded-card-lg border border-rose-300/25 bg-gradient-to-r from-[#120b12] via-[#0b1018] to-[#0a111b] shadow-card">
    <div className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rose-300/30 bg-black/25 sm:h-20 sm:w-20">
        {character?.resource_kind==='EMOJI' ? <span className="text-4xl">{character.emoji || '✦'}</span> : src ? <img src={src} alt={opponent.name} className="h-full w-full object-contain" loading="eager" decoding="async"/> : <span className="font-display text-2xl text-rose-200">{opponent.name.slice(0,1)}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-pill border border-rose-300/25 bg-rose-400/10 px-2 py-1 text-[10px] font-black text-rose-200">Lv.{opponent.difficulty} OPPONENT</span><span className="text-xs font-bold text-slate-400">{opponent.characterUid}</span></div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2"><h3 className="font-display text-xl text-white sm:text-2xl">{opponent.name}</h3><span className="text-xs font-black text-rose-200">[{opponent.epithet}]</span></div>
        <p className="mt-1.5 text-sm font-semibold leading-5 text-slate-200">“{opponent.quote}”</p>
      </div>
    </div>
  </section>;
}

function RakarukaActionHistory({entries,opponentName}:{entries:HistoryEntry[];opponentName:string}) {
  const visible=entries.slice(-6).reverse();
  const nameAi=(text:string)=>text.split('상대 AI').join(opponentName);
  return <section className="overflow-hidden rounded-card-lg border border-white/15 bg-[#0a0e15] shadow-card">
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5"><div><h3 className="text-sm font-black text-white">📜 최근 행동</h3><p className="text-[11px] font-semibold text-slate-400">{opponentName}의 선택과 방금 일어난 일을 여기서 바로 확인합니다.</p></div><span className="rounded-pill bg-white/5 px-2 py-1 text-[10px] font-black text-slate-400">최근 6개</span></div>
    <div className="max-h-44 overflow-y-auto p-2"><div className="space-y-1.5">{visible.map(entry=><div key={entry.id} className={`grid grid-cols-[34px_1fr] gap-2 rounded-card-md border px-2.5 py-2 ${entry.actor==='ai'?'border-rose-400/20 bg-rose-400/[0.05]':entry.actor==='player'?'border-emerald-400/20 bg-emerald-400/[0.05]':'border-white/10 bg-white/[0.025]'}`}><span className="text-[10px] font-black text-slate-500">#{entry.id}</span><span className={`text-xs font-bold leading-5 ${entry.actor==='ai'?'text-rose-100':entry.actor==='player'?'text-emerald-100':'text-slate-200'}`}>{nameAi(entry.text)}</span></div>)}</div></div>
  </section>;
}

function AiRollRevealOverlay({event,stage,opponentName}:{event:AiRollRevealEvent;stage:AiRollStage;opponentName:string}) {
  const die=event.type==='DIE_ROLLED' ? event.die : event.next;
  const reroll=event.type==='TAZZA_USED';
  return <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[1px]">
    <div className="w-full max-w-sm rounded-3xl border border-rose-300/45 bg-[#100b12]/95 p-6 text-center shadow-2xl backdrop-blur-xl">
      <div className="text-sm font-black tracking-[0.16em] text-rose-300">🎲 {opponentName}의 주사위</div>
      {stage==='rolling' ? <>
        <div className="mx-auto mt-5 flex h-28 w-28 animate-spin items-center justify-center rounded-3xl border-2 border-rose-300/55 bg-rose-400/10 text-6xl shadow-[0_0_32px_rgba(251,113,133,0.18)] [animation-duration:450ms]">🎲</div>
        <div className="mt-5 text-xl font-black text-white">{reroll?`${opponentName}, 타짜! 다시 굴리는 중...`:`${opponentName} · 주사위 굴리는 중`}</div>
        <div className="mt-2 text-sm font-bold text-slate-300">{reroll?'2.5초 후 재굴림 결과 공개':'2초 후 결과 공개'}</div>
      </> : <>
        <div className="mx-auto mt-5 flex h-28 w-28 items-center justify-center rounded-3xl border-2 border-rose-300/70 bg-rose-400/10 font-display text-6xl font-black text-white shadow-[0_0_32px_rgba(251,113,133,0.18)]">{die.value}</div>
        <div className="mt-5 text-xl font-black text-white">{opponentName} · 숫자 {die.value}</div>
        <div className="mt-2 text-sm font-bold text-slate-300">{reroll?'타짜 재굴림 결과':'굴림 결과'} · 1.5초 동안 결과를 확인합니다.</div>
      </>}
    </div>
  </div>;
}

function KnockImpactOverlay({event,opponentName}:{event:KnockEvent;opponentName:string}) {
  const value=event.attackingDie?.value ?? event.removedDice[0]?.value ?? '?';
  const attacker=event.attackingSide==='player'?'당신':opponentName;
  const target=event.targetSide==='player'?'당신':opponentName;
  return <div className="rakaruka-knock-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4"><div className="rakaruka-knock-card w-full max-w-xl rounded-3xl border border-rose-300/50 bg-[#12090d]/95 p-6 text-center shadow-2xl backdrop-blur-xl"><div className="text-sm font-black tracking-[0.18em] text-rose-300">💥 알까기</div><div className="mt-2 text-xl font-black text-white">공격: {attacker} → {target} {rowLabel(event.row)}</div><div className="mt-6 flex items-center justify-center gap-5 sm:gap-8"><div className="rakaruka-attack-die flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-cyan-300 bg-cyan-400/15 font-display text-4xl font-black text-white">{value}</div><div className="text-3xl font-black text-rose-300">➜</div><div className="flex gap-2">{event.removedDice.map(die=><div key={die.id} className="rakaruka-target-die flex h-16 w-16 items-center justify-center rounded-xl border-2 border-rose-300/70 bg-rose-400/15 font-display text-3xl font-black text-white">{die.value}</div>)}</div></div><div className="mt-5 text-base font-black text-yellow-200">같은 숫자 일반 주사위 {event.removedDice.length}개 제거 · 공격 주사위는 보드에 놓이지 않습니다</div></div></div>;
}

function RakarukaRulesGuide() {
  return <details open className="overflow-hidden rounded-card-xl border border-gold/30 bg-bg-deep/90">
    <summary className="cursor-pointer px-5 py-4 text-lg font-black text-yellow-200">📖 처음이라면 꼭 읽기 · 핵심 규칙</summary>
    <div className="border-t border-white/10 p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card-lg border border-danger/35 bg-danger/[0.08] p-4">
          <h3 className="text-lg font-black text-rose-200">💥 알까기</h3>
          <div className="mt-3 space-y-2">
            <RuleLine label="공격">내 일반 주사위와 <b>같은 숫자</b>가 상대 줄에 있으면 그 줄을 눌러 공격합니다. 공격 주사위는 배치되지 않고 소모됩니다.</RuleLine>
            <RuleLine label="한 번에 제거">그 줄의 같은 숫자 <b>일반 주사위가 2~3개면 전부 제거</b>합니다.</RuleLine>
            <RuleLine label="예: 숫자 4">내 4로 상대 줄의 일반 4, 4를 공격하면 <b>상대 4 두 개를 제거</b>합니다.</RuleLine>
            <RuleLine label="성공 보상">1개 이상 제거하면 다음 자기 턴에 <b>같은 숫자 실드 1개</b>를 얻습니다.</RuleLine>
          </div>
        </section>

        <section className="rounded-card-lg border border-gold/35 bg-gold/[0.07] p-4">
          <h3 className="text-lg font-black text-yellow-200">🛡️ 실드 주사위</h3>
          <div className="mt-3 space-y-2">
            <RuleLine label="획득">알까기에 성공하면 다음 자기 턴에 공격 숫자와 같은 실드를 얻습니다.</RuleLine>
            <RuleLine label="면역">실드는 숫자가 같아도 <b>알까기로 제거되지 않습니다.</b></RuleLine>
            <RuleLine label="배치">내 보드 또는 상대 보드의 <b>빈 줄 어디든</b> 놓을 수 있습니다.</RuleLine>
            <RuleLine label="점수">놓인 쪽의 점수와 더블·트리플 계산에 포함됩니다.</RuleLine>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <QuickRule icon="🃏" title="타짜">일반 주사위를 버리고 한 번 다시 굴립니다. 실드에는 사용할 수 없습니다.</QuickRule>
        <QuickRule icon="✋" title="홀드">현재 주사위를 보관하고 턴을 넘깁니다. 다음 자기 턴에 먼저 사용합니다.</QuickRule>
        <QuickRule icon="⚡" title="더블 · 트리플">같은 눈 2개는 합계 3배, 3개는 합계 5배입니다. 실드도 포함됩니다.</QuickRule>
      </div>
    </div>
  </details>;
}

function RuleLine({label,children}:{label:string;children:ReactNode}) {
  return <div className="grid grid-cols-[78px_1fr] gap-2 rounded-card-md border border-white/10 bg-black/15 px-3 py-2.5 text-sm font-semibold leading-5 text-slate-100"><b className="text-white">{label}</b><span>{children}</span></div>;
}

function QuickRule({icon,title,children}:{icon:string;title:string;children:ReactNode}) {
  return <div className="rounded-card-md border border-white/10 bg-black/20 px-3.5 py-3 text-sm font-semibold leading-5 text-slate-200"><b className="text-white">{icon} {title}</b><span className="ml-2">— {children}</span></div>;
}