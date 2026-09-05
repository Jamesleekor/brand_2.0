import {
  Crosshair,
  FlagTriangleRight,
  Medal,
  Shield,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { RECORDS_GUILD_LOGO_BY_NAME } from '@/features/feature4/records_hall_assets';
import { formatNumber } from '@/lib/utils/format';

export function RecordsGuildHegemonyHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const byType = groupByType(entries);
  const champions = sortRows(byType.get('SEASON_CHAMPION') ?? []);
  const monthlyGs = sortRows(byType.get('BEST_MONTHLY_GS_RATE') ?? []);
  const monthlyContribution = sortRows(byType.get('BEST_MONTHLY_CONTRIBUTION_RATE') ?? [])[0];
  const seasonContribution = sortRows(byType.get('SEASON_CONTRIBUTION_CHAMPION') ?? [])[0];
  const seasonRate = sortRows(byType.get('BEST_SEASON_CONTRIBUTION_RATE') ?? [])[0];
  const seasonTotal = sortRows(byType.get('SEASON_TOTAL_GS') ?? [])[0];
  const closest = sortRows(byType.get('CLOSEST_SEASON_WIN') ?? [])[0];
  const recordCount = new Set(entries.map((entry) => entry.record_type)).size;

  return (
    <section
      id="hall-guild_hegemony"
      className="scroll-mt-24 overflow-hidden rounded-[30px] border border-red-200/18 bg-[radial-gradient(circle_at_12%_-4%,rgba(134,54,54,0.13),transparent_28%),radial-gradient(circle_at_88%_16%,rgba(140,128,110,0.055),transparent_24%),linear-gradient(180deg,rgba(31,24,25,0.99),rgba(18,14,17,0.998)_48%,rgba(10,9,11,1))] shadow-[0_30px_78px_rgba(0,0,0,0.30)]"
    >
      <WarHallHeader recordCount={recordCount} />

      <div className="space-y-8 px-4 py-8 sm:px-7 sm:py-9 lg:px-9">
        {champions.length > 0 && (
          <section>
            <WarSectionHeading
              eyebrow="THE VICTOR'S STANDARD"
              title="시즌을 제패한 군기"
              description="우승은 한 사람의 기록이 아니라, 한 시즌을 함께 버틴 길드 전체의 전과입니다."
            />
            <div className="mt-5 space-y-4">
              {champions.map((entry) => (
                <ChampionStandard
                  key={entry.id}
                  entry={entry}
                  seasonTotal={seasonTotal?.subject_display_name === entry.subject_display_name ? seasonTotal : null}
                />
              ))}
            </div>
          </section>
        )}

        <IronDivider />

        <section>
          <WarSectionHeading
            eyebrow="CAMPAIGN BOARD"
            title="가장 강력했던 단일 월 전과"
            description="전장을 길게 늘이지 않고, 최고 GS 달성 기록 다섯 개를 하나의 작전판에 압축해 보존합니다."
          />
          <div className="mt-5"><MonthlyCampaignBoard rows={monthlyGs} /></div>
        </section>

        <IronDivider />

        <section>
          <WarSectionHeading
            eyebrow="FIELD HONORS"
            title="전선에서 가장 크게 기여한 지휘관들"
            description="이 전시관의 중심은 길드이지만, 승리의 과정에서 특별한 기여를 남긴 개인의 기록도 지휘관 훈장으로 남깁니다."
          />
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {monthlyContribution && <MonthlyCommander entry={monthlyContribution} />}
            {(seasonContribution || seasonRate) && (
              <SeasonCommander champion={seasonContribution} rate={seasonRate} />
            )}
          </div>
        </section>

        {closest && (
          <>
            <IronDivider />
            <section>
              <WarSectionHeading
                eyebrow="THE NARROWEST VICTORY"
                title="가장 치열했던 마지막 전투"
                description="승자와 준우승 사이가 거의 사라졌던 시즌. 두 길드의 군기를 서로 마주 세워 그 접전을 기록합니다."
              />
              <div className="mt-5"><ClosestBattle entry={closest} /></div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}

function WarHallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-red-100/10 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <Swords aria-hidden="true" className="absolute -right-6 -top-10 h-52 w-52 text-red-100/[0.025] sm:h-64 sm:w-64" strokeWidth={1.0} />
      <div aria-hidden="true" className="absolute inset-x-[8%] bottom-0 h-px bg-gradient-to-r from-transparent via-red-100/13 to-transparent" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[16px] border border-red-200/23 bg-[linear-gradient(145deg,rgba(101,52,52,0.22),rgba(27,22,23,0.92))] text-red-100 shadow-[inset_0_0_20px_rgba(255,205,205,0.018),0_0_20px_rgba(151,56,56,0.07)] sm:h-[72px] sm:w-[72px]">
            <Swords className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-red-100/70">HALL 06 · THE WAR CHRONICLE</div>
            <h3 className="mt-1.5 font-display text-3xl text-red-50 sm:text-4xl [word-break:keep-all]">길드 패권사</h3>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-100/68 sm:text-base [word-break:keep-all]">
              개인의 영광이 아닌 군기의 역사. 승리한 길드와 그 구성원, 가장 치열했던 전과를 전쟁사의 언어로 기록합니다.
            </p>
          </div>
        </div>
        <div className="w-fit rounded-[14px] border border-red-100/14 bg-black/20 px-4 py-2 text-center">
          <div className="font-display text-2xl text-red-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-stone-100/48">WAR RECORDS</div>
        </div>
      </div>
    </header>
  );
}

function WarSectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-4xl text-center">
      <div className="text-[10px] font-black tracking-[0.22em] text-red-200/54">{eyebrow}</div>
      <h4 className="mt-1.5 font-display text-2xl text-stone-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-3xl text-sm font-semibold leading-6 text-stone-100/54 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function IronDivider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-stone-300/10 to-transparent" />;
}

