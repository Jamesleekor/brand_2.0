import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { GameEvent } from '../engine';
import { TikatukaGame as TikatukaGameCore } from './TikatukaGameCore';
import { getEventLogText, RAKARUKA_UI_EVENT, rowLabel } from './presentation';
import './tikatuka-effects.css';

type KnockEvent = Extract<GameEvent, { type: 'DICE_KNOCKED' }>;
interface HistoryEntry { id:number; text:string; actor:'player'|'ai'|'system'; }

function eventActor(event:GameEvent):HistoryEntry['actor'] {
  if ('side' in event) return event.side === 'player' ? 'player' : 'ai';
  if (event.type === 'DICE_KNOCKED') return event.attackingSide === 'player' ? 'player' : 'ai';
  return 'system';
}

export function TikatukaGame(props: ComponentProps<typeof TikatukaGameCore>) {
  const [history,setHistory]=useState<HistoryEntry[]>([]);
  const [impact,setImpact]=useState<KnockEvent|null>(null);
  const sequenceRef=useRef(0);
  const impactTimerRef=useRef<number|null>(null);
  const gameEndedRef=useRef(false);
  const seenEventsRef=useRef(new WeakSet<object>());

  useEffect(()=>{
    const handleEvent=(raw:Event)=>{
      const event=(raw as CustomEvent<GameEvent>).detail;
      if (!event || seenEventsRef.current.has(event)) return;
      seenEventsRef.current.add(event);
      if (event.type==='DIE_ROLLED' && gameEndedRef.current) {
        setHistory([]); sequenceRef.current=0; gameEndedRef.current=false;
        seenEventsRef.current=new WeakSet<object>(); seenEventsRef.current.add(event);
      }
      const text=getEventLogText(event);
      if (text) {
        sequenceRef.current+=1;
        const entry:HistoryEntry={id:sequenceRef.current,text,actor:eventActor(event)};
        setHistory(current=>[...current.slice(-19),entry]);
      }
      if (event.type==='DICE_KNOCKED') {
        setImpact(event);
        if (impactTimerRef.current!==null) window.clearTimeout(impactTimerRef.current);
        impactTimerRef.current=window.setTimeout(()=>{ setImpact(null); impactTimerRef.current=null; },2700);
      }
      if (event.type==='GAME_FINISHED') gameEndedRef.current=true;
    };
    window.addEventListener(RAKARUKA_UI_EVENT,handleEvent as EventListener);
    return ()=>{ window.removeEventListener(RAKARUKA_UI_EVENT,handleEvent as EventListener); if (impactTimerRef.current!==null) window.clearTimeout(impactTimerRef.current); };
  },[]);

  return <div className="rakaruka-game-shell relative space-y-3">
    {history.length > 0 && <RakarukaActionHistory entries={history}/>} 
    <TikatukaGameCore {...props}/>
    <RakarukaRulesGuide/>
    {impact && <KnockImpactOverlay event={impact}/>} 
  </div>;
}

