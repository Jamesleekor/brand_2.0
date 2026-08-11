import { useQuery } from '@tanstack/react-query';
import { PageHeader, EmptyState, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';

const RANK_LABEL:Record<string,string>={TIER:'티어',BRAND_VALUE:'브랜드 가치',GOLD_ASSET:'GOLD 자산',CRYSTAL_ASSET:'CRYSTAL 자산',ACHIEVEMENT_COUNT:'업적 수',CONTRIBUTION:'기여도'};
export default function RecordsPage(){
 const classroomId=useClassroomId(),studentId=useStudentId();
 const q=useQuery({queryKey:['f4d-record-room',classroomId],enabled:!!classroomId,queryFn:async()=>{
  const {data:latest,error:latestError}=await supabase.from('rankings').select('as_of_date').eq('classroom_id',classroomId!).order('as_of_date',{ascending:false}).limit(1).maybeSingle(); if(latestError)throw feature4QueryError('F4D','latest-ranking-date',latestError);
  const date=latest?.as_of_date;
  const [{data:h,error:e1},{data:r,error:e2},{data:d,error:e3}]=await Promise.all([
   supabase.from('hall_of_fame_entries').select('id,category,period_label,title,subtitle,student_id,rank_position,created_at,student:students!student_id(name,brand_name)').eq('classroom_id',classroomId!).eq('status','ACTIVE').order('created_at',{ascending:false}).limit(50),
   date?supabase.from('rankings').select('student_id,ranking_type,rank_position,value,student:students!student_id(name,brand_name)').eq('classroom_id',classroomId!).eq('as_of_date',date).order('rank_position',{ascending:true}):Promise.resolve({data:[],error:null} as any),
   supabase.from('daily_statistics').select('stat_date,total_gold,total_bv,total_crystal,gini_gold,gini_bv,transactions_count').eq('classroom_id',classroomId!).order('stat_date',{ascending:false}).limit(1).maybeSingle()
  ]);if(e1)throw feature4QueryError('F4D','hall-of-fame',e1);if(e2)throw feature4QueryError('F4D','latest-rankings',e2);if(e3)throw feature4QueryError('F4D','latest-statistics',e3);return {hall:h??[],ranks:r??[],stats:d,date};
 }});
 if(q.isLoading)return <><PageHeader title="기록실" emoji="🏛️"/><div className="py-12 flex justify-center"><LoadingSpinner size="lg"/></div></>;
 if(q.isError)return <><PageHeader title="기록실" emoji="🏛️"/><div className="px-4 py-4 max-w-4xl mx-auto"><Feature4ErrorPanel domain="F4D" error={q.error} onRetry={()=>void q.refetch()}/></div></>;
 const grouped=new Map<string,any[]>();(q.data?.ranks??[]).forEach((r:any)=>{if(!grouped.has(r.ranking_type))grouped.set(r.ranking_type,[]);grouped.get(r.ranking_type)!.push(r)});
 return <><PageHeader title="기록실" emoji="🏛️"/><div className="px-4 py-4 pb-28 max-w-4xl mx-auto space-y-5">{q.data?.stats&&<div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Mini label="총 GOLD" value={formatNumber(q.data.stats.total_gold)}/><Mini label="총 BV" value={formatNumber(q.data.stats.total_bv)}/><Mini label="Gini GOLD" value={Number(q.data.stats.gini_gold).toFixed(3)}/><Mini label="스냅샷 거래" value={formatNumber(q.data.stats.transactions_count)}/></div>}<section><h2 className="font-display text-lg text-brand-gradient mb-2">🏆 명예의 전당</h2>{!q.data?.hall.length?<EmptyState emoji="🏛️" title="아직 전시된 기록이 없어요" description="교사가 시즌·MVP·특별 기록을 추가하면 여기에 전시됩니다."/>:<div className="grid sm:grid-cols-2 gap-2">{q.data.hall.map((x:any)=><div key={x.id} className="bg-bg-card border border-gold/25 rounded-card-md p-3"><div className="text-2xs text-gold font-black">{x.category}{x.period_label?` · ${x.period_label}`:''}</div><div className="text-sm font-extrabold mt-1">{x.title}</div>{x.subtitle&&<div className="text-xs text-text-secondary mt-1">{x.subtitle}</div>}<div className="text-2xs text-text-muted mt-2">{x.student?.brand_name||x.student?.name||''}{x.rank_position?` · ${x.rank_position}위`:''}</div></div>)}</div>}</section><section><h2 className="font-display text-lg text-brand-gradient mb-2">📊 최신 공식 랭킹 {q.data?.date&&<span className="text-xs text-text-muted">({q.data.date})</span>}</h2>{grouped.size===0?<EmptyState emoji="📊" title="아직 공식 랭킹 스냅샷이 없어요" description="선생님이 기록 갱신을 실행하면 생성됩니다."/>:<div className="grid md:grid-cols-2 gap-3">{Array.from(grouped.entries()).map(([type,rows])=><div key={type} className="bg-bg-card border border-line rounded-card-md p-3"><div className="text-xs font-black text-bv mb-2">{RANK_LABEL[type]||type}</div>{rows.slice(0,5).map((r:any)=><div key={`${type}-${r.student_id}`} className="flex justify-between text-xs py-1"><span className={r.student_id===studentId?'text-gold font-black':'text-text-secondary'}>{r.rank_position}. {r.student?.brand_name||r.student?.name}</span><span className="font-mono">{formatNumber(r.value)}</span></div>)}</div>)}</div>}</section></div></>;
}
function Mini({label,value}:{label:string;value:string}){return <div className="bg-bg-card border border-line rounded-card-md p-3"><div className="text-2xs text-text-muted font-bold">{label}</div><div className="font-display text-lg text-gold mt-1">{value}</div></div>}
