import {
  Gem,
  ShieldCheck,
  Sparkles,
  Star,
  Stars,
} from 'lucide-react';
import type {
  HallAchievementDetail,
  HallOfGloryEntry,
} from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const CONSTELLATION_STYLE = `
@keyframes constellationPulse {
  0%,100% { opacity:.34; transform:scale(.98); }
  50% { opacity:.72; transform:scale(1.035); }
}
@keyframes constellationDrift {
  0% { transform:translate3d(0,0,0); }
  50% { transform:translate3d(10px,-6px,0); }
  100% { transform:translate3d(0,0,0); }
}
@keyframes starNodeGlow {
  0%,100% { box-shadow:0 0 10px rgba(202,229,255,.18),0 0 26px rgba(133,178,255,.08); }
  50% { box-shadow:0 0 18px rgba(224,239,255,.34),0 0 34px rgba(145,184,255,.14); }
}
.constellation-pulse { animation:constellationPulse 5.8s ease-in-out infinite; }
.constellation-drift { animation:constellationDrift 9s ease-in-out infinite; }
.constellation-star-node { animation:starNodeGlow 4.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .constellation-pulse,.constellation-drift,.constellation-star-node { animation:none; }
}
`;

type ConstellationTone = 'UNIQUE' | 'TRANSCEND';

export function RecordsConstellationHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const uniqueRows = sortRows(entries.filter((entry) => entry.record_type === 'MOST_UNIQUE_ACHIEVEMENTS'));
  const transcendRows = sortRows(entries.filter((entry) => entry.record_type === 'MOST_TRANSCENDENT_ACHIEVEMENTS'));
  const recordCount = new Set(entries.map((entry) => entry.record_type)).size;

  return (
    <>
      <style>{CONSTELLATION_STYLE}</style>
      <section
        id="hall-constellation"
        className="scroll-mt-24 overflow-hidden rounded-[30px] border border-sky-100/18 bg-[radial-gradient(circle_at_50%_-8%,rgba(129,165,255,0.12),transparent_29%),radial-gradient(circle_at_12%_22%,rgba(128,215,255,0.065),transparent_23%),radial-gradient(circle_at_88%_24%,rgba(192,151,255,0.075),transparent_23%),linear-gradient(180deg,rgba(16,22,39,0.99),rgba(10,13,27,0.998)_50%,rgba(7,9,18,1))] shadow-[0_30px_82px_rgba(0,0,0,0.31)]"
      >
        <HallHeader recordCount={recordCount} />

        <div className="space-y-10 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
          {uniqueRows.length > 0 && (
            <ConstellationWing
              tone="UNIQUE"
              eyebrow="유일의 성좌"
              title="희귀한 별들이 하나의 이름 아래 모이다"
              description="유일 등급 업적 하나하나를 별로 기록하고, 가장 많은 별을 품은 자의 성좌를 펼쳐 보입니다."
              rows={uniqueRows}
            />
          )}

          {uniqueRows.length > 0 && transcendRows.length > 0 && <CelestialDivider />}

          {transcendRows.length > 0 && (
            <ConstellationWing
              tone="TRANSCEND"
              eyebrow="초월의 성좌"
              title="별이 아니라 경계 그 너머에 남은 위업"
              description="초월 등급 업적은 수가 적은 만큼 더욱 무겁습니다. 가장 높은 곳에 새겨진 위업들을 별도의 상위 성도로 보존합니다."
              rows={transcendRows}
            />
          )}

          <div className="rounded-[18px] border border-sky-100/14 bg-sky-100/[0.03] px-4 py-3 text-center text-sm font-semibold leading-6 text-slate-100/78">
            현재 유효한 공식 업적만 성좌에 남습니다. 회수된 업적은 기록에서 제외됩니다.
          </div>
        </div>
      </section>
    </>
  );
}

function HallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-sky-100/10 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="constellation-pulse absolute left-1/2 top-[-120px] h-[290px] w-[580px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(164,197,255,0.14),transparent_66%)] blur-xl" />
      <Stars aria-hidden="true" className="absolute -right-5 -top-8 h-48 w-48 text-sky-100/[0.028] sm:h-60 sm:w-60" strokeWidth={1.0} />
      <div aria-hidden="true" className="constellation-drift absolute inset-0 bg-[radial-gradient(circle_at_14%_26%,rgba(255,255,255,.34)_0_1px,transparent_1.4px),radial-gradient(circle_at_37%_16%,rgba(196,223,255,.28)_0_1px,transparent_1.4px),radial-gradient(circle_at_68%_31%,rgba(255,255,255,.26)_0_1px,transparent_1.4px),radial-gradient(circle_at_82%_12%,rgba(220,205,255,.30)_0_1px,transparent_1.4px)]" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-sky-100/24 bg-[radial-gradient(circle,rgba(185,221,255,0.13),rgba(18,25,45,0.88)_72%)] text-sky-50 shadow-[0_0_30px_rgba(139,187,255,0.10)] sm:h-[72px] sm:w-[72px]">
            <Stars className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.45} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-sky-100/78">HALL 08 · CELESTIAL ATLAS</div>
            <h3 className="mt-1.5 font-display text-3xl text-slate-50 sm:text-4xl [word-break:keep-all]">위업의 성좌</h3>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-slate-100/78 sm:text-base [word-break:keep-all]">
              희귀한 위업 하나하나가 별이 되고, 그 별들이 모여 한 사람의 성좌를 이룹니다.
            </p>
          </div>
        </div>

        <div className="w-fit rounded-full border border-sky-100/18 bg-black/18 px-4 py-2 text-center">
          <div className="font-display text-2xl text-sky-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-slate-100/70">성좌 기록</div>
        </div>
      </div>
    </header>
  );
}

