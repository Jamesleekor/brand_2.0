import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { guildTeacherRpc } from '@/lib/rpc/guild_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { formatDateTime, getKstDateString } from '@/lib/utils/format';
import { useToastStore } from '@/stores/ui_store';

const ELEMENTS = [
  { code:'EARTH', label:'땅', emoji:'🌍' },
  { code:'WATER', label:'물', emoji:'💧' },
  { code:'LIGHT', label:'빛', emoji:'✨' },
  { code:'WIND', label:'바람', emoji:'🌬️' },
  { code:'FIRE', label:'불', emoji:'🔥' },
  { code:'DARK', label:'어둠', emoji:'🌑' },
] as const;
type ElementCode = typeof ELEMENTS[number]['code'];
const elementMeta=(value:unknown)=>{const raw=String(value??'').trim();const alias:Record<string,ElementCode>={EARTH:'EARTH',WATER:'WATER',FIRE:'FIRE',WIND:'WIND',LIGHT:'LIGHT',DARK:'DARK','땅':'EARTH','물':'WATER','불':'FIRE','바람':'WIND','빛':'LIGHT','어둠':'DARK'};const code=alias[raw.toUpperCase()]??alias[raw];return ELEMENTS.find(x=>x.code===code)??null;};
type SessionStatus = 'UNMARKED' | 'PRESENT' | 'ABSENT' | 'EXCUSED';
const SESSION_LABEL: Record<SessionStatus, string> = { UNMARKED:'미기록', PRESENT:'참석', ABSENT:'불참', EXCUSED:'인정불참' };

function errText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || '알 수 없는 오류');
}

export default function GuildAdmin() {
  const [tab, setTab] = useState<'members'|'seasons'|'sessions'>('members');
  const [health,setHealth]=useState<Record<string,unknown>|null>(null);
  const classroomId = useClassroomId();
  const {call:healthCall,isLoading:healthLoading}=useRpcCall();
  const { data, isLoading, isError, error, refetch } = useGuildFoundationAdmin(classroomId);

  return (
    <TeacherShell>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-brand-gradient">⚔️ 길드 운영 <span className="text-xs text-text-muted">Guild 1.1</span></h1>
            <p className="text-sm text-text-secondary font-bold mt-1">소속 이력 · 시즌 · 길드 세션 참석을 현재값과 분리해 보존합니다.</p>
          </div>
          <button className="btn-secondary" disabled={!classroomId||healthLoading} onClick={async()=>{if(!classroomId)return;const r=await healthCall(()=>guildTeacherRpc.healthCheck(supabase,{p_classroom_id:classroomId}),{successTitle:'Guild 1 진단 완료'});if(r)setHealth(r);}}>🩺 {healthLoading?'진단 중...':'Guild 1 진단'}</button>
        </div>
        {health&&<div className="glass-card p-3 border-success/30"><div className="font-black text-success text-sm">Guild 1 DB 진단 결과</div><div className="grid sm:grid-cols-2 gap-2 mt-2 text-xs text-text-secondary"><div>중복 활성 소속: <b className="text-white">{String(health.duplicate_active_memberships??'-')}</b></div><div>미배정 재학생: <b className="text-white">{String(health.unassigned_active_students??'-')}</b></div><div>담당 속성 미설정 멤버: <b className="text-white">{String(health.active_members_without_element??'-')}</b></div><div>전출 후 활성 소속 잔존: <b className="text-white">{String(health.transferred_students_with_active_membership??'-')}</b></div></div></div>}
        <div className="flex gap-2 flex-wrap">
          <button className={tab==='members'?'btn-primary':'btn-secondary'} onClick={()=>setTab('members')}>🛡️ 길드·멤버</button>
          <button className={tab==='seasons'?'btn-primary':'btn-secondary'} onClick={()=>setTab('seasons')}>🗓️ 시즌</button>
          <button className={tab==='sessions'?'btn-primary':'btn-secondary'} onClick={()=>setTab('sessions')}>📍 길드 세션</button>
        </div>

        {isLoading && <div className="py-12 flex justify-center"><LoadingSpinner size="lg"/></div>}
        {isError && <div className="glass-card p-4 border-danger/40"><div className="font-black text-danger">Guild 1 데이터를 불러오지 못했습니다.</div><div className="text-xs text-text-secondary mt-2 break-all">{errText(error)}</div><button className="btn-secondary mt-3" onClick={()=>void refetch()}>다시 시도</button></div>}
        {data && tab==='members' && <MembersPanel data={data} />}
        {data && tab==='seasons' && <SeasonsPanel data={data} />}
        {data && tab==='sessions' && <SessionsPanel data={data} />}
      </div>
    </TeacherShell>
  );
}

