import {
  Medal,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const GUILD_HEGEMONY_STYLE = `
@keyframes tcxBorderFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes tcxAuraImperial {
  0%,100% { box-shadow: 0 0 8px 1px rgba(255,215,0,0.5), 0 0 20px 3px rgba(150,20,50,0.35); }
  50% { box-shadow: 0 0 18px 5px rgba(255,215,0,0.85), 0 0 38px 8px rgba(180,20,60,0.55); }
}
@keyframes commanderSpotlight {
  0%,100% { opacity: .24; transform: translateX(-50%) scaleY(1); }
  50% { opacity: .42; transform: translateX(-50%) scaleY(1.04); }
}
.imperial-flow-frame {
  background: linear-gradient(115deg, #ffd700, #6b0f2a, #ffefc0, #3d0a1f, #ffd700);
  background-size: 300% 300%;
  animation: tcxBorderFlow 5.5s ease infinite, tcxAuraImperial 3.2s ease-in-out infinite;
}
.commander-spotlight { animation: commanderSpotlight 4.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .imperial-flow-frame,
  .commander-spotlight { animation: none; }
}
`;

const GUILD_LOGOS: Record<string, string> = {
  'Ruby': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/Ruby.png',
  '빛나는 은하수': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/Milkyway.png',
  '암흑장미': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/Darkrose.png',
  '에메랄드': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/EMERALD.png',
  '아블루션': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Ablution.png',
  '루나 네이비': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-LunaNavy.png',
  '피닉스': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Phoenix.png',
  '슈퍼노바': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Supernova.png',
  '와사비': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2-Wasabi.png',
};

const FINAL_BATTLE_ROSTERS: Record<string, string[]> = {
  Ruby: ['김서영', '박시우', '이현석', '정우림', '한서현'],
  '빛나는 은하수': ['김종현', '민사랑', '이아정', '지담'],
};

export function RecordsGuildHegemonyHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const seasonChampion = pickOne(entries, ['SEASON_CHAMPION', 'GUILD_SEASON_CHAMPION'], ['시즌 최종 우승', '최종 우승 길드']);
  const singleMonthRows = pickMany(entries, ['HIGHEST_SINGLE_MONTH_GS', 'TOP_SINGLE_MONTH_GS', 'GUILD_TOP_SINGLE_MONTH_GS'], ['단일 월', '단일 월 전과']);
  const commanderRows = pickMany(entries, ['MONTHLY_GUILD_CONTRIBUTION_TOP', 'SEASON_GUILD_CONTRIBUTION_TOP', 'TOP_INDIVIDUAL_GUILD_CONTRIBUTION'], ['개인 기여', '지휘관'])
    .filter((entry) => !/기여율/.test(entry.title || ''));
  const finalBattle = pickOne(entries, ['CLOSEST_SEASON_WIN', 'CLOSEST_FINAL_BATTLE'], ['근소한 시즌 우승', '마지막 전투']);
  const recordCount = new Set(entries.map((entry) => entry.record_type)).size;

  return (
    <>
      <style>{GUILD_HEGEMONY_STYLE}</style>
      <section
        id="hall-guild_hegemony"
        className="scroll-mt-24 overflow-hidden rounded-[30px] border border-red-200/18 bg-[radial-gradient(circle_at_50%_-12%,rgba(153,51,39,0.17),transparent_28%),radial-gradient(circle_at_88%_20%,rgba(255,214,143,0.05),transparent_24%),linear-gradient(180deg,rgba(36,18,18,0.99),rgba(20,10,11,0.995)_52%,rgba(11,8,9,1))] shadow-[0_30px_82px_rgba(0,0,0,0.32)]"
      >
        <HallHeader recordCount={recordCount} />

        <div className="space-y-10 px-4 py-8 sm:px-7 sm:py-10 lg:px-9">
          {seasonChampion && <VictorsStandard entry={seasonChampion} />}
          {singleMonthRows.length > 0 && <StrongestMonth rows={singleMonthRows} />}
          {commanderRows.length > 0 && <FieldHonors rows={commanderRows} />}
          {finalBattle && <FinalBattle entry={finalBattle} />}
        </div>
      </section>
    </>
  );
}

