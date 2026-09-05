import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  ChevronRight,
  Coins,
  Crown,
  DoorOpen,
  Gamepad2,
  Gem,
  Landmark,
  LineChart,
  Medal,
  Rocket,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { RecordsHonorOfficialPanels } from '@/features/feature4/RecordsHonorOfficialPanels';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { RecordsPioneersHall } from '@/features/feature4/RecordsPioneersHall';
import { supabase } from '@/lib/supabase/client';
import {
  recordsHistoryRpc,
  type HallAchievementDetail,
  type HallKey,
  type HallOfGloryEntry,
} from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const RANK_LABEL: Record<string, string> = {
  TIER: '티어',
  BRAND_VALUE: '브랜드 가치',
  GOLD_ASSET: 'GOLD 자산',
  CRYSTAL_ASSET: 'CRYSTAL 자산',
  ACHIEVEMENT_COUNT: '업적 수',
  CONTRIBUTION: '기여도',
};

type HallDefinition = {
  key: HallKey;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  special?: boolean;
  portalClass: string;
  iconClass: string;
  hallLabelClass: string;
  transitionGlow: string;
};

const HALLS: HallDefinition[] = [
  {
    key: 'PIONEERS',
    icon: DoorOpen,
    title: 'B.R.A.N.D의 개척자',
    subtitle: '누가 처음 문을 열었는가',
    portalClass: 'border-amber-300/25 bg-[radial-gradient(circle_at_50%_0%,rgba(217,154,78,0.10),transparent_42%),linear-gradient(180deg,rgba(51,34,26,0.52),rgba(15,11,26,0.90))] hover:border-amber-300/45',
    iconClass: 'border-amber-300/30 bg-amber-200/[0.07] text-amber-200',
    hallLabelClass: 'text-amber-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(208,145,73,0.15),transparent_42%)]',
  },
  {
    key: 'THRONE',
    icon: Crown,
    title: '정점의 왕좌',
    subtitle: '현재까지 숫자로 증명된 절대 정점',
    portalClass: 'border-yellow-200/25 bg-[radial-gradient(circle_at_50%_0%,rgba(255,226,119,0.10),transparent_42%),linear-gradient(180deg,rgba(41,36,31,0.48),rgba(15,11,26,0.90))] hover:border-yellow-200/50',
    iconClass: 'border-yellow-200/30 bg-yellow-100/[0.07] text-yellow-100',
    hallLabelClass: 'text-yellow-100',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(255,226,119,0.14),transparent_42%)]',
  },
  {
    key: 'REPEATED_CROWNS',
    icon: Medal,
    title: '왕관을 거듭 쓴 자',
    subtitle: '월간 MVP 무대에 반복해서 이름을 올린 이들',
    portalClass: 'border-rose-300/20 bg-[radial-gradient(circle_at_50%_0%,rgba(191,84,112,0.11),transparent_42%),linear-gradient(180deg,rgba(48,25,38,0.48),rgba(15,11,26,0.90))] hover:border-rose-300/42',
    iconClass: 'border-rose-300/28 bg-rose-300/[0.06] text-rose-200',
    hallLabelClass: 'text-rose-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(180,66,103,0.14),transparent_42%)]',
  },
  {
    key: 'ASCENT',
    icon: Rocket,
    title: '비상의 궤적',
    subtitle: '가장 가파른 성장의 순간',
    portalClass: 'border-cyan-300/20 bg-[radial-gradient(circle_at_50%_0%,rgba(77,185,191,0.10),transparent_42%),linear-gradient(180deg,rgba(21,42,49,0.48),rgba(15,11,26,0.90))] hover:border-cyan-300/42',
    iconClass: 'border-cyan-300/28 bg-cyan-300/[0.06] text-cyan-200',
    hallLabelClass: 'text-cyan-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(65,176,186,0.14),transparent_42%)]',
  },
  {
    key: 'GOLDEN_CHRONICLE',
    icon: Coins,
    title: '황금의 연대기',
    subtitle: 'B.R.A.N.D 경제를 움직이고 나눈 기록',
    portalClass: 'border-orange-300/22 bg-[radial-gradient(circle_at_50%_0%,rgba(203,132,54,0.10),transparent_42%),linear-gradient(180deg,rgba(49,34,21,0.50),rgba(15,11,26,0.90))] hover:border-orange-300/44',
    iconClass: 'border-orange-300/28 bg-orange-300/[0.06] text-orange-200',
    hallLabelClass: 'text-orange-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(198,126,48,0.14),transparent_42%)]',
  },
  {
    key: 'GUILD_HEGEMONY',
    icon: Swords,
    title: '길드 패권사',
    subtitle: '길드의 승리와 기여가 남긴 역사',
    portalClass: 'border-red-300/18 bg-[radial-gradient(circle_at_50%_0%,rgba(150,69,69,0.11),transparent_42%),linear-gradient(180deg,rgba(42,27,29,0.52),rgba(15,11,26,0.90))] hover:border-red-300/40',
    iconClass: 'border-red-300/25 bg-red-300/[0.055] text-red-200',
    hallLabelClass: 'text-red-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(143,61,67,0.14),transparent_42%)]',
  },
  {
    key: 'ARCADE_RULERS',
    icon: Gamepad2,
    title: '아케이드의 지배자',
    subtitle: 'FINALIZED 기록으로 증명되는 게임의 왕좌',
    portalClass: 'border-sky-300/20 bg-[radial-gradient(circle_at_50%_0%,rgba(67,134,196,0.11),transparent_42%),linear-gradient(180deg,rgba(23,33,51,0.52),rgba(15,11,26,0.90))] hover:border-sky-300/42',
    iconClass: 'border-sky-300/28 bg-sky-300/[0.06] text-sky-200',
    hallLabelClass: 'text-sky-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(61,125,190,0.14),transparent_42%)]',
  },
  {
    key: 'CONSTELLATION',
    icon: Sparkles,
    title: '위업의 성좌',
    subtitle: '희귀하고 높은 업적을 세운 이들의 특별관',
    special: true,
    portalClass: 'border-violet-300/25 bg-[radial-gradient(circle_at_50%_0%,rgba(139,110,213,0.13),transparent_44%),linear-gradient(180deg,rgba(35,28,57,0.58),rgba(15,11,26,0.92))] hover:border-violet-300/48 shadow-[0_0_28px_rgba(139,110,213,0.05)]',
    iconClass: 'border-violet-300/32 bg-violet-300/[0.07] text-violet-200',
    hallLabelClass: 'text-violet-200',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(128,98,205,0.16),transparent_42%)]',
  },
  {
    key: 'SOVEREIGN_PROOF',
    icon: Trophy,
    title: '제왕의 증명',
    subtitle: '여러 영역에서 동시에 가치를 증명한 이들의 특별관',
    special: true,
    portalClass: 'border-fuchsia-200/20 bg-[radial-gradient(circle_at_50%_0%,rgba(151,85,174,0.12),transparent_42%),linear-gradient(180deg,rgba(41,24,53,0.58),rgba(15,11,26,0.92))] hover:border-fuchsia-200/42 shadow-[0_0_28px_rgba(151,85,174,0.045)]',
    iconClass: 'border-fuchsia-200/28 bg-fuchsia-200/[0.06] text-fuchsia-100',
    hallLabelClass: 'text-fuchsia-100',
    transitionGlow: 'bg-[radial-gradient(circle_at_50%_42%,rgba(145,79,168,0.15),transparent_42%)]',
  },
];

