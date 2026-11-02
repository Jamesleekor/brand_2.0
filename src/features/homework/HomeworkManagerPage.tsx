import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, History, Plus, Search, ShieldCheck, X, ArrowLeft, CheckCheck } from 'lucide-react';
import { PageHeader, LoadingSpinner, EmptyState } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { homeworkRpc, type HomeworkTask, type HomeworkResult, type HomeworkKind } from '@/lib/rpc/homework_check_rpc';

const localDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const KINDS: Array<{ key: HomeworkKind; name: string; title: string; instruction: string }> = [
  { key: 'MATH', name: '수학익힘', title: '수학익힘', instruction: '진도 나간 쪽의 문제를 풀어옵니다.' },
  { key: 'KOREAN', name: '국어 읽기', title: '국어 지문 읽기', instruction: '지정한 교과서 지문을 읽어옵니다.' },
  { key: 'HANDWRITING', name: '글씨쓰기', title: '아침 글씨쓰기', instruction: '오늘의 글씨쓰기 활동을 완료합니다.' },
  { key: 'FORM', name: '설문', title: '설문 응답', instruction: '지정된 설문에 응답합니다.' },
  { key: 'OTHER', name: '기타', title: '', instruction: '' },
];
const LABELS: Record<HomeworkResult, string> = {
  UNKNOWN: '미확인', DONE: '완료', LATE: '지연완료', MISSING: '미제출', EXEMPT: '면제',
};
const PILL: Record<HomeworkResult, string> = {
  UNKNOWN: 'text-text-muted border-line bg-bg-deep',
  DONE: 'text-success border-success/25 bg-success/10',
  LATE: 'text-warning border-warning/30 bg-warning/10',
  MISSING: 'text-danger border-danger/30 bg-danger/10',
  EXEMPT: 'text-sky-200 border-sky-400/30 bg-sky-500/10',
};
type Tab = 'CHECK' | 'HISTORY' | 'MONTH' | 'GUILD';
type Filter = 'ALL' | HomeworkResult;
function labelDate(iso: string) { const [y,m,d] = iso.split('-'); return `${Number(m)}월 ${Number(d)}일`; }
function shiftDate(iso: string, delta: number) { const dt = new Date(`${iso}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() + delta); return dt.toISOString().slice(0,10); }
function errorText(e: unknown) { return e instanceof Error ? e.message : String(e); }

export default function HomeworkManagerPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('CHECK');
  const [day, setDay] = useState(localDay);
  const [month, setMonth] = useState(() => localDay().slice(0,7));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<HomeworkKind>('MATH');
  const [newNote, setNewNote] = useState('');
  const [newDay, setNewDay] = useState(localDay);
  const [newTime, setNewTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [guildBusy, setGuildBusy] = useState<number | null>(null);

  const accessQ = useQuery({ queryKey: ['homework-manager-access'], queryFn: () => homeworkRpc.access(supabase), staleTime: 30_000 });
  const allowed = accessQ.data?.can_operate === true;
  const isTeacher = accessQ.data?.is_teacher === true;
  const boardQ = useQuery({
    queryKey: ['homework-manager-board', month], queryFn: () => homeworkRpc.board(supabase, month),
    enabled: allowed, staleTime: 7_000, refetchOnWindowFocus: true,
  });
  const guildQ = useQuery({
    queryKey: ['homework-guild-trust', month], queryFn: () => homeworkRpc.guildBoard(supabase, month),
    enabled: allowed && isTeacher && tab === 'GUILD', staleTime: 15_000,
  });
  const tasks = useMemo(() => boardQ.data?.tasks ?? [], [boardQ.data?.tasks]);
  const dayTasks = useMemo(() => tasks.filter(t => t.due_on === day), [tasks,day]);
  const selected = dayTasks.find(t => t.id === selectedId) ?? dayTasks[0] ?? null;
  const historyItems = tasks.filter(t =>
    !historySearch.trim() || `${t.title} ${t.due_on}`.toLowerCase().includes(historySearch.trim().toLowerCase()),
  );
  const historySelected = historyItems.find(t => t.id === selectedId) ?? historyItems[0] ?? null;
  const marksFor = (id: number) => (boardQ.data?.results ?? []).filter(x => x.task_id === id);
  const selectedMarks = selected ? marksFor(selected.id) : [];
  const counts = { UNKNOWN: 0, DONE: 0, LATE: 0, MISSING: 0, EXEMPT: 0 };
  for (const r of selectedMarks) counts[r.result] += 1;
  const editable = Boolean(selected && (isTeacher || selected.status !== 'SUBMITTED'));

  useEffect(() => { setSelectedId(null); setFilter('ALL'); setSearch(''); }, [day]);
  const setPickedDay = (date: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return; setDay(date); setMonth(date.slice(0,7)); };
  const setPickedMonth = (value: string) => { if (!/^\d{4}-\d{2}$/.test(value)) return; setMonth(value); setDay(`${value}-01`); setSelectedId(null); };
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['homework-manager-board'] }); };
  const action = async (fn: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await fn(); await refresh(); if (message) setNotice({ kind:'ok', text:message }); }
    catch (e) { setNotice({ kind:'error', text:errorText(e) }); }
    finally { setBusy(false); }
  };
  const setResult = (task: HomeworkTask, studentId: number, next: HomeworkResult) => {
    if (busy) return;
    let reason: string | null = null;
    if (isTeacher && task.status === 'SUBMITTED') {
      reason = window.prompt('제출 완료된 과제를 정정하는 사유를 2글자 이상 입력하세요.');
      if (reason === null) return;
    }
    void action(() => homeworkRpc.mark(supabase, task.id, studentId, next, reason));
  };
  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || !newDay) return;
    await action(async () => {
      const id = await homeworkRpc.createTask(supabase, { dueOn:newDay,title,kind:newKind,instructions:newNote.trim(),checkAt:newTime });
      setPickedDay(newDay); setSelectedId(id); setModalOpen(false); setFilter('ALL'); setSearch('');
    }, '새 과제가 등록됐습니다. 모든 학생은 미확인으로 시작합니다.');
  };
  const openNew = () => { setNewDay(day); setNewTitle(''); setNewNote(''); setNewTime('09:00'); setNewKind('MATH'); setModalOpen(true); };

  if (accessQ.isLoading) return <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>;
  if (accessQ.isError) return <div className="p-6 text-danger">권한 조회에 실패했습니다. {errorText(accessQ.error)} <button className="btn-secondary" onClick={() => void accessQ.refetch()}>다시 시도</button></div>;
  if (!allowed) return <><PageHeader emoji="📜" title="운영국 과제 검수대" /><EmptyState emoji="🔒" title="제출관리관 전용 페이지" description="현재 1인1역 ‘제출 관리관’ 담당 학생과 교사만 사용할 수 있습니다." /></>;

  return <div className="mx-auto w-full max-w-6xl pb-24 sm:pb-8">
    {!isTeacher && <PageHeader emoji="📜" title="운영국 과제 검수대" />}
    <div className="px-3 pt-4 sm:px-5 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div>
          {isTeacher && <button type="button" className="text-xs text-text-muted hover:text-white flex items-center gap-1 mb-1" onClick={() => navigate('/teacher')}><ArrowLeft size={13} /> 교사 운영 패널</button>}
          <h1 className="font-display text-xl text-white">📜 운영국 과제 검수대</h1>
          <p className="text-xs text-text-secondary mt-1">과제별 독립 검사 · 수정 이력 보존 · 신뢰도 산정 연동</p>
        </div>
        <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={openNew}><Plus size={14} className="inline mr-1"/>과제 등록</button>
      </div>
      <nav className="flex gap-1.5 border-b border-line overflow-x-auto" aria-label="검수대 메뉴">
        {([['CHECK','오늘 검사',ClipboardCheck],['HISTORY','검사 이력',History],['MONTH','월간 현황',CalendarDays],...(isTeacher ? [['GUILD','길드 신뢰도',ShieldCheck]] : [])] as Array<[Tab,string,typeof ClipboardCheck]>).map(([key,title,Icon]) =>
          <button key={key} type="button" onClick={() => { setTab(key); setSelectedId(null); }} className={`shrink-0 px-3 py-3 text-xs font-black border-b-2 flex items-center gap-1.5 ${tab===key?'border-gold text-gold':'border-transparent text-text-secondary'}`}><Icon size={14}/>{title}</button>)}
      </nav>
      {notice && <div role="status" className={`rounded-card-md border px-3 py-2 text-xs font-bold ${notice.kind==='error'?'border-danger/40 bg-danger/10 text-danger':'border-success/40 bg-success/10 text-success'}`}>{notice.text}</div>}
      {(tab==='CHECK' || tab==='HISTORY' || tab==='MONTH' || tab==='GUILD') && <div className="flex flex-wrap items-center justify-between gap-2">
        {tab==='CHECK' ? <div className="flex items-center gap-1.5">
          <button className="btn-secondary p-2" title="전날" onClick={()=>setPickedDay(shiftDate(day,-1))}>‹</button>
          <input type="date" className="input-field text-xs w-[146px]" value={day} onChange={e=>setPickedDay(e.target.value)} />
          <button className="btn-secondary p-2" title="다음날" onClick={()=>setPickedDay(shiftDate(day,1))}>›</button>
          <button className="btn-secondary text-xs px-2" onClick={()=>setPickedDay(localDay())}>오늘</button>
        </div> : <label className="flex items-center gap-2 text-xs text-text-secondary font-bold">조회 월 <input type="month" className="input-field text-xs" value={month} onChange={e=>setPickedMonth(e.target.value)} /></label>}
        <span className="text-xs text-text-secondary">{tab==='CHECK'?`${labelDate(day)} · ${dayTasks.length}개 과제`: `${month} · ${tasks.length}개 과제`}</span>
      </div>}
      {boardQ.isLoading && <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>}
      {boardQ.isError && <div className="rounded-card-md border border-danger/40 p-4 text-danger text-sm">기록 조회 오류: {errorText(boardQ.error)} <button className="btn-secondary ml-2" onClick={()=>void boardQ.refetch()}>재시도</button></div>}
      {!boardQ.isLoading && boardQ.data && tab==='CHECK' && <>
        <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="오늘의 과제">
          <span className="shrink-0 text-[11px] text-text-muted font-bold">과제 {dayTasks.length}건</span>
          {dayTasks.map(t=>{
            const done=marksFor(t.id).filter(x=>x.result!=='UNKNOWN').length;
            const total=marksFor(t.id).length;
            return <button type="button" key={t.id} onClick={()=>{setSelectedId(t.id);setFilter('ALL');setSearch('');}} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold border ${selected?.id===t.id?'border-gold bg-gold/10 text-gold':'border-line bg-bg-card text-text-secondary'}`}>{t.title} <span className="opacity-70 ml-1">{t.status==='SUBMITTED'?'✓ 제출':`${done}/${total}`}</span></button>;
          })}
        </div>
        {!selected ? <div className="glass-card p-8 text-center"><p className="text-text-secondary text-sm">{labelDate(day)}에 등록된 검사 과제가 없습니다.</p><button className="btn-primary mt-4 text-xs" onClick={openNew}>+ 과제 등록</button></div> : <>
          <div className="glass-card p-3 sm:p-4 border-gold/20 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><h2 className="font-display text-lg text-white">{selected.title}</h2><span className="text-2xs font-black text-gold border border-gold/30 rounded px-2 py-0.5">{KINDS.find(k=>k.key===selected.task_kind)?.name??'기타'}</span><span className="text-2xs text-text-secondary">{selected.status==='SUBMITTED'?'✓ 검사 제출 완료':selected.status==='RETURNED'?'↩ 교사 반려':'● 검사 진행 중'}</span></div>
              <p className="text-xs text-text-secondary mt-1">마감 {selected.due_on} {String(selected.check_at).slice(0,5)} {selected.instructions ? `· ${selected.instructions}` : ''}</p>
              {selected.returned_reason && <p className="text-xs text-warning mt-1">반려 사유: {selected.returned_reason}</p>}
            </div>
            {isTeacher && selected.status==='SUBMITTED' && <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={()=>{const reason=window.prompt('제출관리관에게 재검사를 요청할 사유');if(reason?.trim())void action(()=>homeworkRpc.returnTask(supabase,selected.id,reason),'재검사 요청을 등록했습니다.');}}>↩ 재검사 요청</button>}
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {([['UNKNOWN',counts.UNKNOWN,'미확인'],['DONE',counts.DONE,'완료'],['MISSING',counts.MISSING,'미제출'],['EXEMPT',counts.EXEMPT,'면제']] as const).map(([key,count,title])=>
              <button type="button" key={key} onClick={()=>setFilter(filter===key?'ALL':key)} className={`rounded-card-md border px-1.5 py-2.5 text-center ${filter===key?'border-gold bg-gold/10':'border-line bg-bg-card'}`}><div className="text-[10px] font-bold text-text-muted">{title}</div><div className={`text-lg font-black ${key==='DONE'?'text-success':key==='MISSING'?'text-danger':'text-white'}`}>{count}<span className="text-2xs text-text-muted ml-0.5">명</span></div></button>)}
          </div>
          <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
            <div className="flex items-center justify-between gap-2 flex-wrap p-3 border-b border-line">
              <div className="flex items-center gap-2"><h3 className="text-sm font-black text-white">학생별 검사</h3><span className="text-2xs text-text-muted">{selectedMarks.length}명</span></div>
              <div className="flex items-center gap-2 flex-wrap"><button type="button" disabled={!editable||busy} onClick={()=>{if(window.confirm('미확인 학생만 모두 완료 처리할까요? 기존 미제출·면제 결과는 유지됩니다.'))void action(()=>homeworkRpc.markUncheckedDone(supabase,selected.id),'미확인 학생을 완료 처리했습니다.');}} className="btn-secondary text-xs px-2 py-1.5 disabled:opacity-40"><CheckCheck size={14} className="inline mr-1"/>미확인 전체 완료</button><div className="relative"><Search size={13} className="absolute top-2.5 left-2 text-text-muted"/><input className="input-field pl-7 w-[132px] text-xs py-1.5" placeholder="학생 검색" value={search} onChange={e=>setSearch(e.target.value)} /></div></div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
              {(['ALL','UNKNOWN','DONE','MISSING','LATE','EXEMPT'] as Filter[]).map(k=><button key={k} onClick={()=>setFilter(k)} className={`rounded-md px-2 py-1 text-[11px] font-bold ${filter===k?'bg-gold/15 text-gold':'text-text-secondary hover:bg-bg-deep'}`}>{k==='ALL'?'전체':LABELS[k]}</button>)}
            </div>
            <div className="max-h-[48vh] min-h-[180px] overflow-y-auto p-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2">
                {selectedMarks.filter(r=>(filter==='ALL'||r.result===filter)&&r.student_name.includes(search.trim())).map(r=>
                  <div key={r.student_id} className={`rounded-card-md border p-2 flex min-w-0 items-center justify-between gap-1.5 ${r.result==='MISSING'?'bg-danger/5 border-danger/30':'bg-bg-deep border-line'}`}>
                    <span className="truncate text-xs font-black text-white" title={r.student_name}>{r.student_name}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" title={`${r.student_name} 클릭하여 완료/미제출 전환`} className={`text-[10px] font-black rounded-md border px-1.5 py-1 ${PILL[r.result]}`} disabled={!editable||busy} onClick={()=>setResult(selected,r.student_id,r.result==='DONE'?'MISSING':'DONE')}>{LABELS[r.result]}</button>
                      <select aria-label={`${r.student_name} 상태 선택`} title="상세 상태 변경" className="w-[22px] max-w-[22px] rounded bg-bg-deep text-xs text-text-secondary cursor-pointer" disabled={!editable||busy} value={r.result} onChange={e=>setResult(selected,r.student_id,e.target.value as HomeworkResult)}>
                        {(['UNKNOWN','DONE','LATE','MISSING','EXEMPT'] as HomeworkResult[]).map(x=><option key={x} value={x}>{LABELS[x]}</option>)}
                      </select>
                    </div>
                  </div>)}
              </div>
              {selectedMarks.filter(r=>(filter==='ALL'||r.result===filter)&&r.student_name.includes(search.trim())).length===0 && <div className="text-center py-10 text-sm text-text-muted">해당하는 학생이 없습니다.</div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3">
              <span className="text-2xs text-text-muted">개별 체크는 즉시 임시 저장 · 검사 제출 후 신뢰도 집계</span>
              <button type="button" disabled={busy||selected.status==='SUBMITTED'||counts.UNKNOWN>0} className="btn-primary text-xs px-4 py-2 disabled:opacity-40" onClick={()=>{if(window.confirm(`${selected.title} 검사 결과를 제출할까요? 제출 후에는 교사 정정 또는 반려가 필요합니다.`))void action(()=>homeworkRpc.submit(supabase,selected.id),'검사 결과가 공식 기록으로 제출됐습니다.');}}>{selected.status==='SUBMITTED'?'✓ 제출 완료':busy?'저장 중…':counts.UNKNOWN?`미확인 ${counts.UNKNOWN}명`:'검사 제출 →'}</button>
            </div>
          </section>
        </>}
      </>}
      {!boardQ.isLoading && boardQ.data && tab==='HISTORY' && <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-3">
        <section className="rounded-card-lg border border-line bg-bg-card overflow-hidden"><div className="p-3 border-b border-line space-y-2"><h2 className="font-display text-sm text-white">날짜별 검사 이력</h2><input className="input-field w-full text-xs" placeholder="날짜·과제명 검색" value={historySearch} onChange={e=>setHistorySearch(e.target.value)} /></div>
          <div className="max-h-[410px] overflow-y-auto p-2 space-y-1.5">{historyItems.map(t=>{const r=marksFor(t.id);return <button key={t.id} className={`w-full text-left rounded-md border px-3 py-2.5 ${historySelected?.id===t.id?'border-gold bg-gold/10':'border-line bg-bg-deep hover:border-line-brand'}`} onClick={()=>setSelectedId(t.id)}><div className="text-2xs text-text-muted">{t.due_on} · {t.status==='SUBMITTED'?'✓ 제출':'검사 중'}</div><div className="text-xs font-black text-white truncate mt-0.5">{t.title}</div><div className="text-[10px] text-text-secondary mt-1">완료 {r.filter(x=>x.result==='DONE').length} / {r.length}명 · 미제출 {r.filter(x=>x.result==='MISSING').length}</div></button>})}{historyItems.length===0&&<p className="text-sm text-text-muted p-4">기록이 없습니다.</p>}</div>
        </section>
        <section className="rounded-card-lg border border-line bg-bg-card overflow-hidden"><div className="border-b border-line p-3"><h2 className="font-display text-base text-white">{historySelected?.title ?? '과제를 선택하세요'}</h2>{historySelected&&<p className="text-xs text-text-muted mt-1">{historySelected.due_on} · {historySelected.status==='SUBMITTED'?'공식 집계':'미확정 기록'}</p>}</div>
          <div className="max-h-[440px] overflow-y-auto p-3">{historySelected?<div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">{marksFor(historySelected.id).map(r=><div key={r.student_id} className={`border rounded-md px-2 py-1.5 flex justify-between gap-2 text-xs ${PILL[r.result]}`}><span className="text-text-primary truncate">{r.student_name}</span><b>{LABELS[r.result]}</b></div>)}</div>:<p className="text-text-muted text-sm">해당 월에 과제가 없습니다.</p>}</div>
        </section>
      </div>}
      {!boardQ.isLoading && boardQ.data && tab==='MONTH' && <MonthSummary board={boardQ.data} selectedStudent={selectedStudent} onSelectStudent={setSelectedStudent} />}
      {tab==='GUILD' && isTeacher && <div className="rounded-card-lg border border-line bg-bg-card overflow-hidden">
        <div className="p-3 border-b border-line"><h2 className="font-display text-base text-white">길드 미션 1차·2차 판정</h2><p className="text-xs text-text-secondary mt-1">길드3의 기존 성공/실패 기록과 별개로 신뢰도 이행기한을 판정합니다. 미기록 미션은 신뢰도 자동 반영을 보류합니다.</p></div>
        {guildQ.isLoading?<div className="p-6"><LoadingSpinner /></div>:guildQ.isError?<div className="p-4 text-danger">조회 오류: {errorText(guildQ.error)}</div>:<div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">{(guildQ.data??[]).map(row=><div key={row.instance_id} className="flex flex-wrap gap-2 justify-between items-center rounded-md bg-bg-deep border border-line p-3"><div className="min-w-0"><b className="text-xs text-white">{row.title}</b><div className="text-xs text-text-muted mt-1">{row.guild_name} · 공식 {row.current_guild_result==='CLEARED'?'성공':row.current_guild_result==='FAILED'?'실패':'미판정'}</div></div><select className="input-field text-xs" disabled={guildBusy===row.instance_id} value={row.outcome??''} onChange={e=>{const outcome=e.target.value as NonNullable<typeof row.outcome>;if(!window.confirm(`${row.guild_name} · ${row.title} 판정을 변경할까요?`))return;setGuildBusy(row.instance_id);void homeworkRpc.setGuildOutcome(supabase,row.instance_id,outcome).then(async()=>{await qc.invalidateQueries({queryKey:['homework-guild-trust',month]});setNotice({kind:'ok',text:'길드 기한 판정을 저장했습니다.'});}).catch(e=>setNotice({kind:'error',text:errorText(e)})).finally(()=>setGuildBusy(null));}}><option value="" disabled>미판정</option><option value="ON_TIME">1차 성공 (감점 없음)</option><option value="LATE">2차 성공 (절반 감점)</option><option value="FAILED">최종 실패 (전액 감점)</option><option value="EXEMPT">판정 제외</option></select></div>)}{guildQ.data?.length===0&&<p className="text-text-muted text-sm p-4">이 달에 확정된 길드 미션이 없습니다.</p>}</div>}
      </div>}
    </div>
    {modalOpen && <div className="fixed inset-0 z-[1000] bg-black/75 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-labelledby="homework-task-create-title"><form onSubmit={e=>void createTask(e)} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-bg-card border border-gold/35 rounded-card-xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center justify-between"><div><h2 id="homework-task-create-title" className="font-display text-lg text-white">새 검수 과제 등록</h2><p className="text-xs text-text-muted mt-1">한 날짜에 여러 과제를 등록할 수 있습니다.</p></div><button type="button" onClick={()=>setModalOpen(false)} aria-label="닫기"><X size={20}/></button></div>
      <div><p className="text-xs font-bold text-text-secondary mb-2">빠른 템플릿</p><div className="flex flex-wrap gap-1.5">{KINDS.map(k=><button type="button" key={k.key} className={`border rounded px-2.5 py-1.5 text-xs ${newKind===k.key?'border-gold text-gold':'border-line text-text-secondary'}`} onClick={()=>{setNewKind(k.key);setNewTitle(k.title);setNewNote(k.instruction);}}>{k.name}</button>)}</div></div>
      <label className="block text-xs font-bold text-text-secondary">과제명<input required maxLength={100} autoFocus className="input-field w-full mt-1" value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="예: 수학익힘 42~43쪽" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold text-text-secondary">제출 날짜<input required type="date" className="input-field w-full mt-1" value={newDay} onChange={e=>setNewDay(e.target.value)} /></label><label className="block text-xs font-bold text-text-secondary">검사 시간<input required type="time" className="input-field w-full mt-1" value={newTime} onChange={e=>setNewTime(e.target.value)} /></label></div>
      <label className="block text-xs font-bold text-text-secondary">검사 안내 (선택)<textarea className="input-field w-full mt-1 min-h-20" maxLength={800} value={newNote} onChange={e=>setNewNote(e.target.value)} placeholder="예: 진도 나간 쪽 풀어오기"/></label>
      <div className="border border-line rounded-md bg-bg-deep px-3 py-2 text-xs text-text-secondary">등록 시 현재 재학생 전원이 <b className="text-white">미확인</b>으로 생성됩니다. 검사 제출을 마쳐야 신뢰도에 반영됩니다.</div>
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={()=>setModalOpen(false)}>취소</button><button type="submit" disabled={busy||!newTitle.trim()} className="btn-primary disabled:opacity-50">{busy?'등록 중…':'과제 등록 및 검사 시작'}</button></div>
    </form></div>}
  </div>;
}

function MonthSummary({ board, selectedStudent, onSelectStudent }: { board: import('@/lib/rpc/homework_check_rpc').HomeworkBoard; selectedStudent: number | null; onSelectStudent: (id: number | null) => void }) {
  const submitted = board.tasks.filter(t=>t.status==='SUBMITTED');
  const marks = board.results.filter(r=>submitted.some(t=>t.id===r.task_id));
  const students = board.students.map(s=>{
    const rows = marks.filter(m=>m.student_id===s.id && m.result!=='EXEMPT' && m.result!=='UNKNOWN');
    const score = rows.length ? Math.round((rows.reduce((v,r)=>v+(r.result==='DONE'?100:r.result==='LATE'?70:0),0)/rows.length)*10)/10 : null;
    return {...s,rows,score};
  }).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.name.localeCompare(b.name,'ko'));
  const current = students.find(s=>s.id===selectedStudent)??null;
  return <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] gap-3">
    <section className="rounded-card-lg border border-line bg-bg-card overflow-hidden"><div className="p-3 border-b border-line"><h2 className="font-display text-base text-white">월간 과제 이행 현황</h2><p className="text-xs text-text-secondary mt-1">공식 제출된 과제 {submitted.length}건만 집계 · 완료 100점 / 지연 70점 / 미제출 0점 · 면제 제외</p></div><div className="max-h-[56vh] overflow-y-auto p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">{students.map(s=><button key={s.id} className={`flex items-center gap-2 border rounded-md p-2.5 text-xs text-left ${current?.id===s.id?'border-gold bg-gold/10':'border-line bg-bg-deep hover:border-line-brand'}`} onClick={()=>onSelectStudent(current?.id===s.id?null:s.id)}><b className="text-white shrink-0">{s.name}</b><span className="flex-1 h-1.5 bg-bg-base rounded overflow-hidden"><span className="block h-full bg-gold" style={{width:`${s.score??0}%`}}/></span><b className={s.score===null?'text-text-muted':'text-gold'}>{s.score===null?'자료 없음':`${s.score.toFixed(1)}%`}</b></button>)}</div></section>
    <section className="rounded-card-lg border border-line bg-bg-card p-3"><h3 className="font-display text-sm text-white">학생별 과제 이력</h3>{current?<><div className="mt-3 text-lg font-bold text-gold">{current.name} · {current.score===null?'자료 없음':`${current.score.toFixed(1)}%`}</div><div className="max-h-[46vh] overflow-auto mt-2 space-y-1.5">{submitted.map(t=>{const r=board.results.find(x=>x.task_id===t.id&&x.student_id===current.id);return <div key={t.id} className="rounded-md border border-line bg-bg-deep px-2.5 py-2 flex items-start justify-between gap-2 text-xs"><span className="min-w-0"><b className="block text-white truncate">{t.title}</b><span className="text-text-muted">{t.due_on}</span></span><b className={r?.result==='MISSING'?'text-danger':'text-text-secondary'}>{r?LABELS[r.result]:'기록 없음'}</b></div>})}</div></>:<p className="text-xs text-text-muted mt-3">왼쪽 학생을 선택하면 제출 이력을 볼 수 있습니다.</p>}</section>
  </div>;
}
