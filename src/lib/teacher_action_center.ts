import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { economyGuardRpc } from '@/lib/rpc/economy_guard_rpc';
import { newbieSupportRpc } from '@/lib/rpc/newbie_support_rpc';
import { secondaryJobPublicTeacherRpc } from '@/lib/rpc/secondary_job_public_request_rpc';
import { secondaryJobServiceTeacherRpc } from '@/lib/rpc/secondary_job_service_rpc';
import { secondaryJobServiceAdTeacherRpc } from '@/lib/rpc/secondary_job_service_ad_rpc';

export type ActionGroup = 'students' | 'growth' | 'economy';
export type ActionPriority = 'urgent' | 'review' | 'operation';
export type TeacherAction = {
  id: string;
  title: string;
  description: string;
  studentName?: string;
  createdAt: string;
  group: ActionGroup;
  priority: ActionPriority;
  source: string;
  to: string;
};
export type TeacherActionCenter = {
  items: TeacherAction[];
  errors: { source: string; reason: string }[];
  checkedAt: string;
  complete: boolean;
};
const QUERY_PREFIX = 'teacher-action-center';
const MAX_PAGE = 1000;
const kstDay = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function fail(result: { success: boolean; error?: string; data?: unknown }) {
  if (result.success === false) throw new Error(result.error || '조회 실패');
  return result.data;
}
function record(id: string, title: string, description: string, createdAt: string | null | undefined,
  source: string, to: string, group: ActionGroup, priority: ActionPriority,
  studentName?: string): TeacherAction {
  return { id, title, description, createdAt: createdAt || '', source, to, group, priority, studentName };
}
function nameOf(row: any) {
  return row?.brand_name || row?.name || row?.student_name || '학생';
}
type Source = { name: string; run: () => Promise<TeacherAction[]> };

