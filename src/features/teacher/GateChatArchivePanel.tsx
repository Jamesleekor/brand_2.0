import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { gateChatArchiveRpc, type ArchiveCount, type ArchiveFilters, type ArchiveTurn } from '@/lib/rpc/gate_chat_archive_rpc';
import { buildGateArchiveXlsx } from '@/lib/utils/gate_chat_archive_xlsx';
import './gate-chat-archive.css';

const dateLabel = (s: string, full = false) => new Intl.DateTimeFormat('ko-KR', {
  timeZone:'Asia/Seoul', ...(full ? {year:'numeric' as const} : {}), month:'2-digit',day:'2-digit',
  ...(full ? {hour:'2-digit' as const,minute:'2-digit' as const,hour12:false} : {}),
}).format(new Date(s));
const errorText = (e: unknown) => e instanceof Error ? e.message : '대화 기록을 불러오지 못했습니다.';
function highlight(value: string, needle: string) {
  const q = needle.trim(); if (!q) return value;
  const source = value.toLocaleLowerCase(), find = q.toLocaleLowerCase();
  const parts: ReactNode[] = []; let at = 0, index = source.indexOf(find);
  while(index >= 0) { parts.push(value.slice(at,index),<mark key={index}>{value.slice(index,index+q.length)}</mark>); at=index+q.length; index=source.indexOf(find,at); }
  parts.push(value.slice(at)); return parts;
}
type StudentSummary = { id:number; name:string; turns:number; last:string; characters:ArchiveCount[] };

