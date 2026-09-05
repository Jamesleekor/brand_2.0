import {
  Crown,
  Gem,
  LockKeyhole,
  Medal,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const CROWN_HALL_STYLE = `
@keyframes crownHaloBreath {
  0%,100% { opacity:.30; transform:scale(.97); }
  50% { opacity:.62; transform:scale(1.03); }
}
@keyframes crownThreadFlow {
  0% { transform:translateX(-130%); opacity:0; }
  18% { opacity:.50; }
  52% { transform:translateX(180%); opacity:.08; }
  100% { transform:translateX(180%); opacity:0; }
}
.crown-halo-breath { animation:crownHaloBreath 6.4s ease-in-out infinite; }
.crown-thread-flow { animation:crownThreadFlow 8.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .crown-halo-breath,.crown-thread-flow { animation:none; }
}
`;

export function RecordsRepeatedCrownsHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const byType = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = byType.get(entry.record_type) ?? [];
    rows.push(entry);
    byType.set(entry.record_type, rows);
  });

  const firstTwo = sortRows(byType.get('FIRST_MVP_2') ?? [])[0];
  const firstThree = sortRows(byType.get('FIRST_MVP_3') ?? [])[0];
  const finalistRows = sortRows(byType.get('MOST_MVP_FINALS') ?? []);
  const recordCount = new Set(entries.map((entry) => entry.record_type)).size;

  return (
    <>
      <style>{CROWN_HALL_STYLE}</style>
      <section
        id="hall-repeated_crowns"
        className="scroll-mt-24 overflow-hidden rounded-[30px] border border-rose-200/22 bg-[radial-gradient(circle_at_50%_-8%,rgba(223,124,151,0.12),transparent_27%),radial-gradient(circle_at_88%_24%,rgba(255,213,142,0.055),transparent_24%),linear-gradient(180deg,rgba(48,22,35,0.985),rgba(23,12,24,0.995)_48%,rgba(12,8,16,1))] shadow-[0_28px_76px_rgba(0,0,0,0.27)]"
      >
        <CrownHallHeader recordCount={recordCount} />

        <div className="space-y-12 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
          <WingHeading
            eyebrow="THE SECOND CROWN"
            title="왕관은 한 번으로 끝나지 않았다"
            description="월간 MVP의 왕관을 가장 먼저 두 번 들어 올린 순간. 반복된 영예가 하나의 계보가 되기 시작한 기록입니다."
          />
          {firstTwo && <SecondCrownRelic entry={firstTwo} />}

          <Divider />

          <WingHeading
            eyebrow="THE SEALED THIRD CROWN"
            title="아직 봉인이 풀리지 않은 세 번째 왕관"
            description="누군가 세 번째 월간 MVP를 가장 먼저 차지하는 순간, 이 봉인된 왕관의 주인이 정해집니다."
          />
          {firstThree && <SealedThirdCrown entry={firstThree} />}

          <Divider />

          <WingHeading
            eyebrow="THE COURT OF CONTENDERS"
            title="왕관을 가장 자주 눈앞에 두었던 자들"
            description="월간 MVP 후보에 가장 많이 오른 기록을 TOP 3 순위까지 보존합니다. 같은 횟수의 공동 3위는 모두 하나의 회랑에 이름을 남깁니다."
          />
          <FinalistCourt rows={finalistRows} />
        </div>
      </section>
    </>
  );
}

function CrownHallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-rose-100/12 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="crown-halo-breath absolute left-1/2 top-[-115px] h-[270px] w-[540px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(236,143,168,0.13),transparent_67%)] blur-xl" />
      <Crown aria-hidden="true" className="absolute -right-5 -top-9 h-48 w-48 text-rose-100/[0.025] sm:h-60 sm:w-60" strokeWidth={1.0} />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-rose-200/28 bg-[radial-gradient(circle,rgba(226,130,159,0.12),rgba(42,21,34,0.86)_72%)] text-rose-100 shadow-[0_0_26px_rgba(218,111,145,0.10)] sm:h-[72px] sm:w-[72px]">
            <Medal className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.45} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-rose-100/78">HALL 03 · THE CROWN GALLERY</div>
            <h3 className="mt-1.5 font-display text-3xl text-rose-50 sm:text-4xl [word-break:keep-all]">왕관을 거듭 쓴 자</h3>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-rose-50/72 sm:text-base [word-break:keep-all]">
              한 번의 영광을 넘어 다시 왕관을 향한 자들. 반복된 경쟁과 수상의 계보를 보존합니다.
            </p>
          </div>
        </div>

        <div className="w-fit rounded-full border border-rose-100/18 bg-black/18 px-4 py-2 text-center">
          <div className="font-display text-2xl text-rose-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-rose-50/55">CROWN RECORDS</div>
        </div>
      </div>
    </header>
  );
}

function WingHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-[11px] font-black tracking-[0.22em] text-rose-200/62">{eyebrow}</div>
      <h4 className="mt-2 font-display text-2xl text-rose-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-7 text-rose-50/60 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-rose-100/14 to-transparent" />;
}

function SecondCrownRelic({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative mx-auto max-w-4xl overflow-hidden rounded-[30px] border border-rose-200/27 bg-[radial-gradient(circle_at_50%_12%,rgba(235,139,164,0.12),transparent_33%),linear-gradient(180deg,rgba(54,25,40,0.94),rgba(20,11,22,0.985))] px-5 py-7 text-center shadow-[0_0_34px_rgba(220,116,147,0.08),inset_0_0_36px_rgba(255,208,219,0.016)] sm:px-8 sm:py-9">
      <div aria-hidden="true" className="absolute inset-x-[10%] top-0 h-px bg-gradient-to-r from-transparent via-rose-50/22 to-transparent" />
      <div aria-hidden="true" className="crown-thread-flow absolute top-[118px] h-px w-[42%] bg-gradient-to-r from-transparent via-amber-100/65 to-transparent" />

      <div className="relative">
        <div className="mx-auto flex max-w-md items-center justify-center gap-5 sm:gap-8">
          <CrownMedallion index={1} />
          <div className="h-px flex-1 bg-gradient-to-r from-rose-100/10 via-amber-100/38 to-rose-100/10" />
          <CrownMedallion index={2} featured />
        </div>

        <div className="mt-6 text-[10px] font-black tracking-[0.2em] text-rose-200/58">FIRST TO WEAR TWO CROWNS</div>
        <div className="mt-2 font-display text-4xl text-rose-50 sm:text-5xl [text-shadow:0_0_18px_rgba(255,203,217,0.13)]">
          {entry.subject_display_name}
        </div>
        <div className="mt-3 font-display text-2xl text-amber-100 sm:text-3xl">2회의 왕관</div>
        {entry.period_label && <div className="mt-2 text-sm font-bold text-rose-50/66">{entry.period_label} · 두 번째 월간 MVP</div>}
        <div className="mt-4"><CrownRecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} /></div>
      </div>
    </article>
  );
}

