import type { ReactNode } from 'react';
import {
  Coins,
  Crown,
  DoorOpen,
  Gem,
  ShieldCheck,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { RECORDS_TIER_ICONS_2023 } from '@/features/feature4/records_hall_assets';

type EmblemKind = 'MASTER' | 'CELESTIAL' | 'GRANDMASTER';

const TIER_TYPES = [
  'FIRST_TIER_MASTER',
  'FIRST_TIER_CELESTIAL_MASTER',
  'FIRST_TIER_GRANDMASTER',
] as const;

const FIRSTS_TOP = ['FIRST_GOLD_50000', 'FIRST_GOLD_100000'] as const;
const FIRSTS_MIDDLE = [
  'FIRST_MONTHLY_MVP',
  'FIRST_UNIQUE_ACHIEVEMENT',
  'FIRST_TRANSCENDENT_ACHIEVEMENT',
] as const;
const FIRSTS_BOTTOM = ['FIRST_ACHIEVEMENT_90_PERCENT', 'FIRST_ACHIEVEMENT_100'] as const;

const FIRST_MVP_RIVALS = ['공예성', '김채은', '이가온'] as const;
const GRANDMASTER_LINEAGE_BG = `${import.meta.env.BASE_URL}records/Hall01_Pioneer_Grand-Master-History-bg.webp`;

const TIER_COPY: Record<string, string> = {
  FIRST_TIER_MASTER: '역사상 처음으로 마스터에 도달하다',
  FIRST_TIER_CELESTIAL_MASTER: '역사상 처음으로 천상의 마스터에 도달하다',
  FIRST_TIER_GRANDMASTER: '처음으로 정상에 오른 자에 대한 헌사',
};

const TIER_ICON_BY_KIND: Record<EmblemKind, string> = {
  MASTER: RECORDS_TIER_ICONS_2023.MASTER,
  CELESTIAL: RECORDS_TIER_ICONS_2023.CELESTIAL_MASTER,
  GRANDMASTER: RECORDS_TIER_ICONS_2023.GRAND_MASTER,
};

const HALL_ENTRANCE_POLISH = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700;800;900&display=swap');

.grandmaster-serif {
  font-family: 'Noto Serif KR', 'Nanum Myeongjo', 'Batang', serif;
}
nav[aria-label="영광의 전당 전시관 입구"] button {
  border-color: rgba(var(--hall-aura), .48) !important;
  box-shadow:
    0 0 0 1px rgba(var(--hall-aura), .06),
    0 0 18px rgba(var(--hall-aura), .10),
    inset 0 0 18px rgba(var(--hall-aura), .025);
}
nav[aria-label="영광의 전당 전시관 입구"] button:hover {
  border-color: rgba(var(--hall-aura), .72) !important;
  box-shadow:
    0 0 0 1px rgba(var(--hall-aura), .10),
    0 0 24px rgba(var(--hall-aura), .16),
    inset 0 0 20px rgba(var(--hall-aura), .04);
}
nav[aria-label="영광의 전당 전시관 입구"] button > div[aria-hidden="true"]:first-child {
  border-color: rgba(var(--hall-aura), .20) !important;
  box-shadow: inset 0 0 12px rgba(var(--hall-aura), .035);
}
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(1) { --hall-aura: 217, 154, 78; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(2) { --hall-aura: 255, 226, 119; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(3) { --hall-aura: 220, 118, 148; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(4) { --hall-aura: 93, 210, 214; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(5) { --hall-aura: 225, 151, 64; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(6) { --hall-aura: 204, 92, 92; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(7) { --hall-aura: 92, 163, 230; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(8) { --hall-aura: 163, 132, 231; }
nav[aria-label="영광의 전당 전시관 입구"] button:nth-child(9) { --hall-aura: 196, 120, 214; }
nav[aria-label="영광의 전당 전시관 입구"] button span.font-display {
  font-size: clamp(1.12rem, 1.75vw, 1.34rem) !important;
  line-height: 1.35 !important;
  letter-spacing: -0.025em;
  white-space: nowrap;
}
nav[aria-label="영광의 전당 전시관 입구"] button span.text-xs {
  font-size: clamp(.75rem, 1vw, .82rem) !important;
  line-height: 1.35rem !important;
  white-space: nowrap;
}
@keyframes relicBorderOrbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.relic-orbit-border {
  background:
    conic-gradient(
      from 0deg,
      rgba(255,231,184,0) 0deg,
      rgba(255,235,194,.78) 18deg,
      rgba(202,145,75,.32) 40deg,
      rgba(255,231,184,0) 60deg,
      rgba(255,231,184,0) 150deg,
      rgba(255,236,198,.62) 176deg,
      rgba(180,123,64,.28) 196deg,
      rgba(255,231,184,0) 214deg,
      rgba(255,231,184,0) 286deg,
      rgba(255,236,198,.74) 314deg,
      rgba(194,136,71,.3) 334deg,
      rgba(255,231,184,0) 360deg
    );
  animation: relicBorderOrbit 8.4s linear infinite;
  filter: saturate(118%) brightness(1.04);
}
@keyframes grandmasterAuraBreath {
  0%,100% { opacity:.48; transform:scale(.96); }
  50% { opacity:.82; transform:scale(1.04); }
}
@keyframes grandmasterCardBreath {
  0%,100% {
    box-shadow:
      0 18px 38px rgba(0,0,0,.30),
      0 0 24px rgba(239,191,103,.10),
      inset 0 1px 0 rgba(255,255,255,.035);
  }
  50% {
    box-shadow:
      0 20px 44px rgba(0,0,0,.34),
      0 0 34px rgba(247,204,122,.17),
      inset 0 1px 0 rgba(255,255,255,.045);
  }
}
.grandmaster-emblem-aura {
  animation: grandmasterAuraBreath 6.8s ease-in-out infinite;
}
.grandmaster-legend-card {
  animation: grandmasterCardBreath 7.6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .relic-orbit-border,
  .grandmaster-emblem-aura,
  .grandmaster-legend-card {
    animation: none;
  }
}
`;

export function RecordsPioneersHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const byType = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = byType.get(entry.record_type) ?? [];
    rows.push(entry);
    byType.set(entry.record_type, rows);
  });

  const tierRelics = TIER_TYPES
    .map((type) => byType.get(type)?.[0])
    .filter((entry): entry is HallOfGloryEntry => Boolean(entry));

  const topFirsts = selectFirsts(byType, FIRSTS_TOP);
  const middleFirsts = selectFirsts(byType, FIRSTS_MIDDLE);
  const bottomFirsts = selectFirsts(byType, FIRSTS_BOTTOM);

  const grandmasters = [...(byType.get('GRANDMASTER_ROLL') ?? [])].sort((a, b) => {
    const orderA = metadataNumber(a, 'attained_order') ?? Number.MAX_SAFE_INTEGER;
    const orderB = metadataNumber(b, 'attained_order') ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.occurred_on ?? '').localeCompare(b.occurred_on ?? '');
  });

  return (
    <>
      <style>{HALL_ENTRANCE_POLISH}</style>
      <section
        id="hall-pioneers"
        className="scroll-mt-24 overflow-hidden rounded-[30px] border border-amber-300/25 bg-[radial-gradient(circle_at_14%_0%,rgba(217,154,78,0.13),transparent_30%),radial-gradient(circle_at_86%_14%,rgba(246,216,159,0.055),transparent_26%),linear-gradient(180deg,rgba(42,29,24,0.97),rgba(18,12,20,0.99)_48%,rgba(12,9,15,1))] shadow-[0_26px_70px_rgba(0,0,0,0.22)]"
      >
        <PioneersHallHeader recordCount={new Set(entries.map((entry) => entry.record_type)).size} />

        <div className="space-y-12 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
          <MuseumWingHeading
            eyebrow="THE THREE GATES"
            title="세 번 열린 최초의 문"
            description="한 시대의 경계를 차례로 넘어선 세 순간을 각각 독립된 유물함에 보존합니다."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {tierRelics.map((entry, index) => (
              <TierRelicCase
                key={entry.id}
                entry={entry}
                emblemKind={index === 0 ? 'MASTER' : index === 1 ? 'CELESTIAL' : 'GRANDMASTER'}
              />
            ))}
          </div>

          <Divider />

          <MuseumWingHeading
            eyebrow="CABINET OF FIRSTS"
            title="처음이라는 이름의 기록"
            description="누군가 처음 도달했기에 이후의 역사가 시작될 수 있었던 순간들입니다."
          />
          <div className="space-y-4">
            <FirstsRow rows={topFirsts} columns={2} />
            <FirstsRow rows={middleFirsts} columns={3} />
            <FirstsRow rows={bottomFirsts} columns={2} />
          </div>

          <Divider />

          <GrandmasterLineage rows={grandmasters} />
        </div>
      </section>
    </>
  );
}

function selectFirsts(
  byType: Map<string, HallOfGloryEntry[]>,
  types: readonly string[],
) {
  return types
    .map((type) => byType.get(type)?.[0])
    .filter((entry): entry is HallOfGloryEntry => Boolean(entry));
}

function Divider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-amber-200/15 to-transparent" />;
}

function PioneersHallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-amber-200/12 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="absolute inset-y-0 right-0 w-2/5 bg-[radial-gradient(circle_at_80%_50%,rgba(217,154,78,0.09),transparent_52%)]" />
      <DoorOpen aria-hidden="true" className="absolute -right-4 -top-8 h-40 w-40 text-amber-100/[0.025] sm:h-52 sm:w-52" strokeWidth={1.05} />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-t-[28px] rounded-b-[14px] border border-amber-300/30 bg-amber-100/[0.055] text-amber-100 shadow-[inset_0_0_24px_rgba(255,220,163,0.025)] sm:h-[72px] sm:w-[72px]">
            <DoorOpen className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.55} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-amber-200/85">HALL 01 · THE FIRST AGE</div>
            <h3 className="mt-1.5 font-display text-3xl text-amber-50 sm:text-4xl [word-break:keep-all]">B.R.A.N.D의 개척자</h3>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-amber-50/72 sm:text-base [word-break:keep-all]">
              최초의 문을 연 이들과, 그 시대의 정상에 먼저 오른 자들의 기록
            </p>
          </div>
        </div>
        <div className="w-fit rounded-full border border-amber-200/18 bg-black/15 px-4 py-2 text-center">
          <div className="font-display text-2xl text-amber-200">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-amber-50/55">PRESERVED RECORDS</div>
        </div>
      </div>
    </header>
  );
}

function MuseumWingHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-[11px] font-black tracking-[0.22em] text-amber-300/70">{eyebrow}</div>
      <h4 className="mt-2 font-display text-2xl text-amber-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-7 text-amber-50/60 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function MetalRelicFrame({ children, className = '', innerClassName = '' }: { children: ReactNode; className?: string; innerClassName?: string }) {
  return (
    <article className={`group relative overflow-hidden rounded-[26px] p-[2.5px] shadow-[0_0_28px_rgba(217,154,78,0.12)] ${className}`}>
      <div aria-hidden="true" className="absolute inset-0 rounded-[26px] bg-[linear-gradient(135deg,rgba(247,223,159,0.82),rgba(132,84,45,0.86),rgba(244,219,153,0.78),rgba(92,57,30,0.88))]" />
      <div aria-hidden="true" className="relic-orbit-border absolute inset-0 rounded-[26px] opacity-95" />
      <div aria-hidden="true" className="absolute inset-[1px] rounded-[25px] border border-amber-50/16" />
      <div className={`relative h-full overflow-hidden rounded-[23px] bg-[radial-gradient(circle_at_50%_18%,rgba(255,224,165,0.11),transparent_36%),linear-gradient(180deg,rgba(36,26,24,0.95),rgba(15,10,16,0.985))] shadow-[inset_0_0_34px_rgba(255,224,165,0.022)] ${innerClassName}`}>
        <GlassReflections />
        {children}
      </div>
    </article>
  );
}

function TierRelicCase({ entry, emblemKind }: { entry: HallOfGloryEntry; emblemKind: EmblemKind }) {
  const period = displayDate(entry);
  const description = TIER_COPY[entry.record_type] ?? '';

  return (
    <MetalRelicFrame innerClassName="px-5 pb-5 pt-6">
      <div className="relative flex h-full min-h-[338px] flex-col items-center text-center">
        <div className="text-[10px] font-black tracking-[0.2em] text-amber-200/58">PRESERVED RELIC</div>
        <h5 className="mt-2 whitespace-nowrap font-display text-xl leading-7 text-amber-50 sm:text-2xl">{entry.title}</h5>

        <div className="my-5">
          <PioneerEmblemMount kind={emblemKind} />
        </div>

        <div className="mt-auto w-full rounded-[18px] border border-amber-200/22 bg-black/22 px-4 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_0_18px_rgba(217,154,78,0.055)]">
          <div className="text-[10px] font-black tracking-[0.16em] text-amber-300/60">HONOREE</div>
          <div
            className="mt-1 font-display text-3xl text-amber-100 sm:text-[2.15rem] [word-break:keep-all]"
            style={{ textShadow: '0 0 12px rgba(255, 217, 132, .22), 0 0 26px rgba(217, 154, 78, .12)' }}
          >
            {entry.subject_display_name}
          </div>
          {period && <div className="mt-2 text-sm font-extrabold text-amber-50/82">{period}</div>}
        </div>
        {description && (
          <p className="mt-4 whitespace-nowrap text-[11px] font-semibold leading-6 text-amber-50/66 sm:text-xs">
            {description}
          </p>
        )}
      </div>
    </MetalRelicFrame>
  );
}

function PioneerEmblemMount({ kind }: { kind: EmblemKind }) {
  const label = kind === 'MASTER' ? 'MASTER' : kind === 'CELESTIAL' ? 'CELESTIAL MASTER' : '2023 GRANDMASTER';
  const src = TIER_ICON_BY_KIND[kind];

  return (
    <div className="relative flex h-[126px] w-[126px] items-center justify-center">
      <div aria-hidden="true" className="absolute inset-0 rounded-full border border-amber-100/12" />
      <div aria-hidden="true" className="absolute inset-[8px] rounded-full bg-[radial-gradient(circle,rgba(255,224,165,0.09),transparent_68%)] shadow-[0_0_30px_rgba(217,154,78,0.09)]" />
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="relative h-[104px] w-[104px] object-contain drop-shadow-[0_0_10px_rgba(255,220,154,0.22)]"
      />
      <div className="absolute -bottom-2 whitespace-nowrap rounded-full border border-amber-200/18 bg-[#171014]/92 px-2.5 py-1 text-[8px] font-black tracking-[0.14em] text-amber-100/58">
        {label}
      </div>
    </div>
  );
}

function FirstsRow({ rows, columns }: { rows: HallOfGloryEntry[]; columns: 2 | 3 }) {
  if (rows.length === 0) return null;
  const gridClass = columns === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2';

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {rows.map((entry) => (
        entry.subject_kind === 'EMPTY_THRONE'
          ? <VacantFirstRelic key={entry.id} entry={entry} />
          : <FirstRelicCase key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function FirstRelicCase({ entry }: { entry: HallOfGloryEntry }) {
  const period = displayDate(entry);
  const achievementName = achievementLabel(entry);
  const title = firstRecordTitle(entry);
  const Icon = entry.record_type.includes('GOLD') ? Coins : entry.record_type.includes('MVP') ? Crown : Gem;
  const isMvp = entry.record_type === 'FIRST_MONTHLY_MVP';

  return (
    <MetalRelicFrame innerClassName="p-5">
      <div className="relative flex h-full min-h-[244px] flex-col items-center text-center">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-[10px] font-black tracking-[0.16em] text-amber-300/64">FIRST RECORD</div>
          <ShieldCheck className="h-4 w-4 text-amber-200/55" strokeWidth={1.5} />
        </div>

        <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-[15px] border border-amber-200/24 bg-amber-100/[0.05] text-amber-100/82 shadow-[0_0_18px_rgba(217,154,78,0.08)]">
          <Icon className="h-5 w-5" strokeWidth={1.55} />
        </div>
        <h5 className="mt-3 whitespace-nowrap font-display text-xl leading-7 text-amber-50 sm:text-[1.4rem]">{title}</h5>

        <div className="mt-5 w-full border-t border-amber-100/12 pt-4 text-center">
          <div
            className="font-display text-3xl text-amber-100 sm:text-[2.15rem] [word-break:keep-all]"
            style={{ textShadow: '0 0 14px rgba(255, 217, 132, .24), 0 0 28px rgba(217, 154, 78, .14)' }}
          >
            {entry.subject_display_name}
          </div>
          {period && <div className="mt-2 text-sm font-extrabold text-amber-50/78">{period}</div>}
        </div>

        {achievementName && (
          <div className="mt-auto w-full pt-4">
            <div className="rounded-[14px] border border-amber-200/20 bg-black/18 px-3 py-3 text-center shadow-[0_0_14px_rgba(217,154,78,0.045)]">
              <div className="text-[9px] font-black tracking-[0.14em] text-amber-300/60">PRESERVED ACHIEVEMENT</div>
              <div className="mt-1 font-display text-lg text-amber-50 sm:text-xl [word-break:keep-all]">{achievementName}</div>
            </div>
          </div>
        )}

        {isMvp && (
          <div className="mt-auto w-full pt-4">
            <div className="grid w-full grid-cols-3 gap-2">
              {FIRST_MVP_RIVALS.map((name) => (
                <div
                  key={name}
                  className="whitespace-nowrap rounded-full border border-amber-200/22 bg-[linear-gradient(180deg,rgba(255,230,180,0.11),rgba(0,0,0,0.18))] px-2 py-2 font-display text-[12px] text-amber-50 shadow-[0_0_12px_rgba(217,154,78,0.08)] sm:text-sm"
                >
                  {name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </MetalRelicFrame>
  );
}

function VacantFirstRelic({ entry }: { entry: HallOfGloryEntry }) {
  const title = firstRecordTitle(entry);

  return (
    <MetalRelicFrame className="opacity-95" innerClassName="p-5">
      <div className="relative flex h-full min-h-[244px] flex-col items-center justify-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-amber-200/24 bg-black/15 shadow-[0_0_18px_rgba(217,154,78,0.05)]">
          <Crown className="h-7 w-7 text-amber-100/42" strokeWidth={1.3} />
        </div>
        <div className="mt-4 text-[10px] font-black tracking-[0.16em] text-amber-300/50">VACANT RELIQUARY</div>
        <h5 className="mt-2 whitespace-nowrap font-display text-xl leading-7 text-amber-50/90 sm:text-[1.4rem]">{title}</h5>
        <p className="mt-3 max-w-[320px] text-xs font-semibold leading-6 text-amber-50/52 [word-break:keep-all]">
          아직 누구의 이름도 새겨지지 않았습니다.
        </p>
      </div>
    </MetalRelicFrame>
  );
}

function GrandmasterLineage({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="relative -mx-1 overflow-hidden rounded-[34px] border border-amber-100/30 bg-[#070812] shadow-[0_28px_76px_rgba(0,0,0,0.38),0_0_34px_rgba(229,176,91,0.09)] lg:min-h-[690px] xl:min-h-[720px]">
      <img
        src={GRANDMASTER_LINEAGE_BG}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center lg:object-contain"
      />

      {/* 중앙의 6개 명예석만 읽기 쉽게 눌러 주고, 좌우 네 신수는 최대한 살린다. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,6,16,0.66)_0%,rgba(5,6,16,0.52)_36%,rgba(5,6,16,0.28)_62%,rgba(5,6,16,0.10)_82%,rgba(5,6,16,0.05)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,5,13,0.20)_0%,rgba(4,5,13,0.08)_23%,rgba(4,5,13,0.10)_70%,rgba(4,5,13,0.42)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[9%] top-0 h-px bg-gradient-to-r from-transparent via-amber-100/58 to-transparent"
      />

      <div className="relative z-10 flex min-h-[inherit] flex-col px-4 pb-6 pt-7 sm:px-6 sm:pb-7 sm:pt-8 lg:px-[8.5%] lg:pb-8 lg:pt-8">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full border border-amber-100/28 bg-[#080914]/66 px-4 py-1.5 shadow-[0_0_20px_rgba(237,192,103,0.09)] backdrop-blur-[2px]">
            <span className="text-[10px] font-black tracking-[0.28em] text-amber-200/92 sm:text-[11px]">
              GRANDMASTER ROLL · 2023
            </span>
          </div>
          <h4
            className="grandmaster-serif mt-2.5 text-[clamp(1.8rem,3.7vw,2.75rem)] font-black leading-tight tracking-[-0.04em] [word-break:keep-all]"
            style={{
              backgroundImage: 'linear-gradient(180deg, #fff8df 0%, #ffe9ac 34%, #f3ca72 68%, #d8a24a 100%)',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 2px 0 rgba(255,246,212,.22)) drop-shadow(0 4px 10px rgba(255,203,96,.22)) drop-shadow(0 10px 22px rgba(0,0,0,.48))',
              textShadow: '0 1px 0 rgba(255,250,232,.18), 0 2px 0 rgba(175,117,34,.22)',
            }}
          >
            그랜드마스터 명예의 계보
          </h4>
          <p className="grandmaster-serif mx-auto mt-2 max-w-3xl text-[12px] font-bold leading-6 text-amber-50/90 [word-break:keep-all] sm:text-sm">
            역사에 영원히 새겨진 6명의 그랜드마스터
          </p>
        </div>

        <div className="mx-auto mt-5 grid w-full max-w-[900px] flex-1 content-center gap-3.5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-4 lg:gap-y-4">
          {rows.map((entry) => (
            <GrandmasterRelic key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}

function GrandmasterRelic({ entry }: { entry: HallOfGloryEntry }) {
  const period = displayDate(entry);

  return (
    <article className="grandmaster-legend-card group relative min-h-[244px] overflow-hidden rounded-[24px] border border-amber-100/32 bg-[linear-gradient(180deg,rgba(18,18,27,0.54),rgba(7,8,15,0.72))] px-3 pb-3.5 pt-2.5 text-center shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-[2px] sm:min-h-[250px] sm:px-4 sm:pt-3">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[1px] rounded-[22px] border border-white/[0.045]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[14%] top-0 h-px bg-gradient-to-r from-transparent via-amber-100/60 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[31px] h-[176px] w-[176px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,209,111,0.19),rgba(105,78,173,0.065)_43%,transparent_70%)] blur-lg"
      />

      <div className="relative flex h-full flex-col items-center">
        <div className="relative flex h-[168px] w-[168px] items-center justify-center sm:h-[176px] sm:w-[176px]">
          <div
            aria-hidden="true"
            className="grandmaster-emblem-aura absolute inset-[2px] rounded-full border border-amber-100/18 bg-[radial-gradient(circle,rgba(255,226,155,0.13),rgba(88,67,143,0.04)_45%,transparent_72%)] shadow-[0_0_32px_rgba(255,207,107,0.18),0_0_58px_rgba(105,82,180,0.10)]"
          />
          <img
            src={RECORDS_TIER_ICONS_2023.GRAND_MASTER}
            alt=""
            aria-hidden="true"
            className="relative z-10 h-[156px] w-[156px] object-contain drop-shadow-[0_0_14px_rgba(255,218,138,0.36)] sm:h-[164px] sm:w-[164px]"
          />
        </div>

        <div className="mt-0.5 flex w-[78%] items-center gap-2" aria-hidden="true">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-100/38" />
          <span className="h-1.5 w-1.5 rotate-45 border border-amber-100/70 bg-amber-200/20 shadow-[0_0_8px_rgba(255,218,137,0.28)]" />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-100/38" />
        </div>

        <div
          className="grandmaster-serif mt-2.5 whitespace-nowrap text-[1.46rem] font-extrabold leading-none tracking-[-0.035em] sm:text-[1.56rem]"
          style={{
            color: '#f7e9bb',
            textShadow:
              '0 1px 0 rgba(255,248,223,.28), 0 2px 0 rgba(177,120,42,.18), 0 8px 18px rgba(0,0,0,.44), 0 16px 24px rgba(255,192,94,.14)',
            filter: 'drop-shadow(0 7px 12px rgba(255, 196, 112, .20))',
          }}
        >
          {entry.subject_display_name}
        </div>

        {period && (
          <div
            className="grandmaster-serif mt-1.5 whitespace-nowrap text-[10px] font-bold tracking-[-0.015em] sm:text-[11px]"
            style={{
              color: 'rgba(246, 233, 191, 0.92)',
              textShadow: '0 2px 9px rgba(255, 197, 104, .14), 0 4px 12px rgba(0,0,0,.42)',
            }}
          >
            {period}
          </div>
        )}
      </div>
    </article>
  );
}

function GlassReflections() {
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-10 w-[40%] rounded-full bg-white/[0.02] blur-xl" />
    </>
  );
}

function firstRecordTitle(entry: HallOfGloryEntry) {
  if (entry.record_type === 'FIRST_GOLD_50000') return '최초 50,000골드 보유';
  return entry.title;
}

function displayDate(entry: HallOfGloryEntry) {
  if (entry.occurred_on) return koreanDate(entry.occurred_on);
  if (entry.period_label) return entry.period_label;
  if (entry.school_year != null) return `${entry.school_year}년`;
  return '';
}

function koreanDate(value: string) {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

function achievementLabel(entry: HallOfGloryEntry) {
  const value = entry.metadata?.achievement_name;
  if (typeof value === 'string' && value.trim()) return value;
  if (['FIRST_UNIQUE_ACHIEVEMENT', 'FIRST_TRANSCENDENT_ACHIEVEMENT'].includes(entry.record_type)) return entry.subtitle;
  return null;
}

function metadataNumber(entry: HallOfGloryEntry, key: string) {
  const value = entry.metadata?.[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