function HallHeader({ recordCount }: { recordCount: number }) {
  return (
    <header className="relative overflow-hidden border-b border-red-100/10 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="absolute inset-y-0 right-0 w-2/5 bg-[radial-gradient(circle_at_80%_50%,rgba(168,66,53,0.14),transparent_56%)]" />
      <Swords aria-hidden="true" className="absolute -right-4 -top-8 h-44 w-44 text-red-100/[0.025] sm:h-56 sm:w-56" strokeWidth={1.0} />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-red-200/24 bg-[radial-gradient(circle,rgba(191,84,66,0.18),rgba(40,20,19,0.88)_72%)] text-red-50 shadow-[0_0_30px_rgba(188,83,63,0.13)] sm:h-[72px] sm:w-[72px]">
            <Shield className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.55} />
          </div>
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-red-100/78">HALL 06 · THE WAR ARCHIVE</div>
            <h3 className="mt-1.5 font-display text-3xl text-red-50 sm:text-4xl [word-break:keep-all]">길드 패권사</h3>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-red-50/82 sm:text-base [word-break:keep-all]">
              개인이 아니라 길드 전체가 맞붙었던 전장의 기록. 승전, 전과, 공훈, 그리고 가장 치열했던 마지막 전투를 보존합니다.
            </p>
          </div>
        </div>
        <div className="w-fit rounded-full border border-red-100/18 bg-black/18 px-4 py-2 text-center">
          <div className="font-display text-2xl text-red-100">{recordCount}</div>
          <div className="text-[10px] font-black tracking-[0.12em] text-red-50/72">전장 기록</div>
        </div>
      </div>
    </header>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-4xl text-center">
      <div className="text-[11px] font-black tracking-[0.22em] text-red-200/78">{eyebrow}</div>
      <h4 className="mt-2 font-display text-2xl text-red-50 sm:text-3xl [word-break:keep-all]">{title}</h4>
      <p className="mx-auto mt-2 max-w-3xl whitespace-pre-line text-sm font-semibold leading-7 text-red-50/78 [word-break:keep-all]">{description}</p>
    </div>
  );
}

function VictorsStandard({ entry }: { entry: HallOfGloryEntry }) {
  const guildName = firstString(entry, ['guild_name', 'winner_guild_name']) || entry.subject_display_name;
  const seasonLabel = entry.period_label || firstString(entry, ['season_label']) || '2026 시즌1';
  const roster = firstStringArray(entry, ['champion_roster', 'roster', 'members']);
  const logo = GUILD_LOGOS[guildName];
  const score = `${formatNumber(entry.value_primary ?? 0)}점`;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="승전의 군기"
        title="시즌을 제패한 군기"
        description="우승은 한 사람의 기록이 아니라, 한 시즌을 함께 버틴 길드 전체의 전과입니다."
      />

      <article className="mx-auto max-w-4xl overflow-hidden rounded-[30px] border border-red-100/24 bg-[radial-gradient(circle_at_18%_14%,rgba(171,61,49,0.16),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(255,226,168,0.05),transparent_24%),linear-gradient(180deg,rgba(43,19,19,0.95),rgba(16,10,12,0.98))] p-5 shadow-[0_0_38px_rgba(138,50,40,0.12)] sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          <div className="rounded-[24px] border border-red-100/14 bg-black/14 px-5 py-6 text-center sm:px-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100/18 bg-black/15 px-3 py-1.5 text-xs font-black text-red-50/88">
              <Trophy className="h-3.5 w-3.5" strokeWidth={1.7} />
              시즌 최종 우승 길드
            </div>
            <div className="mt-4 flex justify-center">
              <div className="flex h-[122px] w-[122px] items-center justify-center rounded-[26px] border border-red-100/24 bg-[radial-gradient(circle,rgba(255,230,181,0.08),rgba(29,14,14,0.90)_70%)] shadow-[0_0_26px_rgba(255,220,150,0.07)] sm:h-[138px] sm:w-[138px]">
                {logo ? (
                  <img src={logo} alt="" aria-hidden="true" className="h-[96px] w-[96px] object-contain drop-shadow-[0_0_14px_rgba(255,180,120,0.16)] sm:h-[110px] sm:w-[110px]" />
                ) : (
                  <Trophy className="h-14 w-14 text-red-50/78" strokeWidth={1.4} />
                )}
              </div>
            </div>
            <div className="mt-4 text-base font-bold text-red-50/88">{seasonLabel}</div>
            <div className="mt-2 font-display text-5xl text-red-50 sm:text-6xl">{guildName}</div>
            <div className="mt-3 font-display text-[2.5rem] leading-none text-amber-100 sm:text-[2.8rem]">{score}</div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              <RecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} />
            </div>
          </div>

          <div className="rounded-[24px] border border-red-100/14 bg-[linear-gradient(180deg,rgba(31,16,18,0.82),rgba(13,9,11,0.96))] px-5 py-5 sm:px-6">
            <div className="flex items-center justify-center gap-2 text-red-50">
              <Users className="h-4.5 w-4.5 text-red-100/88" strokeWidth={1.7} />
              <div className="text-lg font-display">우승 길드 로스터</div>
            </div>
            <RosterLayout names={roster} highlightRuby={guildName === 'Ruby'} />
          </div>
        </div>
      </article>
    </div>
  );
}

