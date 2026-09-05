import {
  Archive,
  Coins,
  Crown,
  Gem,
  Medal,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const THRONE_STYLE = `
@keyframes throneBreath {
  0%, 100% { opacity: .42; transform: scale(.98); }
  50% { opacity: .72; transform: scale(1.02); }
}
.throne-breath {
  animation: throneBreath 5.8s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .throne-breath { animation: none; }
}
`;

export function RecordsThroneHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const byType = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = byType.get(entry.record_type) ?? [];
    rows.push(entry);
    byType.set(entry.record_type, rows);
  });

  const bvRows = sortRows(byType.get('ALL_TIME_BV') ?? []);
  const goldRows = sortRows(byType.get('ALL_TIME_GOLD_BALANCE') ?? []);
  const achievementCountRows = sortRows(byType.get('MOST_VALID_ACHIEVEMENTS') ?? []);
  const achievementScoreRows = sortRows(byType.get('HIGHEST_ACHIEVEMENT_SCORE') ?? []);
  const recordCount = new Set(entries.map((entry) => entry.record_type)).size;

  return (
    <>
      <style>{THRONE_STYLE}</style>
      <section
        id="hall-throne"
        className="scroll-mt-24 overflow-hidden rounded-[30px] border border-yellow-100/24 bg-[radial-gradient(circle_at_50%_-8%,rgba(255,244,200,0.11),transparent_27%),radial-gradient(circle_at_14%_24%,rgba(169,149,225,0.065),transparent_25%),linear-gradient(180deg,rgba(31,27,39,0.985),rgba(15,12,24,0.995)_48%,rgba(9,8,15,1))] shadow-[0_28px_74px_rgba(0,0,0,0.26)]"
      >
        <ThroneHallHeader recordCount={recordCount} />

        <div className="space-y-12 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
          <WingHeading
            eyebrow="THE HIGH THRONE"
            title="가장 높은 숫자에 허락된 자리"
            description="B.R.A.N.D 가치가 도달한 가장 높은 정점. 더 높은 기록이 탄생하는 순간 왕좌의 이름도 바뀝니다."
          />
          {bvRows[0] && <AbsoluteThrone entry={bvRows[0]} />}

          <Divider />

          <WingHeading
            eyebrow="THE GILDED VAULT"
            title="황금이 가장 높이 쌓였던 순간"
            description="한때 실제로 보유했던 GOLD의 최고점을 기록합니다. 1위의 왕좌와 그 뒤를 잇는 네 개의 금고를 함께 보존합니다."
          />
          <GoldVault rows={goldRows} />

          <Divider />

          <WingHeading
            eyebrow="ACHIEVEMENT DOMINION"
            title="업적의 정점은 두 가지로 증명된다"
            description="얼마나 많은 업적을 쌓았는가, 그리고 그 업적들이 얼마나 높은 가치를 지녔는가를 서로 다른 왕좌로 기록합니다."
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <AchievementThrone
              kind="COUNT"
              title="역대 최다 유효 업적"
              label="VOLUME THRONE"
              rows={achievementCountRows}
            />
            <AchievementThrone
              kind="SCORE"
              title="역대 최고 누적 업적 점수"
              label="WEIGHT THRONE"
              rows={achievementScoreRows}
            />
          </div>

          <div className="rounded-[18px] border border-violet-200/13 bg-violet-100/[0.025] px-4 py-3 text-center text-xs font-semibold leading-6 text-violet-50/62 sm:text-sm">
            업적 개수·점수는 측정 가능한 공식 업적 체계가 존재하는 2026 기록을 기준으로 전시합니다. 2023–2025의 업적 기록은 측정되지 않았습니다.
          </div>
        </div>
      </section>
    </>
  );
}

function ThroneHallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-yellow-100/12 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="throne-breath absolute left-1/2 top-[-110px] h-[260px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,239,176,0.12),transparent_67%)] blur-xl" />
      <Crown aria-hidden="true" className="absolute -right-5 -top-8 h-44 w-44 text-yellow-100/[0.022] sm:h-56 sm:w-56" strokeWidth={1.0} />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-yellow-100/25 bg-[radial-gradient(circle,rgba(255,239,184,0.09),rgba(26,21,35,0.84)_72%)] text-yellow-100 shadow-[0_0_24px_rgba(255,226,119,0.08)] sm:h-[72px] sm:w-[72px]">
            <Crown className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.45} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-yellow-100/78">HALL 02 · THE HIGH THRONE</div>
            <h3 className="mt-1.5 font-display text-3xl text-yellow-50 sm:text-4xl [word-break:keep-all]">정점의 왕좌</h3>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-violet-50/72 sm:text-base [word-break:keep-all]">
              현재까지 숫자로 증명된 절대 정점. 기록은 보존되지만 왕좌의 주인은 영원하지 않습니다.
            </p>
          </div>
        </div>

        <div className="w-fit rounded-full border border-yellow-100/18 bg-black/18 px-4 py-2 text-center">
          <div className="font-display text-2xl text-yellow-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-violet-50/55">ACTIVE THRONES</div>
        </div>
      </div>
    </header>
  );
}

function WingHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-[11px] font-black tracking-[0.22em] text-yellow-100/62">{eyebrow}</div>
      <h4 className="mt-2 font-display text-2xl text-yellow-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-7 text-violet-50/60 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-yellow-100/14 to-transparent" />;
}

function AbsoluteThrone({ entry }: { entry: HallOfGloryEntry }) {
  const value = `${formatNumber(entry.value_primary ?? 0)} ${entry.unit ?? ''}`.trim();

  return (
    <article className="relative mx-auto max-w-4xl overflow-hidden rounded-[30px] border border-yellow-100/28 bg-[radial-gradient(circle_at_50%_14%,rgba(255,239,180,0.12),transparent_31%),linear-gradient(180deg,rgba(41,35,45,0.94),rgba(17,13,25,0.985))] px-5 py-7 text-center shadow-[0_0_34px_rgba(255,226,119,0.075),inset_0_0_38px_rgba(255,240,198,0.018)] sm:px-8 sm:py-9">
      <div aria-hidden="true" className="throne-breath absolute left-1/2 top-8 h-44 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,238,175,0.10),transparent_68%)] blur-lg" />
      <div aria-hidden="true" className="absolute inset-x-[8%] top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="relative">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border border-yellow-100/24 bg-black/18 text-yellow-100 shadow-[0_0_28px_rgba(255,226,119,0.10)]">
          <Crown className="h-10 w-10" strokeWidth={1.3} />
        </div>
        <div className="mt-4 text-[10px] font-black tracking-[0.2em] text-yellow-100/58">ABSOLUTE RECORD · BV</div>
        <h5 className="mt-2 font-display text-xl text-violet-50 sm:text-2xl">{entry.title}</h5>

        <div className="mt-6 font-display text-[clamp(2.6rem,7vw,5rem)] leading-none text-yellow-100 [text-shadow:0_0_24px_rgba(255,226,119,0.16)]">
          {value}
        </div>

        <div className="mx-auto mt-7 max-w-xl rounded-[20px] border border-yellow-100/18 bg-black/20 px-5 py-4">
          <div className="text-[10px] font-black tracking-[0.18em] text-yellow-100/52">THRONE HOLDER</div>
          <div className="mt-1 font-display text-3xl text-yellow-50 sm:text-4xl [text-shadow:0_0_16px_rgba(255,236,190,0.15)]">
            {entry.subject_display_name}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {entry.period_label && <span className="text-sm font-bold text-violet-50/70">{entry.period_label}</span>}
            <RecordStatusBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} />
          </div>
        </div>
      </div>
    </article>
  );
}

