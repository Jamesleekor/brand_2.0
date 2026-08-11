import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PageHeader, EmptyState, LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type Tab = 'mail' | 'alerts' | 'activity';
const ALERT_LABEL: Record<string,string> = { HIDDEN:'히든',MILESTONE:'마일스톤',TIER:'티어',SET_COMPLETION:'세트 완성',EMERGENCY:'비상사태',AUCTION:'경매',GENERAL:'공지' };
const ACTIVITY_LABEL: Record<string,string> = { ACHIEVEMENT:'업적',PURCHASE:'구매',SET_COMPLETION:'세트 완성',TIER_UP:'티어 승급',GUILD_MISSION:'길드 미션',P2P_TRANSFER:'P2P',AUCTION_WIN:'경매 낙찰',DEPOSIT_OPEN:'예금',ASSIGNMENT_GRADE:'과제',OTHER:'활동' };

export default function CommunicationPage() {
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const tab = (['mail','alerts','activity'].includes(params.get('tab') || '') ? params.get('tab') : 'mail') as Tab;

  useEffect(() => {
    if (!studentId || !classroomId) return;
    const ch = supabase.channel(`f4a:communication:${studentId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'mail_messages',filter:`recipient_id=eq.${studentId}`},()=>qc.invalidateQueries({queryKey:['f4a-mail']}))
      .on('postgres_changes',{event:'*',schema:'public',table:'global_alerts',filter:`classroom_id=eq.${classroomId}`},()=>qc.invalidateQueries({queryKey:['f4a-alerts']}))
      .on('postgres_changes',{event:'*',schema:'public',table:'global_alert_reads',filter:`student_id=eq.${studentId}`},()=>qc.invalidateQueries({queryKey:['f4a-alerts']}))
      .on('postgres_changes',{event:'*',schema:'public',table:'activity_feed_items',filter:`classroom_id=eq.${classroomId}`},()=>qc.invalidateQueries({queryKey:['f4a-activity']}))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  },[studentId,classroomId,qc]);

  return <>
    <PageHeader title="소식함" emoji="📬" onBack={()=>navigate('/')} />
    <div className="px-4 pt-4 pb-28 max-w-3xl mx-auto">
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        {([['mail','✉️','우편'],['alerts','🔔','알림'],['activity','🌟','활동']] as const).map(([v,e,l]) =>
          <button key={v} onClick={()=>setParams({tab:v},{replace:true})} className={cn('py-2.5 rounded-pill text-xs font-extrabold border',tab===v?'bg-gradient-to-r from-brand-primary to-gold text-white border-transparent':'bg-bg-card border-line text-text-secondary')}>{e} {l}</button>)}
      </div>
      {tab==='mail' && <MailTab studentId={studentId} />}
      {tab==='alerts' && <AlertsTab studentId={studentId} classroomId={classroomId} />}
      {tab==='activity' && <ActivityTab classroomId={classroomId} />}
    </div>
  </>;
}

function MailTab({studentId}:{studentId:number|null}) {
  const qc=useQueryClient(); const {call}=useRpcCall(); const [openId,setOpenId]=useState<number|null>(null);
  const q=useQuery({queryKey:['f4a-mail',studentId],enabled:!!studentId,queryFn:async()=>{
    const {data,error}=await supabase.from('mail_messages').select('id,title,body,sender_type,message_type,is_read,created_at').eq('recipient_id',studentId!).order('created_at',{ascending:false}).limit(100); if(error) throw feature4QueryError('F4A','mail-list',error); return data??[];
  }});
  const selected=useMemo(()=>q.data?.find((m:any)=>m.id===openId),[q.data,openId]);
  useEffect(()=>{ if(selected && !selected.is_read) void call(()=>feature4Rpc.markMailRead(supabase,{p_message_id:selected.id}),{silent:true,onSuccess:()=>qc.invalidateQueries({queryKey:['f4a-mail']})}); },[selected?.id]);
  if(q.isLoading) return <CenterLoad/>;
  if(q.isError) return <Feature4ErrorPanel domain="F4A" error={q.error} onRetry={()=>void q.refetch()} />;
  if(selected) return <div className="glass-card p-4"><button onClick={()=>setOpenId(null)} className="text-xs text-brand-primary font-bold mb-4">← 목록</button><div className="text-2xs text-text-muted mb-1">{selected.sender_type} · {formatRelativeTime(selected.created_at)}</div><h2 className="font-display text-lg text-brand-gradient mb-3">{selected.title}</h2><p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.body}</p></div>;
  if(!q.data?.length) return <EmptyState emoji="📭" title="받은 우편이 없어요"/>;
  return <div className="space-y-2">{q.data.map((m:any)=><motion.button whileTap={{scale:.98}} key={m.id} onClick={()=>setOpenId(m.id)} className={cn('w-full text-left p-3.5 rounded-card-md border',m.is_read?'bg-bg-deep border-line':'bg-bg-card border-line-brand')}><div className="flex justify-between gap-2"><span className="text-sm font-extrabold truncate">{m.title}</span>{!m.is_read&&<span className="w-2 h-2 bg-brand-primary rounded-full mt-1.5"/>}</div><div className="text-xs text-text-muted truncate mt-1">{m.body}</div><div className="text-2xs text-text-muted mt-1">{formatRelativeTime(m.created_at)}</div></motion.button>)}</div>;
}

function AlertsTab({studentId,classroomId}:{studentId:number|null;classroomId:number|null}) {
  const qc=useQueryClient(); const {call}=useRpcCall();
  const q=useQuery({queryKey:['f4a-alerts',studentId,classroomId],enabled:!!studentId&&!!classroomId,queryFn:async()=>{
    const [{data:a,error:e1},{data:r,error:e2}]=await Promise.all([
      supabase.from('global_alerts').select('id,category,message,emoji,created_at,expires_at,status').eq('classroom_id',classroomId!).eq('status','ACTIVE').order('created_at',{ascending:false}).limit(100),
      supabase.from('global_alert_reads').select('alert_id').eq('student_id',studentId!)
    ]); if(e1) throw feature4QueryError('F4A','alert-list',e1);if(e2)throw feature4QueryError('F4A','alert-read-list',e2); const read=new Set((r??[]).map((x:any)=>x.alert_id)); const now=Date.now(); return (a??[]).filter((x:any)=>!x.expires_at||new Date(x.expires_at).getTime()>now).map((x:any)=>({...x,isRead:read.has(x.id)}));
  }});
  if(q.isLoading)return <CenterLoad/>; if(q.isError)return <Feature4ErrorPanel domain="F4A" error={q.error} onRetry={()=>void q.refetch()} />; if(!q.data?.length)return <EmptyState emoji="🔕" title="현재 알림이 없어요"/>;
  const unread=q.data.filter((x:any)=>!x.isRead).length;
  return <><div className="flex justify-end mb-2">{unread>0&&<button onClick={()=>call(()=>feature4Rpc.markAllAlertsRead(supabase,{p_classroom_id:classroomId!}),{successTitle:'모두 읽음 처리했어요',onSuccess:()=>qc.invalidateQueries({queryKey:['f4a-alerts']})})} className="text-xs font-bold text-brand-primary">모두 읽음 ({unread})</button>}</div><div className="space-y-2">{q.data.map((a:any)=><button key={a.id} onClick={()=>!a.isRead&&call(()=>feature4Rpc.markAlertRead(supabase,{p_alert_id:a.id}),{silent:true,onSuccess:()=>qc.invalidateQueries({queryKey:['f4a-alerts']})})} className={cn('w-full text-left p-3.5 rounded-card-md border',a.isRead?'bg-bg-deep border-line':'bg-bg-card border-gold/40')}><div className="flex gap-2 items-start"><span className="text-xl">{a.emoji||'🔔'}</span><div className="flex-1"><div className="text-2xs font-black text-gold mb-1">{ALERT_LABEL[a.category]||a.category} · {formatRelativeTime(a.created_at)}</div><p className="text-sm font-bold">{a.message}</p></div>{!a.isRead&&<span className="w-2 h-2 rounded-full bg-danger"/>}</div></button>)}</div></>;
}

function ActivityTab({classroomId}:{classroomId:number|null}) {
 const q=useQuery({queryKey:['f4a-activity',classroomId],enabled:!!classroomId,queryFn:async()=>{const {data,error}=await supabase.from('activity_feed_items').select('id,activity_type,subject_data,created_at,subject:students!subject_student_id(name,brand_name)').eq('classroom_id',classroomId!).gt('displayed_until',new Date().toISOString()).order('created_at',{ascending:false}).limit(100);if(error)throw feature4QueryError('F4A','activity-feed',error);return data??[];}});
 if(q.isLoading)return <CenterLoad/>;if(q.isError)return <Feature4ErrorPanel domain="F4A" error={q.error} onRetry={()=>void q.refetch()} />;if(!q.data?.length)return <EmptyState emoji="🌙" title="최근 활동이 없어요"/>;
 return <div className="space-y-2">{q.data.map((x:any)=><div key={x.id} className="p-3.5 rounded-card-md bg-bg-card border border-line"><div className="text-2xs font-black text-bv mb-1">{ACTIVITY_LABEL[x.activity_type]||x.activity_type} · {formatRelativeTime(x.created_at)}</div><div className="text-sm font-extrabold">{x.subject?.brand_name||x.subject?.name||'모험가'}</div><div className="text-xs text-text-secondary mt-1">{activityText(x.subject_data)}</div></div>)}</div>;
}
function activityText(d:any){ if(!d)return '새로운 활동이 기록되었습니다.'; return d.message||d.quest_title||d.assignment_title||Object.entries(d).slice(0,3).map(([k,v])=>`${k}: ${String(v)}`).join(' · '); }
function CenterLoad(){return <div className="py-10 flex justify-center"><LoadingSpinner size="lg"/></div>}
