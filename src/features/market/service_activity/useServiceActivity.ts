import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
export type ServiceActivity = { id:number; buyer:boolean; peer:string; title:string; request:string; note:string|null; status:string; trade_mode:string; amount:number|null; reason:string|null; quote_note:string|null; revision:number; delivery:string|null; updated_at:string; has_review?:boolean };
export const isFinished = (o:ServiceActivity) => ['COMPLETED','REJECTED','CANCELLED'].includes(o.status);
export function needsAction(o:ServiceActivity) {
  if (o.trade_mode === 'QUICK') return o.buyer && ['ACCEPTED','DELIVERED','REVISION_REQUESTED'].includes(o.status);
  return o.buyer ? ['QUOTE_OFFERED','DELIVERED'].includes(o.status) : ['QUOTE_REQUESTED','REQUESTED','ACCEPTED','REVISION_REQUESTED'].includes(o.status);
}
export function statusText(o:ServiceActivity) {
  const labels:Record<string,string> = {QUOTE_REQUESTED:o.buyer?'견적 기다리는 중':'견적 요청 도착',QUOTE_OFFERED:o.buyer?'견적 확인 필요':'구매자의 견적 수락 대기',REQUESTED:o.buyer?'판매자 수락 대기':'구매 신청 도착',ACCEPTED:o.buyer?'판매자가 물품/서비스를 곧 제공해드릴게요':'서비스 제공 후 납품 등록',DELIVERED:o.buyer?'납품 도착 · 구매 완료 확인':'구매자의 구매 확정을 기다리고 있어요',REVISION_REQUESTED:o.buyer?'수정 납품 대기':'수정 요청 도착',DISPUTED:'운영국 확인 중',COMPLETED:'거래 완료 · 정산 처리됨',CANCELLED:'거래 취소',REJECTED:'판매자가 거절함'};
  return o.trade_mode==='QUICK' && !isFinished(o) && o.status!=='DISPUTED' ? '기존 간편 거래 · 대금 보관 중' : labels[o.status] ?? o.status;
}
export function useServiceActivity(poll = false) {
 const studentId=useStudentId();
 const query=useQuery({queryKey:['service-activity',studentId],enabled:!!studentId,queryFn:async()=>{const {data,error}=await supabase.rpc('student_get_service_activity');if(error)throw new Error(error.message);return data as ServiceActivity[];},staleTime:15000,refetchInterval:poll ? 60000 : false,refetchIntervalInBackground:false,retry:1});
 return {...query,actionCount:query.data?.filter(needsAction).length??0};
}
