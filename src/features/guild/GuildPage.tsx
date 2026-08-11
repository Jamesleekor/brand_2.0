import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, LoadingSpinner, EmptyState } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatNumber, getKstDateString } from '@/lib/utils/format';

const ELEMENTS: Record<string,{label:string;emoji:string}> = {
  EARTH:{label:'땅',emoji:'🌍'}, WATER:{label:'물',emoji:'💧'}, LIGHT:{label:'빛',emoji:'✨'}, WIND:{label:'바람',emoji:'🌬️'}, FIRE:{label:'불',emoji:'🔥'}, DARK:{label:'어둠',emoji:'🌑'},
  '땅':{label:'땅',emoji:'🌍'}, '물':{label:'물',emoji:'💧'}, '빛':{label:'빛',emoji:'✨'}, '바람':{label:'바람',emoji:'🌬️'}, '불':{label:'불',emoji:'🔥'}, '어둠':{label:'어둠',emoji:'🌑'},
};
const elementMeta=(value:unknown)=>ELEMENTS[String(value??'')]??{label:'속성 미지정',emoji:'⚔️'};
const SESSION_LABEL: Record<string,string> = { UNMARKED:'미기록', PRESENT:'참석', ABSENT:'불참', EXCUSED:'인정불참' };

export default function GuildPage(){
  const studentId=useStudentId();
  const classroomId=useClassroomId();
  const qc=useQueryClient();
  const q=useGuildFoundation(studentId,classroomId);

  useEffect(()=>{
    if(!studentId||!classroomId)return;
    const invalidate=()=>void qc.invalidateQueries({queryKey:['guild1-student',studentId,classroomId]});
    // 한 테이블의 Realtime 오류가 다른 구독까지 끊지 않도록 채널을 분리한다.
    const channels=[
      supabase.channel(`guild1:guilds:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guilds'},invalidate).subscribe(),
      supabase.channel(`guild1:members:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_members'},invalidate).subscribe(),
      supabase.channel(`guild1:seasons:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_seasons'},invalidate).subscribe(),
      supabase.channel(`guild1:member-events:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_membership_events',filter:`student_id=eq.${studentId}`},invalidate).subscribe(),
      supabase.channel(`guild1:sessions:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_sessions'},invalidate).subscribe(),
      supabase.channel(`guild1:session-participants:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_session_participants',filter:`student_id=eq.${studentId}`},invalidate).subscribe(),
      supabase.channel(`guild1:gs:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_gs'},invalidate).subscribe(),
    ];
    return()=>{channels.forEach(c=>void supabase.removeChannel(c));};
  },[studentId,classroomId,qc]);

  if(q.isLoading)return <><PageHeader title="길드" emoji="⚔️"/><div className="py-12 flex justify-center"><LoadingSpinner size="lg"/></div></>;
  if(q.isError)return <><PageHeader title="길드" emoji="⚔️"/><div className="m-4 glass-card border-danger/40 p-4"><div className="font-black text-danger">길드 정보를 불러오지 못했습니다.</div><div className="text-xs text-text-secondary mt-2 break-all">{q.error instanceof Error?q.error.message:String(q.error)}</div><button className="btn-secondary mt-3" onClick={()=>void q.refetch()}>다시 시도</button></div></>;
  if(!q.data?.guild)return <><PageHeader title="길드" emoji="⚔️"/><div className="px-4 pt-4"><EmptyState emoji="⚔️" title="아직 길드에 속하지 않았어요" description="운영자가 길드를 배정하면 이곳에서 길드의 기록을 확인할 수 있습니다."/></div></>;

  const d=q.data;
  return <><PageHeader title="길드" emoji="⚔️"/><div className="px-4 pt-4 pb-28 space-y-4">
    <GuildHeader data={d}/>
    <div className="grid grid-cols-4 gap-1.5 bg-bg-card border border-line rounded-card-md p-1.5">{['점령','미션','길드점수','동료평가'].map((x,i)=><div key={x} className={`text-center rounded-card-sm px-1 py-2 text-xs font-black ${i===0?'bg-bg-deep text-text-primary':'text-text-secondary'}`}>{x}<div className="text-[9px] font-bold text-text-muted mt-0.5">{i===0?'기반 구축':'준비 중'}</div></div>)}</div>
    <MembersCard data={d}/><SessionSummary data={d}/><MembershipHistory data={d}/>
    <div className="glass-card p-4 border-brand-primary/20"><div className="font-black text-white text-sm">🧭 Guild 1.1 기반 구축 중</div><p className="text-xs text-text-secondary mt-1 leading-relaxed">현재는 소속·시즌·길드 세션 이력을 먼저 안정화했습니다. GS 새 산식, 미션, 동료평가, 영토 점령은 Guild 2~5에서 순차적으로 연결됩니다.</p></div>
  </div></>;
}

function useGuildFoundation(studentId:number|null,classroomId:number|null){
  return useQuery({queryKey:['guild1-student',studentId,classroomId],enabled:!!studentId&&!!classroomId,queryFn:async()=>{
    const currentMonth=getKstDateString().slice(0,7);
    const membershipRes=await supabase.from('guild_members').select('id,guild_id,student_id,element,joined_at,left_at').eq('student_id',studentId!).is('left_at',null).maybeSingle();
    if(membershipRes.error)throw new Error(`[Guild1:membership] ${membershipRes.error.message}`);
    if(!membershipRes.data)return {guild:null};
    const m:any=membershipRes.data,guildId=Number(m.guild_id);
    const [guildRes,membersRes,seasonsRes,gsRes,allGsRes,eventsRes,sessionsRes]=await Promise.all([
      supabase.from('guilds').select('id,name,slogan,logo_url,description,is_active').eq('id',guildId).single(),
      supabase.from('guild_members').select('student_id,element,joined_at,student:students!student_id(name,brand_name)').eq('guild_id',guildId).is('left_at',null).order('joined_at',{ascending:true}),
      supabase.from('guild_seasons').select('id,display_name,school_year,starts_on,ends_on,lifecycle_status').eq('classroom_id',classroomId!).eq('lifecycle_status','ACTIVE').order('starts_on',{ascending:false}).limit(1),
      supabase.from('guild_gs').select('year_month,monthly_gs_total,monthly_rank').eq('guild_id',guildId).order('year_month',{ascending:true}),
      supabase.from('guild_gs').select('guild_id,monthly_gs_total,monthly_rank').eq('year_month',currentMonth).order('monthly_rank',{ascending:true}),
      supabase.from('guild_membership_events').select('id,from_guild_id,to_guild_id,from_guild_name,to_guild_name,event_type,element_before,element_after,reason,effective_at').eq('student_id',studentId!).order('effective_at',{ascending:false}).limit(20),
      supabase.from('guild_session_participants').select('id,attendance_status,note,recorded_at,guild_id_at_session,student_name_at_session,brand_name_at_session,guild_name_at_session,element_at_session,session:guild_sessions!session_id(id,title,session_date,status)').eq('student_id',studentId!).order('id',{ascending:false}).limit(12),
    ]);
    for(const [name,res] of Object.entries({guild:guildRes,members:membersRes,seasons:seasonsRes,gs:gsRes,allGs:allGsRes,events:eventsRes,sessions:sessionsRes}))if(res.error)throw new Error(`[Guild1:${name}] ${res.error.message}`);
    const guild:any=guildRes.data;
    const activeSeason:any=(seasonsRes.data??[])[0]??null;
    const monthRow:any=(gsRes.data??[]).find((x:any)=>x.year_month===currentMonth);
    const startMonth=activeSeason?.starts_on?.slice(0,7),endMonth=activeSeason?.ends_on?.slice(0,7);
    const seasonGs=(gsRes.data??[]).filter((x:any)=>(!startMonth||x.year_month>=startMonth)&&(!endMonth||x.year_month<=endMonth)).reduce((sum:number,x:any)=>sum+Number(x.monthly_gs_total??0),0);
    const allGuilds=allGsRes.data??[];
    let rank=Number(monthRow?.monthly_rank??0);
    if(!rank){const sorted=[...allGuilds].sort((a:any,b:any)=>Number(b.monthly_gs_total??0)-Number(a.monthly_gs_total??0));rank=sorted.findIndex((x:any)=>Number(x.guild_id)===guildId)+1;}
    const guildIds=new Set<number>();(eventsRes.data??[]).forEach((e:any)=>{if(e.from_guild_id)guildIds.add(Number(e.from_guild_id));if(e.to_guild_id)guildIds.add(Number(e.to_guild_id));});guildIds.add(guildId);
    const namesRes=await supabase.from('guilds').select('id,name').in('id',Array.from(guildIds));
    if(namesRes.error)throw new Error(`[Guild1:guild-history-names] ${namesRes.error.message}`);
    const guildNames=new Map<number,string>((namesRes.data??[]).map((g:any)=>[Number(g.id),g.name]));
    return {guild:{...guild,my_element:m.element,joined_at:m.joined_at},activeSeason,currentMonth,monthlyGs:Number(monthRow?.monthly_gs_total??0),seasonGs,monthlyRank:rank||0,totalGuilds:allGuilds.length,members:membersRes.data??[],events:eventsRes.data??[],sessions:sessionsRes.data??[],guildNames};
  }});
}

function GuildHeader({data}:{data:any}){
  const g=data.guild,meta=elementMeta(g.my_element);
  return <section className="relative overflow-hidden glass-card p-5"><div className="absolute inset-0 bg-gradient-to-br from-brand-primary/15 via-transparent to-gold/10 pointer-events-none"/><div className="relative flex gap-4 items-start"><div className="w-16 h-16 rounded-card-lg overflow-hidden bg-bg-deep border border-line-brand flex items-center justify-center text-3xl flex-shrink-0">{g.logo_url?<img src={g.logo_url} alt="길드 문장" className="w-full h-full object-cover"/>:'⚔️'}</div><div className="flex-1 min-w-0"><div className="text-xs text-text-secondary font-black">{data.activeSeason?.display_name||'활성 시즌 미설정'}</div><h2 className="font-display text-2xl text-white mt-0.5 truncate">{g.name}</h2><p className="text-sm text-text-secondary mt-1">{g.slogan||g.description||'우리 길드'}</p><div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-pill bg-bg-deep border border-line text-xs font-black text-bv"><span>{meta.emoji}</span><span>내 담당 속성 · {meta.label}</span></div></div></div><div className="relative grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4"><ScoreBox label={`${Number(data.currentMonth.slice(5))}월 GS`} value={formatNumber(data.monthlyGs)} sub={data.monthlyRank?`${data.monthlyRank}위 / ${data.totalGuilds||'-'}`:'순위 집계 전'}/><ScoreBox label="시즌 누적 GS" value={formatNumber(data.seasonGs)} sub={data.activeSeason?.display_name||'시즌 미설정'}/><ScoreBox label="길드원" value={`${data.members.length}명`} sub="현재 활성 소속 기준"/><ScoreBox label="개인 기여도" value="개편 예정" sub="Guild 2 새 산식 적용" small/></div></section>;
}
function ScoreBox({label,value,sub,small}:{label:string;value:string;sub:string;small?:boolean}){return <div className="bg-bg-deep/70 border border-line rounded-card-md p-4"><div className="text-xs text-text-secondary font-black">{label}</div><div className={`${small?'text-xl font-black':'font-display text-2xl'} text-gold mt-1.5 leading-tight`}>{value}</div><div className="text-xs text-text-secondary mt-1.5">{sub}</div></div>}

function MembersCard({data}:{data:any}){
  return <section className="glass-card p-4"><div className="flex justify-between items-center mb-3"><h3 className="font-display text-lg">👥 현재 길드원</h3><span className="text-xs text-text-secondary">각 모험가의 담당 속성</span></div><div className="grid sm:grid-cols-2 gap-2">{data.members.map((m:any)=>{const s=Array.isArray(m.student)?m.student[0]:m.student;const meta=elementMeta(m.element);return <div key={m.student_id} className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-white">{s?.brand_name||s?.name||`모험가 #${m.student_id}`}</div><div className="text-xs text-text-secondary mt-1">{s?.brand_name&&s?.name?`${s.name} · `:''}<span className="font-black text-bv">{meta.emoji} {meta.label}</span> 담당</div></div>})}</div></section>;
}

function SessionSummary({data}:{data:any}){const completed=data.sessions.filter((r:any)=>r.attendance_status!=='UNMARKED'),credited=completed.filter((r:any)=>r.attendance_status==='PRESENT'||r.attendance_status==='EXCUSED').length;return <section className="glass-card p-4"><div className="flex justify-between items-center mb-3"><div><h3 className="font-display text-lg">📍 길드 세션 참석</h3><p className="text-xs text-text-secondary mt-1">학교 출석과 별도로, 세션 당시 구성원 snapshot을 기준으로 기록됩니다. 인정불참은 기여도 계산에서 참석으로 인정됩니다.</p></div>{completed.length>0&&<div className="text-right"><div className="font-display text-xl text-bv">{credited}/{completed.length}</div><div className="text-[10px] text-text-secondary">참석 인정 / 기록 세션</div></div>}</div>{!data.sessions.length?<p className="text-sm text-text-secondary">아직 Guild 1에서 생성된 길드 세션 기록이 없습니다.</p>:<div className="space-y-2">{data.sessions.slice(0,6).map((r:any)=>{const s=Array.isArray(r.session)?r.session[0]:r.session;const meta=elementMeta(r.element_at_session);return <div key={r.id} className="bg-bg-deep border border-line rounded-card-md p-3 flex items-center justify-between gap-3"><div className="min-w-0"><div className="font-black text-white truncate">{s?.title||'길드 세션'}</div><div className="text-xs text-text-secondary mt-1">{s?.session_date||''} · {r.guild_name_at_session||'당시 길드'} · {meta.emoji} {meta.label}{r.note?` · ${r.note}`:''}</div></div><span className={`text-xs font-black px-2.5 py-1 rounded-pill ${r.attendance_status==='PRESENT'?'bg-success/15 text-success':r.attendance_status==='ABSENT'?'bg-danger/15 text-danger':r.attendance_status==='EXCUSED'?'bg-warning/15 text-warning':'bg-bg-card text-text-secondary'}`}>{SESSION_LABEL[r.attendance_status]||r.attendance_status}</span></div>})}</div>}</section>}

function MembershipHistory({data}:{data:any}){const events=data.events??[];return <section className="glass-card p-4"><h3 className="font-display text-lg mb-1">🕰️ 나의 길드 소속 이력</h3><p className="text-xs text-text-secondary mb-3">새로 전입하거나 길드를 이동해도 과거 활동의 소속은 이 기록을 기준으로 보존됩니다.</p>{!events.length?<div className="bg-bg-deep border border-line rounded-card-md p-3 text-sm text-text-secondary">Guild 1.1 적용 후 소속 변경 기록이 여기에 추가됩니다. 현재 소속 시작: {data.guild.joined_at?new Date(data.guild.joined_at).toLocaleDateString('ko-KR'):'-'}</div>:<div className="space-y-2">{events.map((e:any)=><div key={e.id} className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-white text-sm">{e.event_type==='MOVE'?`${e.from_guild_name||data.guildNames.get(Number(e.from_guild_id))||'이전 길드'} → ${e.to_guild_name||data.guildNames.get(Number(e.to_guild_id))||'새 길드'}`:e.event_type==='ASSIGN'?`${e.to_guild_name||data.guildNames.get(Number(e.to_guild_id))||'길드'} 배정`:e.event_type==='ELEMENT_CHANGE'?`담당 속성 ${elementMeta(e.element_before).emoji} ${elementMeta(e.element_before).label} → ${elementMeta(e.element_after).emoji} ${elementMeta(e.element_after).label}`:`${e.from_guild_name||data.guildNames.get(Number(e.from_guild_id))||'길드'} 소속 종료`}</div><div className="text-xs text-text-secondary mt-1">{e.reason} · {new Date(e.effective_at).toLocaleString('ko-KR')}</div></div>)}</div>}</section>}
