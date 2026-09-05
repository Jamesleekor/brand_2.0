import {
  Crown,
  Medal,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { RECORDS_GUILD_LOGO_BY_NAME } from '@/features/feature4/records_hall_assets';

const SOVEREIGN_STYLE = `
@keyframes sovereignBorderFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes sovereignAura {
  0%,100% {
    box-shadow:
      0 0 10px 1px rgba(244,210,122,0.34),
      0 0 24px 4px rgba(108,92,170,0.20);
  }
  50% {
    box-shadow:
      0 0 20px 4px rgba(255,225,148,0.58),
      0 0 42px 8px rgba(119,95,190,0.34);
  }
}
@keyframes sovereignSealBreath {
  0%,100% { opacity:.78; transform:scale(.985); }
  50% { opacity:1; transform:scale(1.025); }
}
@keyframes sovereignBeamBreath {
  0%,100% { opacity:.16; }
  50% { opacity:.30; }
}
.sovereign-flow-frame {
  background: linear-gradient(115deg,#f7d97c,#594783,#fff0ba,#1d3148,#f0c95f,#7a5da9,#f7d97c);
  background-size: 300% 300%;
  animation: sovereignBorderFlow 6.2s ease infinite, sovereignAura 3.6s ease-in-out infinite;
}
.sovereign-seal-breath { animation: sovereignSealBreath 4.2s ease-in-out infinite; }
.sovereign-beam-breath { animation: sovereignBeamBreath 5.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .sovereign-flow-frame,
  .sovereign-seal-breath,
  .sovereign-beam-breath { animation:none; }
}
`;

const PROOFS = [
  {
    no: '01',
    title: '최종 우승 길드의 구성원',
    description: '시즌 종료 시 최종 우승 길드에 소속되어 있어야 합니다.',
    icon: Users,
  },
  {
    no: '02',
    title: '시즌 개인 기여도 TOP 3',
    description: '한 시즌 전체의 개인 기여도에서 TOP 3 안에 들어야 합니다.',
    icon: Trophy,
  },
  {
    no: '03',
    title: '공식 길드 미션 100% 달성',
    description: '해당 시즌의 공식 길드 미션을 하나도 빠짐없이 완수해야 합니다.',
    icon: ScrollText,
  },
  {
    no: '04',
    title: '공식 길드 세션 실제 출석 100%',
    description: '공식 길드 세션에 실제로 전부 출석해야 합니다. 인정불참은 실제 출석으로 계산하지 않습니다.',
    icon: ShieldCheck,
  },
] as const;

const TRIPLE_CROWN_PROOFS = [
  '월간 MVP 1회 이상',
  '시즌 종료 시 공식 업적 달성률 90% 이상',
  '해당 시즌 최종 우승 길드 소속',
] as const;

const KNOWN_SEASON_GUILD: Record<string, string> = {
  '2026 시즌1': 'Ruby',
};

export function RecordsSovereignProofHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const emperors = entries
    .filter((entry) => entry.record_type === 'SEASON_EMPEROR')
    .sort((a, b) => {
      const seasonA = seasonLabelOf(a);
      const seasonB = seasonLabelOf(b);
      if (seasonA !== seasonB) return seasonA.localeCompare(seasonB, 'ko');
      return a.sort_order - b.sort_order;
    });

  const tripleCrowns = entries
    .filter((entry) => entry.record_type === 'TRIPLE_CROWN')
    .sort((a, b) => a.sort_order - b.sort_order);

  const bySeason = new Map<string, HallOfGloryEntry[]>();
  emperors.forEach((entry) => {
    const season = seasonLabelOf(entry);
    const rows = bySeason.get(season) ?? [];
    rows.push(entry);
    bySeason.set(season, rows);
  });

  return (
    <>
      <style>{SOVEREIGN_STYLE}</style>
      <section
        id="hall-sovereign_proof"
        className="scroll-mt-24 overflow-hidden rounded-[32px] border border-slate-200/18 bg-[radial-gradient(circle_at_50%_-12%,rgba(248,220,153,0.12),transparent_28%),radial-gradient(circle_at_82%_24%,rgba(119,94,185,0.10),transparent_30%),radial-gradient(circle_at_12%_58%,rgba(72,117,152,0.08),transparent_26%),linear-gradient(180deg,rgba(15,18,27,0.995),rgba(9,10,17,0.998)_54%,rgba(5,6,10,1))] shadow-[0_32px_90px_rgba(0,0,0,0.38)]"
      >
        <HallHeader seasonCount={bySeason.size} emperorCount={emperors.length} />

        <div className="space-y-10 px-4 py-8 sm:px-7 sm:py-10 lg:px-9 lg:py-11">
          <ProofChamber />
          <ImperialDecree />

          {bySeason.size === 0 ? (
            <EmptyRegister />
          ) : (
            <div className="space-y-7">
              {Array.from(bySeason.entries()).map(([season, rows]) => (
                <SeasonRegister key={season} season={season} entries={rows} />
              ))}
            </div>
          )}

          <TripleCrownRegister entries={tripleCrowns} />
        </div>
      </section>
    </>
  );
}

