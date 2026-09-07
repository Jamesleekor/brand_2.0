import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import {
  recordsGuestbookRpc,
  type RecordsGuestbookEntry,
} from '@/lib/rpc/records_guestbook_rpc';

const MAX_MESSAGE_LENGTH = 80;

export function RecordsGuestbookPanel() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  const guestbookQ = useQuery({
    queryKey: ['records', 'guestbook'],
    queryFn: () => recordsGuestbookRpc.studentBoard(supabase),
  });

  const myEntry = guestbookQ.data?.my_entry ?? null;

  useEffect(() => {
    setDraft(myEntry?.message ?? '');
  }, [myEntry?.id, myEntry?.message]);

  const saveM = useMutation({
    mutationFn: (message: string) => recordsGuestbookRpc.upsertStudentEntry(supabase, message),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['records', 'guestbook'] });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<number, RecordsGuestbookEntry[]>();
    for (const entry of guestbookQ.data?.rows ?? []) {
      const rows = map.get(entry.school_year) ?? [];
      rows.push(entry);
      map.set(entry.school_year, rows);
    }
    return [...map.entries()].sort(([a], [b]) => b - a);
  }, [guestbookQ.data?.rows]);

  const normalizedDraft = draft.replace(/\s+/g, ' ').trim();
  const canSubmit =
    normalizedDraft.length > 0 &&
    normalizedDraft.length <= MAX_MESSAGE_LENGTH &&
    !saveM.isPending;

  return (
    <section className="relative overflow-hidden rounded-card-lg border border-[#a88645]/45 bg-[radial-gradient(circle_at_50%_0%,rgba(214,174,91,0.12),transparent_36%),linear-gradient(155deg,rgba(24,18,29,0.98),rgba(10,9,16,0.99)_58%,rgba(18,14,21,0.98))]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-[#f0cf83]/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-52 w-80 -translate-x-1/2 rounded-full bg-[#d1a94f]/[0.06] blur-3xl"
      />

      <div className="relative px-4 py-5 sm:px-6 sm:py-6">
        <header className="text-center">
          <div className="text-[10px] font-black tracking-[0.28em] text-[#d8bd7a]">
            VISITORS&apos; LEDGER
          </div>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl text-[#f4ead1] [text-shadow:0_1px_0_rgba(255,255,255,0.16),0_5px_18px_rgba(197,147,51,0.18)]">
            기록실 방명록
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-xs sm:text-sm font-bold leading-relaxed text-[#c9c2b8] [word-break:keep-all]">
            이곳을 지나간 이들의 한마디가 기록실 한편에 남습니다.
          </p>
        </header>

        {guestbookQ.isError ? (
          <div className="mt-5 rounded-card-md border border-danger/30 bg-danger/5 p-3 text-center">
            <p className="text-xs font-bold text-text-secondary">
              방명록을 불러오지 못했습니다.
            </p>
            <button
              type="button"
              onClick={() => void guestbookQ.refetch()}
              className="mt-2 text-xs font-black text-gold hover:underline"
            >
              다시 불러오기
            </button>
          </div>
        ) : guestbookQ.isLoading ? (
          <div className="mt-5 rounded-card-md border border-white/10 bg-black/20 p-5 text-center text-xs font-bold text-text-muted">
            방명록을 펼치는 중…
          </div>
        ) : (
          <>
            {guestbookQ.data?.can_write ? (
              <div className="mx-auto mt-5 max-w-3xl rounded-card-md border border-[#b99149]/35 bg-black/25 p-3.5 sm:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                {myEntry && !editing ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black tracking-[0.16em] text-[#c8aa69]">
                        {myEntry.school_year} · 나의 기록
                      </div>
                      <p className="mt-1 text-sm font-bold leading-relaxed text-[#eee8dc] [word-break:keep-all] break-words">
                        “{myEntry.message}”
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(myEntry.message);
                        setEditing(true);
                      }}
                      className="shrink-0 rounded-pill border border-[#c5a45f]/45 bg-[#c5a45f]/10 px-3 py-1.5 text-xs font-black text-[#ead8ad] transition hover:bg-[#c5a45f]/15"
                    >
                      수정하기
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor="records-guestbook-message"
                        className="text-xs font-black text-[#ead9b3]"
                      >
                        {myEntry ? '나의 문장 다듬기' : '기록실에 한 문장 남기기'}
                      </label>
                      <span className="text-[10px] font-bold text-[#9f988f]">
                        {draft.length} / {MAX_MESSAGE_LENGTH}
                      </span>
                    </div>
                    <textarea
                      id="records-guestbook-message"
                      value={draft}
                      maxLength={MAX_MESSAGE_LENGTH}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="이 기록실을 지나며 남기고 싶은 한마디를 적어 주세요."
                      className="mt-2 min-h-[86px] w-full resize-none rounded-card-md border border-white/10 bg-[#0a0910]/75 px-3 py-2.5 text-sm font-bold leading-relaxed text-[#f0ece4] outline-none placeholder:text-[#746e69] focus:border-[#c8a55d]/55 [word-break:keep-all]"
                    />
                    {saveM.isError ? (
                      <p className="mt-2 text-xs font-bold text-danger">
                        기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      {myEntry ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(myEntry.message);
                            setEditing(false);
                          }}
                          disabled={saveM.isPending}
                          className="rounded-pill border border-white/10 px-3 py-1.5 text-xs font-black text-text-secondary hover:bg-white/5 disabled:opacity-50"
                        >
                          취소
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => saveM.mutate(normalizedDraft)}
                        disabled={!canSubmit}
                        className="rounded-pill border border-[#d0aa55]/60 bg-[linear-gradient(180deg,rgba(211,171,81,0.22),rgba(143,103,38,0.16))] px-4 py-1.5 text-xs font-black text-[#f4dfad] shadow-[0_5px_18px_rgba(174,126,41,0.10)] transition hover:border-[#ebc977]/75 hover:bg-[#c49a4a]/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saveM.isPending
                          ? '새기는 중…'
                          : myEntry
                            ? '기록 수정하기'
                            : '기록 남기기'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-center text-[11px] font-bold text-[#928b82] [word-break:keep-all]">
                공식 참가자만 방명록에 기록을 남길 수 있습니다.
              </p>
            )}

            <div className="mt-6 border-t border-[#b99654]/20 pt-5">
              {!grouped.length ? (
                <div className="py-7 text-center">
                  <div className="text-xl opacity-60">✦</div>
                  <p className="mt-2 text-xs font-bold text-[#918b84]">
                    아직 남겨진 기록이 없습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {grouped.map(([year, entries]) => (
                    <div key={year}>
                      <div className="mb-3 flex items-center gap-3">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#a78445]/30" />
                        <div className="shrink-0 text-[10px] font-black tracking-[0.2em] text-[#c5a866]">
                          {year} · VISITORS
                        </div>
                        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#a78445]/30" />
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {entries.map((entry) => (
                          <GuestbookPlaque key={entry.id} entry={entry} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function GuestbookPlaque({ entry }: { entry: RecordsGuestbookEntry }) {
  return (
    <article className="relative min-w-0 overflow-hidden rounded-card-md border border-[#9f814d]/25 bg-[linear-gradient(145deg,rgba(255,255,255,0.035),rgba(0,0,0,0.18))] px-4 py-3.5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#e2c177]/35 to-transparent"
      />
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-black text-[#c3a663]">
            <span className="whitespace-nowrap">{entry.school_year}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap text-[#eee5d2]">{entry.student_name}</span>
            {entry.is_mine ? (
              <span className="whitespace-nowrap rounded-pill border border-[#c9a85c]/30 bg-[#c9a85c]/10 px-1.5 py-0.5 text-[9px] text-[#ddc486]">
                나
              </span>
            ) : null}
          </div>
          {entry.brand_name ? (
            <div className="mt-0.5 truncate text-[10px] font-bold text-[#817b74]">
              {entry.brand_name}
            </div>
          ) : null}
        </div>
        <time
          dateTime={entry.created_at}
          className="shrink-0 whitespace-nowrap text-[9px] font-bold text-[#77716b]"
        >
          {formatGuestbookDate(entry.created_at)}
        </time>
      </div>
      <p className="mt-3 text-[13px] sm:text-sm font-bold leading-relaxed text-[#ddd7ce] [word-break:keep-all] break-words">
        “{entry.message}”
      </p>
    </article>
  );
}

function formatGuestbookDate(value: string) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(value))
      .replace(/\s/g, '');
  } catch {
    return '';
  }
}
