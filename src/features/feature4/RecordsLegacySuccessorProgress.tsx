import { useQuery } from '@tanstack/react-query';
import { LockKeyhole, ScrollText } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import {
  recordsLegacyStudentQueryKey,
  recordsLegacySuccessorRpc,
} from '@/lib/rpc/records_legacy_successor_rpc';

export function RecordsLegacySuccessorProgress() {
  const studentId = useStudentId();
  const q = useQuery({
    queryKey: recordsLegacyStudentQueryKey(studentId),
    enabled: studentId !== null,
    queryFn: () => recordsLegacySuccessorRpc.studentState(supabase),
    staleTime: 5_000,
    refetchInterval: (query) => {
      const state = query.state.data;
      return state?.seal_confirmed_at && (state.event_status === 'OPEN' || state.event_status === 'UNSEALED') ? 10_000 : false;
    },
    refetchOnWindowFocus: true,
  });

  const state = q.data;
  if (q.isLoading || q.isError || !state?.can_participate || !state.seal_confirmed_at) return null;

  const minimum = Math.max(1, state.minimum_successors || 12);
  const count = Math.max(0, state.registered_count || 0);
  const percent = Math.min(100, Math.round((count / minimum) * 100));
  const locked = state.event_status === 'LOCKED' || state.event_status === 'INHERITED';
  const unsealed = count >= minimum || state.event_status === 'UNSEALED' || locked;
  const helper = locked
    ? '후계자 명부가 확정되었습니다.'
    : unsealed
      ? '봉인 해제'
      : count === minimum - 1
        ? '마지막 한 명의 이름을 기다리고 있습니다.'
        : '봉인이 아직 유지되고 있습니다.';

  return (
    <aside className="relative mt-5 overflow-hidden border border-[#9b7a43]/30 bg-[linear-gradient(90deg,rgba(56,39,23,0.22),rgba(12,10,15,0.78),rgba(56,39,23,0.18))] px-4 py-3 sm:px-5" style={{ borderRadius: '5px 14px 5px 14px' }}>
      <div aria-hidden="true" className="absolute inset-x-[8%] top-0 h-px bg-gradient-to-r from-transparent via-[#d7b263]/45 to-transparent" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#a6864c]/35 bg-black/20 text-[#c4a45f]">
            {locked ? <LockKeyhole className="h-4 w-4" strokeWidth={1.5} /> : <ScrollText className="h-4 w-4" strokeWidth={1.5} />}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-black text-[#dfcca4] sm:text-sm [word-break:keep-all]">기록의 계승자 등록 · 현재 {count}명 / {minimum}명</div>
            <div className={`mt-0.5 text-[10px] font-black sm:text-[11px] ${unsealed ? 'text-[#d9b866]' : 'text-[#8f887c]'}`}>{helper}</div>
          </div>
        </div>
        <div className="h-[5px] w-full overflow-hidden rounded-full bg-black/35 sm:w-48">
          <div className={`h-full rounded-full transition-all duration-700 ${unsealed ? 'bg-[linear-gradient(90deg,#8e6a30,#e0bd6b,#f0d994)] shadow-[0_0_10px_rgba(224,189,107,0.28)]' : 'bg-[linear-gradient(90deg,#71532c,#a8864c)]'}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </aside>
  );
}