function HallHeader({ seasonCount, emperorCount }: { seasonCount: number; emperorCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-slate-200/12 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="sovereign-beam-breath absolute left-1/2 top-[-210px] h-[390px] w-[420px] -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,244,210,0.46),rgba(255,230,157,0.08),transparent)] blur-3xl" />
      <Crown aria-hidden="true" className="absolute -right-3 -top-8 h-48 w-48 text-amber-100/[0.035] sm:h-60 sm:w-60" strokeWidth={0.9} />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-amber-100/30 bg-[radial-gradient(circle,rgba(255,228,158,0.14),rgba(20,22,34,0.92)_72%)] text-amber-100 shadow-[0_0_30px_rgba(255,214,122,0.12)] sm:h-[72px] sm:w-[72px]">
            <Medal className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.45} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-amber-100/90">HALL 09</div>
            <h3 className="mt-1.5 font-display text-3xl text-slate-50 sm:text-4xl [word-break:keep-all]">제왕의 증명</h3>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-slate-200/88 sm:text-base [word-break:keep-all]">
              왕좌를 차지하는 것보다 어려운 것은, 서로 다른 네 영역에서 동시에 자격을 증명하는 일입니다.
            </p>
          </div>
        </div>

        <div className="flex w-fit gap-2.5">
          <div className="min-w-[92px] rounded-[16px] border border-slate-200/16 bg-black/24 px-4 py-2 text-center">
            <div className="font-display text-2xl text-amber-100">{seasonCount}</div>
            <div className="whitespace-nowrap text-[11px] font-black tracking-[0.08em] text-slate-200/84">기록 시즌</div>
          </div>
          <div className="min-w-[104px] rounded-[16px] border border-amber-100/18 bg-amber-100/[0.04] px-4 py-2 text-center">
            <div className="font-display text-2xl text-amber-100">{emperorCount}</div>
            <div className="whitespace-nowrap text-[11px] font-black tracking-[0.08em] text-slate-200/84">시즌의 황제</div>
          </div>
        </div>
      </div>
    </header>
  );
}

