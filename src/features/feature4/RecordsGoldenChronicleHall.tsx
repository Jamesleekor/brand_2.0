import {
  BookOpenText,
  Coins,
  HandHeart,
  Landmark,
  ScrollText,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

export function RecordsGoldenChronicleHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const byType = groupByType(entries);
  const donations = sortRows(byType.get('LIFETIME_DONATION') ?? []);
  const dividend = sortRows(byType.get('STOCK_DIVIDEND_2023') ?? [])[0];
  const recordCount = new Set(entries.map((entry) => entry.record_type)).size;

  return (
    <section
      id="hall-golden_chronicle"
      className="scroll-mt-24 overflow-hidden rounded-[30px] border border-orange-200/20 bg-[radial-gradient(circle_at_12%_0%,rgba(214,143,64,0.12),transparent_28%),radial-gradient(circle_at_88%_18%,rgba(105,139,88,0.045),transparent_24%),linear-gradient(180deg,rgba(42,29,18,0.985),rgba(22,15,17,0.995)_48%,rgba(11,9,12,1))] shadow-[0_28px_74px_rgba(0,0,0,0.26)]"
    >
      <GoldenHallHeader recordCount={recordCount} />

      <div className="space-y-10 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
        <ChronicleHeading
          eyebrow="THE TREASURY OF GIVING"
          title="황금이 머문 자리보다, 흘러간 방향을 기록한다"
          description="보유한 부가 아니라 공동체를 위해 실제로 내어놓은 GOLD. 가장 많이 나눈 세 이름을 하나의 금고 장부에 보존합니다."
        />
        <DonationTreasury rows={donations} />

        <Divider />

        <ChronicleHeading
          eyebrow="THE STOCK AGE · 2023"
          title="사라진 시장이 남긴 마지막 장부"
          description="2023년 주식시대에 실제로 지급된 배당수익만을 집계한 역사 기록입니다. 지금은 닫힌 시장의 흔적을 별도의 봉인 장부로 남깁니다."
        />
        {dividend && <StockEraLedger entry={dividend} />}
      </div>
    </section>
  );
}

function GoldenHallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-orange-100/11 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <BookOpenText aria-hidden="true" className="absolute -right-5 -top-8 h-48 w-48 text-orange-100/[0.022] sm:h-60 sm:w-60" strokeWidth={1.0} />
      <div aria-hidden="true" className="absolute left-[10%] top-0 h-px w-[62%] bg-gradient-to-r from-transparent via-orange-100/18 to-transparent" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-orange-200/26 bg-[radial-gradient(circle,rgba(221,151,72,0.12),rgba(42,29,19,0.86)_72%)] text-orange-100 shadow-[0_0_24px_rgba(213,137,56,0.09)] sm:h-[72px] sm:w-[72px]">
            <ScrollText className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.45} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-orange-100/76">HALL 05 · THE GOLDEN CHRONICLE</div>
            <h3 className="mt-1.5 font-display text-3xl text-orange-50 sm:text-4xl [word-break:keep-all]">황금의 연대기</h3>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-orange-50/68 sm:text-base [word-break:keep-all]">
              축적과 소비, 기부와 배당. B.R.A.N.D의 황금이 어떤 흔적을 남겼는지 장부와 금고의 언어로 기록합니다.
            </p>
          </div>
        </div>

        <div className="w-fit rounded-full border border-orange-100/16 bg-black/18 px-4 py-2 text-center">
          <div className="font-display text-2xl text-orange-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-orange-50/52">ECONOMIC RECORDS</div>
        </div>
      </div>
    </header>
  );
}

function ChronicleHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-[11px] font-black tracking-[0.22em] text-orange-200/60">{eyebrow}</div>
      <h4 className="mt-2 font-display text-2xl text-orange-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-7 text-orange-50/57 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-orange-100/13 to-transparent" />;
}

