import { useCallback, useEffect, useRef, useState } from 'react';
import { arcadeStudentRpc, type ArcadeRunBootstrap, type ArcadeRunSubmissionResult } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';
import { applyStarlinkEvent, advanceStarlinkRun, createStarlinkRun, starlinkActiveGameMs, type StarlinkInputEvent, type StarlinkRuntimeState } from './games/starlink_04/starlinkRuntime';
import { parseStarlinkRules, type StarlinkGameplayRules } from './games/starlink_04/starlinkRules';
import { enterStarlinkCell } from './games/starlink_04/starlinkPath';

type Phase = 'COUNTDOWN' | 'STARTING' | 'PLAYING' | 'SUBMITTING' | 'RESULT' | 'ERROR';
const STAR_SYMBOLS = ['✦','✧','✶','✷','✳','✴'] as const;
const STAR_COLORS = [
  'text-cyan-200 border-cyan-400/45 bg-cyan-500/15',
  'text-fuchsia-200 border-fuchsia-400/45 bg-fuchsia-500/15',
  'text-amber-200 border-amber-400/45 bg-amber-500/15',
  'text-sky-200 border-sky-400/45 bg-sky-500/15',
  'text-lime-200 border-lime-400/45 bg-lime-500/15',
  'text-rose-200 border-rose-400/45 bg-rose-500/15',
] as const;

export interface StarlinkPlaySummary {
  durationMs: number;
  previewScore: number;
  maxCombo: number;
  totalRemovedStars: number;
  loopCount: number;
  reshuffleCount: number;
}

interface Props {
  bootstrap: ArcadeRunBootstrap;
  myRank: number | null;
  myBestScore: number | null;
  isRankingUpdating: boolean;
  onRecorded: (result: ArcadeRunSubmissionResult, summary: StarlinkPlaySummary) => void;
  onExit: () => void;
  onInlineError: (error: string) => void;
}

interface PendingPayload {
  events: StarlinkInputEvent[];
  endWallMs: number;
  summary: StarlinkPlaySummary;
}

