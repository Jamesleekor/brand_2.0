import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { secondaryJobServiceAdHomeRpc } from '@/lib/rpc/secondary_job_service_ad_rpc';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';

const ROTATE_MS = 8_000;

export function HomeServiceAdStrip() {
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);

  const classmateNames = useQuery({
    queryKey: ['home-service-ad-student-names', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id,name')
        .eq('classroom_id', classroomId!);
      if (error) throw new Error(error.message);
      return new Map<number, string>((data ?? []).map((row) => [Number(row.id), row.name]));
    },
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ['home-service-ads', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const result = await secondaryJobServiceAdHomeRpc.board(supabase);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!studentId || !classroomId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: ['home-service-ads', studentId],
      });
    };

    const channel = supabase
      .channel(`home-service-ads:${studentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'secondary_job_service_ads',
          filter: `classroom_id=eq.${classroomId}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [studentId, classroomId, queryClient]);

  const ads = useMemo(() => query.data?.ads ?? [], [query.data?.ads]);

  useEffect(() => {
    setIndex((current) => (ads.length ? current % ads.length : 0));
    if (ads.length <= 1) return;

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % ads.length);
    }, ROTATE_MS);

    return () => window.clearInterval(timer);
  }, [ads.length]);

  if (query.isError || ads.length === 0) return null;

  const ad = ads[index % ads.length];
  if (!ad) return null;
  const sellerName = classmateNames.data?.get(ad.seller_student_id) ?? ad.seller_name;

  return (
    <button
      type="button"
      onClick={() =>
        navigate(`/market/services?view=market&service=${ad.service_id}`)
      }
      className="relative z-10 mx-4 mt-2 flex w-[calc(100%-32px)] min-w-0 items-center gap-2 rounded-card-md border border-gold/35 bg-bg-deep/95 px-3 py-2.5 text-left shadow-card backdrop-blur-card transition hover:border-gold/60 hover:bg-bg-card lg:mx-0 lg:w-full"
      title={`${sellerName}의 서비스 광고 열기`}
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gold/10 text-sm"
      >
        📣
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="flex-none font-black text-gold">SERVICE AD</span>
          <span className="truncate font-extrabold text-slate-200">
            {sellerName} <span className="font-bold text-slate-400">· {ad.job_name}</span>
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-black text-white">
            {ad.service_title}
          </span>
          <span className="flex-none text-2xs font-black text-gold">
            🪙 {formatNumber(ad.service_price_gold)}
          </span>
        </div>
      </div>

      {ads.length > 1 && (
        <span className="flex-none text-[9px] font-black tabular-nums text-text-muted">
          {index + 1}/{ads.length}
        </span>
      )}

      <span className="flex-none text-xs font-black text-gold">→</span>
    </button>
  );
}