function useGuildFoundationAdmin(classroomId: number | null) {
  return useQuery({
    queryKey:['guild1-admin',classroomId],
    enabled:!!classroomId,
    queryFn: async () => {
      const [students, guilds, memberships, seasons, events, sessions] = await Promise.all([
        supabase.from('students').select('id,name,brand_name,role,transferred_at').eq('classroom_id',classroomId!).order('name'),
        supabase.from('guilds').select('id,name,slogan,logo_url,description,is_active,classroom_id').or(`classroom_id.eq.${classroomId},classroom_id.is.null`).order('id'),
        supabase.from('guild_members').select('id,guild_id,student_id,element,joined_at,left_at,leave_reason').is('left_at',null),
        supabase.from('guild_seasons').select('id,classroom_id,display_name,school_year,starts_on,ends_on,lifecycle_status,updated_at').eq('classroom_id',classroomId!).order('starts_on',{ascending:false}),
        supabase.from('guild_membership_events').select('id,student_id,from_guild_id,to_guild_id,from_membership_id,to_membership_id,from_guild_name,to_guild_name,event_type,element_before,element_after,reason,effective_at').eq('classroom_id',classroomId!).order('effective_at',{ascending:false}).limit(60),
        supabase.from('guild_sessions').select('id,classroom_id,season_id,title,session_date,note,status,created_at,updated_at').eq('classroom_id',classroomId!).order('session_date',{ascending:false}).order('id',{ascending:false}).limit(60),
      ]);
      for (const [name,res] of Object.entries({students,guilds,memberships,seasons,events,sessions})) {
        if (res.error) throw new Error(`[Guild1:${name}] ${res.error.message}`);
      }
      const studentRows=(students.data??[]).filter((s:any)=>!['TEACHER','ADMIN','TEST'].includes(String(s.role)));
      const activeStudentRows=studentRows.filter((s:any)=>!s.transferred_at);
      const studentIds=new Set(studentRows.map((s:any)=>Number(s.id)));
      return {
        classroomId: classroomId!,
        students: activeStudentRows,
        allStudents: studentRows,
        guilds: guilds.data??[],
        memberships: (memberships.data??[]).filter((m:any)=>studentIds.has(Number(m.student_id))),
        seasons: seasons.data??[],
        events: events.data??[],
        sessions: sessions.data??[],
      };
    }
  });
}

type AdminData = NonNullable<ReturnType<typeof useGuildFoundationAdmin>['data']>;

