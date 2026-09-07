import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { recordsGuestbookRpc } from '@/lib/rpc/records_guestbook_rpc';

export function RecordsGuestbookAdminPanel() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['records', 'guestbook', 'admin', classroomId],
    enabled: !!classroomId,
    queryFn: () => recordsGuestbookRpc.teacherBoard(supabase),
  });

  const deleteM = useMutation({
    mutationFn: (entryId: number) =>
      recordsGuestbookRpc.deleteTeacherEntry(supabase, entryId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['records', 'guestbook', 'admin'] }),
        queryClient.invalidateQueries({ queryKey: ['records', 'guestbook'] }),
      ]);
    },
  });

  return (
    <section className="glass-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-2xs font-black tracking-[0.14em] text-gold">
            VISITORS&apos; LEDGER
          </div>
          <h2 className="mt-1 font-display text-lg">방명록 관리</h2>
          <p className="mt-1 text-xs font-bold text-text-muted">
            학생이 남긴 기록을 확인하고, 필요한 경우 부적절한 기록만 삭제합니다.
          </p>
        </div>
        <div className="rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-2xs font-black text-text-secondary">
          {q.data?.total_count ?? 0}개
        </div>
      </div>

      {q.isLoading ? (
        <div className="py-6 text-center text-xs font-bold text-text-muted">
          방명록을 불러오는 중…
        </div>
      ) : q.isError ? (
        <div className="mt-3 rounded-card-md border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs font-bold text-danger">방명록을 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-2 text-xs font-black text-gold hover:underline"
          >
            다시 불러오기
          </button>
        </div>
      ) : !q.data?.rows.length ? (
        <p className="mt-4 text-sm font-bold text-text-muted">아직 방명록 기록이 없습니다.</p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {q.data.rows.map((entry) => (
            <article
              key={entry.id}
              className="min-w-0 rounded-card-md border border-line bg-bg-deep p-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xs font-black text-gold">
                    {entry.school_year} · {entry.student_name}
                  </div>
                  {entry.brand_name ? (
                    <div className="mt-0.5 truncate text-2xs font-bold text-text-muted">
                      {entry.brand_name}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={deleteM.isPending}
                  onClick={() => {
                    if (!window.confirm('이 방명록 기록을 삭제할까요?')) return;
                    deleteM.mutate(entry.id);
                  }}
                  className="shrink-0 text-xs font-black text-danger disabled:opacity-40"
                >
                  삭제
                </button>
              </div>
              <p className="mt-2 text-sm font-bold leading-relaxed text-text-primary [word-break:keep-all] break-words">
                “{entry.message}”
              </p>
              <time
                dateTime={entry.created_at}
                className="mt-2 block text-[10px] font-bold text-text-muted"
              >
                {formatAdminDate(entry.created_at)}
              </time>
            </article>
          ))}
        </div>
      )}

      {deleteM.isError ? (
        <p className="mt-3 text-xs font-bold text-danger">
          방명록 기록을 삭제하지 못했습니다. 다시 시도해 주세요.
        </p>
      ) : null}
    </section>
  );
}

function formatAdminDate(value: string) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
