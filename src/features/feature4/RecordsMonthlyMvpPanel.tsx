import { useQuery } from '@tanstack/react-query';
import {
  Crown,
  ImageOff,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/shared/components';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { recordsHistoryRpc, type MonthlyMvpArchiveRow } from '@/lib/rpc/records_history_rpc';
import { supabase } from '@/lib/supabase/client';

type PortraitSpec = {
  imageUrl: string;
  flip?: boolean;
  accent: 'silver' | 'gold' | 'rose' | 'cyan';
};

const DISPLAY_YEARS = [2023, 2026] as const;

const RIVAL_ORDER_OVERRIDES: Record<string, string[]> = {
  '2026-3': ['류은우', '한서현'],
  '2026-4': ['부희주', '김윤우', '김서영'],
  '2026-5': ['정민준', '김서영', '이태우'],
  '2026-6': ['한서현', '지담', '김서영'],
  '2026-7': ['지담', '한서현', '정우림'],
};

// 2023 월간 MVP는 Production 아카이브의 확정 기록을 그대로 사용한다.
// 특히 2023년 6월 최종 MVP는 공예성으로 확정한다.
const PORTRAITS_2026: Record<string, PortraitSpec> = {
  '3:김서영': {
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/March_MVP.png',
    accent: 'silver',
  },
  '4:류은우': {
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/April_MVP.png',
    accent: 'gold',
  },
  '5:한서현': {
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/May_MVP.png',
    accent: 'rose',
    flip: true,
  },
  '6:류은우': {
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/June_MVP.png',
    accent: 'cyan',
  },
  '7:김서영': {
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/July_MVP-3.png',
    accent: 'gold',
  },
};

const MVP_GALLERY_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700;800;900&display=swap');

.records-mvp-serif {
  font-family: 'Noto Serif KR', 'Nanum Myeongjo', 'Batang', serif;
}

@keyframes recordsMvpLightBreath {
  0%, 100% { opacity: .48; transform: translateX(-50%) scale(.96); }
  50% { opacity: .78; transform: translateX(-50%) scale(1.04); }
}

@keyframes recordsMvpFrameBreath {
  0%, 100% {
    box-shadow:
      0 18px 42px rgba(0,0,0,.30),
      0 0 0 1px rgba(255,231,180,.02),
      0 0 26px rgba(255,211,118,.07);
  }
  50% {
    box-shadow:
      0 22px 48px rgba(0,0,0,.34),
      0 0 0 1px rgba(255,231,180,.035),
      0 0 36px rgba(255,211,118,.12);
  }
}

.records-mvp-light {
  animation: recordsMvpLightBreath 7.8s ease-in-out infinite;
}

.records-mvp-showcase {
  animation: recordsMvpFrameBreath 8.8s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .records-mvp-light,
  .records-mvp-showcase {
    animation: none;
  }
}
`;

export function RecordsMonthlyMvpPanel() {
  const archiveQ = useQuery({
    queryKey: ['f4d-monthly-mvp-archive'],
    queryFn: () => recordsHistoryRpc.monthlyMvpArchive(supabase),
    staleTime: 5 * 60 * 1000,
  });

  const rows = archiveQ.data?.rows ?? [];
  const rowsByYear = new Map<number, MonthlyMvpArchiveRow[]>();

  rows.forEach((row) => {
    const yearRows = rowsByYear.get(row.school_year) ?? [];
    yearRows.push(row);
    rowsByYear.set(row.school_year, yearRows);
  });

  const awardCounts = rows.reduce<Map<string, number>>((acc, row) => {
    acc.set(row.winner_display_name, (acc.get(row.winner_display_name) ?? 0) + 1);
    return acc;
  }, new Map());

  const mostAwards = Math.max(0, ...Array.from(awardCounts.values()));
  const leaders = Array.from(awardCounts.entries())
    .filter(([, count]) => count === mostAwards && count > 0)
    .map(([name]) => name);

  return (
    <div className="space-y-6">
      <style>{MVP_GALLERY_STYLE}</style>

      <ArchiveEntrance
        rowsByYear={rowsByYear}
        leaders={leaders}
        mostAwards={mostAwards}
      />

      {archiveQ.isLoading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-text-muted">
          <LoadingSpinner size="lg" />
          <div className="text-sm font-bold">월간 MVP 전시 기록을 불러오고 있어요.</div>
        </div>
      ) : archiveQ.isError ? (
        <Feature4ErrorPanel domain="F4D" error={archiveQ.error} onRetry={() => void archiveQ.refetch()} />
      ) : (
        <div className="space-y-8">
          <YearGallery
            year={2023}
            rows={rowsByYear.get(2023) ?? []}
          />

          {renderGapBetween(
            2023,
            2026,
            archiveQ.data?.gap_eras ?? [],
          )}

          <YearGallery
            year={2026}
            rows={rowsByYear.get(2026) ?? []}
          />
        </div>
      )}
    </div>
  );
}

function ArchiveEntrance({
  rowsByYear,
  leaders,
  mostAwards,
}: {
  rowsByYear: Map<number, MonthlyMvpArchiveRow[]>;
  leaders: string[];
  mostAwards: number;
}) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-amber-200/20 bg-[radial-gradient(circle_at_15%_0%,rgba(255,211,118,0.11),transparent_32%),radial-gradient(circle_at_90%_18%,rgba(141,165,255,0.10),transparent_28%),linear-gradient(180deg,rgba(20,18,29,0.98),rgba(9,9,17,0.995))] px-5 py-7 shadow-[0_24px_68px_rgba(0,0,0,0.28)] sm:px-7 sm:py-8">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-135px] h-[300px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,220,144,0.12),transparent_68%)] blur-2xl"
      />

      <div className="relative">
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-[10px] font-black tracking-[0.28em] text-amber-200/78">
            B.R.A.N.D · MONTHLY MVP PORTRAIT GALLERY
          </div>
          <h2
            className="records-mvp-serif mt-2 bg-[linear-gradient(180deg,#fff8df_0%,#ffe9aa_24%,#fff8e9_48%,#d6af62_76%,#fff2c3_100%)] bg-clip-text text-[clamp(2rem,4vw,3.2rem)] font-black tracking-[-0.045em] text-transparent [word-break:keep-all]"
            style={{
              textShadow:
                '0 1px 0 rgba(255,248,220,0.38), 0 2px 0 rgba(147,103,18,0.18), 0 10px 24px rgba(0,0,0,0.42), 0 0 16px rgba(255,216,132,0.10)',
            }}
          >
            월간 MVP
          </h2>
          <p className="records-mvp-serif mx-auto mt-3 max-w-2xl text-sm font-bold leading-7 text-amber-50/82 [word-break:keep-all] sm:text-[0.98rem]">
            한 달의 왕관을 쓴 사람과, 끝까지 그 왕관을 다퉜던 이름들을 함께 조명합니다.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {DISPLAY_YEARS.map((year) => {
            const count = rowsByYear.get(year)?.length ?? 0;
            const is2026 = year === 2026;

            return (
              <a
                key={year}
                href={`#monthly-mvp-${year}`}
                className={[
                  'group relative overflow-hidden rounded-[22px] border px-4 py-4 transition duration-200 hover:-translate-y-0.5',
                  is2026
                    ? 'border-sky-200/20 bg-[linear-gradient(135deg,rgba(58,79,130,0.20),rgba(11,13,25,0.78))] hover:border-sky-100/34'
                    : 'border-amber-200/20 bg-[linear-gradient(135deg,rgba(116,78,41,0.18),rgba(18,13,17,0.80))] hover:border-amber-100/34',
                ].join(' ')}
              >
                <div
                  aria-hidden="true"
                  className={[
                    'absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl transition group-hover:opacity-90',
                    is2026 ? 'bg-sky-300/10' : 'bg-amber-300/10',
                  ].join(' ')}
                />

                <div className="relative flex items-center justify-between gap-4">
                  <div>
                    <div className={[
                      'text-[9px] font-black tracking-[0.22em]',
                      is2026 ? 'text-sky-100/64' : 'text-amber-200/64',
                    ].join(' ')}>
                      PORTRAIT WING
                    </div>
                    <div className="records-mvp-serif mt-1 text-2xl font-black text-white">
                      {year} 전시관
                    </div>
                    <div className="mt-1 text-xs font-bold text-white/55">
                      공식 월간 MVP {count}개 기록
                    </div>
                  </div>

                  <div className={[
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border',
                    is2026
                      ? 'border-sky-100/24 bg-sky-100/[0.05] text-sky-100'
                      : 'border-amber-100/24 bg-amber-100/[0.05] text-amber-100',
                  ].join(' ')}>
                    <Crown className="h-5 w-5" strokeWidth={1.45} />
                  </div>
                </div>
              </a>
            );
          })}
        </div>

        {mostAwards > 0 && (
          <div className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-3 rounded-full border border-amber-100/14 bg-black/18 px-4 py-2 text-center">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-200/70" strokeWidth={1.5} />
            <div className="text-[11px] font-bold text-white/62 [word-break:keep-all]">
              현재 아카이브 최다 수상 · <span className="font-black text-amber-100">{leaders.join(' · ')}</span>
              <span className="ml-1.5 text-amber-200">{mostAwards}회</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function YearGallery({
  year,
  rows,
}: {
  year: 2023 | 2026;
  rows: MonthlyMvpArchiveRow[];
}) {
  const sorted = [...rows].sort((a, b) => a.month_no - b.month_no);
  const is2026 = year === 2026;

  return (
    <section
      id={`monthly-mvp-${year}`}
      className={[
        'scroll-mt-24 overflow-hidden rounded-[30px] border shadow-[0_26px_72px_rgba(0,0,0,0.26)]',
        is2026
          ? 'border-sky-200/18 bg-[radial-gradient(circle_at_88%_0%,rgba(102,143,230,0.13),transparent_32%),linear-gradient(180deg,rgba(15,20,34,0.98),rgba(7,9,17,1))]'
          : 'border-amber-200/18 bg-[radial-gradient(circle_at_12%_0%,rgba(195,132,65,0.13),transparent_32%),linear-gradient(180deg,rgba(31,22,20,0.98),rgba(12,10,15,1))]',
      ].join(' ')}
    >
      <YearGalleryHeader year={year} count={sorted.length} />

      {sorted.length > 0 ? (
        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-2">
          {sorted.map((row, index) => (
            <MvpPortraitShowcase
              key={row.period_key}
              row={row}
              year={year}
              index={index}
            />
          ))}
        </div>
      ) : (
        <div className="p-5 sm:p-7">
          <div className="flex min-h-[230px] flex-col items-center justify-center rounded-[24px] border border-dashed border-white/14 bg-black/18 px-6 text-center">
            <Crown className={is2026 ? 'h-10 w-10 text-sky-100/42' : 'h-10 w-10 text-amber-100/42'} strokeWidth={1.25} />
            <div className="records-mvp-serif mt-4 text-xl font-black text-white/84">
              전시 기록을 기다리고 있습니다
            </div>
            <div className="mt-2 text-xs font-bold text-white/48">
              공식 월간 MVP 기록이 등록되면 이 전시관에 조명됩니다.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function YearGalleryHeader({
  year,
  count,
}: {
  year: 2023 | 2026;
  count: number;
}) {
  const is2026 = year === 2026;

  return (
    <header className={[
      'relative overflow-hidden border-b px-5 py-5 sm:px-7 sm:py-6',
      is2026 ? 'border-sky-100/12' : 'border-amber-100/12',
    ].join(' ')}>
      <div
        aria-hidden="true"
        className={[
          'absolute left-1/2 top-[-120px] h-[230px] w-[560px] -translate-x-1/2 rounded-full blur-2xl',
          is2026 ? 'bg-sky-200/[0.07]' : 'bg-amber-200/[0.07]',
        ].join(' ')}
      />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className={[
            'text-[10px] font-black tracking-[0.24em]',
            is2026 ? 'text-sky-100/64' : 'text-amber-200/64',
          ].join(' ')}>
            {year} · MONTHLY MVP PORTRAIT WING
          </div>
          <h3 className="records-mvp-serif mt-1 text-[clamp(1.65rem,3.5vw,2.4rem)] font-black tracking-[-0.04em] text-white [word-break:keep-all]">
            {year} 월간 MVP 전시관
          </h3>
          <p className="mt-2 text-xs font-bold leading-6 text-white/56 [word-break:keep-all] sm:text-sm">
            {is2026
              ? '월별 최종 수상자를 초상과 함께 전시하고, 그 달의 공식 본선 대적자를 함께 기록합니다.'
              : '2023년 월별 최종 수상자와 그 달의 공식 본선 대적자를 함께 보존합니다.'}
          </p>
        </div>

        <div className={[
          'w-fit rounded-full border px-3 py-1.5 text-[10px] font-black',
          is2026
            ? 'border-sky-100/18 bg-sky-100/[0.04] text-sky-100/72'
            : 'border-amber-100/18 bg-amber-100/[0.04] text-amber-100/72',
        ].join(' ')}>
          {count} PRESERVED CROWNS
        </div>
      </div>
    </header>
  );
}

function MvpPortraitShowcase({
  row,
  year,
  index,
}: {
  row: MonthlyMvpArchiveRow;
  year: 2023 | 2026;
  index: number;
}) {
  const rivals = resolveRivals(row);
  const portrait = resolvePortrait(row);
  const is2026 = year === 2026;

  const accent = portrait?.accent ?? (is2026 ? 'silver' : 'gold');
  const accentClass = {
    silver: {
      border: 'border-slate-200/22',
      line: 'via-slate-100/46',
      glow: 'rgba(188,214,238,0.20)',
      light: 'rgba(188,214,238,0.16)',
      text: 'text-slate-100',
    },
    gold: {
      border: 'border-amber-100/24',
      line: 'via-amber-100/50',
      glow: 'rgba(255,203,102,0.22)',
      light: 'rgba(255,203,102,0.17)',
      text: 'text-amber-100',
    },
    rose: {
      border: 'border-rose-200/22',
      line: 'via-rose-100/46',
      glow: 'rgba(251,146,175,0.20)',
      light: 'rgba(251,146,175,0.15)',
      text: 'text-rose-100',
    },
    cyan: {
      border: 'border-cyan-100/22',
      line: 'via-cyan-100/46',
      glow: 'rgba(125,231,239,0.19)',
      light: 'rgba(125,231,239,0.15)',
      text: 'text-cyan-100',
    },
  }[accent];

  return (
    <article className={[
      'records-mvp-showcase relative isolate overflow-hidden rounded-[26px] border bg-[linear-gradient(180deg,rgba(17,17,27,0.82),rgba(7,8,15,0.94))] p-3.5 sm:p-4',
      accentClass.border,
    ].join(' ')}>
      <div
        aria-hidden="true"
        className="records-mvp-light pointer-events-none absolute left-1/2 top-[-112px] h-[260px] w-[240px] -translate-x-1/2 rounded-[50%]"
        style={{
          background: `radial-gradient(ellipse, ${accentClass.light} 0%, transparent 70%)`,
          filter: 'blur(14px)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-70px] left-1/2 h-[150px] w-[76%] -translate-x-1/2 rounded-[50%]"
        style={{
          background: `radial-gradient(ellipse, ${accentClass.glow} 0%, transparent 68%)`,
          filter: 'blur(18px)',
        }}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent ${accentClass.line} to-transparent`}
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className={[
            'text-[10px] font-black tracking-[0.18em]',
            accentClass.text,
          ].join(' ')}>
            {year} · {row.month_no}월
          </div>
          <div className="rounded-full border border-white/12 bg-black/22 px-2.5 py-1 text-[9px] font-black tracking-[0.12em] text-white/58">
            MONTHLY MVP
          </div>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(150px,0.86fr)_minmax(0,1.14fr)] sm:items-center">
          <PortraitStage
            row={row}
            portrait={portrait}
            year={year}
          />

          <div className="min-w-0 py-1 sm:py-3">
            <div className="text-[10px] font-black tracking-[0.18em] text-amber-100/74">
              최종 수상
            </div>
            <div
              className="records-mvp-serif mt-1.5 whitespace-nowrap text-[clamp(1.7rem,4.4vw,2.45rem)] font-black leading-none tracking-[-0.045em]"
              style={{
                color: '#fff0c8',
                textShadow: `0 2px 0 rgba(172,113,37,.20), 0 8px 20px rgba(0,0,0,.50), 0 16px 28px ${accentClass.glow}`,
              }}
            >
              {row.winner_display_name}
            </div>

            <div className="mt-3 flex items-center gap-2" aria-hidden="true">
              <span className={`h-px flex-1 bg-gradient-to-r from-transparent ${accentClass.line}`} />
              <Crown className={`h-4 w-4 ${accentClass.text}`} strokeWidth={1.35} />
              <span className={`h-px flex-1 bg-gradient-to-l from-transparent ${accentClass.line}`} />
            </div>

            <div className="mt-4">
              <div className="flex items-center gap-2">
                <UsersRound className="h-4 w-4 text-amber-100/68" strokeWidth={1.45} />
                <div className="text-[10px] font-black tracking-[0.12em] text-amber-50/82">
                  그 달의 대적자
                </div>
              </div>

              {rivals.length > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {rivals.map((name) => (
                    <div
                      key={`${row.period_key}-${name}`}
                      className="min-w-0 rounded-[14px] border border-white/11 bg-black/24 px-2.5 py-2 text-center"
                    >
                      <div className="records-mvp-serif whitespace-nowrap text-[13px] font-extrabold text-white/86 sm:text-sm">
                        {name}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-[14px] border border-dashed border-white/10 bg-black/16 px-3 py-3 text-center text-[10px] font-bold text-white/34">
                  공식 본선 대적자 기록 없음
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 text-center text-[9px] font-black tracking-[0.16em] text-white/28">
          OFFICIAL MONTHLY MVP ARCHIVE · {String(index + 1).padStart(2, '0')}
        </div>
      </div>
    </article>
  );
}


function resolveRivals(row: MonthlyMvpArchiveRow) {
  const override = RIVAL_ORDER_OVERRIDES[`${row.school_year}-${row.month_no}`];
  if (override) return override;

  return row.finalists.filter((name) => name !== row.winner_display_name);
}

function PortraitStage({
  row,
  portrait,
  year,
}: {
  row: MonthlyMvpArchiveRow;
  portrait: PortraitSpec | null;
  year: 2023 | 2026;
}) {
  if (!portrait) {
    return (
      <div className="relative mx-auto w-full max-w-[230px]">
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-[-36px] h-[130px] w-[150px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse,rgba(255,213,130,0.11),transparent_70%)] blur-xl"
        />
        <div className="relative aspect-[9/13] overflow-hidden rounded-t-[92px] rounded-b-[24px] border border-amber-100/20 bg-[radial-gradient(circle_at_50%_22%,rgba(255,219,146,0.08),transparent_34%),linear-gradient(180deg,rgba(39,29,27,0.78),rgba(8,8,14,0.92))] shadow-[inset_0_0_40px_rgba(255,217,145,0.025),0_18px_34px_rgba(0,0,0,0.30)]">
          <div className="absolute inset-[8px] rounded-t-[84px] rounded-b-[18px] border border-amber-100/[0.07]" />
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-100/18 bg-black/22 text-amber-100/52 shadow-[0_0_24px_rgba(255,211,119,0.08)]">
              <ImageOff className="h-7 w-7" strokeWidth={1.25} />
            </div>
            <div className="records-mvp-serif mt-4 text-sm font-extrabold text-amber-50/72">
              {year} 초상 전시 자리
            </div>
            <div className="mt-1.5 text-[9px] font-black tracking-[0.16em] text-amber-100/34">
              PORTRAIT RESERVED
            </div>
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-x-[16%] bottom-0 h-px bg-gradient-to-r from-transparent via-amber-100/34 to-transparent"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[230px]">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-34px] h-[130px] w-[160px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse,rgba(255,232,176,0.13),transparent_70%)] blur-xl"
      />
      <div className="relative aspect-[9/13] overflow-hidden rounded-t-[92px] rounded-b-[24px] border border-white/18 bg-black/60 shadow-[0_18px_36px_rgba(0,0,0,0.34)]">
        <img
          src={portrait.imageUrl}
          alt={`${row.period_label} 월간 MVP ${row.winner_display_name}`}
          className={[
            'h-full w-full object-contain object-center',
            portrait.flip ? '-scale-x-100' : '',
          ].join(' ')}
          loading="lazy"
        />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-black/38 to-transparent" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[32%] bg-gradient-to-t from-black/66 via-black/16 to-transparent" />
        <div aria-hidden="true" className="absolute inset-[7px] rounded-t-[84px] rounded-b-[18px] border border-white/[0.07]" />
      </div>
    </div>
  );
}

function resolvePortrait(row: MonthlyMvpArchiveRow): PortraitSpec | null {
  const metadataUrl = readMetadataString(row.metadata, [
    'portrait_url',
    'image_url',
    'mvp_portrait_url',
  ]);

  if (metadataUrl) {
    return {
      imageUrl: metadataUrl,
      accent: 'gold',
    };
  }

  if (row.school_year !== 2026) return null;

  return PORTRAITS_2026[`${row.month_no}:${row.winner_display_name}`] ?? null;
}

function readMetadataString(
  metadata: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function renderGapBetween(
  startYear: number,
  endYear: number,
  gaps: Array<{ start_year: number; end_year: number; title: string; subtitle: string }>,
) {
  const gap = gaps.find((item) => item.start_year > startYear && item.end_year < endYear);
  if (!gap) return null;

  return (
    <div
      key={`${gap.start_year}-${gap.end_year}`}
      className="relative overflow-hidden rounded-[24px] border border-dashed border-white/12 bg-[linear-gradient(180deg,rgba(12,12,20,0.86),rgba(7,8,14,0.92))] px-4 py-6 text-center"
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
      <div className="relative mx-auto w-fit bg-[#0a0a12] px-6">
        <div className="text-[10px] font-black tracking-[0.20em] text-white/34">
          {gap.start_year}–{gap.end_year}
        </div>
        <div className="records-mvp-serif mt-1 text-xl font-black text-white/72">
          {gap.title}
        </div>
        <div className="mt-1 text-xs font-bold text-white/38 [word-break:keep-all]">
          {gap.subtitle}
        </div>
      </div>
    </div>
  );
}