export async function getTeacherActionCenter(classroomId: number): Promise<TeacherActionCenter> {
  const day = kstDay();
  const sources: Source[] = [
    { name: '업적 신청', run: async () => {
      const { data, error } = await supabase.rpc('teacher_get_achievement_review_queue', { p_classroom_id: classroomId });
      if (error) throw error;
      return ((data?.applications ?? []) as any[]).map(a => record(
        'achievement:' + a.id,
        a.application_kind === 'SPECIAL_REPORT' ? '히든 업적 특별보고' : '업적 신청 검토',
        a.achievement_name || '업적 신청', a.created_at, '업적 신청',
        '/teacher/review?tab=achievement&item=' + a.id, 'students', 'review', a.student_name));
    }},
    { name: '2차직업 신청', run: async () => {
      const { data, error } = await supabase.from('secondary_job_applications')
        .select('id,job_name,created_at,student:students!student_id(name,brand_name)')
        .eq('classroom_id', classroomId).eq('status','PENDING').order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((a: any) => record('secondary-job:' + a.id, '2차직업 신청',
        a.job_name, a.created_at, '2차직업 신청',
        '/teacher/review?tab=secondary_job&item=' + a.id, 'students','review', nameOf(a.student)));
    }},
    { name: '과제 채점', run: async () => {
      const all: any[] = [];
      for (let offset=0;offset<10_000;offset+=MAX_PAGE) {
        const {data,error} = await supabase.from('assignment_submissions')
          .select('id,submitted_at,assignment_id,student:students!student_id(name,brand_name),assignment:assignments!assignment_id(title),grading:assignment_gradings(id,is_revoked)')
          .eq('classroom_id', classroomId).eq('status','SUBMITTED').order('submitted_at', {ascending:false})
          .order('id',{ascending:false}).range(offset,offset+MAX_PAGE-1);
        if (error) throw error;
        all.push(...(data??[]));
        if ((data??[]).length < MAX_PAGE) break;
        if (offset+MAX_PAGE >= 10_000) throw new Error('제출 기록이 1만 건을 초과해 정확한 집계를 위해 서버 조회 개선이 필요합니다.');
      }
      return all.filter((s: any) => !(s.grading ?? []).some((g: any) => !g.is_revoked))
        .map((s: any) => record('assignment:' + s.id, '과제 채점 대기',
          (s.assignment?.title || '과제') + ' · 제출물 확인', s.submitted_at, '과제 채점',
          '/teacher/learning?tab=assignments&assignment=' + s.assignment_id + '&item=' + s.id,
          'students','review',nameOf(s.student)));
    }},
    { name: '출석 입력', run: async () => {
      const now = new Date();
      const weekday = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',weekday:'short'}).format(now);
      const hour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(now));
      if (weekday === 'Sat' || weekday === 'Sun' || hour < 10) return [];
      const [students, attendance] = await Promise.all([
        supabase.from('students').select('id', {count:'exact',head:true})
          .eq('classroom_id', classroomId).eq('role','STUDENT').is('transferred_at',null),
        supabase.from('attendances').select('student_id')
          .eq('classroom_id', classroomId).eq('attendance_date',day),
      ]);
      if (students.error) throw students.error;
      if (attendance.error) throw attendance.error;
      const enrolled = students.count ?? 0;
      const entered = new Set((attendance.data ?? []).map(row => row.student_id)).size;
      const missing = Math.max(0,enrolled - entered);
      return missing ? [record('attendance:' + day, '오늘 출석 입력 확인',
        missing + '명 미입력 · 휴업일이면 무시해도 됩니다', day + 'T10:00:00+09:00', '출석 입력',
        '/teacher/learning?tab=attendance&date=' + day, 'students','operation')] : [];
    }},
    { name: '공공의뢰 검사', run: async () => {
      const board = fail(await secondaryJobPublicTeacherRpc.board(supabase, classroomId)) as any;
      return (board.assignments ?? []).filter((a: any)=>a.status==='SUBMITTED').map((a: any) => record(
        'public:' + a.id, '공공의뢰 수행 검사', a.request_title || '공공의뢰',
        a.submitted_at, '공공의뢰 검사',
        '/teacher/secondary-jobs/public-requests?assignment=' + a.id, 'students','review',a.student_name));
    }},
    { name: 'P2P 서비스 분쟁', run: async () => {
      const board = fail(await secondaryJobServiceTeacherRpc.board(supabase, classroomId)) as any;
      return (board.orders ?? []).filter((o: any)=>o.status==='DISPUTED').map((o: any) => record(
        'dispute:' + o.id, 'P2P 거래 분쟁', o.service_title,
        o.disputed_at || o.created_at, 'P2P 거래 분쟁',
        '/teacher/secondary-jobs/services?section=ORDERS&filter=DISPUTED&item=' + o.id,
        'students','urgent', (o.buyer_name || '') + ' · ' + (o.seller_name || '')));
    }},
    { name: 'P2P 광고 승인', run: async () => {
      const board = fail(await secondaryJobServiceAdTeacherRpc.board(supabase, classroomId)) as any;
      return (board.ads ?? []).filter((a: any)=>a.status==='PENDING').map((a: any) => record(
        'advert:' + a.id,'P2P 광고 승인',a.service_title,
        a.submitted_at,'P2P 광고 승인',
        '/teacher/secondary-jobs/services?section=ADS&item=' + a.id,
        'students','review',a.seller_name));
    }},
    { name: '일일퀘스트 정산', run: async () => {
      // Private table: only the teacher-authorized RPC can read this summary.
      const { data, error } = await supabase.rpc('teacher_get_pending_daily_quest_reports');
      if (error) throw error;
      return ((data ?? []) as Array<{ id: number; quest_date: string; submitted_at: string | null }>).map(r => record('quest:' + r.id,'일일퀘스트 정산',
        r.quest_date + ' 보고서',r.submitted_at,'일일퀘스트 정산',
        '/teacher/daily-quests?date=' + r.quest_date,'growth','operation'));
    }},
    { name: '뉴비 정착 지원', run: async () => {
      const board = fail(await newbieSupportRpc.teacherBoard(supabase)) as any;
      const pending = (board.claims ?? []).filter((c: any)=>c.status === 'PENDING')
        .map((c: any) => record('newbie:' + c.claim_id,'정착 지원 완료 요청',
          c.quest_title || '정착 퀘스트 완료 신청',c.requested_at,'뉴비 정착 지원',
          '/teacher/newbie-support?tab=review&item=' + c.claim_id,'growth','review',
          c.student_brand_name || c.student_name));
      const settlement = (board.programs ?? []).filter((p: any)=>p.status === 'COMPLETION_PENDING' ||
          p.effective_status === 'COMPLETION_PENDING')
        .map((p: any)=>record('newbie-final:' + p.program_id,'정착 지원 최종 정산',
          p.student_brand_name || p.student_name || '정착 프로그램',
          p.end_on,'뉴비 정착 지원','/teacher/newbie-support?tab=programs&program=' + p.program_id,
          'growth','operation'));
      return [...pending,...settlement];
    }},
    { name: '경제수호대', run: async () => {
      const result = await economyGuardRpc.getDashboard(supabase,{
        p_period:'all',p_start_date:null,p_end_date:null,
      });
      const board = fail(result) as any;
      return (board.events ?? []).filter((e: any)=>e.is_open_alert).map((e: any) => record(
        'guard:' + e.event_key,'이상거래 확인' + (e.review_is_stale ? ' · 재검토' : ''),
        e.anomaly_reasons?.join(' · ') || '경제수호대 이상거래',
        e.occurred_at,'경제수호대',
        '/teacher/economy-guard?tab=alerts&event=' + encodeURIComponent(e.event_key),
        'economy','urgent', (e.sender_brand_name || e.sender_name) + ' · ' + (e.receiver_brand_name || e.receiver_name)));
    }},
  ];
  // The Supabase client deliberately caps ordinary REST requests at two in flight.
  // Launching every source at once would overflow its eight-second waiting queue.
  const results: PromiseSettledResult<TeacherAction[]>[] = new Array(sources.length);
  let next = 0;
  await Promise.all([0,1].map(async () => {
    while (next < sources.length) {
      const index = next++;
      try { results[index] = { status:'fulfilled', value:await sources[index].run() }; }
      catch (reason) { results[index] = { status:'rejected', reason }; }
    }
  }));
  const items: TeacherAction[] = [];
  const errors: TeacherActionCenter['errors'] = [];
  results.forEach((result,index) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else errors.push({source:sources[index].name,reason:result.reason instanceof Error ?
      result.reason.message : '조회 실패'});
  });
  const weight: Record<ActionPriority,number> = {urgent:0,review:1,operation:2};
  items.sort((a,b) => weight[a.priority]-weight[b.priority] ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { items, errors, checkedAt: new Date().toISOString(), complete:errors.length===0 };
}

export function useTeacherActionCenter() {
  const classroomId = useClassroomId();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [QUERY_PREFIX,classroomId],
    queryFn:()=>getTeacherActionCenter(classroomId!),
    enabled:classroomId!==null,
    staleTime: 15_000,
    refetchInterval:30_000,
    refetchOnWindowFocus:true,
    retry:1,
  });
  useEffect(()=>{
    if (!classroomId) return;
    const tables = ['secondary_job_applications','secondary_job_public_assignments',
      'secondary_job_service_orders','secondary_job_service_ads','daily_quest_reports',
      'assignment_submissions','assignment_gradings','attendances'];
    // Realtime is opportunistic; 30-second polling remains the reliable fallback.
    const ch = tables.reduce((channel,table)=>channel.on('postgres_changes',
      {event:'*',schema:'public',table},()=>void qc.invalidateQueries({
        queryKey:[QUERY_PREFIX,classroomId],
      })),supabase.channel('teacher-action-center:' + classroomId));
    ch.subscribe();
    return ()=>{void supabase.removeChannel(ch);};
  },[classroomId,qc]);
  return query;
}