function CrownMedallion({ index, featured = false }: { index: number; featured?: boolean }) {
  return (
    <div className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border sm:h-24 sm:w-24 ${featured ? 'border-amber-100/36 bg-[radial-gradient(circle,rgba(255,219,148,0.15),rgba(56,29,38,0.88)_72%)] shadow-[0_0_28px_rgba(255,196,100,0.11)]' : 'border-rose-100/22 bg-[radial-gradient(circle,rgba(225,137,162,0.10),rgba(46,24,36,0.88)_72%)]'}`}>
      <Crown className={`h-9 w-9 sm:h-11 sm:w-11 ${featured ? 'text-amber-100' : 'text-rose-100/78'}`} strokeWidth={1.3} />
      <span className="absolute -bottom-2 flex h-6 w-6 items-center justify-center rounded-full border border-rose-100/18 bg-[#27131f] font-display text-xs text-rose-50">{index}</span>
    </div>
  );
}

function SealedThirdCrown({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative mx-auto max-w-3xl overflow-hidden rounded-[28px] border border-dashed border-rose-200/25 bg-[radial-gradient(circle_at_50%_28%,rgba(132,83,114,0.09),transparent_34%),linear-gradient(180deg,rgba(38,23,35,0.76),rgba(15,10,18,0.96))] px-5 py-7 text-center sm:px-8 sm:py-8">
      <div className="relative flex flex-col items-center">
        <div className="flex items-center justify-center gap-3 sm:gap-5">
          {[1, 2].map((index) => (
            <div key={index} className="flex h-14 w-14 items-center justify-center rounded-full border border-rose-100/17 bg-rose-100/[0.035] text-rose-100/46">
              <Crown className="h-6 w-6" strokeWidth={1.3} />
            </div>
          ))}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-amber-100/27 bg-black/20 text-amber-100/54 shadow-[0_0_24px_rgba(255,201,116,0.055)]">
            <Crown className="h-8 w-8" strokeWidth={1.25} />
            <LockKeyhole className="absolute -bottom-2 -right-1 h-7 w-7 rounded-full border border-rose-100/18 bg-[#21121c] p-1.5 text-rose-100/64" />
          </div>
        </div>
        <div className="mt-5 text-[10px] font-black tracking-[0.2em] text-rose-200/52">UNCLAIMED THIRD CROWN</div>
        <div className="mt-2 font-display text-2xl text-rose-50 sm:text-3xl">{entry.subject_display_name}</div>
        <p className="mt-2 max-w-xl text-sm font-semibold leading-7 text-rose-50/55 [word-break:keep-all]">
          세 번째 왕관에 가장 먼저 도달하는 순간, 봉인이 풀리고 새로운 이름이 이 자리에 새겨집니다.
        </p>
      </div>
    </article>
  );
}

function FinalistCourt({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;
  const rank1 = rows.filter((row) => row.rank_position === 1);
  const rank2 = rows.filter((row) => row.rank_position === 2);
  const rank3 = rows.filter((row) => row.rank_position === 3);

  return (
    <div className="relative overflow-hidden rounded-[30px] border border-rose-100/18 bg-[radial-gradient(circle_at_50%_0%,rgba(211,116,144,0.085),transparent_30%),linear-gradient(180deg,rgba(42,22,34,0.88),rgba(17,10,20,0.98))] px-4 py-6 shadow-[inset_0_0_34px_rgba(246,176,194,0.012)] sm:px-6 sm:py-8">
      <div aria-hidden="true" className="absolute left-1/2 top-8 bottom-8 w-px -translate-x-1/2 bg-gradient-to-b from-amber-100/28 via-rose-100/10 to-transparent" />
      <div className="relative space-y-5">
        {rank1.map((entry) => <CourtSeat key={entry.id} entry={entry} rank={1} featured />)}
        {rank2.map((entry) => <CourtSeat key={entry.id} entry={entry} rank={2} />)}

        {rank3.length > 0 && (
          <div className="rounded-[24px] border border-rose-100/16 bg-black/18 px-4 py-5 sm:px-5">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-100/22 bg-rose-100/[0.05] font-display text-lg text-rose-100">3</div>
              <div className="mt-2 text-[10px] font-black tracking-[0.18em] text-rose-200/56">JOINT THIRD · THE RIVAL GALLERY</div>
              <div className="mt-1 font-display text-xl text-rose-50 sm:text-2xl">공동 3위의 회랑</div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {rank3.map((entry) => (
                <div key={entry.id} className="rounded-[18px] border border-rose-100/16 bg-[linear-gradient(180deg,rgba(111,53,75,0.22),rgba(18,11,20,0.78))] px-3 py-3 text-center">
                  <Gem className="mx-auto h-4 w-4 text-rose-100/52" strokeWidth={1.4} />
                  <div className="mt-2 font-display text-lg text-rose-50 [word-break:keep-all]">{entry.subject_display_name}</div>
                  <div className="mt-1 font-display text-xl text-amber-100">{formatNumber(entry.value_primary ?? 0)}회</div>
                  <div className="mt-1 text-[10px] font-bold text-rose-50/46">{entry.period_label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CourtSeat({ entry, rank, featured = false }: { entry: HallOfGloryEntry; rank: number; featured?: boolean }) {
  return (
    <article className={`relative mx-auto overflow-hidden rounded-[24px] border text-center ${featured ? 'max-w-3xl border-amber-100/30 bg-[radial-gradient(circle_at_50%_0%,rgba(255,213,139,0.12),transparent_38%),linear-gradient(180deg,rgba(79,36,52,0.66),rgba(23,12,24,0.94))] px-5 py-6 shadow-[0_0_28px_rgba(255,190,95,0.07)]' : 'max-w-2xl border-rose-100/19 bg-[linear-gradient(180deg,rgba(74,34,51,0.38),rgba(21,12,23,0.90))] px-5 py-5'}`}>
      <div className="flex justify-center">
        <div className={`flex items-center justify-center rounded-full border font-display ${featured ? 'h-14 w-14 border-amber-100/34 bg-amber-100/[0.07] text-2xl text-amber-100' : 'h-11 w-11 border-rose-100/22 bg-rose-100/[0.045] text-xl text-rose-100'}`}>{rank}</div>
      </div>
      <div className={`mt-3 font-display text-rose-50 ${featured ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'}`}>{entry.subject_display_name}</div>
      {entry.subject_brand_name && <div className="mt-1 text-xs font-bold text-rose-50/45">{entry.subject_brand_name}</div>}
      <div className={`mt-3 font-display text-amber-100 ${featured ? 'text-3xl' : 'text-2xl'}`}>{formatNumber(entry.value_primary ?? 0)}회</div>
      <div className="mt-1 text-xs font-bold text-rose-50/50">{entry.period_label} · 월간 MVP 후보 선정</div>
      {featured && <div className="mt-4"><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100/22 bg-amber-100/[0.055] px-3 py-1.5 text-xs font-black text-amber-100"><Sparkles className="h-3.5 w-3.5" />역대 최다</span></div>}
    </article>
  );
}

function CrownRecordBadge({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${live ? 'border-rose-200/25 bg-rose-100/[0.065] text-rose-100' : 'border-amber-100/24 bg-amber-100/[0.055] text-amber-100'}`}>
      <ShieldCheck className="h-4 w-4" strokeWidth={1.55} />
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