function ChampionStandard({ entry, seasonTotal }: { entry: HallOfGloryEntry; seasonTotal: HallOfGloryEntry | null }) {
  const logo = guildLogo(entry.subject_display_name);
  const roster = getStringArray(entry.metadata?.champion_roster);
  const rate = entry.comparison_value ?? getMetadataNumber(entry, 'rate_percent');

  return (
    <article className="relative overflow-hidden rounded-[26px] border border-red-100/19 bg-[radial-gradient(circle_at_18%_50%,rgba(151,62,62,0.13),transparent_28%),linear-gradient(100deg,rgba(45,27,28,0.96),rgba(18,14,17,0.99)_58%,rgba(27,23,22,0.99))] px-5 py-5 shadow-[inset_0_0_32px_rgba(255,210,200,0.012)] sm:px-6">
      <div aria-hidden="true" className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-red-200/50 via-red-700/30 to-transparent" />
      <div className="relative grid gap-5 lg:grid-cols-[160px_minmax(0,1fr)_minmax(260px,.95fr)] lg:items-center">
        <div className="flex flex-col items-center text-center">
          <GuildLogo name={entry.subject_display_name} src={logo} size="lg" />
          <div className="mt-2 text-[9px] font-black tracking-[0.18em] text-red-200/52">CHAMPION STANDARD</div>
        </div>

        <div className="min-w-0 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-100/15 bg-red-100/[0.035] px-3 py-1 text-[10px] font-black tracking-[0.12em] text-red-100/68">
            <Trophy className="h-3.5 w-3.5" />시즌 최종 우승 길드
          </div>
          <div className="mt-2 font-display text-4xl text-stone-50 sm:text-5xl [text-shadow:0_0_18px_rgba(255,215,205,0.08)]">{entry.subject_display_name}</div>
          <div className="mt-3 font-display text-2xl text-red-100 sm:text-3xl">
            {formatNumber(entry.value_primary ?? 0)} / {formatNumber(entry.denominator ?? 0)} GS
            {rate != null && <span className="ml-2 text-lg text-red-100/68">({Number(rate).toFixed(1)}%)</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
            <span className="text-xs font-bold text-stone-100/50">{entry.season_label ?? entry.period_label}</span>
            <RecordStatusBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} />
            {seasonTotal && <span className="rounded-full border border-stone-200/10 bg-stone-100/[0.025] px-2.5 py-1 text-[10px] font-black text-stone-100/48">역대 최고 시즌 누적 GS</span>}
          </div>
        </div>

        <div className="rounded-[20px] border border-stone-200/10 bg-black/18 px-4 py-4">
          <div className="flex items-center justify-center gap-2 text-[10px] font-black tracking-[0.16em] text-stone-100/48 lg:justify-start">
            <Users className="h-4 w-4 text-red-100/55" />CHAMPION ROSTER
          </div>
          {roster.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {roster.map((name) => (
                <div key={name} className="rounded-[12px] border border-red-100/11 bg-red-100/[0.025] px-2.5 py-2 text-center font-display text-base text-stone-50">
                  {name}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-center text-xs font-semibold text-stone-100/38 lg:text-left">보존된 우승 로스터가 없습니다.</div>
          )}
        </div>
      </div>
    </article>
  );
}

function MonthlyCampaignBoard({ rows }: { rows: HallOfGloryEntry[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-[24px] border border-stone-200/10 bg-[linear-gradient(180deg,rgba(29,25,25,0.94),rgba(14,12,14,0.98))]">
      <div className="grid grid-cols-[42px_1fr_auto] items-center gap-3 border-b border-stone-200/8 bg-stone-100/[0.025] px-4 py-2.5 text-[9px] font-black tracking-[0.15em] text-stone-100/40 sm:grid-cols-[42px_52px_1fr_100px_210px]">
        <span>RANK</span><span className="hidden sm:block">BANNER</span><span>GUILD</span><span className="hidden sm:block">PERIOD</span><span className="text-right">GS / RATE</span>
      </div>
      {rows.map((entry, index) => (
        <CampaignRow key={entry.id} entry={entry} last={index === rows.length - 1} />
      ))}
    </div>
  );
}

function CampaignRow({ entry, last }: { entry: HallOfGloryEntry; last: boolean }) {
  const logo = guildLogo(entry.subject_display_name);
  const rate = entry.comparison_value ?? getMetadataNumber(entry, 'rate_percent');
  return (
    <div className={`grid grid-cols-[42px_1fr_auto] items-center gap-3 px-4 py-3 ${last ? '' : 'border-b border-stone-200/[0.065]'} ${entry.rank_position === 1 ? 'bg-red-100/[0.035]' : ''} sm:grid-cols-[42px_52px_1fr_100px_210px]`}>
      <div className={`font-display text-lg ${entry.rank_position === 1 ? 'text-red-100' : 'text-stone-100/56'}`}>{entry.rank_position}</div>
      <div className="hidden sm:block"><GuildLogo name={entry.subject_display_name} src={logo} size="sm" /></div>
      <div className="min-w-0">
        <div className="font-display text-lg text-stone-50">{entry.subject_display_name}</div>
        <div className="mt-0.5 text-[10px] font-semibold text-stone-100/36 sm:hidden">{formatPeriod(entry.period_label)}</div>
      </div>
      <div className="hidden text-xs font-bold text-stone-100/42 sm:block">{formatPeriod(entry.period_label)}</div>
      <div className="text-right font-display text-base text-red-50 sm:text-lg">
        {formatNumber(entry.value_primary ?? 0)} / {formatNumber(entry.denominator ?? 0)} GS
        {rate != null && <span className="ml-1.5 text-sm text-red-100/58">({Number(rate).toFixed(2)}%)</span>}
      </div>
    </div>
  );
}

function MonthlyCommander({ entry }: { entry: HallOfGloryEntry }) {
  const guild = getMetadataString(entry, 'guild') ?? '에메랄드';
  return (
    <CommanderPanel
      label="MONTHLY FIELD COMMANDER"
      title="역대 최고 월간 기여도 달성률"
      entry={entry}
      guild={guild}
      extra={formatPeriod(entry.period_label)}
    />
  );
}

function SeasonCommander({ champion, rate }: { champion?: HallOfGloryEntry; rate?: HallOfGloryEntry }) {
  const entry = rate ?? champion;
  if (!entry) return null;
  const guild = entry.subject_display_name === '한서현' ? 'Ruby' : getMetadataString(entry, 'guild') ?? '';
  return (
    <CommanderPanel
      label="SEASON FIELD COMMANDER"
      title="시즌 개인 기여의 정점"
      entry={entry}
      guild={guild}
      extra={champion && rate ? '시즌 개인 기여도 1위 · 역대 최고 시즌 개인 기여율' : champion ? '시즌 개인 기여도 1위' : '역대 최고 시즌 개인 기여율'}
    />
  );
}

function CommanderPanel({ label, title, entry, guild, extra }: { label: string; title: string; entry: HallOfGloryEntry; guild: string; extra: string }) {
  const rate = entry.comparison_value;
  return (
    <article className="rounded-[22px] border border-stone-200/10 bg-[linear-gradient(145deg,rgba(39,31,31,0.74),rgba(15,13,15,0.97))] p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <div className="shrink-0"><GuildLogo name={guild || entry.subject_display_name} src={guildLogo(guild)} size="md" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black tracking-[0.16em] text-red-200/48">{label}</div>
          <div className="mt-1 text-sm font-extrabold text-stone-100/66">{title}</div>
          <div className="mt-2 font-display text-2xl text-stone-50">{entry.subject_display_name}</div>
          <div className="mt-2 font-display text-lg text-red-100">
            {formatNumber(entry.value_primary ?? 0)} / {formatNumber(entry.denominator ?? 0)} {entry.unit}
            {rate != null && <span className="ml-1.5 text-sm text-red-100/58">({Number(rate).toFixed(2)}%)</span>}
          </div>
          <div className="mt-2 text-xs font-semibold leading-5 text-stone-100/43 [word-break:keep-all]">{extra}</div>
        </div>
      </div>
    </article>
  );
}

function ClosestBattle({ entry }: { entry: HallOfGloryEntry }) {
  const winner = getMetadataString(entry, 'winner') ?? entry.subject_display_name;
  const runnerUp = getMetadataString(entry, 'runner_up') ?? '빛나는 은하수';
  const winnerGs = getMetadataNumber(entry, 'winner_gs') ?? entry.value_secondary ?? 0;
  const runnerUpGs = getMetadataNumber(entry, 'runner_up_gs') ?? 0;
  const margin = getMetadataNumber(entry, 'display_margin_percent') ?? Number(entry.comparison_value ?? 0);

  return (
    <article className="relative overflow-hidden rounded-[26px] border border-red-200/16 bg-[radial-gradient(circle_at_50%_50%,rgba(122,44,44,0.10),transparent_28%),linear-gradient(90deg,rgba(39,25,27,0.95),rgba(15,13,15,0.99)_48%,rgba(35,30,27,0.95))] px-4 py-5 sm:px-6">
      <div aria-hidden="true" className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-red-100/18 via-stone-100/5 to-red-100/18" />
      <div className="relative grid gap-4 md:grid-cols-[1fr_150px_1fr] md:items-center">
        <BattleSide name={winner} score={winnerGs} winner />
        <div className="text-center">
          <Crosshair className="mx-auto h-7 w-7 text-red-100/58" strokeWidth={1.4} />
          <div className="mt-1 text-[9px] font-black tracking-[0.17em] text-stone-100/38">MARGIN</div>
          <div className="font-display text-3xl text-red-100">{margin.toFixed(2)}%</div>
          <div className="mt-0.5 text-xs font-semibold text-stone-100/40">차이</div>
        </div>
        <BattleSide name={runnerUp} score={runnerUpGs} />
      </div>
    </article>
  );
}

function BattleSide({ name, score, winner = false }: { name: string; score: number; winner?: boolean }) {
  return (
    <div className={`flex items-center gap-4 ${winner ? 'md:flex-row' : 'md:flex-row-reverse'} ${winner ? 'md:text-left' : 'md:text-right'}`}>
      <GuildLogo name={name} src={guildLogo(name)} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-black tracking-[0.16em] text-red-200/44">{winner ? 'VICTOR' : 'RUNNER-UP'}</div>
        <div className="mt-1 font-display text-2xl text-stone-50 sm:text-3xl [word-break:keep-all]">{name}</div>
        <div className="mt-1 font-display text-xl text-red-100">{formatNumber(score)} GS</div>
      </div>
    </div>
  );
}

function GuildLogo({ name, src, size }: { name: string; src?: string; size: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-20 w-20' : size === 'md' ? 'h-14 w-14' : 'h-10 w-10';
  return (
    <div className={`flex ${dims} items-center justify-center overflow-hidden rounded-[16px] border border-stone-200/11 bg-black/20 p-1.5 shadow-[inset_0_0_16px_rgba(255,255,255,0.012)]`} title={name}>
      {src ? <img src={src} alt={`${name} 길드 로고`} className="h-full w-full object-contain" /> : <Shield className="h-1/2 w-1/2 text-stone-100/35" strokeWidth={1.4} />}
    </div>
  );
}

function RecordStatusBadge({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${live ? 'border-red-200/18 bg-red-100/[0.045] text-red-100/72' : 'border-stone-200/12 bg-stone-100/[0.025] text-stone-100/52'}`}>
      <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />{live ? '현재 공식 기록' : '공식 확정 기록'}
    </span>
  );
}

function guildLogo(name?: string | null) {
  if (!name) return undefined;
  return RECORDS_GUILD_LOGO_BY_NAME[name];
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
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

function formatPeriod(value?: string | null) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[1]}년 ${Number(match[2])}월` : value;
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
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.subject_display_name.localeCompare(b.subject_display_name, 'ko');
  });
}