function DonationTreasury({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;
  const [first, second, third] = rows;

  return (
    <div className="relative overflow-hidden rounded-[30px] border border-orange-200/22 bg-[radial-gradient(circle_at_50%_16%,rgba(223,153,73,0.11),transparent_34%),linear-gradient(180deg,rgba(47,31,19,0.90),rgba(19,13,16,0.98))] px-4 py-6 shadow-[inset_0_0_36px_rgba(255,201,119,0.014)] sm:px-6 sm:py-7">
      <div aria-hidden="true" className="absolute left-1/2 top-3 h-[230px] w-[230px] -translate-x-1/2 rounded-full border border-orange-100/[0.045]" />
      <div aria-hidden="true" className="absolute left-1/2 top-11 h-[150px] w-[150px] -translate-x-1/2 rounded-full border border-orange-100/[0.04]" />

      <div className="relative grid items-end gap-4 md:grid-cols-[1fr_1.18fr_1fr]">
        {second && <DonationPedestal entry={second} />}
        {first && <DonationPedestal entry={first} featured />}
        {third && <DonationPedestal entry={third} />}
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2 border-t border-orange-100/10 pt-4 text-xs font-semibold text-orange-50/54">
        <HandHeart className="h-4 w-4 text-orange-200/66" />
        <span>공식 GOLD 기부 누적 기준 · 환불 및 취소 기록 제외</span>
      </div>
    </div>
  );
}

function DonationPedestal({ entry, featured = false }: { entry: HallOfGloryEntry; featured?: boolean }) {
  return (
    <article className={`relative overflow-hidden rounded-[24px] border text-center ${featured ? 'border-orange-100/32 bg-[linear-gradient(180deg,rgba(132,84,38,0.28),rgba(19,13,16,0.92))] px-4 py-6 shadow-[0_0_28px_rgba(218,145,60,0.075)] md:-translate-y-3' : 'border-orange-100/15 bg-black/18 px-4 py-4'}`}>
      {featured && <div aria-hidden="true" className="absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-orange-50/28 to-transparent" />}
      <div className={`mx-auto flex items-center justify-center rounded-full border font-display ${featured ? 'h-12 w-12 border-orange-100/28 bg-orange-100/[0.07] text-xl text-orange-100' : 'h-9 w-9 border-orange-100/17 bg-black/15 text-sm text-orange-100/72'}`}>
        {entry.rank_position}
      </div>
      <div className={`mt-3 font-display text-orange-50 ${featured ? 'text-3xl' : 'text-xl sm:text-2xl'}`}>{entry.subject_display_name}</div>
      <div className={`mt-2 font-display text-orange-100 ${featured ? 'text-4xl' : 'text-2xl'}`}>{formatNumber(entry.value_primary ?? 0)}</div>
      <div className="mt-1 text-[10px] font-black tracking-[0.15em] text-orange-200/48">GOLD DONATED</div>
      {entry.period_label && <div className="mt-2 text-xs font-bold text-orange-50/48">{entry.period_label}</div>}
      <div className="mt-3"><RecordStatusBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} /></div>
    </article>
  );
}

function StockEraLedger({ entry }: { entry: HallOfGloryEntry }) {
  return (
    <article className="relative mx-auto max-w-4xl overflow-hidden rounded-[28px] border border-lime-100/13 bg-[radial-gradient(circle_at_18%_20%,rgba(130,151,91,0.07),transparent_30%),linear-gradient(135deg,rgba(40,36,23,0.86),rgba(18,14,17,0.97))] p-5 shadow-[inset_0_0_34px_rgba(177,196,123,0.012)] sm:p-6">
      <div aria-hidden="true" className="absolute bottom-0 left-[11%] top-0 w-px bg-lime-100/[0.045]" />
      <div className="relative grid gap-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border border-lime-100/16 bg-lime-100/[0.035] text-lime-100/72">
          <TrendingUp className="h-8 w-8" strokeWidth={1.4} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-black tracking-[0.18em] text-lime-100/48">SEALED MARKET LEDGER · 2023</div>
          <div className="mt-1 font-display text-2xl text-orange-50 sm:text-3xl">{entry.subject_display_name}</div>
          <div className="mt-1 text-sm font-semibold text-orange-50/55">2023 주식시대 최고의 배당 수익</div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-lime-100/13 bg-black/14 px-3 py-1.5 text-xs font-bold text-lime-50/54">
            <Landmark className="h-3.5 w-3.5" />현재는 종료된 과거 시장 기록
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="font-display text-3xl text-orange-100 sm:text-4xl">{formatNumber(entry.value_primary ?? 0)}</div>
          <div className="mt-1 text-[10px] font-black tracking-[0.15em] text-orange-200/48">GOLD DIVIDEND</div>
          <div className="mt-3"><RecordStatusBadge live={false} /></div>
        </div>
      </div>
    </article>
  );
}

function RecordStatusBadge({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${live ? 'border-orange-200/22 bg-orange-100/[0.06] text-orange-100' : 'border-lime-100/14 bg-lime-100/[0.035] text-lime-50/62'}`}>
      <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
      {live ? '현재 공식 기록' : '공식 확정 기록'}
    </span>
  );
}

function groupByType(entries: HallOfGloryEntry[]) {
  const map = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = map.get(entry.record_type) ?? [];
    rows.push(entry);
    map.set(entry.record_type, rows);
  });
  return map;
}

function sortRows(rows: HallOfGloryEntry[]) {
  return [...rows].sort((a, b) => {
    const rankA = a.rank_position ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank_position ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.sort_order - b.sort_order;
  });
}
