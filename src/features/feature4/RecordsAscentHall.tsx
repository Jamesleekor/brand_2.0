import {
  ArrowUpRight,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const ASCENT_STYLE = `
@keyframes ascentPulse {
  0% { transform:translateY(26px); opacity:0; }
  18% { opacity:.70; }
  72% { opacity:.18; }
  100% { transform:translateY(-520px); opacity:0; }
}
@keyframes apexBreath {
  0%,100% { opacity:.36; transform:scale(.98); }
  50% { opacity:.72; transform:scale(1.035); }
}
.ascent-pulse { animation:ascentPulse 7.6s ease-in-out infinite; }
.apex-breath { animation:apexBreath 5.9s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .ascent-pulse,.apex-breath { animation:none; }
}
`;

export function RecordsAscentHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const rows = [...entries]
    .filter((entry) => entry.record_type === 'MONTHLY_BV_GAIN')
    .sort((a, b) => (a.rank_position ?? 99) - (b.rank_position ?? 99));

  return (
    <>
      <style>{ASCENT_STYLE}</style>
      <section
        id="hall-ascent"
        className="scroll-mt-24 overflow-hidden rounded-[30px] border border-cyan-100/20 bg-[radial-gradient(circle_at_52%_-8%,rgba(126,237,234,0.11),transparent_28%),radial-gradient(circle_at_14%_36%,rgba(90,160,205,0.07),transparent_25%),linear-gradient(180deg,rgba(18,35,43,0.985),rgba(11,20,31,0.997)_52%,rgba(7,11,19,1))] shadow-[0_28px_76px_rgba(0,0,0,0.28)]"
      >
        <AscentHallHeader recordCount={new Set(entries.map((entry) => entry.record_type)).size} />

        <div className="space-y-10 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
          <WingHeading
            eyebrow="THE ASCENT SPIRE"
            title="한 달 만에 가장 높이 치솟은 궤적"
            description="한 달 동안 얼마나 큰 BV 상승을 만들어냈는가. 다섯 번의 도약을 하나의 상승 궤도로 이어 기록합니다."
          />
          <AscentSpire rows={rows} />

          <div className="rounded-[18px] border border-cyan-100/12 bg-cyan-100/[0.025] px-4 py-3 text-center text-xs font-semibold leading-6 text-cyan-50/58 sm:text-sm">
            이 전시는 월간 BV 순증가량을 기준으로 높이를 정합니다. 새로운 기록이 TOP 5에 진입하면 궤적도 함께 갱신됩니다.
          </div>
        </div>
      </section>
    </>
  );
}

function AscentHallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-cyan-100/11 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="apex-breath absolute left-1/2 top-[-118px] h-[270px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(126,236,233,0.12),transparent_67%)] blur-xl" />
      <Rocket aria-hidden="true" className="absolute -right-5 -top-8 h-48 w-48 text-cyan-100/[0.022] sm:h-60 sm:w-60" strokeWidth={1.0} />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-cyan-100/24 bg-[radial-gradient(circle,rgba(113,224,224,0.10),rgba(17,32,41,0.88)_72%)] text-cyan-100 shadow-[0_0_26px_rgba(99,219,219,0.08)] sm:h-[72px] sm:w-[72px]">
            <TrendingUp className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.45} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-cyan-100/76">HALL 04 · THE ASCENT SPIRE</div>
            <h3 className="mt-1.5 font-display text-3xl text-cyan-50 sm:text-4xl [word-break:keep-all]">비상의 궤적</h3>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-cyan-50/70 sm:text-base [word-break:keep-all]">
              가장 가파르게 치솟은 성장의 순간들. 기록은 카드가 아니라 하나의 상승 경로로 이어집니다.
            </p>
          </div>
        </div>

        <div className="w-fit rounded-full border border-cyan-100/16 bg-black/18 px-4 py-2 text-center">
          <div className="font-display text-2xl text-cyan-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-cyan-50/52">ASCENT RECORDS</div>
        </div>
      </div>
    </header>
  );
}

function WingHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-[11px] font-black tracking-[0.22em] text-cyan-200/60">{eyebrow}</div>
      <h4 className="mt-2 font-display text-2xl text-cyan-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-7 text-cyan-50/58 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function AscentSpire({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;
  const apex = rows[0];
  const trail = rows.slice(1);
  const maxValue = Number(apex.value_primary ?? 1);

  return (
    <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-cyan-100/15 bg-[radial-gradient(circle_at_50%_0%,rgba(130,237,235,0.08),transparent_27%),linear-gradient(180deg,rgba(19,37,46,0.86),rgba(8,16,25,0.985))] px-4 py-7 shadow-[inset_0_0_40px_rgba(112,227,225,0.012)] sm:px-6 sm:py-9">
      <div aria-hidden="true" className="absolute bottom-8 left-1/2 top-40 w-px -translate-x-1/2 bg-gradient-to-t from-cyan-200/5 via-cyan-100/20 to-cyan-50/48" />
      <div aria-hidden="true" className="ascent-pulse absolute bottom-8 left-1/2 h-28 w-[3px] -translate-x-1/2 rounded-full bg-gradient-to-t from-transparent via-cyan-100/78 to-transparent shadow-[0_0_14px_rgba(116,236,233,0.32)]" />

      <ApexMarker entry={apex} />

      <div className="relative mt-8 space-y-5 sm:mt-10 sm:space-y-6">
        {trail.map((entry, index) => (
          <AscentMarker
            key={entry.id}
            entry={entry}
            side={index % 2 === 0 ? 'left' : 'right'}
            strength={Math.max(0.58, Number(entry.value_primary ?? 0) / maxValue)}
          />
        ))}
      </div>
    </div>
  );
}