function ProofChamber() {
  return (
    <section>
      <div className="mx-auto max-w-4xl text-center">
        <div className="text-[11px] font-black tracking-[0.22em] text-amber-100/82">네 개의 증명</div>
        <h4 className="mt-2 font-display text-2xl text-slate-50 sm:text-3xl">황제의 이름 앞에는 네 개의 인장이 놓인다</h4>
        <p className="mx-auto mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-200/84 [word-break:keep-all]">
          하나만 뛰어나서는 통과할 수 없습니다. 길드의 승리, 개인의 기여, 공동의 임무, 실제 출석을 같은 시즌 안에서 모두 증명해야 합니다.
        </p>
      </div>

      <div className="relative mt-6">
        <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-amber-100/24 to-transparent lg:block" />
        <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROOFS.map((proof) => (
            <ProofSeal key={proof.no} {...proof} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofSeal({
  no,
  title,
  description,
  icon: Icon,
}: {
  no: string;
  title: string;
  description: string;
  icon: typeof Users;
}) {
  return (
    <article className="sovereign-seal-breath relative overflow-hidden rounded-[24px] border border-amber-100/20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,228,158,0.10),transparent_36%),linear-gradient(180deg,rgba(27,30,43,0.95),rgba(13,15,23,0.98))] px-4 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_12px_30px_rgba(0,0,0,0.18)]">
      <div className="absolute right-3 top-2 font-display text-4xl text-amber-100/[0.09]">{no}</div>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-100/28 bg-amber-100/[0.07] text-amber-100 shadow-[0_0_18px_rgba(255,220,137,0.10)]">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <div className="mt-3 font-display text-lg leading-6 text-slate-50 [word-break:keep-all]">{title}</div>
      <p className="mt-2 text-[12px] font-semibold leading-5 text-slate-200/84 [word-break:keep-all]">{description}</p>
    </article>
  );
}

function ImperialDecree() {
  return (
    <div className="relative mx-auto max-w-4xl overflow-hidden rounded-[26px] border border-amber-100/22 bg-[radial-gradient(circle_at_50%_0%,rgba(255,235,180,0.10),transparent_38%),linear-gradient(180deg,rgba(22,25,37,0.96),rgba(10,12,19,0.99))] px-5 py-6 text-center shadow-[0_0_30px_rgba(255,217,128,0.07)] sm:px-8">
      <div aria-hidden="true" className="absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-amber-100/50 to-transparent" />
      <ShieldCheck className="mx-auto h-7 w-7 text-amber-100" strokeWidth={1.5} />
      <div className="mt-3 font-display text-xl leading-8 text-amber-50 sm:text-2xl [word-break:keep-all]">
        네 조건을 한 시즌 안에 모두 충족한 자만이 시즌의 황제로 기록된다.
      </div>
    </div>
  );
}

function SeasonRegister({ season, entries }: { season: string; entries: HallOfGloryEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.sort_order - b.sort_order);
  const guildName = resolveGuildName(season, sorted);
  const guildLogo = guildName ? RECORDS_GUILD_LOGO_BY_NAME[guildName] : null;

  return (
    <section className="sovereign-flow-frame rounded-[30px] p-[2px]">
      <div className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,232,175,0.11),transparent_29%),radial-gradient(circle_at_12%_90%,rgba(87,119,156,0.09),transparent_28%),linear-gradient(180deg,rgba(18,20,31,0.99),rgba(8,9,15,1))] px-5 py-6 sm:px-7 sm:py-7">
        <div aria-hidden="true" className="sovereign-beam-breath absolute left-1/2 top-[-150px] h-[290px] w-[260px] -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,246,214,0.34),rgba(255,231,162,0.05),transparent)] blur-2xl" />

        <div className="relative flex flex-col items-center justify-between gap-4 border-b border-slate-200/12 pb-5 sm:flex-row">
          <div className="text-center sm:text-left">
            <div className="text-[11px] font-black tracking-[0.18em] text-amber-100/88">황제 명부</div>
            <div className="mt-1 font-display text-3xl text-slate-50 sm:text-4xl">{season}</div>
          </div>

          {guildName && (
            <div className="flex items-center gap-3 rounded-[18px] border border-amber-100/18 bg-black/24 px-3.5 py-2.5">
              {guildLogo && <img src={guildLogo} alt="" aria-hidden="true" className="h-11 w-11 object-contain" />}
              <div>
                <div className="text-[10px] font-black tracking-[0.12em] text-slate-200/82">최종 우승 길드</div>
                <div className="mt-0.5 font-display text-xl text-amber-50">{guildName}</div>
              </div>
            </div>
          )}
        </div>

        <div className={`relative mt-6 grid gap-4 ${sorted.length === 1 ? 'mx-auto max-w-xl' : 'md:grid-cols-2'}`}>
          {sorted.map((entry) => (
            <EmperorProof key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EmperorProof({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative overflow-hidden rounded-[26px] border border-amber-100/22 bg-[radial-gradient(circle_at_50%_0%,rgba(255,225,149,0.13),transparent_34%),linear-gradient(180deg,rgba(32,31,45,0.92),rgba(12,13,20,0.98))] px-5 py-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_0_26px_rgba(255,210,118,0.07)] sm:px-6">
      <div aria-hidden="true" className="absolute left-1/2 top-0 h-32 w-36 -translate-x-1/2 bg-[radial-gradient(circle,rgba(255,239,198,0.12),transparent_65%)] blur-lg" />
      <div className="relative">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-100/32 bg-[radial-gradient(circle,rgba(255,230,166,0.14),rgba(28,27,40,0.92)_72%)] text-amber-100 shadow-[0_0_22px_rgba(255,215,130,0.12)]">
          <Crown className="h-6 w-6" strokeWidth={1.35} />
        </div>
        <div className="mt-3 text-[11px] font-black tracking-[0.14em] text-amber-100/90">시즌의 황제</div>
        <div className="mt-1.5 font-display text-4xl text-slate-50 sm:text-5xl [text-shadow:0_0_18px_rgba(255,228,166,0.12)]">
          {entry.subject_display_name}
        </div>
        {entry.subject_brand_name && <div className="mt-1 text-sm font-bold text-slate-200/84">{entry.subject_brand_name}</div>}

        <div className="mt-5 grid grid-cols-4 gap-2">
          {['우승', 'TOP 3', '미션', '출석'].map((label) => (
            <div key={label} className="rounded-[14px] border border-amber-100/18 bg-amber-100/[0.045] px-2 py-2.5">
              <ShieldCheck className="mx-auto h-4 w-4 text-amber-100" strokeWidth={1.7} />
              <div className="mt-1 text-[10px] font-black text-slate-100/90">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100/20 bg-amber-100/[0.055] px-3 py-1.5 text-xs font-black text-amber-50">
            <Sparkles className="h-3.5 w-3.5" />
            네 개의 증명 모두 충족
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-100/18 bg-slate-100/[0.045] px-3 py-1.5 text-xs font-black text-slate-100/90">
            <ShieldCheck className="h-3.5 w-3.5" />
            공식 확정 기록
          </span>
        </div>
      </div>
    </article>
  );
}

function TripleCrownRegister({ entries }: { entries: HallOfGloryEntry[] }) {
  return (
    <section className="space-y-5">
      <div className="mx-auto max-w-4xl text-center">
        <div className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-100/18 bg-amber-100/[0.035] px-5 py-2 shadow-[0_0_28px_rgba(255,217,128,0.10)]">
          <Crown className="h-5 w-5 text-amber-100/90" strokeWidth={1.35} />
          <div className="font-display text-3xl text-amber-50 sm:text-4xl [text-shadow:0_0_18px_rgba(255,225,145,0.22)]">삼중왕관</div>
          <Crown className="h-5 w-5 text-amber-100/90" strokeWidth={1.35} />
        </div>
        <h4 className="mt-2 text-sm font-extrabold text-slate-100/88 sm:text-base">세 개의 조건을 동시에 꿰찬 또 하나의 증명</h4>
        <p className="mx-auto mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-200/84 [word-break:keep-all]">
          같은 시즌 안에서 월간 MVP, 업적 달성률, 최종 우승 길드 소속을 모두 만족한 자만이 삼중왕관의 자격을 얻습니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <div className="rounded-[28px] border border-amber-100/18 bg-[radial-gradient(circle_at_50%_0%,rgba(255,226,159,0.10),transparent_35%),linear-gradient(180deg,rgba(24,25,37,0.96),rgba(10,11,18,0.99))] px-5 py-6">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-100/24 bg-amber-100/[0.06] text-amber-100 shadow-[0_0_22px_rgba(255,215,130,0.10)]">
              <Crown className="h-6 w-6" strokeWidth={1.4} />
            </div>
            <div className="mt-3 font-display text-2xl text-amber-50">삼중왕관의 조건</div>
          </div>
          <div className="mt-5 space-y-3">
            {TRIPLE_CROWN_PROOFS.map((item, index) => (
              <div key={item} className="flex items-start gap-3 rounded-[18px] border border-white/10 bg-black/18 px-4 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-100/22 bg-amber-100/[0.06] text-[11px] font-black text-amber-100">
                  {index + 1}
                </div>
                <div className="text-sm font-bold leading-6 text-slate-100/90">{item}</div>
              </div>
            ))}
          </div>
        </div>

        {entries.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {entries.map((entry) => (
              <TripleCrownCard key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-amber-100/18 bg-black/20 px-5 py-10 text-center">
            <Crown className="mx-auto h-9 w-9 text-amber-100/82" strokeWidth={1.35} />
            <div className="mt-4 font-display text-2xl text-slate-50">아직 삼중왕관의 자리는 비어 있습니다</div>
            <div className="mt-2 text-sm font-semibold leading-7 text-slate-200/84">
              첫 번째 삼중왕관 달성자가 나타나면 이 공간에 이름이 새겨집니다.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TripleCrownCard({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="sovereign-flow-frame rounded-[26px] p-[2px]">
      <div className="rounded-[24px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,225,149,0.12),transparent_34%),linear-gradient(180deg,rgba(31,29,46,0.96),rgba(11,12,20,0.99))] px-5 py-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-100/28 bg-amber-100/[0.06] text-amber-100">
          <Crown className="h-6 w-6" strokeWidth={1.35} />
        </div>
        <div className="mt-3 text-[11px] font-black tracking-[0.14em] text-amber-100/90">삼중왕관</div>
        <div className="mt-1.5 font-display text-4xl text-slate-50">{entry.subject_display_name}</div>
        {entry.season_label && <div className="mt-2 text-sm font-bold text-slate-200/84">{entry.season_label}</div>}
      </div>
    </article>
  );
}

function EmptyRegister() {
  return (
    <div className="rounded-[26px] border border-dashed border-slate-200/18 bg-black/20 px-5 py-9 text-center">
      <Crown className="mx-auto h-8 w-8 text-slate-200/70" strokeWidth={1.35} />
      <div className="mt-3 font-display text-xl text-slate-50">아직 황제의 명부가 비어 있습니다</div>
      <div className="mt-2 text-sm font-semibold text-slate-200/82">네 개의 증명을 모두 통과한 기록이 생기면 이곳에 이름이 새겨집니다.</div>
    </div>
  );
}

function seasonLabelOf(entry: HallOfGloryEntry) {
  return entry.season_label || entry.subtitle || entry.period_label || `${entry.school_year ?? ''} 시즌`;
}

function resolveGuildName(season: string, entries: HallOfGloryEntry[]) {
  for (const entry of entries) {
    const keys = ['guild', 'guild_name', 'champion_guild', 'winner_guild'];
    for (const key of keys) {
      const value = entry.metadata?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return KNOWN_SEASON_GUILD[season] ?? null;
}
