import { createContext, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, ClipboardList, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTeacherActionCenter, type ActionGroup, type ActionPriority, type TeacherAction } from '@/lib/teacher_action_center';

export const TeacherActionContext = createContext<ReturnType<typeof useTeacherActionCenter> | null>(null);
export function useTeacherActions() {
  const value = useContext(TeacherActionContext);
  if (!value) throw new Error('TeacherActionContext is missing');
  return value;
}
const groupNames: Record<ActionGroup,string> = {
  students:'학생 관리',growth:'성장 시스템',economy:'경제',
};
const priorityNames: Record<ActionPriority,string> = {
  urgent:'긴급',review:'검토',operation:'운영',
};
function ItemLine({item,onNavigate}:{item:TeacherAction;onNavigate?:()=>void}) {
  return <Link to={item.to} onClick={onNavigate} title={item.description}
    className="group flex items-center gap-3 rounded-xl border border-line/70 bg-bg-deep/60 px-3 py-2.5 transition hover:border-gold/35 hover:bg-bg-deep">
    <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
      (item.priority === 'urgent' ? 'bg-danger/15 text-danger' : item.priority === 'review' ?
        'bg-gold/10 text-gold' : 'bg-brand-primary/15 text-brand-primary')}>
      {item.priority === 'urgent' ? <ShieldAlert size={16}/> : <ClipboardList size={16}/>}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-xs font-black text-text-primary">{item.title}</span>
        <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " +
          (item.priority==='urgent' ? 'bg-danger/10 text-danger' : 'bg-bg-card text-text-muted')}>{priorityNames[item.priority]}</span>
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
        {item.studentName ? item.studentName + ' · ' : ''}{item.description}
      </span>
    </span>
    <span className="hidden shrink-0 text-[10px] text-text-muted sm:block">{item.source}</span>
    <ChevronRight size={14} className="shrink-0 text-text-muted group-hover:text-gold"/>
  </Link>;
}