function MembersPanel({data}:{data:AdminData}) {
  const qc=useQueryClient(), {call,isLoading}=useRpcCall();
  const [creating,setCreating]=useState(false);
  const [editing,setEditing]=useState<any|null>(null);
  const [moving,setMoving]=useState<any|null>(null);
  const [removing,setRemoving]=useState<any|null>(null);
  const [statusChanging,setStatusChanging]=useState<any|null>(null);
  const memberByStudent=useMemo(()=>new Map<number,any>(data.memberships.map((m:any)=>[Number(m.student_id),m])),[data.memberships]);
  const guildById=useMemo(()=>new Map<number,any>(data.guilds.map((g:any)=>[Number(g.id),g])),[data.guilds]);
  const studentById=useMemo(()=>new Map<number,any>(data.allStudents.map((s:any)=>[Number(s.id),s])),[data.allStudents]);
  const assigned=data.students.filter((s:any)=>memberByStudent.has(Number(s.id))).length;
  const transferredWithMembership=data.allStudents.filter((s:any)=>s.transferred_at&&memberByStudent.has(Number(s.id)));
  const activeGuilds=data.guilds.filter((g:any)=>g.is_active!==false);
  const refresh=()=>qc.invalidateQueries({queryKey:['guild1-admin']});

  return <div className="space-y-4">
    <div className="grid sm:grid-cols-3 gap-3">
      <MiniStat label="활성 길드" value={`${activeGuilds.length}개`} sub="현재 운영"/>
      <MiniStat label="길드 배정" value={`${assigned}/${data.students.length}명`} sub={assigned===data.students.length?'전원 배정 완료':'미배정 확인 필요'}/>
      <MiniStat label="소속 원칙" value="1인 1길드" sub="DB unique guard 적용"/>
    </div>

    <section className="glass-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div><h2 className="font-display text-lg">길드 현황</h2><p className="text-xs text-text-secondary mt-1">속성은 길드가 아니라 각 모험가의 담당 역할입니다. 같은 길드 안에서도 서로 다른 속성을 가질 수 있습니다.</p></div>
        <button type="button" className="btn-primary" onClick={(e)=>{e.preventDefault();setCreating(true);}}>+ 새 길드</button>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.guilds.map((g:any)=>{
          const members=data.memberships.filter((m:any)=>Number(m.guild_id)===Number(g.id));
          return <div key={g.id} className={`bg-bg-deep border rounded-card-md p-4 ${g.is_active===false?'border-line opacity-60':'border-line-brand'}`}>
            <div className="flex gap-3 items-center">
              <div className="w-12 h-12 rounded-card-md overflow-hidden bg-bg-card border border-line flex items-center justify-center text-2xl">{g.logo_url?<img src={g.logo_url} className="w-full h-full object-cover" alt=""/>:'⚔️'}</div>
              <div className="min-w-0 flex-1"><div className="font-black text-white truncate">{g.name}</div><div className="text-xs text-text-secondary truncate">{g.slogan||'슬로건 없음'}</div></div>
              <div className="flex gap-1.5">
                <button type="button" className="btn-secondary" onClick={()=>setEditing(g)}>수정</button>
                <button type="button" className={g.is_active===false?'btn-primary':'btn-secondary'} onClick={()=>setStatusChanging({guild:g,members})}>{g.is_active===false?'활성화':'비활성화'}</button>
              </div>
            </div>
            <div className="mt-3 text-xs text-text-secondary">길드원 <b className="text-gold">{members.length}명</b> · {g.is_active===false?'비활성':'활성'}</div>
            {members.length>0&&<div className="flex flex-wrap gap-1.5 mt-2">{members.map((m:any)=>{const meta=elementMeta(m.element);return <span key={m.id} className="text-[10px] font-black px-2 py-1 rounded-pill bg-bg-card border border-line text-text-secondary">{meta?.emoji||'⚠️'} {meta?.label||'미설정'}</span>})}</div>}
          </div>;
        })}
      </div>
    </section>

    <section className="glass-card p-4">
      <h2 className="font-display text-lg mb-1">모험가 길드 배정</h2>
      <p className="text-xs text-text-secondary mb-3">길드를 옮겨도 기존 membership row는 종료 시각을 기록한 뒤 보존됩니다. 새 소속은 별도 row로 생성됩니다.</p>
      <div className="grid md:grid-cols-2 gap-2">
        {data.students.map((s:any)=>{
          const m=memberByStudent.get(Number(s.id));
          const g=m?guildById.get(Number(m.guild_id)):null;
          const meta=elementMeta(m?.element);
          return <div key={s.id} className="bg-bg-deep border border-line rounded-card-md p-3 flex gap-3 items-center">
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-white truncate">{s.brand_name||s.name} <span className="text-xs text-text-secondary font-bold">{s.brand_name?`(${s.name})`:''}</span></div>
              <div className="text-xs mt-1">{g?<><span className="text-gold font-black">{g.name}</span><span className="text-text-secondary"> · </span><span className={meta?'text-bv font-black':'text-danger font-black'}>{meta?`${meta.emoji} ${meta.label} 담당`:'담당 속성 미설정'}</span><span className="text-text-secondary"> · {m.joined_at?new Date(m.joined_at).toLocaleDateString('ko-KR'):'기존 기록'}~</span></>:<span className="text-danger font-black">미배정</span>}</div>
            </div>
            <button disabled={isLoading} onClick={()=>setMoving({student:s,membership:m,guild:g})} className="btn-secondary">{m?'이동/속성':'배정'}</button>
            {m&&<button disabled={isLoading} onClick={()=>setRemoving({student:s,membership:m,guild:g})} className="text-xs font-black text-danger">해제</button>}
          </div>;
        })}
      </div>
    </section>

    {transferredWithMembership.length>0&&<section className="glass-card p-4 border-warning/30">
      <h2 className="font-display text-lg">⚠️ 전출 학생 소속 정리</h2>
      <p className="text-xs text-text-secondary mt-1 mb-3">학생 전출일과 길드 membership 종료는 서로 다른 기록입니다. 전출된 학생에게 활성 길드 소속이 남아 있으면 이곳에서 종료 처리하세요.</p>
      <div className="grid md:grid-cols-2 gap-2">{transferredWithMembership.map((s:any)=>{const m=memberByStudent.get(Number(s.id)),g=m?guildById.get(Number(m.guild_id)):null;return <div key={s.id} className="bg-bg-deep border border-warning/20 rounded-card-md p-3 flex items-center gap-3"><div className="flex-1"><div className="font-black text-white">{s.brand_name||s.name} <span className="text-xs text-text-secondary">{s.brand_name?`(${s.name})`:''}</span></div><div className="text-xs text-warning mt-1">전출 {s.transferred_at} · 활성 소속 {g?.name||`#${m?.guild_id}`}</div></div><button className="btn-secondary" disabled={isLoading} onClick={()=>setRemoving({student:s,membership:m,guild:g})}>소속 종료</button></div>})}</div>
    </section>}

    <section className="glass-card p-4">
      <h2 className="font-display text-lg mb-3">최근 소속 이력</h2>
      {!data.events.length?<p className="text-sm text-text-secondary">Guild 1 적용 후 변경 이력이 여기에 쌓입니다.</p>:<div className="space-y-2">{data.events.map((e:any)=>{
        const s=studentById.get(Number(e.student_id));
        const from=e.from_guild_id?guildById.get(Number(e.from_guild_id)):null;
        const to=e.to_guild_id?guildById.get(Number(e.to_guild_id)):null;
        const fromName=e.from_guild_name||from?.name||'이전 길드';
        const toName=e.to_guild_name||to?.name||'새 길드';
        return <div key={e.id} className="bg-bg-deep rounded-card-md p-3"><div className="text-sm font-black text-white">{s?.brand_name||s?.name||`#${e.student_id}`} · {e.event_type==='MOVE'?`${fromName} → ${toName}`:e.event_type==='ASSIGN'?`${toName} 배정`:e.event_type==='ELEMENT_CHANGE'?`담당 속성 ${elementMeta(e.element_before)?.emoji||''} ${elementMeta(e.element_before)?.label||e.element_before||'미설정'} → ${elementMeta(e.element_after)?.emoji||''} ${elementMeta(e.element_after)?.label||e.element_after||'미설정'}`:`${fromName} 소속 해제`}</div><div className="text-xs text-text-secondary mt-1">{e.reason} · {formatDateTime(e.effective_at)}</div></div>;
      })}</div>}
    </section>

    {creating&&<GuildCreateModal onClose={()=>setCreating(false)} onCreated={async()=>{await refresh();setCreating(false);}}/>}
    {editing&&<GuildEditModal guild={editing} busy={isLoading} onClose={()=>setEditing(null)} onSave={async(v)=>{const ok=await call(()=>guildTeacherRpc.updateGuildProfile(supabase,v),{successTitle:'길드 정보를 수정했어요',onSuccess:refresh});if(ok!==null)setEditing(null);}}/>}
    {moving&&<MembershipModal item={moving} guilds={activeGuilds} onClose={()=>setMoving(null)} onSave={async(v)=>{const result=await guildTeacherRpc.assignGuildMember(supabase,v);if(result.success===false)throw new Error(result.error);await refresh();}}/>}
    {removing&&<RemoveMembershipModal item={removing} busy={isLoading} onClose={()=>setRemoving(null)} onSave={async(reason)=>{const ok=await call(()=>guildTeacherRpc.removeGuildMember(supabase,{p_student_id:Number(removing.student.id),p_reason:reason,p_effective_at:new Date().toISOString()}),{successTitle:'길드 소속을 해제했어요',successDescription:'과거 소속 이력은 보존됩니다.',onSuccess:refresh});if(ok!==null)setRemoving(null);}}/>}
    {statusChanging&&<GuildStatusModal item={statusChanging} busy={isLoading} onClose={()=>setStatusChanging(null)} onSave={async()=>{const g=statusChanging.guild;const next=g.is_active===false;const ok=await call(()=>guildTeacherRpc.updateGuildProfile(supabase,{p_guild_id:Number(g.id),p_name:g.name,p_slogan:g.slogan||null,p_description:g.description||null,p_logo_url:g.logo_url||null,p_is_active:next}),{successTitle:next?'길드를 다시 활성화했어요':'길드를 비활성화했어요',onSuccess:refresh});if(ok!==null)setStatusChanging(null);}}/>}
  </div>;
}