export function GateChatArchivePanel({ classroomId }: { classroomId:number }) {
  const [from,setFrom]=useState(''), [to,setTo]=useState('');
  const [draft,setDraft]=useState(''), [search,setSearch]=useState('');
  const [nameSearch,setNameSearch]=useState(''), [sort,setSort]=useState('recent');
  const [student,setStudent]=useState<number|null>(null), [character,setCharacter]=useState<number|null>(null);
  const [focus,setFocus]=useState<number|null>(null), [refresh,setRefresh]=useState(0);
  const [exportScope,setExportScope]=useState('student'), [exportBusy,setExportBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const shell=useRef<HTMLElement>(null), body=useRef<HTMLDivElement>(null);
  const pendingScroll=useRef<{height:number;top:number}|null>(null), alive=useRef(true);
  const queryClient=useQueryClient();
  useEffect(()=>{alive.current=true; return ()=>{alive.current=false;};},[]);
  const filters:ArchiveFilters={classroomId,from,to,search};
  const validDates=(!from||!to||from<=to);
  const index=useQuery({queryKey:['gate-chat-archive-index',classroomId,from,to,search,refresh],
    queryFn:()=>gateChatArchiveRpc.index(filters),enabled:classroomId>0&&validDates,staleTime:30_000,retry:1,gcTime:60_000});
  const summaries=useMemo(()=>{
    const map=new Map<number,StudentSummary>();
    for(const r of index.data?.rows??[]) {
      if(character!==null&&r.character_id!==character) continue;
      let s=map.get(r.student_id); if(!s){s={id:r.student_id,name:r.student_name,turns:0,last:r.last_at,characters:[]};map.set(r.student_id,s);}
      s.turns+=r.turn_count;s.characters.push(r);if(r.last_at>s.last)s.last=r.last_at;
    }
    return [...map.values()].filter(s=>s.name.includes(nameSearch.trim())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ko'):b.last.localeCompare(a.last)||a.id-b.id);
  },[index.data,character,nameSearch,sort]);
  const selected=summaries.find(s=>s.id===student)??summaries[0];
  const selectedId=selected?.id??null;
  useEffect(()=>{setFocus(null);},[selectedId]);
  const characters=useMemo(()=>{
    const map=new Map<number,string>();for(const r of index.data?.rows??[])map.set(r.character_id,r.character_name);return [...map.entries()];
  },[index.data]);
  const studentCharacters=(index.data?.rows??[]).filter(r=>r.student_id===selectedId);
  const pageFilters={...filters,search:focus===null?search:''};
  const detail=useInfiniteQuery({
    queryKey:['gate-chat-archive-pages',classroomId,selectedId,character,from,to,search,focus,refresh],
    initialPageParam:null as {before:number;snapshot:number}|null,
    queryFn:({pageParam})=>gateChatArchiveRpc.page(pageFilters,selectedId,character,pageParam?.before??null,pageParam?.snapshot??null,20,focus),
    getNextPageParam:last=>last.has_more&&last.next_before_id!==null?{before:last.next_before_id,snapshot:last.snapshot_id}:undefined,
    enabled:validDates&&selectedId!==null&&!index.isFetching,staleTime:30_000,retry:1,gcTime:60_000,
  });
  const turns=useMemo(()=>(detail.data?.pages??[]).flatMap(p=>p.items).sort((a,b)=>a.turn_id-b.turn_id),[detail.data]);
  const viewKey=[classroomId,selectedId,character,from,to,search,focus,refresh].join('|');
  const previousView=useRef('');
  useLayoutEffect(()=>{
    const el=body.current;if(!el)return;
    if(previousView.current!==viewKey){previousView.current=viewKey;pendingScroll.current=null;el.scrollTop=el.scrollHeight;}
    else if(pendingScroll.current&&!detail.isFetchingNextPage){const p=pendingScroll.current;el.scrollTop=p.top+el.scrollHeight-p.height;pendingScroll.current=null;}
    else if(turns.length&&detail.data?.pages.length===1&&!search&&focus===null)el.scrollTop=el.scrollHeight;
    if(focus!==null){const target=el.querySelector<HTMLElement>(`[data-turn="${focus}"]`);if(target)el.scrollTop+=target.getBoundingClientRect().top-el.getBoundingClientRect().top-el.clientHeight/2+Math.min(target.clientHeight,el.clientHeight)/2;}
  },[viewKey,turns,detail.isFetchingNextPage,detail.data?.pages.length,search,focus]);
  useLayoutEffect(()=>{
    const fit=()=>{if(shell.current)shell.current.style.height=`${Math.max(340,window.innerHeight-shell.current.getBoundingClientRect().top-20)}px`;};
    fit();window.addEventListener('resize',fit);return ()=>window.removeEventListener('resize',fit);
  },[]);
  useEffect(()=>()=>{queryClient.removeQueries({queryKey:['gate-chat-archive-pages',classroomId]});queryClient.removeQueries({queryKey:['gate-chat-archive-index',classroomId]});},[classroomId,queryClient]);
  function chooseStudent(id:number){setStudent(id);setFocus(null);setNotice('');}
  function changeCharacter(id:number|null){setCharacter(id);setFocus(null);}
  async function exportXlsx(){
    if(exportBusy||!summaries.length)return;
    setExportBusy(true);setNotice('');
    const allowed=new Set(exportScope==='student'?[selectedId]:summaries.map(s=>s.id));
    try{
      const all:ArchiveTurn[]=[];let before:number|null=null,snapshot:number|null=null;
      for(let pages=0;pages<200;pages++){
        const result=await gateChatArchiveRpc.page(filters,exportScope==='student'?selectedId:null,character,before,snapshot,500);
        if(!alive.current)return;
        all.push(...result.items.filter(t=>allowed.has(t.student_id)));
        if(all.length>20000)throw new Error('내보낼 문답이 20,000회를 넘습니다. 기간이나 학생을 좁혀 주세요.');
        if(!result.has_more){
          all.sort((a,b)=>a.turn_id-b.turn_id);
          const blob=buildGateArchiveXlsx(all,filters),url=URL.createObjectURL(blob),a=document.createElement('a');
          a.href=url;a.download=`BRAND_AI_대화_${exportScope==='student'?selected?.name:'전체'}_${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})}.xlsx`;
          document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30_000);
          setNotice(`${all.length.toLocaleString()}회 문답을 XLSX로 저장했습니다.`);return;
        }
        if(result.next_before_id===null||result.next_before_id===before)throw new Error('내보내기 페이지를 계속 읽을 수 없습니다.');
        before=result.next_before_id;snapshot=result.snapshot_id;
      }
      throw new Error('조회 범위가 큽니다. 기간을 좁혀 다시 저장해 주세요.');
    }catch(e){if(alive.current)setNotice(errorText(e));}finally{if(alive.current)setExportBusy(false);}
  }
  return <section ref={shell} className="gate-archive" aria-label="학생 AI 대화 기록">
    <header className="ga-heading"><strong>AI 대화 기록</strong><span>{summaries.length}명 · {summaries.reduce((n,s)=>n+s.turns,0).toLocaleString()}회 문답</span><span className="ga-note">테스트 계정 제외 · 한국 시간</span></header>
    <div className="ga-tools">
      <div className="ga-period"><input aria-label="시작일" type="date" value={from} onChange={e=>{setFrom(e.target.value);setFocus(null);}}/><span>~</span><input aria-label="종료일" type="date" value={to} onChange={e=>{setTo(e.target.value);setFocus(null);}}/></div>
      <select aria-label="편린 필터" value={character??''} onChange={e=>changeCharacter(e.target.value?Number(e.target.value):null)}><option value="">모든 편린</option>{characters.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
      <form className="ga-search" onSubmit={e=>{e.preventDefault();setSearch(draft.trim());setFocus(null);}}><input aria-label="대화 내용 검색" placeholder="대화 내용 검색" maxLength={200} value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit">검색</button>{search&&<button type="button" onClick={()=>{setDraft('');setSearch('');setFocus(null);}}>해제</button>}</form>
      <button type="button" aria-label="대화 기록 새로고침" onClick={()=>{setFocus(null);setRefresh(v=>v+1);}}>↻</button>
      <select aria-label="XLSX 저장 범위" value={exportScope} onChange={e=>setExportScope(e.target.value)}><option value="student">선택 학생</option><option value="all">현재 목록 전체</option></select>
      <button type="button" className="ga-export" disabled={exportBusy||!summaries.length||!validDates||index.isFetching} onClick={()=>void exportXlsx()}>{exportBusy?'저장 중…':'XLSX 저장'}</button>
    </div>
    {!validDates&&<div className="ga-error" role="alert">종료일은 시작일보다 빠를 수 없습니다.</div>}
    {index.isError&&<div className="ga-error" role="alert">{errorText(index.error)} <button type="button" onClick={()=>void index.refetch()}>다시 시도</button></div>}
    {notice&&<div className="ga-notice" role="status">{notice}</div>}
    <div className="ga-layout">
      <aside className="ga-sidebar" aria-label="대화한 학생 목록">
        <input aria-label="학생 이름 검색" placeholder="학생 이름 검색" value={nameSearch} onChange={e=>setNameSearch(e.target.value)}/>
        <select aria-label="학생 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">최근 대화순</option><option value="name">이름순</option></select>
        <div className="ga-students">{index.isPending?<p className="ga-empty">목록을 불러오는 중…</p>:summaries.map(s=><button type="button" key={s.id} aria-pressed={s.id===selectedId} onClick={()=>chooseStudent(s.id)}><strong>{s.name}</strong><span>{s.turns}회</span><time>{dateLabel(s.last)}</time></button>)}{!index.isPending&&!summaries.length&&<p className="ga-empty">조건에 맞는 대화가 없습니다.</p>}</div>
      </aside>
      <div className="ga-reader">
        <div className="ga-reader-head"><strong>{selected?.name??'학생 선택'}</strong><div className="ga-tabs"><button type="button" aria-pressed={character===null} onClick={()=>changeCharacter(null)}>전체</button>{studentCharacters.map(c=><button type="button" key={c.character_id} aria-pressed={character===c.character_id} onClick={()=>changeCharacter(c.character_id)}>{c.character_name} <span>{c.turn_count}</span></button>)}</div>{focus!==null&&<button type="button" onClick={()=>setFocus(null)}>검색 결과로</button>}</div>
        <div className="ga-conversation" ref={body} aria-busy={detail.isFetching}>
          {detail.hasNextPage&&<button className="ga-older" type="button" disabled={detail.isFetchingNextPage} onClick={()=>{if(body.current)pendingScroll.current={height:body.current.scrollHeight,top:body.current.scrollTop};void detail.fetchNextPage();}}>{detail.isFetchingNextPage?'불러오는 중…':'이전 대화 불러오기'}</button>}
          {(detail.isPending&&selectedId!==null||index.isFetching&&!turns.length)&&<p className="ga-empty">대화 기록을 불러오는 중…</p>}
          {detail.isError&&<div className="ga-error" role="alert">{errorText(detail.error)} <button type="button" onClick={()=>void detail.refetch()}>다시 시도</button></div>}
          {(!detail.isPending||selectedId===null&&!index.isPending)&&!turns.length&&!detail.isError&&<p className="ga-empty">표시할 대화가 없습니다.</p>}
          {turns.map((t,i)=><div key={t.turn_id}>
            {(!i||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(turns[i-1].created_at))!==new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(t.created_at)))&&<div className="ga-date">{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(t.created_at))}</div>}
            <article data-turn={t.turn_id} className={focus===t.turn_id?'ga-turn ga-focused':'ga-turn'}>
              <div className="ga-student-line"><div className="ga-message-label"><strong>{t.student_name}</strong><time>{dateLabel(t.created_at,true)}</time><span>→ {t.character_name}</span></div><p>{highlight(t.student_content,search)}</p></div>
              <div className="ga-ai-line"><div className="ga-message-label"><strong>{t.character_name}</strong><span className="ga-ai-badge">AI</span>{t.reply_at&&<time>{dateLabel(t.reply_at,true)}</time>}</div><p>{highlight(t.reply_content??(t.is_aborted?'대화가 중단되어 저장된 AI 응답이 없습니다.':'저장된 AI 응답이 없습니다.'),search)}</p></div>
              {search&&focus===null&&<button className="ga-context" type="button" onClick={()=>setFocus(t.turn_id)}>앞뒤 대화 보기</button>}
            </article>
          </div>)}
        </div>
        <footer className="ga-footer"><span>{focus!==null?'선택 문답 전후 최대 20회':`현재 ${turns.length}회 문답 표시`}</span><span>{index.isFetching||detail.isFetching?'조회 중…':'읽기 전용'} · KST</span></footer>
      </div>
    </div>
  </section>;
}