function GoldVault({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;
  const [first, ...rest] = rows;

  return (
    <div className="space-y-4">
      <GoldVaultFirst entry={first} />
      {rest.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {rest.map((entry) => <GoldVaultPlaque key={entry.id} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

function GoldVaultFirst({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative overflow-hidden rounded-[28px] border border-amber-200/30 bg-[radial-gradient(circle_at_88%_10%,rgba(255,195,83,0.12),transparent_28%),linear-gradient(135deg,rgba(54,40,25,0.90),rgba(20,15,24,0.98))] p-5 shadow-[0_0_30px_rgba(255,190,70,0.075)] sm:p-6">
      <Coins aria-hidden="true" className="absolute -right-4 -top-6 h-32 w-32 text-amber-100/[0.025]" strokeWidth={1.0} />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-amber-200/30 bg-amber-100/[0.07] font-display text-2xl text-amber-100 shadow-[0_0_20px_rgba(255,190,70,0.08)]">1</div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="text-[10px] font-black tracking-[0.18em] text-amber-200/62">THE GOLDEN PEAK</div>
          <div className="mt-1 font-display text-3xl text-amber-100">{entry.subject_display_name}</div>
          {entry.period_label && <div className="mt-1.5 text-sm font-bold text-amber-50/66">{entry.period_label}</div>}
        </div>
        <div className="text-center sm:text-right">
          <div className="font-display text-3xl text-amber-100 sm:text-4xl">{formatNumber(entry.value_primary ?? 0)}</div>
          <div className="mt-1 text-xs font-black tracking-[0.15em] text-amber-200/58">GOLD</div>
          <div className="mt-2"><RecordStatusBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} /></div>
        </div>
      </div>
    </article>
  );
}

function GoldVaultPlaque({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="rounded-[22px] border border-amber-100/18 bg-[linear-gradient(145deg,rgba(61,45,27,0.48),rgba(18,14,22,0.94))] px-4 py-4 shadow-[inset_0_0_22px_rgba(255,202,103,0.015)] sm:px-5">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-100/20 bg-black/18 font-display text-lg text-amber-100/82">
          {entry.rank_position}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl text-amber-50 sm:text-2xl">{entry.subject_display_name}</div>
          {entry.period_label && <div className="mt-1 text-xs font-bold text-amber-50/55">{entry.period_label}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-xl text-amber-100 sm:text-2xl">{formatNumber(entry.value_primary ?? 0)}</div>
          <div className="text-[9px] font-black tracking-[0.14em] text-amber-200/48">GOLD</div>
        </div>
      </div>
    </article>
  );
}

function AchievementThrone({
  kind,
  title,
  label,
  rows,
}: {
  kind: 'COUNT' | 'SCORE';
  title: string;
  label: string;
  rows: HallOfGloryEntry[];
}) {
  const primary = rows[0];
  const accent = kind === 'COUNT' ? 'text-sky-100' : 'text-violet-100';
  const border = kind === 'COUNT' ? 'border-sky-100/20' : 'border-violet-100/22';
  const glow = kind === 'COUNT'
    ? 'bg-[radial-gradient(circle_at_50%_8%,rgba(178,223,255,0.10),transparent_32%),linear-gradient(180deg,rgba(27,34,46,0.92),rgba(15,12,24,0.98))]'
    : 'bg-[radial-gradient(circle_at_50%_8%,rgba(205,181,255,0.12),transparent_32%),linear-gradient(180deg,rgba(38,29,50,0.92),rgba(15,12,24,0.98))]';
  const Icon = kind === 'COUNT' ? Archive : Gem;

  return (
    <article className={`relative overflow-hidden rounded-[26px] border ${border} ${glow} p-5 text-center shadow-[0_0_26px_rgba(190,175,255,0.045)] sm:p-6`}>
      <div aria-hidden="true" className="absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
      <div className="relative flex h-full flex-col items-center">
        <div className={`flex h-14 w-14 items-center justify-center rounded-[18px] border ${border} bg-black/18 ${accent}`}>
          <Icon className="h-7 w-7" strokeWidth={1.45} />
        </div>
        <div className={`mt-4 text-[10px] font-black tracking-[0.18em] ${accent} opacity-65`}>{label}</div>
        <h5 className="mt-1.5 font-display text-xl text-violet-50 sm:text-2xl">{title}</h5>

        {primary ? (
          <>
            <div className={`mt-5 font-display text-4xl sm:text-5xl ${accent} [text-shadow:0_0_18px_rgba(205,190,255,0.12)]`}>
              {formatNumber(primary.value_primary ?? 0)}
              <span className="ml-1.5 text-base text-violet-50/60">{primary.unit}</span>
            </div>

            <div className={`mt-5 grid w-full gap-3 ${rows.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {rows.map((entry) => (
                <div key={entry.id} className={`rounded-[18px] border ${border} bg-black/18 px-3 py-3`}>
                  <div className="font-display text-2xl text-violet-50">{entry.subject_display_name}</div>
                  {entry.subject_brand_name && <div className="mt-1 text-[10px] font-bold text-violet-50/48">{entry.subject_brand_name}</div>}
                </div>
              ))}
            </div>

            {kind === 'SCORE' && primary.value_secondary != null && (
              <div className="mt-4 text-xs font-semibold text-violet-50/58">유효 업적 {formatNumber(primary.value_secondary)}개에서 누적된 점수</div>
            )}
            <div className="mt-4"><RecordStatusBadge live /></div>
          </>
        ) : (
          <div className="mt-6 text-sm font-bold text-violet-50/50">아직 기록이 없습니다.</div>
        )}
      </div>
    </article>
  );
}

function RecordStatusBadge({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${live ? 'border-violet-200/25 bg-violet-100/[0.07] text-violet-100' : 'border-yellow-100/25 bg-yellow-100/[0.06] text-yellow-100'}`}>
      <ShieldCheck className="h-4 w-4" strokeWidth={1.6} />
      {live ? '현재 공식 기록' : '공식 확정 기록'}
    </span>
  );
}

function sortRows(rows: HallOfGloryEntry[]) {
  return [...rows].sort((a, b) => {
    const rankA = a.rank_position ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank_position ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.subject_display_name.localeCompare(b.subject_display_name, 'ko');
  });
}