export function RecordsHonorPanel({ data, grouped, studentId }: { data: any; grouped: Map<string, any[]>; studentId: number | null }) {
  const historyQ = useQuery({
    queryKey: ['f4d-hall-of-glory'],
    queryFn: () => recordsHistoryRpc.hallOfGlory(supabase),
    staleTime: 5 * 60 * 1000,
  });
  const [transitionHall, setTransitionHall] = useState<HallDefinition | null>(null);
  const [transitionVisible, setTransitionVisible] = useState(false);

  const entriesByHall = new Map<HallKey, HallOfGloryEntry[]>();
  (historyQ.data?.entries ?? []).forEach((entry) => {
    const rows = entriesByHall.get(entry.hall_key) ?? [];
    rows.push(entry);
    entriesByHall.set(entry.hall_key, rows);
  });

  const enterHall = (hall: HallDefinition) => {
    if (transitionHall) return;
    setTransitionHall(hall);
    window.setTimeout(() => setTransitionVisible(true), 20);
    window.setTimeout(() => {
      document.getElementById(`hall-${hall.key.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 260);
    window.setTimeout(() => setTransitionVisible(false), 560);
    window.setTimeout(() => setTransitionHall(null), 980);
  };

  return (
    <div id="hall-of-glory-top" className="space-y-8 sm:space-y-10">
      <HallTransitionOverlay hall={transitionHall} visible={transitionVisible} />

      {historyQ.isLoading ? (
        <EntranceLoading />
      ) : historyQ.isError ? (
        <Feature4ErrorPanel domain="F4D" error={historyQ.error} onRetry={() => void historyQ.refetch()} />
      ) : (
        <>
          <HallEntrance entriesByHall={entriesByHall} onEnter={enterHall} />

          {(historyQ.data?.gap_eras ?? []).map((gap) => (
            <section key={`${gap.start_year}-${gap.end_year}`} className="relative overflow-hidden rounded-card-lg border border-dashed border-line bg-bg-deep/70 px-5 py-6 text-center sm:px-8">
              <div aria-hidden="true" className="absolute inset-x-8 top-1/2 h-px bg-line/50" />
              <div className="relative mx-auto inline-block bg-bg-deep px-6 sm:px-10">
                <div className="text-xs font-black tracking-[0.2em] text-text-secondary">{gap.start_year}–{gap.end_year}</div>
                <div className="mt-1 font-display text-xl text-text-primary">{gap.title}</div>
                <div className="mt-1 text-sm font-bold text-text-secondary">{gap.subtitle}</div>
              </div>
            </section>
          ))}

          <div className="space-y-12 sm:space-y-14">
            {HALLS.map((hall, index) => (
              <HallSection
                key={hall.key}
                hall={hall}
                index={index + 1}
                entries={entriesByHall.get(hall.key) ?? []}
              />
            ))}
          </div>
        </>
      )}

      <details className="group rounded-card-md border border-line bg-bg-card/75">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-start gap-3">
            <ScrollText className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <div>
              <div className="text-sm font-extrabold text-text-primary">공식 확정 원장 참고</div>
              <div className="mt-1 text-xs font-bold text-text-secondary">길드·Arcade의 FINALIZED 원본은 필요할 때만 펼쳐 확인합니다.</div>
            </div>
          </div>
          <span className="text-text-secondary transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-4 py-4">
          <RecordsHonorOfficialPanels />
        </div>
      </details>

      <details className="group rounded-card-md border border-line bg-bg-card/75">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-bv" />
            <div>
              <div className="text-sm font-extrabold text-text-primary">현재 시즌 참고 기록</div>
              <div className="mt-1 text-xs font-bold text-text-secondary">최신 랭킹과 학급 통계는 영광의 전당과 분리된 보조 자료입니다.</div>
            </div>
          </div>
          <span className="text-text-secondary transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-6 border-t border-line px-4 py-5">
          <section>
            <SectionTitle icon={BarChart3} title="최신 공식 랭킹" description={data?.date ? `${data.date} 기준 · 각 부문 TOP 5` : '선생님이 확정한 가장 최근 랭킹 snapshot'} />
            {grouped.size === 0 ? (
              <EmptyState emoji="📊" title="아직 공식 랭킹 snapshot이 없어요" description="선생님이 기록 갱신을 실행하면 공식 참가자만 포함한 랭킹이 생성됩니다." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from(grouped.entries()).map(([type, rows]) => (
                  <div key={type} className="rounded-card-md border border-line bg-bg-deep p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-black text-bv">{RANK_LABEL[type] || type}</div>
                      <OfficialBadge compact />
                    </div>
                    {rows.slice(0, 5).map((rank: any) => (
                      <div key={`${type}-${rank.student_id}`} className={`flex items-center justify-between gap-3 rounded-card-sm px-2 py-2 text-xs ${rank.student_id === studentId ? 'bg-gold/10' : ''}`}>
                        <span className={rank.student_id === studentId ? 'font-black text-gold' : 'font-bold text-text-secondary'}>
                          {rank.rank_position}. {rank.student?.name || rank.student?.brand_name}
                          {rank.student_id === studentId && <span className="ml-1 text-2xs">나</span>}
                        </span>
                        <span className="font-mono text-text-primary">{formatNumber(rank.value)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle icon={LineChart} title="학급 최신 통계" description="공식 참가자 기준으로 생성된 가장 최근 일일 통계 snapshot" />
            {!data?.stats ? (
              <EmptyState emoji="📈" title="아직 학급 통계 snapshot이 없어요" description="선생님이 기록 갱신을 실행하면 자산·거래 통계가 이곳에 표시됩니다." />
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <OfficialBadge />
                  <span className="text-xs font-bold text-text-secondary">{data.stats.stat_date} 기준</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Mini label="학급 총 GOLD" value={formatNumber(data.stats.total_gold)} />
                  <Mini label="학급 총 BV" value={formatNumber(data.stats.total_bv)} />
                  <Mini label="학급 총 CRYSTAL" value={formatNumber(data.stats.total_crystal)} />
                  <Mini label="snapshot 거래" value={formatNumber(data.stats.transactions_count)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Mini label="Gini GOLD" value={Number(data.stats.gini_gold).toFixed(3)} />
                  <Mini label="Gini BV" value={Number(data.stats.gini_bv).toFixed(3)} />
                </div>
              </div>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}

function EntranceLoading() {
  return (
    <section className="relative overflow-hidden rounded-card-lg border border-gold/30 bg-[radial-gradient(circle_at_50%_10%,rgba(255,217,61,0.08),transparent_34%),linear-gradient(180deg,rgba(23,17,35,0.96),rgba(10,8,17,0.98))] px-5 py-16 text-center sm:px-8 sm:py-20">
      <Landmark className="mx-auto h-12 w-12 text-gold/45" strokeWidth={1.3} />
      <div className="mt-5 flex justify-center"><LoadingSpinner size="lg" /></div>
      <div className="mt-4 font-display text-xl text-text-primary">영광의 전당을 열고 있습니다</div>
      <div className="mt-2 text-sm font-bold text-text-secondary">기록과 전시관을 준비하고 있어요.</div>
    </section>
  );
}

function HallEntrance({ entriesByHall, onEnter }: { entriesByHall: Map<HallKey, HallOfGloryEntry[]>; onEnter: (hall: HallDefinition) => void }) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-gold/30 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,217,61,0.10),transparent_32%),radial-gradient(circle_at_16%_40%,rgba(177,151,252,0.055),transparent_26%),linear-gradient(180deg,rgba(22,16,34,0.98),rgba(10,8,17,0.99))] px-4 py-7 shadow-[0_26px_70px_rgba(0,0,0,0.22)] sm:px-7 sm:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[8%] top-0 h-24 rounded-b-[50%] border-b border-gold/[0.07]" />
      <Landmark aria-hidden="true" className="pointer-events-none absolute left-1/2 top-7 h-52 w-52 -translate-x-1/2 text-white/[0.018] sm:h-64 sm:w-64" strokeWidth={1.05} />

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="text-[11px] font-black tracking-[0.28em] text-gold/70 sm:text-xs">THE HALL OF GLORY · B.R.A.N.D ARCHIVE</div>
        <h2 className="mt-4 font-display text-3xl text-white sm:text-5xl [word-break:keep-all]">영광의 전당</h2>
        <p className="mt-3 text-base font-extrabold text-gold sm:text-xl [word-break:keep-all]">시간을 넘어 B.R.A.N.D에 이름을 새긴 이들의 기록</p>
        <p className="mx-auto mt-4 max-w-2xl text-sm font-semibold leading-7 text-text-secondary sm:text-base sm:leading-8 [word-break:keep-all]">
          최초의 발자취, 절대적인 정점, 길드의 승리와 특별한 위업. 이곳의 기록은 빠르게 소비되는 정보가 아니라 오래도록 보존되는 하나의 역사입니다.
        </p>
        <div className="mx-auto mt-6 flex max-w-xl items-center gap-3 text-gold/35" aria-hidden="true">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-current" />
          <Gem className="h-4 w-4" strokeWidth={1.4} />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-current" />
        </div>
      </div>

      <div className="relative mt-8 sm:mt-10">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-black tracking-[0.18em] text-bv">EXHIBITION VESTIBULE</div>
            <h3 className="mt-1 font-display text-xl text-text-primary sm:text-2xl">전시관을 선택하세요</h3>
          </div>
          <div className="text-xs font-bold text-text-secondary">선택한 전시관의 문이 조용히 열립니다.</div>
        </div>

        <nav aria-label="영광의 전당 전시관 입구" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HALLS.map((hall, index) => {
            const Icon = hall.icon;
            const recordCount = countRecordGroups(entriesByHall.get(hall.key) ?? []);
            return (
              <button
                key={hall.key}
                type="button"
                onClick={() => onEnter(hall)}
                className={`group relative min-h-[172px] overflow-hidden rounded-t-[34px] rounded-b-[16px] border p-4 text-center transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${hall.portalClass}`}
              >
                <div aria-hidden="true" className="absolute inset-[7px] rounded-t-[29px] rounded-b-[12px] border border-white/[0.035]" />
                <div aria-hidden="true" className="absolute left-1/2 top-0 h-14 w-px -translate-x-1/2 bg-gradient-to-b from-white/[0.08] to-transparent" />
                <div aria-hidden="true" className="absolute -right-1 bottom-0 font-display text-[72px] leading-none text-white/[0.018]">{String(index + 1).padStart(2, '0')}</div>

                <div className="relative flex h-full min-h-[140px] flex-col">
                  <div className="flex items-center justify-between gap-2 text-left">
                    <span className={`text-[10px] font-black tracking-[0.18em] ${hall.hallLabelClass}`}>HALL {String(index + 1).padStart(2, '0')}</span>
                    <span className="text-[10px] font-bold text-text-secondary">{recordCount > 0 ? `${recordCount}개의 기록` : '기록을 기다리는 중'}</span>
                  </div>

                  <div className="flex flex-1 items-center justify-center px-3 py-4">
                    <div className="flex max-w-[250px] flex-col items-center text-center">
                      <span className={`flex h-11 w-11 items-center justify-center rounded-t-[18px] rounded-b-[10px] border ${hall.iconClass}`}>
                        <Icon className="h-5 w-5" strokeWidth={1.65} />
                      </span>
                      <span className="mt-3 block font-display text-lg leading-6 text-text-primary transition-colors group-hover:text-white sm:text-xl [word-break:keep-all]">{hall.title}</span>
                      <span className="mt-1.5 block text-xs font-bold leading-5 text-text-secondary [word-break:keep-all]">{hall.subtitle}</span>
                    </div>
                  </div>

                  <ChevronRight className={`absolute bottom-0 right-0 h-5 w-5 opacity-38 transition group-hover:translate-x-0.5 group-hover:opacity-75 ${hall.hallLabelClass}`} strokeWidth={1.6} />
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-white/[0.045] pt-5 text-xs font-bold text-text-secondary">
        <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-gold/70" />공식 참가자 기준으로 기록을 산정합니다.</span>
        <span className="hidden text-white/20 sm:inline" aria-hidden="true">·</span>
        <span>전시관마다 고유한 기록과 분위기가 이어집니다.</span>
      </div>
    </section>
  );
}

function HallTransitionOverlay({ hall, visible }: { hall: HallDefinition | null; visible: boolean }) {
  if (!hall) return null;
  const index = HALLS.findIndex((item) => item.key === hall.key) + 1;
  const Icon = hall.icon;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-0 z-[90] transition-opacity duration-500 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="absolute inset-0 bg-[#080611]/45 backdrop-blur-[1px]" />
      <div className={`absolute inset-0 ${hall.transitionGlow}`} />
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="flex items-center gap-4 rounded-full border border-white/[0.07] bg-[#0d0916]/55 px-5 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
          <Icon className={`h-5 w-5 ${hall.hallLabelClass}`} strokeWidth={1.45} />
          <div>
            <div className={`text-[10px] font-black tracking-[0.18em] ${hall.hallLabelClass}`}>HALL {String(index).padStart(2, '0')}</div>
            <div className="mt-0.5 font-display text-base text-white sm:text-lg">{hall.title}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HallSection({ hall, entries, index }: { hall: HallDefinition; entries: HallOfGloryEntry[]; index: number }) {
  if (hall.key === 'PIONEERS') {
    return <RecordsPioneersHall entries={entries} />;
  }

  const grouped = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = grouped.get(entry.record_type) ?? [];
    rows.push(entry);
    grouped.set(entry.record_type, rows);
  });

  const recordGroups = Array.from(grouped.entries());
  const Icon = hall.icon;

  return (
    <section
      id={`hall-${hall.key.toLowerCase()}`}
      className={`scroll-mt-24 overflow-hidden rounded-card-lg border ${hall.special ? 'border-gold/40 bg-[radial-gradient(circle_at_92%_0%,rgba(255,217,61,0.11),transparent_28%),linear-gradient(145deg,rgba(255,217,61,0.055),rgba(177,151,252,0.075),rgba(15,11,26,0.92))] shadow-[0_0_34px_rgba(255,217,61,0.07)]' : 'border-line bg-bg-card'}`}
    >
      <header className="relative border-b border-line/80 px-5 py-6 sm:px-7 sm:py-7">
        <div aria-hidden="true" className="absolute right-5 top-1/2 -translate-y-1/2 font-display text-7xl text-white/[0.025] sm:right-8 sm:text-8xl">
          {String(index).padStart(2, '0')}
        </div>
        <div className="relative flex items-start gap-4 sm:gap-5">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-card-md border sm:h-16 sm:w-16 ${hall.special ? 'border-gold/40 bg-gold/10 text-gold shadow-[0_0_24px_rgba(255,217,61,0.10)]' : 'border-bv/25 bg-bg-deep text-bv'}`}>
            <Icon className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.7} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black tracking-[0.16em] text-gold/80">HALL {String(index).padStart(2, '0')}</span>
              {hall.special && <span className="rounded-pill border border-gold/40 bg-gold/10 px-2.5 py-1 text-[10px] font-black text-gold">SPECIAL HALL</span>}
            </div>
            <h3 className="mt-1 font-display text-2xl text-text-primary sm:text-3xl [word-break:keep-all]">{hall.title}</h3>
            <p className="mt-2 text-sm font-extrabold leading-6 text-text-secondary sm:text-base [word-break:keep-all]">{hall.subtitle}</p>
          </div>
          {recordGroups.length > 0 && (
            <div className="hidden shrink-0 rounded-card-md border border-line bg-bg-deep/65 px-3 py-2 text-center sm:block">
              <div className="font-display text-2xl text-gold">{recordGroups.length}</div>
              <div className="text-[10px] font-bold text-text-secondary">전시 기록</div>
            </div>
          )}
        </div>
      </header>

      <div className="px-4 py-6 sm:px-7 sm:py-8">
        {recordGroups.length === 0 ? (
          <EmptyHall />
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {recordGroups.map(([recordType, rows], groupIndex) => (
              <RecordGroup key={recordType} rows={rows} exhibitionNo={groupIndex + 1} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyHall() {
  return (
    <div className="rounded-card-lg border border-dashed border-line bg-bg-deep/55 px-5 py-9 text-center sm:py-11">
      <Sparkles className="mx-auto h-8 w-8 text-text-secondary" strokeWidth={1.4} />
      <div className="mt-3 font-display text-lg text-text-primary">아직 주인을 기다리는 전시관</div>
      <div className="mx-auto mt-2 max-w-md text-sm font-bold leading-6 text-text-secondary [word-break:keep-all]">
        공식 조건을 충족한 기록이 탄생하면 이 공간에 이름과 기록이 하나의 역사로 새겨집니다.
      </div>
    </div>
  );
}

function RecordGroup({ rows, exhibitionNo }: { rows: HallOfGloryEntry[]; exhibitionNo: number }) {
  const orderedRows = [...rows].sort((a, b) => {
    const rankA = a.rank_position ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank_position ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.sort_order - b.sort_order;
  });

  const first = orderedRows[0];
  const hasLiveDerived = orderedRows.some((row) => row.source_kind === 'PRODUCTION_DERIVED');
  const hasHistorical = orderedRows.some((row) => row.source_kind !== 'PRODUCTION_DERIVED');
  const sameRank = orderedRows.length > 1 && orderedRows.every((row) => row.rank_position === first.rank_position);
  const achievementMilestone = ['FIRST_UNIQUE_ACHIEVEMENT', 'FIRST_TRANSCENDENT_ACHIEVEMENT'].includes(first.record_type);
  const customSubtitle = achievementMilestone || first.record_type === 'CLOSEST_SEASON_WIN';

  return (
    <article className="relative overflow-hidden rounded-card-lg border border-gold/20 bg-[linear-gradient(145deg,rgba(255,217,61,0.035),rgba(15,11,26,0.76)_46%,rgba(22,16,37,0.88))] shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
      <div aria-hidden="true" className="absolute -right-2 -top-5 font-display text-8xl text-white/[0.018]">{String(exhibitionNo).padStart(2, '0')}</div>
      <div className="relative border-b border-line/70 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-black tracking-[0.16em] text-gold/65">HONOR RECORD {String(exhibitionNo).padStart(2, '0')}</div>
            <h4 className="mt-1.5 text-base font-black leading-6 text-text-primary sm:text-lg sm:leading-7 [word-break:keep-all]">{first.title}</h4>
            {!customSubtitle && first.subtitle && <p className="mt-1.5 max-w-3xl text-sm font-bold leading-6 text-text-secondary [word-break:keep-all]">{first.subtitle}</p>}
            {first.description && <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-text-secondary [word-break:keep-all]">{first.description}</p>}
          </div>
          <HallRecordBadge live={hasLiveDerived} mixed={hasLiveDerived && hasHistorical} />
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        {first.record_type === 'CLOSEST_SEASON_WIN' ? (
          <ClosestSeasonExhibit entry={first} />
        ) : first.hall_key === 'CONSTELLATION' && getAchievementDetails(first).length > 0 ? (
          <AchievementConstellationExhibit entry={first} />
        ) : first.record_type === 'SEASON_EMPEROR' ? (
          <JointHonoreesExhibit rows={orderedRows} hideRank />
        ) : sameRank ? (
          <JointHonoreesExhibit rows={orderedRows} />
        ) : orderedRows.length > 1 && orderedRows.some((row) => row.rank_position != null) ? (
          <BalancedRankingExhibit rows={orderedRows} />
        ) : (
          <MilestoneExhibit entry={first} />
        )}
      </div>
    </article>
  );
}

function BalancedRankingExhibit({ rows }: { rows: HallOfGloryEntry[] }) {
  const [first, ...rest] = rows;

  if (rest.length === 0) return <MilestoneExhibit entry={first} />;

  return (
    <div className="space-y-3">
      <RankingPlaque entry={first} featured />
      {rest.length === 5 ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {rest.slice(0, 2).map((entry) => <RankingPlaque key={entry.id} entry={entry} />)}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {rest.slice(2).map((entry) => <RankingPlaque key={entry.id} entry={entry} />)}
          </div>
        </>
      ) : rest.length === 4 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rest.map((entry) => <RankingPlaque key={entry.id} entry={entry} />)}
        </div>
      ) : rest.length === 3 ? (
        <div className="grid gap-3 md:grid-cols-3">
          {rest.map((entry) => <RankingPlaque key={entry.id} entry={entry} />)}
        </div>
      ) : rest.length === 2 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rest.map((entry) => <RankingPlaque key={entry.id} entry={entry} />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((entry) => <RankingPlaque key={entry.id} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

function RankingPlaque({ entry, featured = false }: { entry: HallOfGloryEntry; featured?: boolean }) {
  const period = getEntryPeriod(entry);
  const value = formatRecordValue(entry);

  return (
    <div className={`relative min-w-0 overflow-hidden rounded-card-md border ${featured ? 'border-gold/45 bg-[radial-gradient(circle_at_95%_0%,rgba(255,217,61,0.12),transparent_36%),linear-gradient(135deg,rgba(255,217,61,0.10),rgba(18,13,31,0.88))] px-4 py-5 shadow-[0_0_24px_rgba(255,217,61,0.06)] sm:px-5' : 'border-gold/18 bg-bg-card/80 px-4 py-4'}`}>
      {featured && <Crown aria-hidden="true" className="absolute -right-3 -top-4 h-20 w-20 text-gold/[0.045]" strokeWidth={1.2} />}
      <div className="relative flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {entry.rank_position != null && (
          <div className={`flex shrink-0 items-center justify-center rounded-full border font-display ${featured ? 'h-12 w-12 border-gold/50 bg-gold/10 text-xl text-gold' : 'h-9 w-9 border-line bg-bg-deep text-sm text-text-primary'}`}>
            {entry.rank_position}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className={`font-extrabold text-text-primary [word-break:keep-all] ${featured ? 'text-xl sm:text-2xl' : 'text-base sm:text-lg'}`}>{entry.subject_display_name}</div>
          {entry.subject_brand_name && entry.subject_brand_name !== entry.subject_display_name && (
            <div className="mt-0.5 text-xs font-bold text-text-secondary">{entry.subject_brand_name}</div>
          )}
          {period && <div className="mt-1.5 text-xs font-bold text-text-secondary">{period}{entry.source_kind === 'PRODUCTION_DERIVED' ? ' · 현재 공식' : ''}</div>}
        </div>
        {value && (
          <div className={`min-w-0 max-w-full font-mono font-black leading-tight text-gold sm:ml-auto sm:max-w-[52%] sm:text-right ${featured ? 'text-[clamp(1.05rem,2.4vw,1.5rem)]' : 'text-[clamp(0.95rem,2vw,1.2rem)]'} [overflow-wrap:anywhere]`}>
            {value}
          </div>
        )}
      </div>
    </div>
  );
}

function JointHonoreesExhibit({ rows, hideRank = false }: { rows: HallOfGloryEntry[]; hideRank?: boolean }) {
  const cols = rows.length === 2 ? 'md:grid-cols-2' : rows.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
  return (
    <div className={`grid gap-3 ${cols}`}>
      {rows.map((entry) => {
        const period = getEntryPeriod(entry);
        const value = formatRecordValue(entry);
        return (
          <div key={entry.id} className="min-w-0 rounded-card-md border border-gold/28 bg-[linear-gradient(135deg,rgba(255,217,61,0.065),rgba(18,13,31,0.82))] p-4 sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              {!hideRank && entry.rank_position != null && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/35 bg-gold/10 font-display text-sm text-gold">{entry.rank_position}</div>}
              <div className="min-w-0 flex-1">
                <div className="font-display text-xl text-gold sm:text-2xl [word-break:keep-all]">{entry.subject_display_name}</div>
                {period && <div className="mt-1.5 text-xs font-bold text-text-secondary">{period}</div>}
                {value && <div className="mt-3 font-mono text-base font-black leading-tight text-text-primary [overflow-wrap:anywhere]">{value}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MilestoneExhibit({ entry }: { entry: HallOfGloryEntry }) {
  if (entry.subject_kind === 'EMPTY_THRONE') return <EmptyThroneExhibit entry={entry} />;

  const period = getEntryPeriod(entry);
  const value = formatRecordValue(entry);
  const achievementName = getAchievementName(entry);

  return (
    <div className="rounded-card-md border border-gold/30 bg-[radial-gradient(circle_at_95%_0%,rgba(255,217,61,0.085),transparent_35%),linear-gradient(135deg,rgba(255,217,61,0.055),rgba(18,13,31,0.78))] p-5 sm:p-6">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <div className="text-xs font-black tracking-[0.15em] text-gold/70">HONOREE</div>
          <div className="mt-1 font-display text-2xl text-gold sm:text-3xl [word-break:keep-all]">{entry.subject_display_name}</div>
          {entry.subject_brand_name && entry.subject_brand_name !== entry.subject_display_name && (
            <div className="mt-1 text-sm font-bold text-text-secondary">{entry.subject_brand_name}</div>
          )}
          {achievementName && (
            <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-card-md border border-bv/30 bg-bv/[0.08] px-3.5 py-2.5">
              <Gem className="h-5 w-5 shrink-0 text-bv" />
              <div className="min-w-0">
                <div className="text-[10px] font-black tracking-[0.12em] text-bv">달성 업적</div>
                <div className="mt-0.5 text-base font-extrabold text-text-primary sm:text-lg [word-break:keep-all]">{achievementName}</div>
              </div>
            </div>
          )}
          {period && <div className="mt-3 text-sm font-bold text-text-secondary">{period}{entry.source_kind === 'PRODUCTION_DERIVED' ? ' · 현재 공식' : ''}</div>}
        </div>
        {value && (
          <div className="min-w-0 md:max-w-[360px] md:text-right">
            <div className="text-xs font-black tracking-[0.15em] text-text-secondary">RECORD</div>
            <div className="mt-1 font-mono text-xl font-black leading-tight text-text-primary sm:text-2xl [overflow-wrap:anywhere]">{value}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyThroneExhibit({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <div className="rounded-card-md border border-dashed border-gold/35 bg-gold/[0.025] px-5 py-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-gold/35 bg-gold/[0.04]">
          <Crown className="h-6 w-6 text-gold/65" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <div className="font-display text-lg text-text-primary sm:text-xl [word-break:keep-all]">{entry.subject_display_name}</div>
          <div className="mt-1 text-sm font-bold leading-6 text-text-secondary [word-break:keep-all]">아직 누구의 이름도 새겨지지 않은 왕좌입니다.</div>
        </div>
      </div>
    </div>
  );
}

function AchievementConstellationExhibit({ entry }: { entry: HallOfGloryEntry }) {
  const details = getAchievementDetails(entry);
  const period = getEntryPeriod(entry);
  return (
    <div className="overflow-hidden rounded-card-md border border-gold/38 bg-[radial-gradient(circle_at_85%_0%,rgba(255,217,61,0.13),transparent_30%),linear-gradient(145deg,rgba(177,151,252,0.09),rgba(18,13,31,0.86))] p-5 shadow-[0_0_28px_rgba(177,151,252,0.07)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-black tracking-[0.15em] text-bv">HONOREE</div>
          <div className="mt-1 font-display text-2xl text-gold sm:text-3xl">{entry.subject_display_name}</div>
          {period && <div className="mt-1.5 text-sm font-bold text-text-secondary">{period} · 현재 공식</div>}
        </div>
        <div className="font-display text-3xl text-text-primary sm:text-4xl">{formatNumber(entry.value_primary ?? details.length)}<span className="ml-1 text-base text-text-secondary">개</span></div>
      </div>
      <div className="mt-5 border-t border-line/70 pt-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-text-primary">
          <Sparkles className="h-4 w-4 text-gold" />
          달성 업적 전체
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((detail) => (
            <div key={`${detail.name}-${detail.achieved_on ?? ''}`} className="rounded-card-sm border border-bv/20 bg-bg-deep/70 px-3 py-2.5">
              <div className="text-sm font-extrabold text-text-primary [word-break:keep-all]">{detail.name}</div>
              {detail.achieved_on && <div className="mt-1 text-[11px] font-bold text-text-secondary">{formatDateLabel(detail.achieved_on)}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClosestSeasonExhibit({ entry }: { entry: HallOfGloryEntry }) {
  const runnerUp = getMetadataString(entry, 'runner_up') ?? '2위 길드';
  const runnerUpGs = getMetadataNumber(entry, 'runner_up_gs') ?? entry.value_secondary ?? 0;
  const winnerGs = getMetadataNumber(entry, 'winner_gs') ?? runnerUpGs + (entry.value_primary ?? 0);
  const marginPercent = getMetadataNumber(entry, 'display_margin_percent') ?? Number(entry.comparison_value ?? 0);
  const period = getEntryPeriod(entry);

  return (
    <div className="rounded-card-md border border-gold/30 bg-[linear-gradient(135deg,rgba(255,217,61,0.06),rgba(18,13,31,0.82))] p-5 sm:p-6">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <GuildDuelSide label="우승" name={entry.subject_display_name} score={winnerGs} align="right" />
        <div className="flex flex-col items-center justify-center px-2 py-2">
          <div className="rounded-pill border border-line bg-bg-deep px-3 py-1 text-xs font-black tracking-[0.14em] text-text-secondary">VS</div>
          <div className="mt-2 text-center text-xs font-bold text-text-secondary">차이</div>
          <div className="font-display text-2xl text-gold">{marginPercent.toFixed(2)}%</div>
        </div>
        <GuildDuelSide label="준우승" name={runnerUp} score={runnerUpGs} align="left" />
      </div>
      {period && <div className="mt-4 border-t border-line/70 pt-3 text-center text-sm font-bold text-text-secondary">{period}</div>}
    </div>
  );
}

function GuildDuelSide({ label, name, score, align }: { label: string; name: string; score: number; align: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 rounded-card-md border border-line bg-bg-deep/70 p-4 ${align === 'right' ? 'md:text-right' : 'md:text-left'}`}>
      <div className="text-[11px] font-black tracking-[0.12em] text-bv">{label}</div>
      <div className="mt-1 font-display text-xl text-text-primary sm:text-2xl [word-break:keep-all]">{name}</div>
      <div className="mt-2 font-mono text-lg font-black text-gold">{formatNumber(score)} GS</div>
    </div>
  );
}

function getEntryPeriod(entry: HallOfGloryEntry) {
  if (entry.period_label) return entry.period_label;
  if (entry.season_label) return entry.season_label;
  if (entry.school_year != null) return `${entry.school_year}`;
  return '';
}

function getAchievementName(entry: HallOfGloryEntry) {
  const metadataName = getMetadataString(entry, 'achievement_name');
  if (metadataName) return metadataName;
  if (['FIRST_UNIQUE_ACHIEVEMENT', 'FIRST_TRANSCENDENT_ACHIEVEMENT'].includes(entry.record_type)) return entry.subtitle;
  return null;
}

function getAchievementDetails(entry: HallOfGloryEntry): HallAchievementDetail[] {
  const value = entry.metadata?.achievement_names;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HallAchievementDetail => Boolean(item && typeof item === 'object' && typeof (item as HallAchievementDetail).name === 'string'));
}

function getMetadataString(entry: HallOfGloryEntry, key: string) {
  const value = entry.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function getMetadataNumber(entry: HallOfGloryEntry, key: string) {
  const value = entry.metadata?.[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function countRecordGroups(entries: HallOfGloryEntry[]) {
  return new Set(entries.map((entry) => entry.record_type)).size;
}

function formatRecordValue(entry: HallOfGloryEntry) {
  if (entry.value_primary == null) return '';

  const value = formatNumber(entry.value_primary);
  const unit = entry.unit ? ` ${entry.unit}` : '';

  if (entry.denominator != null) {
    const rate = entry.comparison_value != null
      ? ` (${entry.record_type === 'SEASON_CHAMPION' ? Number(entry.comparison_value).toFixed(1) : Number(entry.comparison_value).toFixed(2)}%)`
      : '';
    return `${value} / ${formatNumber(entry.denominator)}${unit}${rate}`;
  }

  if (entry.record_type === 'CLOSEST_SEASON_WIN' && entry.comparison_value != null) {
    return `${Number(entry.comparison_value).toFixed(2)}%`;
  }

  return `${value}${unit}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${year}.${month}.${day}`;
}

function SectionTitle({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-bv" />
      <div>
        <h2 className="font-display text-lg text-brand-gradient">{title}</h2>
        <div className="mt-1 text-xs font-bold text-text-secondary">{description}</div>
      </div>
    </div>
  );
}

function HallRecordBadge({ live, mixed = false, compact = false }: { live: boolean; mixed?: boolean; compact?: boolean }) {
  const label = mixed ? '역대 · 현재 통합' : live ? '현재 공식 기록' : '공식 확정 기록';
  const tone = live ? 'border-bv/40 bg-bv/10 text-bv' : 'border-gold/40 bg-gold/10 text-gold';
  return (
    <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-pill border font-black ${tone} ${compact ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-xs'} whitespace-nowrap`}>
      <ShieldCheck className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      {label}
    </span>
  );
}

function OfficialBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill border border-gold/40 bg-gold/10 font-black text-gold ${compact ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-xs'}`}>
      <ShieldCheck className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      공식 확정 기록
    </span>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card p-3">
      <div className="text-xs font-bold text-text-secondary">{label}</div>
      <div className="mt-1 font-display text-lg text-gold">{value}</div>
    </div>
  );
}