function RakarukaActionHistory({entries}:{entries:HistoryEntry[]}) {
  const visible=entries.slice(-6).reverse();
  return <section className="overflow-hidden rounded-card-lg border border-white/15 bg-[#0a0e15] shadow-card">
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5"><div><h3 className="text-sm font-black text-white">📜 최근 행동</h3><p className="text-[11px] font-semibold text-slate-400">AI가 방금 무엇을 했는지 여기서 바로 확인할 수 있습니다.</p></div><span className="rounded-pill bg-white/5 px-2 py-1 text-[10px] font-black text-slate-400">최근 6개</span></div>
    <div className="max-h-44 overflow-y-auto p-2"><div className="space-y-1.5">{visible.map(entry=><div key={entry.id} className={`grid grid-cols-[34px_1fr] gap-2 rounded-card-md border px-2.5 py-2 ${entry.actor==='ai'?'border-rose-400/20 bg-rose-400/[0.05]':entry.actor==='player'?'border-emerald-400/20 bg-emerald-400/[0.05]':'border-white/10 bg-white/[0.025]'}`}><span className="text-[10px] font-black text-slate-500">#{entry.id}</span><span className={`text-xs font-bold leading-5 ${entry.actor==='ai'?'text-rose-100':entry.actor==='player'?'text-emerald-100':'text-slate-200'}`}>{entry.text}</span></div>)}</div></div>
  </section>;
}

function KnockImpactOverlay({event}:{event:KnockEvent}) {
  const value=event.attackingDie?.value ?? event.removedDice[0]?.value ?? '?';
  return <div className="rakaruka-knock-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4"><div className="rakaruka-knock-card w-full max-w-xl rounded-3xl border border-rose-300/50 bg-[#12090d]/95 p-6 text-center shadow-2xl backdrop-blur-xl"><div className="text-sm font-black tracking-[0.18em] text-rose-300">💥 알까기</div><div className="mt-2 text-xl font-black text-white">{event.attackingSide==='player'?'당신':'상대 AI'}이(가) {event.targetSide==='player'?'당신':'상대'} {rowLabel(event.row)}을 공격!</div><div className="mt-6 flex items-center justify-center gap-5 sm:gap-8"><div className="rakaruka-attack-die flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-cyan-300 bg-cyan-400/15 font-display text-4xl font-black text-white">{value}</div><div className="text-3xl font-black text-rose-300">➜</div><div className="flex gap-2">{event.removedDice.map(die=><div key={die.id} className="rakaruka-target-die flex h-16 w-16 items-center justify-center rounded-xl border-2 border-rose-300/70 bg-rose-400/15 font-display text-3xl font-black text-white">{die.value}</div>)}</div></div><div className="mt-5 text-base font-black text-yellow-200">같은 숫자 일반 주사위 {event.removedDice.length}개 제거 · 공격 주사위는 보드에 놓이지 않습니다</div></div></div>;
}

function RakarukaRulesGuide() {
  return <details open className="overflow-hidden rounded-card-xl border border-gold/30 bg-bg-deep/90"><summary className="cursor-pointer px-5 py-4 text-lg font-black text-yellow-200">📖 처음이라면 꼭 읽기 · 알까기 / 실드 / 타짜 / 홀드</summary><div className="border-t border-white/10 p-5"><div className="mb-4 rounded-card-md border border-danger/35 bg-danger/10 p-4"><div className="text-base font-black text-rose-200">💥 알까기 핵심 한 줄</div><p className="mt-2 text-base font-semibold leading-7 text-slate-100">현재 <b className="text-white">일반 주사위와 같은 숫자</b>가 상대 줄에 있다면, 내 보드에 놓는 대신 <b className="text-white">그 상대 줄을 클릭해 공격</b>할 수 있습니다. 공격 주사위는 보드에 들어가지 않고 소모됩니다.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <Rule title="💥 알까기란?">일반 주사위는 <b>내 빈 줄에 정상 배치</b>하거나, 상대 줄의 같은 숫자 일반 주사위를 <b>알까기로 공격</b>합니다. 둘을 동시에 할 수는 없습니다.</Rule>
    <Rule title="🎯 예: 숫자 4">내가 일반 4를 들고 상대 중단에 일반 4가 2개 있다면 <b>알까기 가능</b> 표시가 뜹니다. 누르면 내 4는 배치되지 않고 상대 4 두 개를 제거합니다.</Rule>
    <Rule title="🔥 더블·트리플 깨기">실드 없이 같은 숫자가 2개·3개 연결되어 있다면 한 번의 알까기로 그 숫자의 일반 주사위를 전부 제거할 수 있습니다.</Rule>
    <Rule title="🛡️ 실드 면역">같은 숫자라도 <b>실드 주사위는 알까기에 제거되지 않습니다.</b></Rule>
    <Rule title="✨ 알까기 보상">1개든 3개든 실제로 제거하면 공격 숫자와 같은 <b>실드 1개</b>를 다음 자기 턴에 얻습니다.</Rule>
    <Rule title="↔️ 실드 배치">실드는 내 보드 또는 상대 보드의 빈 줄에 놓을 수 있고, 놓인 쪽 점수와 더블·트리플에 포함됩니다.</Rule>
    <Rule title="🃏 타짜">현재 일반 주사위를 버리고 새 일반 주사위를 한 번 다시 굴립니다. 실드에는 사용할 수 없습니다.</Rule>
    <Rule title="✋ 홀드">현재 주사위를 보관하고 턴을 넘깁니다. 다음 자기 턴에 보관한 주사위를 먼저 사용합니다.</Rule>
    <Rule title="⚡ 더블 · 트리플">같은 눈 2개는 그 눈의 합계 3배, 3개는 5배입니다. 실드도 같은 숫자라면 포함됩니다.</Rule>
    <Rule title="📜 행동 기록">게임 화면 위의 최근 행동에서 굴림, 배치, 타짜, 홀드, 알까기, 실드 획득을 다시 확인할 수 있습니다.</Rule>
    <Rule title="🏁 승리 판정">상단·중단·하단 중 더 많은 줄을 이기면 승리합니다. 줄 승수가 같으면 원래 눈 합계로 판정합니다.</Rule>
  </div></div></details>;
}
function Rule({title,children}:{title:string;children:ReactNode}) { return <div className="rounded-card-md border border-white/10 bg-black/20 p-4"><div className="text-base font-black text-white">{title}</div><p className="mt-2 text-sm font-semibold leading-6 text-slate-200">{children}</p></div>; }