export function ActionBell() {
  const q = useTeacherActions();
  const [open,setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const urgent = items.filter(item => item.priority==='urgent').length;
  const count = items.length;
  return <div className="relative">
    <button type="button" aria-label={"통합 업무 알림 " + (q.data?.complete===false ? '일부 조회 실패' : count + '건')}
      aria-expanded={open} onClick={()=>setOpen(v=>!v)}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg-card text-text-secondary hover:text-white">
      <Bell size={17}/>{count>0 && <span className={"absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black text-white "+
        (urgent ? 'bg-danger':'bg-brand-primary')}>{count>99?'99+':count}</span>}
      {q.data?.complete===false && <span className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-warning" title="일부 업무 조회 실패"/>}
    </button>
    {open && <>
      <button aria-label="알림 닫기" className="fixed inset-0 z-40 cursor-default bg-transparent" onClick={()=>setOpen(false)}/>
      <div className="absolute right-0 top-11 z-50 w-[min(92vw,400px)] rounded-xl border border-line bg-bg-overlay p-3 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div><div className="font-display text-sm text-white">통합 업무 알림</div>
            <p className="mt-1 text-[11px] text-text-secondary">30초 자동 갱신 · 확인만으로 삭제되지 않음</p></div>
          <button type="button" aria-label="새로고침" onClick={()=>void q.refetch()} className="rounded-lg p-2 text-text-secondary hover:bg-bg-card"><RefreshCw size={15}/></button>
        </div>
        {q.isLoading && !q.data ? <p className="py-5 text-center text-xs text-text-muted">업무 불러오는 중...</p>
        : <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {items.slice(0,7).map(item=><ItemLine key={item.id} item={item} onNavigate={()=>setOpen(false)}/>)}
          {items.length===0 && <p className="py-4 text-center text-xs text-text-muted">{q.data?.complete===false?'업무 일부를 확인하지 못했습니다':'확인된 미처리 업무가 없습니다'}</p>}
        </div>}
        {q.data?.complete===false && <p className="mt-2 text-[11px] text-warning">일부 영역의 데이터를 불러오지 못했습니다. 대시보드에서 확인하세요.</p>}
        <Link to="/teacher#work-center" onClick={()=>setOpen(false)}
          className="mt-3 block rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-center text-xs font-black text-gold hover:bg-gold/20">전체 업무함 보기</Link>
      </div>
    </>}
  </div>;
}

export function ActionNavCount({group,to}:{group?:ActionGroup;to?:string}) {
  const q = useTeacherActions();
  const items = q.data?.items ?? [];
  const count = items.filter(item =>
    group ? item.group===group :
    to==='/teacher/secondary-jobs' ? item.to.startsWith('/teacher/secondary-jobs') :
    to==='/teacher/review' ? item.to.startsWith('/teacher/review') :
    to ? item.to.split('?')[0]===to : false
  ).length;
  if (!count) return null;
  const urgent = items.some(item=>(group ? item.group===group :
    to==='/teacher/secondary-jobs' ? item.to.startsWith('/teacher/secondary-jobs') :
    to==='/teacher/review' ? item.to.startsWith('/teacher/review') :
    item.to.split('?')[0]===to) && item.priority==='urgent');
  return <span aria-label={count+'건 미처리'} className={"ml-auto min-w-5 rounded-md px-1.5 py-0.5 text-center text-[10px] font-black "+
    (urgent?'bg-danger/20 text-danger':'bg-gold/15 text-gold')}>{count>99?'99+':count}</span>;
}

export function DashboardActionWorklist() {
  const q = useTeacherActions();
  const [filter,setFilter] = useState<'all'|ActionPriority>('all');
  const [group,setGroup] = useState<'all'|ActionGroup>('all');
  const [expanded,setExpanded] = useState(false);
  const actions = q.data?.items ?? [];
  const filtered = actions.filter(item=>(filter==='all'||item.priority===filter) && (group==='all'||item.group===group));
  const urgent = actions.filter(i=>i.priority==='urgent').length;
  const review = actions.filter(i=>i.priority==='review').length;
  const operation = actions.filter(i=>i.priority==='operation').length;
  const tabs: {value:'all'|ActionPriority;name:string;count:number}[] = [
    {value:'all',name:'전체',count:actions.length},{value:'urgent',name:'긴급',count:urgent},
    {value:'review',name:'승인·검사',count:review},{value:'operation',name:'정산·운영',count:operation},
  ];
  return <section id="work-center" className="rounded-2xl border border-line bg-bg-card p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-display text-lg text-white">통합 업무함</h2>
        <p className="mt-1 text-xs text-text-secondary">교사 조치가 필요한 요청을 분야에 관계없이 모았습니다.</p></div>
      <button type="button" onClick={()=>void q.refetch()} disabled={q.isFetching} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 text-xs font-black text-text-secondary hover:text-white disabled:opacity-50">
        <RefreshCw size={13} className={q.isFetching?'animate-spin':''}/> 지금 확인
      </button>
    </div>
    {q.data?.complete===false && <div className="mb-3 rounded-lg border border-warning/35 bg-warning-bg p-3 text-xs text-warning">
      <div className="flex items-center gap-1.5 font-black"><AlertTriangle size={14}/> 일부 업무를 조회하지 못했습니다</div>
      <div className="mt-1">{q.data.errors.map(e=>e.source).join(' · ')} · 해당 영역은 총건수에 포함되지 않았습니다.</div>
      <div className="mt-1 text-[11px]">다시 확인해도 지속되면 각 업무 페이지의 권한·응답 오류를 점검해주세요.</div>
    </div>}
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {tabs.map(tab=><button key={tab.value} type="button" onClick={()=>{setFilter(tab.value);setExpanded(false)}}
        className={"rounded-lg px-3 py-2 text-xs font-black transition "+
          (filter===tab.value?'bg-brand-primary/20 text-white ring-1 ring-brand-primary/40':'text-text-secondary hover:bg-bg-deep')}>
        {tab.name} <span className={tab.value==='urgent' && tab.count?'text-danger':'text-gold'}>{tab.count}</span>
      </button>)}
    </div>
    <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
      <button className={group==='all'?'font-black text-gold':'text-text-muted'} onClick={()=>setGroup('all')}>모든 분야</button>
      {(['students','growth','economy'] as ActionGroup[]).map(g=><button key={g}
        onClick={()=>{setGroup(g);setExpanded(false)}} className={"rounded-md px-2 py-1 "+(group===g?'bg-gold/10 font-black text-gold':'text-text-secondary hover:bg-bg-deep')}>{groupNames[g]}</button>)}
    </div>
    {q.isLoading && !q.data?<p className="py-12 text-center text-sm text-text-secondary">운영 정보를 수집하는 중...</p>:
    <div className="space-y-1.5">
      {filtered.slice(0,expanded?undefined:9).map(item=><ItemLine key={item.id} item={item}/>)}
      {!filtered.length && <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
        <CheckCircle2 size={19} className="text-success"/>{q.data?.complete?'해당하는 미처리 업무가 없습니다':'현재 확인된 업무가 없습니다'}
      </div>}
    </div>}
    {!expanded && filtered.length>9 && <button type="button" onClick={()=>setExpanded(true)}
      className="mt-3 w-full rounded-lg border border-line py-2 text-xs font-black text-gold hover:bg-bg-deep">
      나머지 {filtered.length-9}건 더 보기
    </button>}
    {expanded&&filtered.length>9&&<button type="button" onClick={()=>setExpanded(false)}
      className="mt-3 w-full text-xs text-text-secondary">접기</button>}
    <p className="mt-3 text-[10px] text-text-muted">30초 간격 자동 갱신 · 승인·정산 시 원본 상태를 기준으로 사라집니다.</p>
  </section>;
}