function RosterLayout({ names, highlightRuby = false }: { names: string[]; highlightRuby?: boolean }) {
  if (highlightRuby && names.length === 5) {
    return (
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 px-6">
          {names.slice(0, 2).map((name) => <RosterChip key={name} name={name} />)}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {names.slice(2).map((name) => <RosterChip key={name} name={name} />)}
        </div>
      </div>
    );
  }

  const gridCols = names.length <= 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  return (
    <div className={`mt-4 grid gap-3 ${gridCols}`}>
      {names.map((name) => <RosterChip key={name} name={name} />)}
    </div>
  );
}

function RosterChip({ name }: { name: string }) {
  return (
    <div className="rounded-[16px] border border-red-100/20 bg-black/18 px-4 py-3 text-center font-display text-[1.6rem] text-red-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:text-[1.7rem]">
      {name}
    </div>
  );
}

function StrongestMonth({ rows }: { rows: HallOfGloryEntry[] }) {
  const sorted = [...rows].sort(sortByRankThenValue);
  const top = sorted[0];
  const rest = sorted.slice(1, 5);

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="단일 월 전과 기록"
        title="가장 강력했던 단일 월 전과"
        description="한 달 동안 길드가 쌓아 올린 가장 높은 전과를 비교하여 보존합니다."
      />

      <div className="grid gap-4 lg:grid-cols-[1.08fr_.92fr]">
        {top && <TopSingleMonthRelic entry={top} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {rest.map((entry) => (
            <CompactMonthRelic key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TopSingleMonthRelic({ entry }: { entry: HallOfGloryEntry }) {
  const guildName = firstString(entry, ['guild_name']) || entry.subject_display_name;
  const logo = GUILD_LOGOS[guildName];
  const score = `${formatNumber(entry.value_primary ?? 0)} / ${formatNumber(valueMeta(entry, ['goal_gs', 'target_gs']) ?? 10000)} GS`;
  const percent = valueMeta(entry, ['completion_pct', 'completion_percent', 'percent']);

  return (
    <article className="imperial-flow-frame relative overflow-hidden rounded-[28px] p-[2.5px]">
      <div className="relative overflow-hidden rounded-[25px] bg-[radial-gradient(circle_at_10%_20%,rgba(255,230,168,0.12),transparent_32%),linear-gradient(180deg,rgba(48,24,15,0.97),rgba(17,10,10,0.98))] px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-black tracking-[0.18em] text-amber-100/84">1위 · 최강의 한 달</div>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-[20px] border border-amber-100/28 bg-black/18 sm:h-24 sm:w-24">
                {logo ? (
                  <img src={logo} alt="" aria-hidden="true" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
                ) : (
                  <Shield className="h-9 w-9 text-amber-50" strokeWidth={1.4} />
                )}
              </div>
              <div>
                <div className="font-display text-4xl text-amber-50 sm:text-5xl">{guildName}</div>
                <div className="mt-2 text-sm font-bold text-red-50/88">{entry.period_label}</div>
              </div>
            </div>
          </div>
          <RecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} />
        </div>

        <div className="mt-6 rounded-[22px] border border-amber-100/18 bg-black/18 px-5 py-5 text-center">
          <div className="whitespace-nowrap font-display text-[2.15rem] leading-none text-amber-50 sm:text-[2.6rem]">{score}</div>
          {percent != null && <div className="mt-2 font-display text-xl text-amber-100">({percent.toFixed(2)}%)</div>}
        </div>
      </div>
    </article>
  );
}

function CompactMonthRelic({ entry }: { entry: HallOfGloryEntry }) {
  const guildName = firstString(entry, ['guild_name']) || entry.subject_display_name;
  const logo = GUILD_LOGOS[guildName];
  const goal = valueMeta(entry, ['goal_gs', 'target_gs']) ?? 10000;
  const percent = valueMeta(entry, ['completion_pct', 'completion_percent', 'percent']);

  return (
    <article className="rounded-[22px] border border-red-100/18 bg-[linear-gradient(180deg,rgba(47,20,20,0.82),rgba(14,10,11,0.96))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-red-100/18 bg-black/20">
          {logo ? (
            <img src={logo} alt="" aria-hidden="true" className="h-9 w-9 object-contain" />
          ) : (
            <Shield className="h-5 w-5 text-red-50/84" strokeWidth={1.4} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black tracking-[0.14em] text-red-100/82">{ordinalLabel(entry.rank_position)}</div>
          <div className="mt-1 font-display text-[1.9rem] leading-9 text-red-50 [word-break:keep-all]">{guildName}</div>
          <div className="mt-1 whitespace-nowrap text-sm font-extrabold text-red-50/92">
            {formatNumber(entry.value_primary ?? 0)} / {formatNumber(goal)} GS
          </div>
          {percent != null && <div className="mt-1 text-xs font-bold text-amber-100/88">({percent.toFixed(2)}%)</div>}
          <div className="mt-1 text-[12px] font-bold text-red-50/82">{entry.period_label}</div>
        </div>
      </div>
    </article>
  );
}

function FieldHonors({ rows }: { rows: HallOfGloryEntry[] }) {
  const featuredRows = rows.slice(0, 2);
  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="지휘관 공훈"
        title="전선에서 가장 크게 기여한 지휘관들"
        description="전장에서 가장 화려하게 공훈을 세운 장수들의 이름과 전공을 따로 기립니다."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {featuredRows.map((entry, index) => (
          <CommanderRelic key={entry.id} entry={entry} featured={index === 0} />
        ))}
      </div>
    </div>
  );
}

function CommanderRelic({ entry, featured = false }: { entry: HallOfGloryEntry; featured?: boolean }) {
  const scoreUnit = contributionUnit(entry.title || '');
  const score = `${formatNumber(entry.value_primary ?? 0)}${scoreUnit}`;

  return (
    <article className={`relative overflow-hidden rounded-[26px] border px-5 py-5 text-center ${featured ? 'border-amber-100/26 bg-[radial-gradient(circle_at_50%_0%,rgba(255,214,135,0.16),transparent_34%),linear-gradient(180deg,rgba(84,35,24,0.84),rgba(18,10,11,0.97))] shadow-[0_0_32px_rgba(255,193,94,0.11)]' : 'border-red-100/18 bg-[radial-gradient(circle_at_50%_0%,rgba(236,116,81,0.12),transparent_34%),linear-gradient(180deg,rgba(53,20,20,0.82),rgba(14,10,11,0.96))] shadow-[0_0_24px_rgba(171,62,42,0.09)]'}`}>
      <div aria-hidden="true" className={`commander-spotlight absolute left-1/2 top-0 h-[180px] w-[62%] -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,247,220,0.22),rgba(255,247,220,0.02),transparent)] blur-lg ${featured ? 'opacity-40' : 'opacity-28'}`} />
      <div className="relative">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-100/22 bg-black/18 text-amber-100 shadow-[0_0_18px_rgba(255,205,116,0.09)]">
          <Medal className="h-5 w-5" strokeWidth={1.6} />
        </div>
        <div className="mt-3 text-[10px] font-black tracking-[0.16em] text-red-100/76">지휘관 공훈</div>
        <div className="mt-2 font-display text-3xl text-red-50 sm:text-[2.2rem]">{entry.subject_display_name}</div>
        <div className="mt-1 text-base font-bold text-red-50/88">{entry.title}</div>
        {entry.period_label && <div className="mt-1 text-sm font-bold text-red-50/82">{entry.period_label}</div>}
        <div className="mt-4 font-display text-[2.3rem] leading-none text-amber-100 sm:text-[2.75rem]">{score}</div>
        <div className="mt-3"><RecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} compact /></div>
      </div>
    </article>
  );
}

function FinalBattle({ entry }: { entry: HallOfGloryEntry }) {
  const victor = firstString(entry, ['winner_guild_name', 'victor_guild_name']) || 'Ruby';
  const runnerUp = firstString(entry, ['runner_up_guild_name', 'loser_guild_name']) || '빛나는 은하수';
  const victorScore = valueMeta(entry, ['winner_gs', 'victor_gs']) ?? 26826;
  const runnerUpScore = valueMeta(entry, ['runner_up_gs', 'loser_gs']) ?? 26814;
  const marginPct = valueMeta(entry, ['margin_pct', 'difference_pct']) ?? 0.04;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="최후의 접전"
        title="가장 치열했던 마지막 전투"
        description="패권을 결정지은 마지막 순간. 두 길드의 전과와 아주 미세한 차이까지 함께 새깁니다."
      />
      <article className="overflow-hidden rounded-[30px] border border-red-100/20 bg-[radial-gradient(circle_at_50%_0%,rgba(171,62,42,0.14),transparent_34%),linear-gradient(180deg,rgba(40,18,18,0.92),rgba(13,9,10,0.98))] px-5 py-6 shadow-[0_0_30px_rgba(154,55,36,0.10)] sm:px-6 sm:py-7">
        <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <BattleSide title="최종 우승" guildName={victor} score={victorScore} roster={FINAL_BATTLE_ROSTERS[victor] ?? []} winner />
          <div className="flex flex-col items-center justify-center rounded-[24px] border border-amber-100/14 bg-black/18 px-5 py-6 text-center">
            <div className="text-[11px] font-black tracking-[0.18em] text-red-100/76">차이</div>
            <div className="mt-1 text-sm font-bold text-red-50/86">12 GS</div>
            <div className="mt-2 font-display text-4xl text-amber-100 sm:text-5xl">{marginPct.toFixed(2)}%</div>
            <div className="mt-3"><RecordBadge live={entry.source_kind === 'PRODUCTION_DERIVED'} compact /></div>
          </div>
          <BattleSide title="최종 준우승" guildName={runnerUp} score={runnerUpScore} roster={FINAL_BATTLE_ROSTERS[runnerUp] ?? []} note="시즌 유일의 4인 길드" />
        </div>
      </article>
    </div>
  );
}

function BattleSide({ title, guildName, score, roster, note, winner = false }: { title: string; guildName: string; score: number; roster: string[]; note?: string; winner?: boolean }) {
  const logo = GUILD_LOGOS[guildName];
  return (
    <div className={`rounded-[26px] border px-5 py-5 text-center ${winner ? 'imperial-flow-frame p-[2px]' : ''}`}>
      <div className={`${winner ? 'rounded-[24px] border border-black/0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,226,160,0.12),transparent_34%),linear-gradient(180deg,rgba(88,37,25,0.58),rgba(20,10,11,0.95))] px-4 py-4 shadow-[0_0_24px_rgba(255,194,90,0.10)]' : 'rounded-[24px] border border-red-100/18 bg-[linear-gradient(180deg,rgba(52,22,22,0.54),rgba(13,10,11,0.96))] px-4 py-4'}`}>
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${winner ? 'border-amber-100/24 bg-amber-100/[0.06] text-amber-100' : 'border-red-100/18 bg-red-100/[0.04] text-red-50/90'}`}>
          {winner ? <Trophy className="h-3.5 w-3.5" strokeWidth={1.6} /> : <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.6} />}
          {title}
        </div>
        <div className="mt-4 flex items-center justify-center">
          <div className={`flex h-20 w-20 items-center justify-center rounded-[20px] border ${winner ? 'border-amber-100/22 bg-black/22' : 'border-red-100/18 bg-black/18'}`}>
            {logo ? (
              <img src={logo} alt="" aria-hidden="true" className="h-16 w-16 object-contain" />
            ) : (
              <Shield className={`h-9 w-9 ${winner ? 'text-amber-100' : 'text-red-50/84'}`} strokeWidth={1.4} />
            )}
          </div>
        </div>
        <div className={`mt-4 font-display text-[2.6rem] leading-none ${winner ? 'text-amber-50' : 'text-red-50'} sm:text-[3rem] [word-break:keep-all]`}>{guildName}</div>
        <div className={`mt-3 font-display text-3xl ${winner ? 'text-amber-100' : 'text-red-50'} sm:text-[2.5rem]`}>{formatNumber(score)} GS</div>
        {note && <div className="mt-2 text-sm font-bold text-slate-100/88">{note}</div>}
        <div className="mt-4 rounded-[18px] border border-white/10 bg-black/18 px-3 py-3">
          <div className="text-[11px] font-black tracking-[0.14em] text-slate-100/88">함께 싸운 길드원</div>
          <div className={`mt-3 grid gap-2 ${roster.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {roster.map((name) => (
              <div key={name} className="rounded-[14px] border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[1rem] font-extrabold text-slate-50">
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordBadge({ live, compact = false }: { live: boolean; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-black ${compact ? 'text-[11px]' : 'text-xs'} ${live ? 'border-red-100/24 bg-red-100/[0.05] text-red-50/92' : 'border-amber-100/22 bg-amber-100/[0.055] text-amber-100'}`}>
      <ShieldCheck className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={1.55} />
      {live ? '현재 공식 기록' : '공식 확정 기록'}
    </span>
  );
}

function pickOne(entries: HallOfGloryEntry[], recordTypes: string[], titleHints: string[]) {
  return pickMany(entries, recordTypes, titleHints)[0] ?? null;
}

function pickMany(entries: HallOfGloryEntry[], recordTypes: string[], titleHints: string[]) {
  return [...entries]
    .filter((entry) => {
      if (recordTypes.includes(entry.record_type)) return true;
      return titleHints.some((hint) => entry.title?.includes(hint) || entry.subtitle?.includes(hint));
    })
    .sort(sortByRankThenValue);
}

function sortByRankThenValue(a: HallOfGloryEntry, b: HallOfGloryEntry) {
  const rankA = a.rank_position ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.rank_position ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  const valueA = a.value_primary ?? -Number.MAX_SAFE_INTEGER;
  const valueB = b.value_primary ?? -Number.MAX_SAFE_INTEGER;
  if (valueA !== valueB) return valueB - valueA;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.subject_display_name.localeCompare(b.subject_display_name, 'ko');
}

function valueMeta(entry: HallOfGloryEntry, keys: string[]) {
  for (const key of keys) {
    const value = entry.metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function firstString(entry: HallOfGloryEntry, keys: string[]) {
  for (const key of keys) {
    const value = entry.metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstStringArray(entry: HallOfGloryEntry, keys: string[]) {
  for (const key of keys) {
    const value = entry.metadata?.[key];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (typeof value === 'string' && value.trim()) return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function ordinalLabel(rank?: number | null) {
  if (rank == null) return '기록';
  return `${rank}위`;
}

function contributionUnit(title: string) {
  if (title.includes('기여율')) return '%';
  if (title.includes('GS')) return ' GS';
  return '';
}