function ConstellationWing({
  tone,
  eyebrow,
  title,
  description,
  rows,
}: {
  tone: ConstellationTone;
  eyebrow: string;
  title: string;
  description: string;
  rows: HallOfGloryEntry[];
}) {
  const primary = rows[0];
  if (!primary) return null;

  const achievements = achievementDetails(primary);
  const isTranscend = tone === 'TRANSCEND';
  const accent = isTranscend ? 'text-violet-100' : 'text-sky-100';
  const border = isTranscend ? 'border-violet-100/22' : 'border-sky-100/20';
  const panel = isTranscend
    ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(197,157,255,0.13),transparent_32%),radial-gradient(circle_at_90%_20%,rgba(255,219,151,0.055),transparent_22%),linear-gradient(180deg,rgba(30,22,48,0.95),rgba(12,12,26,0.99))] shadow-[0_0_34px_rgba(162,119,238,0.08)]'
    : 'bg-[radial-gradient(circle_at_50%_0%,rgba(158,211,255,0.12),transparent_32%),radial-gradient(circle_at_8%_24%,rgba(119,178,255,0.06),transparent_22%),linear-gradient(180deg,rgba(20,31,51,0.95),rgba(10,13,25,0.99))] shadow-[0_0_34px_rgba(117,180,255,0.07)]';

  return (
    <section className="space-y-5">
      <div className="mx-auto max-w-4xl text-center">
        <div className={`text-[11px] font-black tracking-[0.22em] ${accent}`}>{eyebrow}</div>
        <h4 className="mt-2 font-display text-2xl text-slate-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
        <p className="mx-auto mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-100/76 [word-break:keep-all]">{description}</p>
      </div>

      <article className={`relative overflow-hidden rounded-[30px] border ${border} ${panel} px-4 py-5 sm:px-6 sm:py-6 lg:px-7`}>
        <StarField tone={tone} />
        <div className="relative grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-stretch">
          <ConstellationCore entry={primary} tone={tone} tiedRows={rows.slice(1)} />
          <AchievementAtlas achievements={achievements} tone={tone} />
        </div>
      </article>
    </section>
  );
}

