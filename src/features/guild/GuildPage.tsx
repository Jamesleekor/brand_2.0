import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, LoadingSpinner, EmptyState } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatNumber, getKstDateString } from '@/lib/utils/format';
import { guild5RpcError, guild5StudentRpc } from '@/lib/rpc/guild5_rpc';

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
  const contributionQ=useGuild2StudentContribution(studentId,classroomId);
  const finalHistoryQ=useGuild5StudentHistory(!!studentId&&!!classroomId);
  const currentFinal=(finalHistoryQ.data??[]).find((row:any)=>row.year_month===q.data?.currentMonth)??null;

  useEffect(()=>{
    if(!studentId||!classroomId)return;
    const invalidateGuild1=()=>void qc.invalidateQueries({queryKey:['guild1-student',studentId,classroomId]});
    const invalidateGuild2=()=>void qc.invalidateQueries({queryKey:['guild2-student',studentId,classroomId]});
    // 한 테이블의 Realtime 오류가 다른 구독까지 끊지 않도록 채널을 분리한다.
    const channels=[
      supabase.channel(`guild1:guilds:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guilds'},invalidateGuild1).subscribe(),
      supabase.channel(`guild1:members:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_members'},invalidateGuild1).subscribe(),
      supabase.channel(`guild1:seasons:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_seasons'},invalidateGuild1).subscribe(),
      supabase.channel(`guild1:member-events:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_membership_events',filter:`student_id=eq.${studentId}`},invalidateGuild1).subscribe(),
      supabase.channel(`guild1:sessions:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_sessions'},invalidateGuild1).subscribe(),
      supabase.channel(`guild1:session-participants:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild_session_participants',filter:`student_id=eq.${studentId}`},invalidateGuild1).subscribe(),
      supabase.channel(`guild2:contribution:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild2_individual_contributions',filter:`student_id=eq.${studentId}`},invalidateGuild2).subscribe(),
      supabase.channel(`guild2:observations:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild2_observation_events',filter:`student_id=eq.${studentId}`},invalidateGuild2).subscribe(),
      supabase.channel(`guild2:summaries:${studentId}`).on('postgres_changes',{event:'*',schema:'public',table:'guild2_monthly_gs_summaries'},invalidateGuild2).subscribe(),
    ];
    return()=>{channels.forEach(c=>void supabase.removeChannel(c));};
  },[studentId,classroomId,qc]);

  if(q.isLoading)return <><PageHeader title="길드" emoji="⚔️"/><div className="py-12 flex justify-center"><LoadingSpinner size="lg"/></div></>;
  if(q.isError)return <><PageHeader title="길드" emoji="⚔️"/><div className="m-4 glass-card border-danger/40 p-4"><div className="font-black text-danger">길드 정보를 불러오지 못했습니다.</div><div className="text-xs text-text-secondary mt-2 break-all">{q.error instanceof Error?q.error.message:String(q.error)}</div><button className="btn-secondary mt-3" onClick={()=>void q.refetch()}>다시 시도</button></div></>;
  if(!q.data?.guild)return <><PageHeader title="길드" emoji="⚔️"/><div className="px-4 pt-4"><EmptyState emoji="⚔️" title="아직 길드에 속하지 않았어요" description="운영자가 길드를 배정하면 이곳에서 길드의 기록을 확인할 수 있습니다."/></div></>;

  const d=q.data;
  return <><PageHeader title="길드" emoji="⚔️"/><div className="px-4 pt-4 pb-28 space-y-4">
    <GuildHeader data={d} contribution={contributionQ.data} finalRow={currentFinal}/>
    <div className="grid grid-cols-5 gap-1.5 bg-bg-card border border-line rounded-card-md p-1.5">
      <Link to="/guild/conquest" className="text-center rounded-card-sm px-1 py-2 text-xs font-black text-bv hover:bg-bv/10">점령<div className="text-[9px] font-bold text-bv/80 mt-0.5">월드맵</div></Link>
      <Link to="/guild/missions" className="text-center rounded-card-sm px-1 py-2 text-xs font-black text-bv hover:bg-bv/10">미션<div className="text-[9px] font-bold text-bv/80 mt-0.5">열기</div></Link>
      <Link to="/guild/scores" className="text-center rounded-card-sm px-1 py-2 text-xs font-black text-bv hover:bg-bv/10">길드점수<div className={`text-[9px] font-bold mt-0.5 ${currentFinal?'text-gold':'text-text-muted'}`}>{currentFinal?'FINAL':'DRAFT'}</div></Link>
      <Link to="/guild/peer-review" className="text-center rounded-card-sm px-1 py-2 text-xs font-black text-bv hover:bg-bv/10">동료평가<div className="text-[9px] font-bold text-bv/80 mt-0.5">열기</div></Link>
      <Link to="/guild/monthly" className={`text-center rounded-card-sm px-1 py-2 text-xs font-black hover:bg-gold/10 ${currentFinal ? 'text-gold' : 'text-text-secondary'}`}>월간결산<div className={`text-[9px] font-bold mt-0.5 ${currentFinal ? 'text-gold/80' : 'text-text-muted'}`}>{currentFinal ? 'FINAL' : '마감 전'}</div></Link>
    </div>
    <ContributionCard data={contributionQ.data} isLoading={contributionQ.isLoading} error={contributionQ.error} finalRow={currentFinal}/>
    <MembersCard data={d}/><SessionSummary data={d}/><MembershipHistory data={d}/>
    <div className="glass-card border-brand-primary/20 p-4"><div className="font-black text-sm text-white">🕹️ Arcade 월간 연결</div><p className="mt-1 text-xs leading-relaxed text-text-secondary">게임별 월간 Top 10을 확정하면 원본 보너스가 개인 기여도에 연결됩니다. 원본 합계는 보존하고, Guild 2 반영값은 최대 +90점입니다.</p><Link to="/arcade" className="btn-secondary mt-3 inline-flex text-xs">아케이드로 가기</Link></div>
  </div></>;
}

function useGuildFoundation(studentId:number|null,classroomId:number|null){
  return useQuery({queryKey:['guild1-student',studentId,classroomId],enabled:!!studentId&&!!classroomId,queryFn:async()=>{
    const currentMonth=getKstDateString().slice(0,7);
    const membershipRes=await supabase.from('guild_members').select('id,guild_id,student_id,element,joined_at,left_at').eq('student_id',studentId!).is('left_at',null).maybeSingle();
    if(membershipRes.error)throw new Error(`[Guild1:membership] ${membershipRes.error.message}`);
    if(!membershipRes.data)return {guild:null};
    const m:any=membershipRes.data,guildId=Number(m.guild_id);
    const [guildRes,membersRes,seasonsRes,eventsRes,sessionsRes]=await Promise.all([
      supabase.from('guilds').select('id,name,slogan,logo_url,description,is_active').eq('id',guildId).single(),
      supabase.from('guild_members').select('student_id,element,joined_at,student:students!student_id(name,brand_name)').eq('guild_id',guildId).is('left_at',null).order('joined_at',{ascending:true}),
      supabase.from('guild_seasons').select('id,display_name,school_year,starts_on,ends_on,lifecycle_status').eq('classroom_id',classroomId!).eq('lifecycle_status','ACTIVE').order('starts_on',{ascending:false}).limit(1),
      supabase.from('guild_membership_events').select('id,from_guild_id,to_guild_id,from_guild_name,to_guild_name,event_type,element_before,element_after,reason,effective_at').eq('student_id',studentId!).order('effective_at',{ascending:false}).limit(20),
      supabase.from('guild_session_participants').select('id,attendance_status,note,recorded_at,guild_id_at_session,student_name_at_session,brand_name_at_session,guild_name_at_session,element_at_session,session:guild_sessions!session_id(id,title,session_date,status)').eq('student_id',studentId!).order('id',{ascending:false}).limit(12),
    ]);
    for(const [name,res] of Object.entries({guild:guildRes,members:membersRes,seasons:seasonsRes,events:eventsRes,sessions:sessionsRes}))if(res.error)throw new Error(`[Guild1:${name}] ${res.error.message}`);
    const guild:any=guildRes.data;
    const activeSeason:any=(seasonsRes.data??[])[0]??null;
    const guildIds=new Set<number>();(eventsRes.data??[]).forEach((e:any)=>{if(e.from_guild_id)guildIds.add(Number(e.from_guild_id));if(e.to_guild_id)guildIds.add(Number(e.to_guild_id));});guildIds.add(guildId);
    const namesRes=await supabase.from('guilds').select('id,name').in('id',Array.from(guildIds));
    if(namesRes.error)throw new Error(`[Guild1:guild-history-names] ${namesRes.error.message}`);
    const guildNames=new Map<number,string>((namesRes.data??[]).map((g:any)=>[Number(g.id),g.name]));
    return {guild:{...guild,my_element:m.element,joined_at:m.joined_at},activeSeason,currentMonth,members:membersRes.data??[],events:eventsRes.data??[],sessions:sessionsRes.data??[],guildNames};
  }});
}

function GuildHeader({data,contribution,finalRow}:{data:any;contribution:any;finalRow:any}){
  const g=data.guild,meta=elementMeta(g.my_element),summary=contribution?.summary,row=contribution?.contribution;
  const finalGuild=finalRow?.my_guild,finalMe=finalRow?.my_contribution;
  return <section className="relative overflow-hidden glass-card p-5"><div className="absolute inset-0 bg-gradient-to-br from-brand-primary/15 via-transparent to-gold/10 pointer-events-none"/><div className="relative flex gap-4 items-start"><div className="w-16 h-16 rounded-card-lg overflow-hidden bg-bg-deep border border-line-brand flex items-center justify-center text-3xl flex-shrink-0">{g.logo_url?<img src={g.logo_url} alt="길드 문장" className="w-full h-full object-cover"/>:'⚔️'}</div><div className="flex-1 min-w-0"><div className="text-xs text-text-secondary font-black">{data.activeSeason?.display_name||'활성 시즌 미설정'}</div><h2 className="font-display text-2xl text-white mt-0.5 truncate">{g.name}</h2><p className="text-sm text-text-secondary mt-1">{g.slogan||g.description||'우리 길드'}</p><div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-pill bg-bg-deep border border-line text-xs font-black text-bv"><span>{meta.emoji}</span><span>내 담당 속성 · {meta.label}</span></div></div></div><div className="relative grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4"><ScoreBox label={`${Number(data.currentMonth.slice(5))}월 길드 GS`} value={finalGuild?formatNumber(Number(finalGuild.total_gs)):summary?formatNumber(Number(summary.draft_gs_total)):'집계 전'} sub={finalGuild?`최종 ${finalGuild.rank_position??'-'}위 · FINAL v${finalRow.version_no}`:summary?.draft_rank?`초안 ${summary.draft_rank}위`:'Guild 2A 초안'}/><ScoreBox label="길드 GS 확정" value={finalGuild?'확정':'준비 중'} sub={finalGuild?`${new Date(finalRow.finalized_at).toLocaleDateString('ko-KR')} 월 마감 완료`:'Guild 5 월 마감에서 확정'} small/><ScoreBox label="길드원" value={`${data.members.length}명`} sub="현재 활성 소속 기준"/><ScoreBox label="개인 기여도" value={finalMe?`${formatNumber(Number(finalMe.final_contribution))}점`:row?`${formatNumber(Number(row.final_total))}점`:'집계 대기'} sub={finalMe?`FINAL · 기본 ${formatNumber(Number(finalMe.basic_total))} / 900`:row?`기본 ${formatNumber(Number(row.basic_total))} / 900`:'Guild 2 계산 후 표시'} small/></div></section>;
}
function ScoreBox({label,value,sub,small}:{label:string;value:string;sub:string;small?:boolean}){return <div className="bg-bg-deep/70 border border-line rounded-card-md p-4"><div className="text-xs text-text-secondary font-black">{label}</div><div className={`${small?'text-xl font-black':'font-display text-2xl'} text-gold mt-1.5 leading-tight`}>{value}</div><div className="text-xs text-text-secondary mt-1.5">{sub}</div></div>}


function useGuild5StudentHistory(enabled:boolean){
  return useQuery({queryKey:['guild5-student-history'],enabled,queryFn:async()=>{
    const r=await guild5StudentRpc.history(supabase);
    if(!r.success)throw new Error(guild5RpcError(r));
    return r.data;
  }});
}

function useGuild2StudentContribution(studentId:number|null,classroomId:number|null){
  return useQuery({queryKey:['guild2-student',studentId,classroomId],enabled:!!studentId&&!!classroomId,queryFn:async()=>{
    const yearMonth=getKstDateString().slice(0,7);
    const contributionRes=await supabase.from('guild2_individual_contributions').select('*').eq('classroom_id',classroomId!).eq('student_id',studentId!).eq('year_month',yearMonth).maybeSingle();
    if(contributionRes.error)throw new Error(`[Guild2:contribution] ${contributionRes.error.message}`);
    const contribution:any=contributionRes.data;
    const [summaryRes,observationsRes]=await Promise.all([
      contribution?.scoring_guild_id?supabase.from('guild2_monthly_gs_summaries').select('*').eq('classroom_id',classroomId!).eq('year_month',yearMonth).eq('guild_id',contribution.scoring_guild_id).maybeSingle():Promise.resolve({data:null,error:null}),
      supabase.from('guild2_observation_events').select('id,category,reason,occurred_on,created_at').eq('student_id',studentId!).eq('year_month',yearMonth).eq('event_kind','RECOGNITION').eq('is_public',true).order('created_at',{ascending:false}),
    ]);
    if(summaryRes.error)throw new Error(`[Guild2:summary] ${summaryRes.error.message}`);
    if(observationsRes.error)throw new Error(`[Guild2:observations] ${observationsRes.error.message}`);
    return {yearMonth,contribution,summary:summaryRes.data,publicObservations:observationsRes.data??[]};
  }});
}

const CONTRIBUTION_STATUS:Record<string,string>={READY:'집계됨',PENDING:'기록 대기',NOT_READY:'연결 전'};
const OBSERVATION_CATEGORY:Record<string,string>={COOPERATION:'협력',LEADERSHIP:'리더십',RESPONSIBILITY:'책임',SUPPORT:'지원',PROBLEM_SOLVING:'문제해결',OTHER:'기타'};
function ContributionCard({data,isLoading,error,finalRow}:{data:any;isLoading:boolean;error:unknown;finalRow:any}){
  if(isLoading)return <section className="glass-card p-4"><div className="font-display text-lg">✨ 이달의 개인 기여도</div><div className="mt-4 flex justify-center"><LoadingSpinner/></div></section>;
  if(error)return <section className="glass-card p-4 border-warning/40"><div className="font-black text-warning">개인 기여도를 아직 불러오지 못했어요.</div><p className="mt-1 text-xs text-text-secondary">점수 기능을 막 적용한 뒤라면 교사가 ‘점수 다시 계산’을 누르면 표시됩니다.</p></section>;
  const row=data?.contribution;
  const finalMe=finalRow?.my_contribution;
  if(!row&&!finalMe)return <section className="glass-card p-4 border-brand-primary/20"><div className="font-display text-lg">✨ 이달의 개인 기여도</div><p className="mt-2 text-sm text-text-secondary">아직 이번 달 점수 초안이 만들어지지 않았어요. 길드 운영자가 점수를 계산하면 여기에서 확인할 수 있습니다.</p></section>;
  const displayRow=finalMe??row;
  const categories=Object.entries(row?.calculation_metadata?.observation_category_counts??{}) as [string,unknown][];
  const observationPoints=finalMe?Number(finalMe.observation_points):Number(row.teacher_observation_points);
  const finalTotal=finalMe?Number(finalMe.final_contribution):Number(row.final_total);
  const card=(label:string,value:number,max:number,status:string,description:string)=><div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs font-black text-text-secondary">{label}</div><div className="mt-1 font-display text-xl text-gold">{formatNumber(value)} <span className="text-xs">/ {max}</span></div><div className={`mt-1 text-[10px] font-black ${status==='READY'?'text-success':status==='OVERRIDDEN'||status==='PENDING'?'text-warning':'text-text-muted'}`}>{status==='OVERRIDDEN'?'Override 확정':CONTRIBUTION_STATUS[status]||status}</div><p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{description}</p></div>;
  return <section className={`glass-card p-4 ${finalMe?'border-gold/30':''}`}><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-display text-lg">✨ {(finalRow?.year_month??data?.yearMonth??'').slice(5)}월 개인 기여도 {finalMe&&<span className="text-xs text-gold">FINAL</span>}</h3><p className="mt-1 text-xs text-text-secondary">{finalMe?'Guild5 월 마감 snapshot으로 확정된 점수입니다.':'월 마감 전의 초안입니다. 최종 확정은 Guild 5에서 진행됩니다.'}</p></div><div className="text-right"><div className="font-display text-2xl text-gold">{formatNumber(finalTotal)}점</div><div className="text-xs text-text-secondary">기본 {formatNumber(Number(displayRow.basic_total))} / 900 · 아케이드 +{formatNumber(Number(displayRow.arcade_applied))} / 90</div></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{card('동료평가',Number(displayRow.peer_points),300,displayRow.peer_status,'길드원들의 평가를 종합·보정하여 반영합니다.')}{card('미션 기여',Number(displayRow.mission_points),300,displayRow.mission_status,'활동 기록과 교사 등급을 반영합니다.')}{card('길드 세션',Number(displayRow.session_points),150,displayRow.session_status,finalMe?'마감 시점의 확정 점수입니다.':`일반 불참 ${Number(row.session_absent_count)}회 × -30${Number(row.session_unmarked_count)>0?` · 미기록 ${Number(row.session_unmarked_count)}명`:''}`)}{card('길드 기여 기록',observationPoints,150,finalMe?displayRow.observation_status:displayRow.teacher_observation_status,finalMe?'마감 시점의 확정 점수입니다.':`인정된 행동 ${Number(row.observation_count)}건 · 1건 +10점`)}{card('아케이드 보너스',Number(displayRow.arcade_applied),90,displayRow.arcade_status,`게임별 원점수 ${formatNumber(Number(displayRow.arcade_raw_total))}점은 최대 +90점까지만 반영됩니다.`)}</div>{row&&<div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs font-black text-text-secondary">기여 기록 분포</div>{categories.length?<div className="mt-2 flex flex-wrap gap-1.5">{categories.map(([category,count])=><span key={category} className="rounded-pill border border-line bg-bg-card px-2 py-1 text-xs text-text-secondary">{OBSERVATION_CATEGORY[category]||category} ×{String(count)}</span>)}</div>:<p className="mt-2 text-xs text-text-secondary">아직 인정된 기여 기록이 없습니다.</p>}</div><div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs font-black text-text-secondary">학생에게 공개된 기여 메모</div>{!data.publicObservations.length?<p className="mt-2 text-xs text-text-secondary">공개된 메모가 없습니다. 비공개 메모는 교사만 볼 수 있습니다.</p>:<div className="mt-2 space-y-1.5">{data.publicObservations.map((event:any)=><div key={event.id} className="text-xs text-text-secondary"><b className="text-white">{OBSERVATION_CATEGORY[event.category]||event.category}</b> · {event.reason}</div>)}</div>}</div></div>}</section>;
}

function MembersCard({data}:{data:any}){
  return <section className="glass-card p-4"><div className="flex justify-between items-center mb-3"><h3 className="font-display text-lg">👥 현재 길드원</h3><span className="text-xs text-text-secondary">각 모험가의 담당 속성</span></div><div className="grid sm:grid-cols-2 gap-2">{data.members.map((m:any)=>{const s=Array.isArray(m.student)?m.student[0]:m.student;const meta=elementMeta(m.element);return <div key={m.student_id} className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-white">{s?.brand_name||s?.name||`모험가 #${m.student_id}`}</div><div className="text-xs text-text-secondary mt-1">{s?.brand_name&&s?.name?`${s.name} · `:''}<span className="font-black text-bv">{meta.emoji} {meta.label}</span> 담당</div></div>})}</div></section>;
}

function SessionSummary({data}:{data:any}){const completed=data.sessions.filter((r:any)=>r.attendance_status!=='UNMARKED'),credited=completed.filter((r:any)=>r.attendance_status==='PRESENT'||r.attendance_status==='EXCUSED').length;return <section className="glass-card p-4"><div className="flex justify-between items-center mb-3"><div><h3 className="font-display text-lg">📍 길드 세션 참석</h3><p className="text-xs text-text-secondary mt-1">학교 출석과 별도로, 세션 당시 구성원 snapshot을 기준으로 기록됩니다. 인정불참은 기여도 계산에서 참석으로 인정됩니다.</p></div>{completed.length>0&&<div className="text-right"><div className="font-display text-xl text-bv">{credited}/{completed.length}</div><div className="text-[10px] text-text-secondary">참석 인정 / 기록 세션</div></div>}</div>{!data.sessions.length?<p className="text-sm text-text-secondary">아직 Guild 1에서 생성된 길드 세션 기록이 없습니다.</p>:<div className="space-y-2">{data.sessions.slice(0,6).map((r:any)=>{const s=Array.isArray(r.session)?r.session[0]:r.session;const meta=elementMeta(r.element_at_session);return <div key={r.id} className="bg-bg-deep border border-line rounded-card-md p-3 flex items-center justify-between gap-3"><div className="min-w-0"><div className="font-black text-white truncate">{s?.title||'길드 세션'}</div><div className="text-xs text-text-secondary mt-1">{s?.session_date||''} · {r.guild_name_at_session||'당시 길드'} · {meta.emoji} {meta.label}{r.note?` · ${r.note}`:''}</div></div><span className={`text-xs font-black px-2.5 py-1 rounded-pill ${r.attendance_status==='PRESENT'?'bg-success/15 text-success':r.attendance_status==='ABSENT'?'bg-danger/15 text-danger':r.attendance_status==='EXCUSED'?'bg-warning/15 text-warning':'bg-bg-card text-text-secondary'}`}>{SESSION_LABEL[r.attendance_status]||r.attendance_status}</span></div>})}</div>}</section>}

function MembershipHistory({data}:{data:any}){const events=data.events??[];return <section className="glass-card p-4"><h3 className="font-display text-lg mb-1">🕰️ 나의 길드 소속 이력</h3><p className="text-xs text-text-secondary mb-3">새로 전입하거나 길드를 이동해도 과거 활동의 소속은 이 기록을 기준으로 보존됩니다.</p>{!events.length?<div className="bg-bg-deep border border-line rounded-card-md p-3 text-sm text-text-secondary">Guild 1.1 적용 후 소속 변경 기록이 여기에 추가됩니다. 현재 소속 시작: {data.guild.joined_at?new Date(data.guild.joined_at).toLocaleDateString('ko-KR'):'-'}</div>:<div className="space-y-2">{events.map((e:any)=><div key={e.id} className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-white text-sm">{e.event_type==='MOVE'?`${e.from_guild_name||data.guildNames.get(Number(e.from_guild_id))||'이전 길드'} → ${e.to_guild_name||data.guildNames.get(Number(e.to_guild_id))||'새 길드'}`:e.event_type==='ASSIGN'?`${e.to_guild_name||data.guildNames.get(Number(e.to_guild_id))||'길드'} 배정`:e.event_type==='ELEMENT_CHANGE'?`담당 속성 ${elementMeta(e.element_before).emoji} ${elementMeta(e.element_before).label} → ${elementMeta(e.element_after).emoji} ${elementMeta(e.element_after).label}`:`${e.from_guild_name||data.guildNames.get(Number(e.from_guild_id))||'길드'} 소속 종료`}</div><div className="text-xs text-text-secondary mt-1">{e.reason} · {new Date(e.effective_at).toLocaleString('ko-KR')}</div></div>)}</div>}</section>}