function ApexMarker({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative mx-auto max-w-2xl text-center">
      <div aria-hidden="true" className="apex-breath absolute left-1/2 top-0 h-36 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(135,245,240,0.12),transparent_68%)] blur-lg" />
      <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-cyan-100/26 bg-[radial-gradient(circle,rgba(124,235,232,0.13),rgba(12,27,35,0.92)_72%)] text-cyan-50 shadow-[0_0_34px_rgba(101,226,223,0.11)]">
        <Rocket className="h-9 w-9" strokeWidth={1.35} />
      </div>
      <div className="relative mt-4 text-[10px] font-black tracking-[0.2em] text-cyan-200/62">APEX · #1</div>
      <div className="relative mt-2 font-display text-4xl text-cyan-50 sm:text-5xl [text-shadow:0_0_18px_rgba(134,241,238,0.14)]">{entry.subject_display_name}</div>
      <div className="relative mt-3 font-display text-3xl text-cyan-100 sm:text-4xl">+{formatNumber(entry.value_primary ?? 0)} BV</div>
      {entry.period_label && <div className="relative mt-2 text-sm font-bold text-cyan-50/62">{entry.period_label}</div>}
      <div className="relative mt-4"><AscentRecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} /></div>
      <div aria-hidden="true" className="relative mx-auto mt-5 h-10 w-px bg-gradient-to-b from-cyan-100/48 to-cyan-100/8" />
    </article>
  );
}

function AscentMarker({ entry, side, strength }: { entry: HallOfGloryEntry; side: 'left' | 'right'; strength: number }) {
  const width = `${Math.round(68 + strength * 24)}%`;
  const alignClass = side === 'left' ? 'sm:mr-auto sm:pr-12' : 'sm:ml-auto sm:pl-12';
  const arrowSide = side === 'left' ? 'sm:right-[-7px]' : 'sm:left-[-7px]';

  return (
    <div className={`relative mx-auto w-full sm:w-[52%] ${alignClass}`}>
      <div aria-hidden="true" className={`absolute top-1/2 hidden h-px w-12 -translate-y-1/2 bg-gradient-to-r from-cyan-100/28 to-transparent sm:block ${side === 'left' ? 'right-0' : 'left-0 rotate-180'}`} />
      <div aria-hidden="true" className={`absolute top-1/2 hidden h-3 w-3 -translate-y-1/2 rounded-full border border-cyan-100/28 bg-[#10202a] shadow-[0_0_12px_rgba(96,220,219,0.10)] sm:block ${arrowSide}`} />

      <article
        className="relative overflow-hidden border border-cyan-100/16 bg-[linear-gradient(135deg,rgba(46,93,103,0.32),rgba(10,19,28,0.94))] px-4 py-4 shadow-[inset_0_0_24px_rgba(114,228,226,0.012)] sm:px-5"
        style={{ clipPath: 'polygon(0 0, 94% 0, 100% 50%, 94% 100%, 0 100%)', width }}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-100/18 bg-black/18 font-display text-lg text-cyan-100">
            {entry.rank_position}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl text-cyan-50 sm:text-2xl">{entry.subject_display_name}</div>
            {entry.period_label && <div className="mt-1 text-xs font-bold text-cyan-50/50">{entry.period_label}</div>}
          </div>
          <div className="shrink-0 text-right">
            <div className="font-display text-xl text-cyan-100 sm:text-2xl">+{formatNumber(entry.value_primary ?? 0)}</div>
            <div className="text-[9px] font-black tracking-[0.14em] text-cyan-200/48">BV</div>
          </div>
        </div>
      </article>
    </div>
  );
}

function AscentRecordBadge({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${live ? 'border-cyan-100/24 bg-cyan-100/[0.06] text-cyan-100' : 'border-sky-100/22 bg-sky-100/[0.05] text-sky-100'}`}>
      <ShieldCheck className="h-4 w-4" strokeWidth={1.55} />
      {live ? '현재 공식 기록' : '공식 확정 기록'}
    </span>
  );
}