function GuildCreateModal({onClose,onCreated}:{onClose:()=>void;onCreated:()=>Promise<void>}){
  const showToast=useToastStore((x)=>x.show);
  const [name,setName]=useState(''),[slogan,setSlogan]=useState(''),[description,setDescription]=useState(''),[logo,setLogo]=useState('');
  const [submitting,setSubmitting]=useState(false),[submitError,setSubmitError]=useState<string|null>(null);
  const submit=async()=>{
    if(submitting||!name.trim())return;
    setSubmitting(true);setSubmitError(null);
    try{
      const result=await guildTeacherRpc.createGuild(supabase,{p_name:name.trim(),p_slogan:slogan.trim()||null,p_description:description.trim()||null,p_logo_url:logo.trim()||null,p_is_active:true});
      if(result.success===false){setSubmitError(result.error);showToast({title:'길드 생성 실패',description:result.error,variant:'error'});return;}
      showToast({title:'새 길드를 만들었어요',variant:'success'});
      await onCreated();
    }catch(error){const message=errText(error);setSubmitError(message);showToast({title:'길드 생성 오류',description:message,variant:'error'});}
    finally{setSubmitting(false);}
  };
  return <Modal isOpen onClose={onClose} title="새 길드 생성" emoji="⚔️" size="lg"><div className="space-y-3">
    <div className="text-xs text-text-secondary bg-bg-deep border border-line rounded-card-md p-3">길드 자체에는 속성이 없습니다. 모험가를 배정할 때 각자 🌍땅 · 💧물 · 🔥불 · 🌬️바람 · ✨빛 · 🌑어둠 중 담당 속성을 지정합니다.</div>
    {submitError&&<div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-card-md p-3 break-all"><b>길드 생성 오류</b><div className="mt-1">{submitError}</div></div>}
    <Field label="길드명"><input className="input-field w-full" value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field label="슬로건"><input className="input-field w-full" value={slogan} onChange={e=>setSlogan(e.target.value)}/></Field>
    <Field label="설명"><textarea className="input-field w-full min-h-24" value={description} onChange={e=>setDescription(e.target.value)}/></Field>
    <Field label="로고 URL"><input className="input-field w-full" value={logo} onChange={e=>setLogo(e.target.value)}/></Field>
    <button type="button" className="btn-primary w-full" disabled={submitting||!name.trim()} onClick={()=>void submit()}>{submitting?'생성 중...':'길드 생성'}</button>
  </div></Modal>;
}

function GuildEditModal({guild,busy,onClose,onSave}:{guild:any;busy:boolean;onClose:()=>void;onSave:(v:any)=>Promise<void>}){
  const [name,setName]=useState(guild.name||''),[slogan,setSlogan]=useState(guild.slogan||''),[description,setDescription]=useState(guild.description||''),[logo,setLogo]=useState(guild.logo_url||''),[active,setActive]=useState(guild.is_active!==false);
  return <Modal isOpen onClose={onClose} title="길드 정보 수정" emoji="🛡️" size="lg"><div className="space-y-3">
    <Field label="길드명"><input className="input-field w-full" value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field label="슬로건"><input className="input-field w-full" value={slogan} onChange={e=>setSlogan(e.target.value)}/></Field>
    <Field label="설명"><textarea className="input-field w-full min-h-24" value={description} onChange={e=>setDescription(e.target.value)}/></Field>
    <Field label="로고 URL"><input className="input-field w-full" value={logo} onChange={e=>setLogo(e.target.value)}/></Field>
    <label className="flex gap-2 items-center text-sm text-text-secondary"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>활성 길드</label>{!active&&<div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-card-md p-3">활성 길드원이 남아 있으면 비활성화가 차단됩니다. 먼저 모든 길드원을 다른 길드로 이동하거나 소속 종료하세요.</div>}
    <button type="button" className="btn-primary w-full" disabled={busy||!name.trim()} onClick={()=>void onSave({p_guild_id:Number(guild.id),p_name:name.trim(),p_slogan:slogan.trim()||null,p_description:description.trim()||null,p_logo_url:logo.trim()||null,p_is_active:active})}>저장</button>
  </div></Modal>;
}

function MemberElementSelect({value,onChange}:{value:ElementCode;onChange:(v:ElementCode)=>void}){
  return <Field label="모험가 담당 속성"><select className="input-field w-full" value={value} onChange={e=>onChange(e.target.value as ElementCode)}>{ELEMENTS.map(x=><option key={x.code} value={x.code}>{x.emoji} {x.label}</option>)}</select></Field>;
}

function MembershipModal({item,guilds,onClose,onSave}:{item:any;guilds:any[];onClose:()=>void;onSave:(v:any)=>Promise<void>}){
  const showToast=useToastStore((x)=>x.show);
  const currentGuildId=Number(item.membership?.guild_id||0);
  const [guildId,setGuildId]=useState<number>(currentGuildId||Number(guilds[0]?.id||0));
  const currentElement=(elementMeta(item.membership?.element)?.code||'EARTH') as ElementCode;
  const [element,setElement]=useState<ElementCode>(currentElement);
  const [reason,setReason]=useState(item.membership?'길드/담당 속성 변경':'신규 길드 배정');
  const [confirming,setConfirming]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [submitError,setSubmitError]=useState<string|null>(null);
  const target=guilds.find((g:any)=>Number(g.id)===guildId);
  const meta=elementMeta(element);
  const sameGuild=Boolean(item.membership)&&currentGuildId===guildId;
  const sameElement=Boolean(item.membership)&&String(elementMeta(item.membership?.element)?.code||'')===element;
  const submit=async()=>{
    if(submitting||!guildId||reason.trim().length<2)return;
    setSubmitting(true);setSubmitError(null);
    try{
      await onSave({p_student_id:Number(item.student.id),p_guild_id:guildId,p_element:element,p_reason:reason.trim(),p_effective_at:new Date().toISOString()});
      showToast({title:item.membership?'길드 소속/속성을 변경했어요':'길드에 배정했어요',description:'기존 소속 이력은 보존됩니다.',variant:'success'});
      onClose();
    }catch(error){
      const message=errText(error);
      setSubmitError(message);
      showToast({title:'길드 소속 변경 오류',description:message,variant:'error',duration:6000});
    }finally{setSubmitting(false);}
  };
  return <Modal isOpen onClose={onClose} title={confirming?'소속/속성 변경 최종 확인':item.membership?'길드 이동 · 담당 속성':'길드 배정'} emoji={confirming?'⚠️':'⚔️'} size="md"><div className="space-y-3">
    {submitError&&<div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-card-md p-3 break-all"><b>소속 변경 오류</b><div className="mt-1">{submitError}</div></div>}
    {!confirming?<>
      <div className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-white">{item.student.brand_name||item.student.name}</div><div className="text-xs text-text-secondary mt-1">{item.membership?`현재 ${item.guild?.name||'길드'} · ${elementMeta(item.membership?.element)?.emoji||'⚠️'} ${elementMeta(item.membership?.element)?.label||'속성 미설정'}`:'현재 길드 미배정'}</div></div>
      <Field label="길드"><select className="input-field w-full" value={guildId} onChange={e=>setGuildId(Number(e.target.value))}>{guilds.map((g:any)=><option key={g.id} value={g.id}>⚔️ {g.name}</option>)}</select></Field>
      <MemberElementSelect value={element} onChange={setElement}/>
      <div className="text-xs rounded-card-md p-3 border text-text-secondary bg-bg-deep border-line">{meta?.emoji} <b className="text-bv">{meta?.label}</b>은 이 모험가 개인의 담당 속성입니다. 길드 자체 속성이 아니며 같은 길드의 다른 모험가는 다른 속성을 가질 수 있습니다.</div>
      <Field label="변경 사유"><input className="input-field w-full" value={reason} onChange={e=>setReason(e.target.value)} placeholder="이력에 남을 사유"/></Field>
      <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-card-md p-3">길드 이동 시 기존 membership row는 삭제하지 않고 종료 시각을 기록합니다. 같은 길드에서 속성만 바꾸면 현재 membership의 담당 속성 변경 이력이 남습니다.</div>
      <button type="button" className="btn-primary w-full" disabled={!guildId||reason.trim().length<2||(sameGuild&&sameElement)} onClick={()=>{setSubmitError(null);setConfirming(true);}}>{sameGuild?'담당 속성 변경 확인':'변경 내용 확인'}</button>
    </>:<>
      <p className="text-sm text-text-secondary"><b className="text-white">{item.student.brand_name||item.student.name}</b> → <b className="text-gold">{target?.name}</b> · <b className="text-bv">{meta?.emoji} {meta?.label}</b> 담당으로 적용합니다.</p>
      <p className="text-xs text-text-secondary">과거 미션·평가·세션에서 사용해야 할 이전 길드와 당시 담당 속성 snapshot은 그대로 보존됩니다.</p>
      <div className="grid grid-cols-2 gap-2"><button type="button" className="btn-secondary" disabled={submitting} onClick={()=>setConfirming(false)}>이전</button><button type="button" disabled={submitting} className="btn-primary" onClick={()=>void submit()}>{submitting?'적용 중...':'이력 보존 후 적용'}</button></div>
    </>}
  </div></Modal>;
}

function GuildStatusModal({item,busy,onClose,onSave}:{item:any;busy:boolean;onClose:()=>void;onSave:()=>Promise<void>}){
  const g=item.guild, members=item.members||[], activating=g.is_active===false;
  const blocked=!activating&&members.length>0;
  return <Modal isOpen onClose={onClose} title={activating?'길드 활성화':'길드 비활성화'} emoji={activating?'✅':'⏸️'}><div className="space-y-3">
    <p className="text-sm text-text-secondary"><b className="text-white">{g.name}</b> 길드를 {activating?'다시 활성화':'비활성화'}합니다.</p>
    {blocked&&<div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-card-md p-3">현재 활성 길드원이 <b>{members.length}명</b> 남아 있어 비활성화할 수 없습니다. 먼저 모든 길드원을 다른 길드로 이동하거나 소속 해제하세요.</div>}
    {!blocked&&!activating&&<div className="text-xs text-text-secondary bg-bg-deep border border-line rounded-card-md p-3">비활성화해도 과거 길드·소속·세션 이력은 삭제되지 않습니다.</div>}
    <div className="grid grid-cols-2 gap-2"><button className="btn-secondary" disabled={busy} onClick={onClose}>취소</button><button className="btn-primary" disabled={busy||blocked} onClick={()=>void onSave()}>{busy?'처리 중...':activating?'활성화':'비활성화'}</button></div>
  </div></Modal>;
}

function RemoveMembershipModal({item,busy,onClose,onSave}:{item:any;busy:boolean;onClose:()=>void;onSave:(reason:string)=>Promise<void>}){
  const [reason,setReason]=useState('전출/길드 소속 해제');
  return <Modal isOpen onClose={onClose} title="길드 소속 해제" emoji="⚠️"><div className="space-y-3"><p className="text-sm text-text-secondary"><b className="text-white">{item.student.brand_name||item.student.name}</b>의 <b className="text-gold">{item.guild?.name}</b> 소속을 종료합니다. 기존 이력은 삭제되지 않습니다.</p><Field label="사유"><input className="input-field w-full" value={reason} onChange={e=>setReason(e.target.value)}/></Field><button className="btn-primary w-full" disabled={busy||reason.trim().length<2} onClick={()=>void onSave(reason.trim())}>소속 종료</button></div></Modal>;
}

function SeasonsPanel({data}:{data:AdminData}){
  const qc=useQueryClient(),{call,isLoading}=useRpcCall();
  const [create,setCreate]=useState(false);
  const active=data.seasons.find((s:any)=>s.lifecycle_status==='ACTIVE');
  const refresh=()=>qc.invalidateQueries({queryKey:['guild1-admin']});
  return <div className="space-y-4"><div className="glass-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-display text-lg">현재 시즌</h2><div className="mt-1 text-sm">{active?<><b className="text-gold">{active.display_name}</b> · {active.starts_on||'?'} ~ {active.ends_on||'?'}</>:<span className="text-warning">활성 시즌이 없습니다.</span>}</div></div><button className="btn-primary" onClick={()=>setCreate(true)}>+ 새 시즌</button></div><section className="glass-card p-4"><h2 className="font-display text-lg mb-3">시즌 이력</h2>{!data.seasons.length?<p className="text-sm text-text-secondary">Guild 1 시즌을 만들어 시작하세요.</p>:<div className="space-y-2">{data.seasons.map((s:any)=><div key={s.id} className="bg-bg-deep border border-line rounded-card-md p-3 flex flex-col md:flex-row md:items-center gap-3"><div className="flex-1"><div className="font-black text-white">{s.display_name||`시즌 #${s.id}`} <span className={s.lifecycle_status==='ACTIVE'?'text-success':s.lifecycle_status==='CLOSED'?'text-text-secondary':'text-warning'}>· {s.lifecycle_status}</span></div><div className="text-xs text-text-secondary mt-1">{s.school_year||'-'}학년도 · {s.starts_on||'?'} ~ {s.ends_on||'?'}</div></div><div className="flex gap-2">{s.lifecycle_status!=='ACTIVE'&&<button disabled={isLoading} className="btn-secondary" onClick={()=>{if(confirm(`${s.display_name||'이 시즌'}을 활성화하면 기존 활성 시즌은 종료됩니다. 계속할까요?`))void call(()=>guildTeacherRpc.setSeasonStatus(supabase,{p_season_id:Number(s.id),p_status:'ACTIVE'}),{successTitle:'활성 시즌을 변경했어요',onSuccess:refresh});}}>활성화</button>}{s.lifecycle_status==='ACTIVE'&&<button disabled={isLoading} className="btn-secondary" onClick={()=>void call(()=>guildTeacherRpc.setSeasonStatus(supabase,{p_season_id:Number(s.id),p_status:'CLOSED'}),{successTitle:'시즌을 종료했어요',onSuccess:refresh})}>시즌 종료</button>}{s.lifecycle_status==='CLOSED'&&<button disabled={isLoading} className="btn-secondary" onClick={()=>void call(()=>guildTeacherRpc.setSeasonStatus(supabase,{p_season_id:Number(s.id),p_status:'PLANNED'}),{successTitle:'시즌을 재개방 준비 상태로 바꿨어요',onSuccess:refresh})}>재개방 준비</button>}</div></div>)}</div>}</section>{create&&<SeasonCreateModal classroomId={data.classroomId} busy={isLoading} onClose={()=>setCreate(false)} onSave={async(v)=>{const ok=await call(()=>guildTeacherRpc.createSeason(supabase,v),{successTitle:v.p_activate_now?'새 시즌을 만들고 활성화했어요':'새 시즌을 만들었어요',onSuccess:refresh});if(ok!==null)setCreate(false);}}/>}</div>;
}

function SeasonCreateModal({classroomId,busy,onClose,onSave}:{classroomId:number;busy:boolean;onClose:()=>void;onSave:(v:any)=>Promise<void>}){
  const today=getKstDateString();const year=Number(today.slice(0,4));const [name,setName]=useState(`${year} 시즌 2`),[schoolYear,setSchoolYear]=useState(year),[start,setStart]=useState(today),[end,setEnd]=useState(`${year}-12-31`),[active,setActive]=useState(true);
  return <Modal isOpen onClose={onClose} title="새 길드 시즌" emoji="🗓️"><div className="space-y-3"><Field label="시즌명"><input className="input-field w-full" value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="학년도"><input type="number" className="input-field w-full" value={schoolYear} onChange={e=>setSchoolYear(Number(e.target.value))}/></Field><div className="grid grid-cols-2 gap-2"><Field label="시작일"><input type="date" className="input-field w-full" value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="종료일"><input type="date" className="input-field w-full" value={end} onChange={e=>setEnd(e.target.value)}/></Field></div><label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>생성과 동시에 활성 시즌으로 설정</label>{active&&<div className="text-xs text-warning">기존 활성 시즌이 있다면 종료 상태로 전환됩니다.</div>}<button disabled={busy||!name.trim()||end<start} className="btn-primary w-full" onClick={()=>void onSave({p_classroom_id:classroomId,p_display_name:name.trim(),p_school_year:schoolYear,p_starts_on:start,p_ends_on:end,p_activate_now:active})}>시즌 생성</button></div></Modal>;
}

function SessionsPanel({data}:{data:AdminData}){
  const qc=useQueryClient(),{call,isLoading}=useRpcCall();
  const [create,setCreate]=useState(false),[selected,setSelected]=useState<number|null>(data.sessions[0]?Number(data.sessions[0].id):null);
  const refresh=()=>qc.invalidateQueries({queryKey:['guild1-admin']});
  return <div className="grid xl:grid-cols-[340px_1fr] gap-4"><section className="glass-card p-4"><div className="flex items-center justify-between gap-2 mb-3"><div><h2 className="font-display text-lg">길드 세션</h2><p className="text-xs text-text-secondary mt-1">학교 출석과 별도입니다.</p></div><button className="btn-primary" onClick={()=>setCreate(true)}>+ 세션</button></div><div className="space-y-2">{data.sessions.map((s:any)=><button key={s.id} onClick={()=>setSelected(Number(s.id))} className={`w-full text-left p-3 rounded-card-md border ${selected===Number(s.id)?'border-gold bg-gold/10':'border-line bg-bg-deep'}`}><div className="flex justify-between gap-2"><b className="text-sm text-white">{s.title}</b><span className={s.status==='OPEN'?'text-success text-xs font-black':'text-text-secondary text-xs font-black'}>{s.status==='OPEN'?'진행':'종료'}</span></div><div className="text-xs text-text-secondary mt-1">{s.session_date}</div></button>)}</div></section><section className="glass-card p-4">{selected?<SessionAttendanceEditor key={selected} sessionId={selected} sessions={data.sessions} students={data.students} guilds={data.guilds} busy={isLoading} onSave={async(records)=>{await call(()=>guildTeacherRpc.recordSessionAttendance(supabase,{p_session_id:selected,p_records:records}),{successTitle:'길드 세션 참석을 저장했어요',onSuccess:()=>{void qc.invalidateQueries({queryKey:['guild1-session-participants',selected]});refresh();}})}} onStatus={async status=>{await call(()=>guildTeacherRpc.setSessionStatus(supabase,{p_session_id:selected,p_status:status}),{successTitle:status==='CLOSED'?'길드 세션을 종료했어요':'길드 세션을 다시 열었어요',onSuccess:refresh});}}/>:<div className="py-12 text-center text-text-secondary">왼쪽에서 길드 세션을 선택하세요.</div>}</section>{create&&<SessionCreateModal classroomId={data.classroomId} busy={isLoading} onClose={()=>setCreate(false)} onSave={async(v)=>{const id=await call(()=>guildTeacherRpc.createSession(supabase,v),{successTitle:'길드 세션을 만들었어요',successDescription:'현재 길드 구성원이 세션 snapshot으로 고정되었습니다.',onSuccess:refresh});if(id!==null){setSelected(Number(id));setCreate(false);}}}/>}</div>;
}

function SessionCreateModal({classroomId,busy,onClose,onSave}:{classroomId:number;busy:boolean;onClose:()=>void;onSave:(v:any)=>Promise<void>}){
  const [title,setTitle]=useState('길드 세션'),[date,setDate]=useState(getKstDateString()),[note,setNote]=useState('');
  return <Modal isOpen onClose={onClose} title="길드 세션 생성" emoji="📍"><div className="space-y-3"><Field label="세션명"><input className="input-field w-full" value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label="날짜"><input type="date" className="input-field w-full" value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="메모"><textarea className="input-field w-full min-h-20" value={note} onChange={e=>setNote(e.target.value)}/></Field><div className="text-xs text-text-secondary bg-bg-deep border border-line rounded-card-md p-3">생성 버튼을 누르는 순간의 길드 구성원을 snapshot으로 저장합니다. 이후 전입·전출·길드 이동이 발생해도 이 세션의 참석 대상은 바뀌지 않습니다.</div><button disabled={busy||!title.trim()} className="btn-primary w-full" onClick={()=>void onSave({p_classroom_id:classroomId,p_title:title.trim(),p_session_date:date,p_note:note.trim()||null})}>세션 생성 + 구성원 고정</button></div></Modal>;
}

function SessionAttendanceEditor({sessionId,sessions,students,guilds,busy,onSave,onStatus}:{sessionId:number;sessions:any[];students:any[];guilds:any[];busy:boolean;onSave:(records:any[])=>Promise<void>;onStatus:(status:'OPEN'|'CLOSED')=>Promise<void>}){
  const session=sessions.find((s:any)=>Number(s.id)===sessionId);
  const q=useQuery({queryKey:['guild1-session-participants',sessionId],queryFn:async()=>{const {data,error}=await supabase.from('guild_session_participants').select('id,session_id,student_id,guild_id_at_session,student_name_at_session,brand_name_at_session,guild_name_at_session,element_at_session,attendance_status,note,recorded_at').eq('session_id',sessionId).order('student_id');if(error)throw new Error(`[Guild1:session-participants] ${error.message}`);return data??[];}});
  const [draft,setDraft]=useState<Record<number,{status:SessionStatus;note:string}>>({});
  const sMap=new Map(students.map((s:any)=>[Number(s.id),s])),gMap=new Map(guilds.map((g:any)=>[Number(g.id),g]));
  if(q.isLoading)return <LoadingSpinner size="lg"/>;
  if(q.isError)return <div className="text-danger text-sm">{errText(q.error)}</div>;
  const rows=(q.data??[]).map((r:any)=>({student_id:Number(r.student_id),status:draft[Number(r.student_id)]?.status||(r.attendance_status as SessionStatus),note:draft[Number(r.student_id)]?.note??(r.note||'')}));
  const counts=(q.data??[]).reduce((a:Record<string,number>,r:any)=>{a[r.attendance_status]=(a[r.attendance_status]||0)+1;return a;},{});
  return <div><div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3"><div><h2 className="font-display text-lg">{session?.title||'길드 세션'}</h2><div className="text-xs text-text-secondary mt-1">{session?.session_date} · snapshot {q.data?.length||0}명 · 참석 {counts.PRESENT||0} · 불참 {counts.ABSENT||0} · 인정불참 {counts.EXCUSED||0}</div></div><div className="flex gap-2"><button disabled={busy} className="btn-secondary" onClick={()=>void onStatus(session?.status==='OPEN'?'CLOSED':'OPEN')}>{session?.status==='OPEN'?'세션 종료':'다시 열기'}</button><button disabled={busy||!rows.length} className="btn-primary" onClick={()=>void onSave(rows)}>전체 저장</button></div></div><div className="text-xs text-warning mb-3">이 목록은 현재 길드원이 아니라 <b>세션 생성 당시 구성원</b>입니다.</div><div className="grid md:grid-cols-2 gap-2">{(q.data??[]).map((r:any)=>{const id=Number(r.student_id),s=sMap.get(id),g=gMap.get(Number(r.guild_id_at_session)),studentLabel=r.brand_name_at_session||r.student_name_at_session||s?.brand_name||s?.name||`학생 #${id}`,guildLabel=r.guild_name_at_session||g?.name||`#${r.guild_id_at_session}`,sessionElement=elementMeta(r.element_at_session),d=draft[id]||{status:r.attendance_status as SessionStatus,note:r.note||''};return <div key={r.id} className="bg-bg-deep border border-line rounded-card-md p-3"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="font-black text-white truncate">{studentLabel}</div><div className="text-xs text-text-secondary">당시 길드 · {guildLabel}{sessionElement?` · ${sessionElement.emoji} ${sessionElement.label}`:''}</div></div><select className="input-field min-w-[110px]" value={d.status} onChange={e=>setDraft(v=>({...v,[id]:{status:e.target.value as SessionStatus,note:d.note}}))}>{(Object.keys(SESSION_LABEL) as SessionStatus[]).map(k=><option key={k} value={k}>{SESSION_LABEL[k]}</option>)}</select></div><input className="input-field w-full mt-2 text-xs" placeholder="메모 (선택)" value={d.note} onChange={e=>setDraft(v=>({...v,[id]:{status:d.status,note:e.target.value}}))}/></div>})}</div></div>;
}

function MiniStat({label,value,sub}:{label:string;value:string;sub:string}){return <div className="glass-card p-4"><div className="text-xs text-text-secondary font-black">{label}</div><div className="font-display text-2xl text-gold mt-1">{value}</div><div className="text-xs text-text-secondary mt-1">{sub}</div></div>}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="block text-xs font-black text-text-secondary"><span className="block mb-1.5">{label}</span>{children}</label>}