function ConstellationCore({ entry, tone, tiedRows }: { entry: HallOfGloryEntry; tone: ConstellationTone; tiedRows: HallOfGloryEntry[] }) {
  const isTranscend = tone === 'TRANSCEND';
  const accent = isTranscend ? 'text-violet-100' : 'text-sky-100';
  const glow = isTranscend
    ? 'shadow-[0_0_38px_rgba(185,139,255,0.14),inset_0_0_26px_rgba(255,230,180,0.025)]'
    : 'shadow-[0_0_38px_rgba(139,199,255,0.13),inset_0_0_26px_rgba(205,232,255,0.025)]';

  return (
    <div className={`relative flex min-h-[260px] flex-col items-center justify-center rounded-[24px] border border-white/12 bg-black/22 px-5 py-6 text-center ${glow}`}>
      <div aria-hidden="true" className={`constellation-pulse absolute top-7 h-28 w-28 rounded-full ${isTranscend ? 'bg-[radial-gradient(circle,rgba(196,158,255,.19),transparent_68%)]' : 'bg-[radial-gradient(circle,rgba(164,215,255,.18),transparent_68%)]'} blur-md`} />
      <div className={`constellation-star-node relative flex h-16 w-16 items-center justify-center rounded-full border border-white/18 bg-black/28 ${accent}`}>
        {isTranscend ? <Sparkles className="h-8 w-8" strokeWidth={1.45} /> : <Star className="h-8 w-8" strokeWidth={1.45} />}
      </div>
      <div className="mt-4 text-[10px] font-black tracking-[0.18em] text-slate-100/72">성좌의 중심</div>
      <div className="mt-2 font-display text-[2.1rem] text-slate-50 sm:text-[2.5rem] [text-shadow:0_0_16px_rgba(220,236,255,.10)]">{entry.subject_display_name}</div>
      {entry.subject_brand_name && <div className="mt-1 text-sm font-bold text-slate-100/72">{entry.subject_brand_name}</div>}
      <div className={`mt-4 whitespace-nowrap font-display text-4xl ${accent}`}>
        {formatNumber(entry.value_primary ?? 0)}<span className="ml-1.5 text-base text-slate-100/78">개</span>
      </div>
      <div className="mt-4"><RecordStatusBadge /></div>

      {tiedRows.length > 0 && (
        <div className="mt-4 w-full border-t border-white/10 pt-3">
          <div className="text-[10px] font-black tracking-[0.12em] text-slate-100/70">공동 기록 보유자</div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {tiedRows.map((row) => (
              <span key={row.id} className="rounded-full border border-white/14 bg-white/[0.04] px-3 py-1.5 text-sm font-extrabold text-slate-50">{row.subject_display_name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AchievementAtlas({ achievements, tone }: { achievements: HallAchievementDetail[]; tone: ConstellationTone }) {
  if (achievements.length === 0) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-white/10 bg-black/14 px-5 text-center text-sm font-semibold text-slate-100/76">
        세부 업적 목록을 불러오는 중입니다.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black/14 px-4 py-4 sm:px-5 sm:py-5">
      <div aria-hidden="true" className="absolute left-[7%] right-[7%] top-1/2 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div aria-hidden="true" className="absolute bottom-[10%] left-1/2 top-[10%] w-px bg-gradient-to-b from-transparent via-white/8 to-transparent lg:hidden" />
      <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {achievements.map((achievement, index) => (
          <AchievementStar key={`${achievement.name}-${achievement.achieved_on ?? index}`} achievement={achievement} index={index} tone={tone} />
        ))}
      </div>
    </div>
  );
}

function AchievementStar({ achievement, index, tone }: { achievement: HallAchievementDetail; index: number; tone: ConstellationTone }) {
  const isTranscend = tone === 'TRANSCEND';
  const featured = /시즌1의 황제|최초의 왕좌|마스터피스/.test(achievement.name);
  const border = isTranscend ? 'border-violet-100/18' : 'border-sky-100/16';
  const bg = featured
    ? isTranscend
      ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(231,196,255,0.12),transparent_34%),linear-gradient(180deg,rgba(61,42,82,0.50),rgba(12,13,26,0.80))]'
      : 'bg-[radial-gradient(circle_at_50%_0%,rgba(205,233,255,0.11),transparent_34%),linear-gradient(180deg,rgba(35,61,82,0.48),rgba(10,15,27,0.82))]'
    : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.10))]';

  return (
    <div className={`relative min-h-[126px] overflow-hidden rounded-[19px] border ${border} ${bg} px-3.5 py-3.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]`}>
      <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/16 bg-black/22 ${isTranscend ? 'text-violet-100' : 'text-sky-100'} ${featured ? 'constellation-star-node' : ''}`}>
        {featured ? <Sparkles className="h-4.5 w-4.5" strokeWidth={1.55} /> : <Star className="h-4 w-4" strokeWidth={1.55} />}
      </div>
      <div className="mt-2.5 font-display text-lg leading-6 text-slate-50 [word-break:keep-all]">{achievement.name}</div>
      {achievement.achieved_on && <div className="mt-2 whitespace-nowrap text-xs font-extrabold text-slate-100/78">{koreanDate(achievement.achieved_on)}</div>}
      <div className="absolute right-2.5 top-2.5 text-[9px] font-black tracking-[0.12em] text-slate-100/55">{String(index + 1).padStart(2, '0')}</div>
    </div>
  );
}

function StarField({ tone }: { tone: ConstellationTone }) {
  const glow = tone === 'TRANSCEND'
    ? 'bg-[radial-gradient(circle_at_72%_18%,rgba(202,170,255,.08),transparent_28%),radial-gradient(circle_at_18%_82%,rgba(255,218,154,.035),transparent_24%)]'
    : 'bg-[radial-gradient(circle_at_72%_18%,rgba(147,209,255,.08),transparent_28%),radial-gradient(circle_at_18%_82%,rgba(125,173,255,.04),transparent_24%)]';
  return (
    <>
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${glow}`} />
      <div aria-hidden="true" className="constellation-drift pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_12%_18%,rgba(255,255,255,.28)_0_1px,transparent_1.3px),radial-gradient(circle_at_31%_72%,rgba(202,225,255,.22)_0_1px,transparent_1.3px),radial-gradient(circle_at_51%_26%,rgba(255,255,255,.20)_0_1px,transparent_1.3px),radial-gradient(circle_at_78%_66%,rgba(222,208,255,.22)_0_1px,transparent_1.3px),radial-gradient(circle_at_91%_32%,rgba(255,255,255,.24)_0_1px,transparent_1.3px)]" />
    </>
  );
}

function RecordStatusBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100/20 bg-sky-100/[0.05] px-3 py-1.5 text-xs font-black text-slate-50">
      <ShieldCheck className="h-4 w-4 text-sky-100" strokeWidth={1.55} />
      현재 공식 기록
    </span>
  );
}

function CelestialDivider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-sky-100/14 to-transparent" />;
}

function achievementDetails(entry: HallOfGloryEntry) {
  const list = entry.metadata?.achievement_names;
  return Array.isArray(list)
    ? list.filter((item): item is HallAchievementDetail => Boolean(item && typeof item.name === 'string' && item.name.trim()))
    : [];
}

function sortRows(rows: HallOfGloryEntry[]) {
  return [...rows].sort((a, b) => {
    const rankA = a.rank_position ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank_position ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return (b.value_primary ?? 0) - (a.value_primary ?? 0);
  });
}

function koreanDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}
