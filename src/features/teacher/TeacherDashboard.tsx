import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardList, Coins, Users, Wallet, Activity, ArrowUpRight } from 'lucide-react';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { DashboardActionWorklist, useTeacherActions } from '@/components/teacher/TeacherActionWidgets';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useCurrentStudent } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';

function OperatingSummary() {
  const actions = useTeacherActions();
  const list = actions.data?.items ?? [];
  const status = [
    {title:'미처리 업무',value:list.length,icon:ClipboardList,color:'text-white'},
    {title:'긴급 확인',value:list.filter(x=>x.priority==='urgent').length,icon:AlertTriangle,color:'text-danger'},
    {title:'승인·검사',value:list.filter(x=>x.priority==='review').length,icon:CheckCircle2,color:'text-gold'},
    {title:'정산·운영',value:list.filter(x=>x.priority==='operation').length,icon:Activity,color:'text-brand-primary'},
  ];
  return <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
    {status.map(item=><div key={item.title} className="rounded-xl border border-line bg-bg-card p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
        <span className="font-bold">{item.title}</span><item.icon size={16} className={item.color}/>
      </div>
      <div className={"mt-2 font-display text-2xl tracking-tight "+item.color}>
        {actions.isLoading&&!actions.data?'…':item.value}
        {actions.data?.complete===false&&<span title="일부 분야 조회 실패" className="ml-1 align-middle text-xs text-warning">+</span>}
      </div>
      {actions.data?.complete===false && <p className="mt-1 text-[10px] text-warning">확인된 건수만 표시</p>}
    </div>)}
  </div>;
}
function ActivityOverview() {
  const cid = useClassroomId();
  const q = useQuery({
    queryKey:['teacher-action-overview',cid],
    enabled:cid!==null,
    queryFn:async()=>{
      if (!cid) throw new Error('학급 정보를 찾지 못했습니다');
      const start = new Intl.DateTimeFormat('en-CA',{
        timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
      }).format(new Date())+'T00:00:00+09:00';
      const [students,tx,wallets] = await Promise.all([
        supabase.from('students').select('id,transferred_at',{count:'exact'})
          .eq('classroom_id',cid).eq('role','STUDENT'),
        supabase.from('transactions').select('id',{count:'exact',head:true})
          .eq('classroom_id',cid).gte('created_at',start),
        supabase.from('wallets').select('bv,gold,student:students!student_id(classroom_id)').limit(100),
      ]);
      if (students.error) throw students.error;
      if (tx.error) throw tx.error;
      if (wallets.error) throw wallets.error;
      const active = (students.data??[]).filter(x=>x.transferred_at===null).length;
      const rows = (wallets.data??[]).filter((w:any)=>w.student?.classroom_id===cid);
      return {active,total:students.count??0,transactions:tx.count??0,
        bv:rows.reduce((v,w)=>v+Number(w.bv??0),0),
        gold:rows.reduce((v,w)=>v+Number(w.gold??0),0)};
    },
    refetchInterval:30_000,staleTime:15_000,refetchOnWindowFocus:true,
  });
  return <section className="rounded-2xl border border-line bg-bg-card p-4">
    <h2 className="mb-3 font-display text-sm text-white">학급 운영 현황</h2>
    {q.isError ? <p className="text-xs text-warning">현황 조회 실패 · 새로고침 후 다시 확인해주세요.</p>:
    q.isLoading ? <p className="text-xs text-text-muted">학급 현황 확인 중...</p>:
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-text-secondary"><Users size={14}/>활성 학생</span><b className="text-white">{q.data?.active} / {q.data?.total}</b></div>
      <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-text-secondary"><Activity size={14}/>오늘 거래</span><b className="text-white">{formatNumber(q.data?.transactions??0)}건</b></div>
      <div className="border-t border-line pt-3">
        <div className="mb-2 flex items-center gap-2 text-text-secondary"><Wallet size={14}/>학급 자산</div>
        <div className="flex justify-between gap-2"><span className="text-text-secondary">BV</span><b className="text-bv">{formatNumber(q.data?.bv??0)}</b></div>
        <div className="mt-1.5 flex justify-between gap-2"><span className="flex items-center gap-1 text-text-secondary"><Coins size={12}/>GOLD</span><b className="text-gold">{formatNumber(q.data?.gold??0)}</b></div>
      </div>
    </div>}
  </section>;
}
function GroupOverview() {
  const q = useTeacherActions();
  const actions = q.data?.items??[];
  const rows = [
    {group:'students',name:'학생 관리',to:'/teacher/review'},
    {group:'growth',name:'성장 시스템',to:'/teacher/daily-quests'},
    {group:'economy',name:'경제',to:'/teacher/economy-guard'},
  ];
  return <section className="rounded-2xl border border-line bg-bg-card p-4">
    <h2 className="mb-3 font-display text-sm text-white">분야별 업무</h2>
    <div className="space-y-2">
      {rows.map(r=><div key={r.group} className="flex items-center justify-between rounded-lg bg-bg-deep/60 px-3 py-2.5">
        <span className="text-xs text-text-secondary">{r.name}</span>
        <span className="text-xs font-black text-gold">{actions.filter(a=>a.group===r.group).length}건</span>
      </div>)}
    </div>
    {q.data?.complete===false&&<p className="mt-2 text-[10px] text-warning">일부 분야의 건수가 누락될 수 있습니다.</p>}
  </section>;
}
const SHORTCUTS = [
  {to:'/teacher/control',label:'자산 지급·차감'},
  {to:'/teacher/arrears',label:'미납금 관리'},
  {to:'/teacher/auction',label:'경매 시작'},
  {to:'/teacher/daily-quests',label:'일일퀘스트 정산'},
  {to:'/teacher/primary-jobs',label:'1인1역'},
  {to:'/teacher/market',label:'시장 운영'},
  {to:'/teacher/economy-guard',label:'경제수호대'},
];
export default function TeacherDashboard() {
  const teacher = useCurrentStudent();
  return <TeacherShell><div className="space-y-4 pb-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl text-brand-gradient">
          {teacher?.studentName ?? '선생님'}, 안녕하세요
        </h1>
        <p className="mt-1 text-xs font-bold text-text-secondary">
          {teacher?.classroomName??''} · B.R.A.N.D 운영국 통합 관제센터
        </p>
      </div>
      <span className="rounded-lg border border-line bg-bg-card px-3 py-2 text-xs text-text-muted">30초 자동 갱신</span>
    </div>
    <OperatingSummary/>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(275px,1fr)]">
      <DashboardActionWorklist/>
      <div className="space-y-4">
        <GroupOverview/>
        <ActivityOverview/>
      </div>
    </div>
    <section className="rounded-xl border border-line bg-bg-card px-4 py-3">
      <h2 className="mb-2 text-xs font-black text-text-secondary">자주 사용하는 작업</h2>
      <div className="flex flex-wrap gap-2">{SHORTCUTS.map(a=><Link key={a.label} to={a.to}
        className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-secondary hover:border-gold/40 hover:text-white">
        {a.label}<ArrowUpRight size={12}/></Link>)}</div>
    </section>
  </div></TeacherShell>;
}