export function StarlinkGame({bootstrap,myRank,myBestScore,isRankingUpdating,onRecorded,onExit,onInlineError}: Props) {
  const [phase,setPhase]=useState<Phase>('COUNTDOWN');
  const [countdown,setCountdown]=useState(5);
  const [view,setView]=useState<StarlinkRuntimeState|null>(null);
  const [serverResult,setServerResult]=useState<ArcadeRunSubmissionResult|null>(null);
  const [error,setError]=useState('');
  const [hidden,setHidden]=useState(false);
  const runtimeRef=useRef<StarlinkRuntimeState|null>(null);
  const ruleRef=useRef<StarlinkGameplayRules|null>(null);
  const eventsRef=useRef<StarlinkInputEvent[]>([]);
  const payloadRef=useRef<PendingPayload|null>(null);
  const nonceRef=useRef<string>(bootstrap.run_nonce);
  const startPerfRef=useRef<number|null>(null);
  const pointerRef=useRef<number|null>(null);
  const lastCellRef=useRef<number|null>(null);
  const submittedRef=useRef(false);

  const buildSummary=useCallback((state:StarlinkRuntimeState):StarlinkPlaySummary=>({
    durationMs:60000,previewScore:state.score,maxCombo:state.stats.maxCombo,
    totalRemovedStars:state.stats.totalRemovedStars,loopCount:state.stats.loopCount,
    reshuffleCount:state.stats.reshuffleCount,
  }),[]);

  const submit=useCallback(async (state:StarlinkRuntimeState)=>{
    if(submittedRef.current || state.finalEndWallMs===null) return;
    submittedRef.current=true;
    pointerRef.current=null;
    const payload=payloadRef.current ?? {
      events:[...eventsRef.current],
      endWallMs:state.finalEndWallMs,
      summary:buildSummary(state),
    };
    payloadRef.current=payload;
    setPhase('SUBMITTING');
    try {
      const response=await arcadeStudentRpc.submitStarlinkRun(supabase,{
        p_run_id:bootstrap.run_id,
        p_run_nonce:nonceRef.current,
        p_input_events:payload.events,
        p_client_game_over_elapsed_ms:payload.endWallMs,
      });
      if(!response.success) throw new Error(response.error);
      setServerResult(response.data);
      onRecorded(response.data,payload.summary);
      setPhase('RESULT');
    } catch (e) {
      const message=e instanceof Error?e.message:'서버 기록 제출에 실패했습니다.';
      setError(message);
      onInlineError('스타링크 기록 제출 상태를 확인하지 못했습니다. 같은 기록으로 다시 제출해주세요.');
      setPhase('ERROR');
    } finally {submittedRef.current=false;}
  },[bootstrap.run_id,buildSummary,onInlineError,onRecorded]);

  const begin=useCallback(async()=>{
    setPhase('STARTING');
    const rpc=await arcadeStudentRpc.beginRun(supabase,{p_run_id:bootstrap.run_id});
    if(!rpc.success){setError(rpc.error);setPhase('ERROR');return;}
    try {
      if(rpc.data.run_nonce!==bootstrap.run_nonce) throw new Error('실행 식별값이 일치하지 않습니다.');
      const rules=parseStarlinkRules(rpc.data.config);
      ruleRef.current=rules;
      nonceRef.current=rpc.data.run_nonce;
      const state=createStarlinkRun(rpc.data.schedule_seed,rules);
      runtimeRef.current=state;
      startPerfRef.current=performance.now();
      setView(state);
      setPhase('PLAYING');
    }catch(e){setError(e instanceof Error?e.message:'게임을 초기화하지 못했습니다.');setPhase('ERROR');}
  },[bootstrap.run_id,bootstrap.run_nonce]);

  useEffect(()=>{
    if(phase!=='COUNTDOWN') return;
    const remaining=Math.max(0,new Date(bootstrap.countdown_ends_at).getTime()-Date.now());
    const ms=Math.max(5200,remaining+200);
    const started=performance.now();
    let frame=0;
    const tick=(now:number)=>{setCountdown(Math.max(0,Math.ceil((ms-(now-started))/1000)));if(now-started<ms)frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    const timer=window.setTimeout(()=>void begin(),ms);
    return()=>{window.clearTimeout(timer);cancelAnimationFrame(frame);};
  },[bootstrap.countdown_ends_at,begin,phase]);

  useEffect(()=>{
    if(phase!=='PLAYING') return;
    let frame=0;let lastRender=0;
    const tick=(now:number)=>{
      const state=runtimeRef.current;
      const rules=ruleRef.current;
      const started=startPerfRef.current;
      if(!state||!rules||started===null)return;
      try {
        const updated=advanceStarlinkRun(state,Math.max(state.wallMs,Math.floor(now-started)),rules);
        runtimeRef.current=updated;
        if(now-lastRender>33 || updated.phase==='GAME_OVER'){setView(updated);lastRender=now;}
        if(updated.phase==='GAME_OVER'){void submit(updated);return;}
        frame=requestAnimationFrame(tick);
      }catch(e){setError(e instanceof Error?e.message:'게임 시간 오류');setPhase('ERROR');}
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[phase,submit]);

  useEffect(()=>{
    const handler=()=>setHidden(document.hidden);
    document.addEventListener('visibilitychange',handler);
    return()=>document.removeEventListener('visibilitychange',handler);
  },[]);

  const nowMs=useCallback(()=>{
    if(startPerfRef.current===null)return 0;
    return Math.max(0,Math.floor(performance.now()-startPerfRef.current));
  },[]);

  const dispatch=useCallback((event:StarlinkInputEvent)=>{
    const current=runtimeRef.current, rules=ruleRef.current;
    if(phase!=='PLAYING'||!current||!rules||eventsRef.current.length>=5000)return;
    try {
      const updated=applyStarlinkEvent(current,event,rules);
      runtimeRef.current=updated;
      eventsRef.current.push(event);
      setView(updated);
    }catch(e){
      const message=e instanceof Error?e.message:'게임 입력 오류';
      setError(message);
      setPhase('ERROR');
    }
  },[phase]);

  const toCell=useCallback((element:HTMLDivElement,x:number,y:number):number|null=>{
    const rect=element.getBoundingClientRect();
    if(x<rect.left||x>=rect.right||y<rect.top||y>=rect.bottom)return null;
    return Math.max(0,Math.min(48,Math.floor((y-rect.top)/rect.height*7)*7+Math.floor((x-rect.left)/rect.width*7)));
  },[]);

  const startPointer=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(phase!=='PLAYING'||pointerRef.current!==null||runtimeRef.current?.phase!=='PLAYING')return;
    const cell=toCell(event.currentTarget,event.clientX,event.clientY);
    if(cell===null)return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current=event.pointerId;
    lastCellRef.current=cell;
    dispatch({type:'PATH_START',elapsed_ms:nowMs(),cell});
  };

  const movePointer=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(pointerRef.current!==event.pointerId||phase!=='PLAYING')return;
    const original=runtimeRef.current;
    if(!original||original.phase!=='PLAYING')return;
    const entries=event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for(const point of entries){
      const cell=toCell(event.currentTarget,point.clientX,point.clientY);
      if(cell===null||lastCellRef.current===cell)continue;
      const state=runtimeRef.current;
      if(!state||state.phase!=='PLAYING')break;
      // Log only transitions the server must reproduce; ignored visual hovers
      // are irrelevant to path validity and can exhaust the 5000-event cap.
      const preview=enterStarlinkCell(state.board,state.path,cell,ruleRef.current!);
      if(preview.action!=='IGNORE')dispatch({type:'CELL_ENTER',elapsed_ms:nowMs(),cell});
      lastCellRef.current=cell;
      if(preview.action==='LOOP_CLOSE')break;
    }
  };

  const releasePointer=(event:React.PointerEvent<HTMLDivElement>,cancel=false)=>{
    if(pointerRef.current!==event.pointerId)return;
    event.preventDefault();
    pointerRef.current=null;
    lastCellRef.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(runtimeRef.current?.phase==='PLAYING')dispatch({type:cancel?'PATH_CANCEL':'PATH_RELEASE',elapsed_ms:nowMs()});
  };

  const exit=async()=>{
    if(phase==='PLAYING'||phase==='COUNTDOWN'||phase==='STARTING'){
      const prompt=bootstrap.run_context==='VERIFICATION'
        ? '공인도전을 종료하면 PLAYING 이후 사용한 인증 기회는 돌려받을 수 없습니다. 종료할까요?'
        : '진행 중인 게임을 종료하면 이번 기록은 저장되지 않습니다. 종료할까요?';
      if(!window.confirm(prompt))return;
      const response=await arcadeStudentRpc.abandonRun(supabase,{p_run_id:bootstrap.run_id});
      if(!response.success){setError(response.error);setPhase('ERROR');return;}
    }
    onExit();
  };

  if(phase==='COUNTDOWN'||phase==='STARTING'){
    return <section className="glass-card border-sky-400/30 p-8 text-center">
      <div className="text-xs font-black tracking-[.2em] text-sky-300">STARLINK #04</div>
      <div className="my-5 font-display text-7xl text-gold">{phase==='STARTING'?'GO':countdown}</div>
      <h2 className="font-display text-2xl text-white">천공의 성좌판</h2>
      <p className="mt-2 text-sm text-text-secondary">같은 별 3개 이상 연결 · 5개 이상 이어 고리를 만들면 같은 별을 모두 제거</p>
      <button className="btn-secondary mt-5" disabled={phase==='STARTING'} onClick={()=>void exit()}>준비 취소</button>
    </section>;
  }

  if(phase==='ERROR'){
    return <section className="glass-card border-danger/40 p-6 text-center">
      <div className="text-4xl">⚠️</div><h2 className="mt-3 font-display text-xl text-danger">스타링크 진행 확인 필요</h2>
      <p className="mt-3 text-sm text-text-secondary">{error}</p>
      {payloadRef.current && <button className="btn-primary mt-5" disabled={submittedRef.current} onClick={()=>void submit(runtimeRef.current!)}>동일한 기록 다시 제출</button>}
      <button className="btn-secondary ml-2 mt-5" onClick={()=>void exit()}>Arcade로 돌아가기</button>
    </section>;
  }

  if(phase==='RESULT'&&serverResult){
    return <section className="glass-card overflow-hidden border-sky-400/30">
      <div className="border-b border-line bg-slate-950 px-5 py-7 text-center">
        <div className="text-4xl">{serverResult.accepted?'🌌':'⚠️'}</div>
        <h2 className="mt-3 font-display text-2xl text-white">{serverResult.accepted?'성좌 관측 완료':'공식 기록 미인정'}</h2>
        <p className="mt-2 text-sm text-text-secondary">{serverResult.accepted?'서버가 60초 입력 기록을 다시 검증했습니다.':serverResult.message}</p>
        <div className="mt-4 font-display text-5xl text-gold">{Number(serverResult.official_score??0).toLocaleString('ko-KR')}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-5 text-center sm:grid-cols-4">
        {[
          ['제거한 별',serverResult.stats?.totalRemovedStars??0],
          ['완성한 고리',serverResult.stats?.loopCount??0],
          ['최대 콤보',serverResult.stats?.maxCombo??0],
          ['재배치',serverResult.stats?.reshuffleCount??0],
        ].map(([label,value])=><div key={String(label)} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs text-text-muted">{label}</div><div className="mt-1 text-xl font-black text-white">{value}</div></div>)}
      </div>
      <p className="px-5 text-center text-xs text-text-secondary">{bootstrap.is_prerelease_test?'사전 테스트 기록은 랭킹에 반영되지 않습니다.':bootstrap.run_context==='VERIFICATION'?'공인 인증 도전 결과입니다.':isRankingUpdating?'현재 순위 반영 중':`내 최고 점수 ${(myBestScore??0).toLocaleString('ko-KR')} · ${myRank?myRank+'위':'Top 10 밖'}`}</p>
      <div className="p-5"><button className="btn-primary w-full" onClick={onExit}>Arcade로 돌아가기</button></div>
    </section>;
  }

  const run=view??runtimeRef.current;
  const board=run?.board??[];
  const activeMs=run?starlinkActiveGameMs(run):0;
  const remaining=Math.max(0,60000-activeMs);
  const selected=new Set(run?.path.path??[]);
  const first=run?.path.path[0];
  const locked=run?.phase!=='PLAYING'||phase!=='PLAYING';
  const pointerLine=run?.path.path??[];
  return <section className="glass-card overflow-hidden border-sky-400/35">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-slate-950 px-5 py-3">
      <div><div className="text-[10px] font-black tracking-widest text-sky-300">STARLINK · 천공의 성좌판</div>
        <div className="font-display text-2xl text-white">{(remaining/1000).toFixed(1)}s</div></div>
      <div className="flex gap-6 text-center">
        <div><div className="text-[10px] text-text-muted">SCORE</div><div className="font-display text-xl text-gold">{(run?.score??0).toLocaleString('ko-KR')}</div></div>
        <div><div className="text-[10px] text-text-muted">COMBO</div><div className="font-display text-xl text-cyan-200">{run?.combo??0}</div></div>
        <div><div className="text-[10px] text-text-muted">LINK</div><div className="font-display text-xl text-white">{pointerLine.length}</div></div>
      </div>
    </div>
    {hidden&&<p className="bg-warning/15 p-2 text-center text-xs text-warning">화면을 벗어나도 플레이 시간이 흐릅니다.</p>}
    <div className="relative mx-auto max-w-[560px] select-none p-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-card-xl border border-sky-400/20 bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-950 shadow-[inset_0_0_80px_rgba(56,189,248,.09)]"
        style={{touchAction:'none'}}
        onPointerDown={startPointer} onPointerMove={movePointer}
        onPointerUp={(e)=>releasePointer(e)} onPointerCancel={(e)=>releasePointer(e,true)}
        onLostPointerCapture={(e)=>{if(pointerRef.current===e.pointerId)releasePointer(e,true);}}
        role="application" aria-label="7행 7열 별 연결판. 같은 별 세 개 이상 드래그해서 연결하세요.">
        <div className="absolute inset-0 grid grid-cols-7 grid-rows-7">
          {board.map((type,index)=><div key={index} data-cell={index}
            className={`relative m-[3px] flex items-center justify-center rounded-xl border text-[clamp(17px,4vw,34px)] transition-[background-color,box-shadow] duration-75 ${STAR_COLORS[type]} ${selected.has(index)?'scale-[.97] border-white bg-white/25 shadow-[0_0_19px_rgba(255,255,255,.55)]':''} ${first===index&&run?.path.loopClosed?'ring-2 ring-gold':''}`}>
            <span className="pointer-events-none drop-shadow-[0_0_12px_currentColor]">{STAR_SYMBOLS[type]}</span>
          </div>)}
        </div>
        {pointerLine.length>=2&&<svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 700 700" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={[...pointerLine,...(run?.path.loopClosed?[pointerLine[0]]:[])].map(i=>`${(i%7+0.5)*100},${(Math.floor(i/7)+0.5)*100}`).join(' ')}
            fill="none" stroke="#f8fafc" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>
        </svg>}
        {locked&&<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/40 backdrop-blur-[1px]">
          <span className="rounded-card-md border border-sky-400/50 bg-slate-950/90 px-5 py-3 font-display text-xl text-sky-200">{run?.phase==='RESHUFFLING'?'성좌 재정렬 중':'별빛 정착 중'}</span>
        </div>}
        {phase==='SUBMITTING'&&<div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/90"><span className="font-display text-xl text-gold">서버 공식 기록 검증 중...</span></div>}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-deep px-5 py-3">
      <p className="text-xs text-text-secondary">같은 별 3개 이상 연결 · 고리 5개 이상 · 손가락/마우스로 드래그</p>
      <button className="btn-secondary text-xs" disabled={phase==='SUBMITTING'} onClick={()=>void exit()}>도전 중단</button>
    </div>
  </section>;
}
