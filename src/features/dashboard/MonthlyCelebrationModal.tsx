import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Crown, Medal, ShieldCheck, Sparkles, Star, Trophy, X } from 'lucide-react';

const CELEBRATION_PERIOD = '2026-10';
const CELEBRATION_HIDDEN_KEY = `brand:celebration:hidden-until:${CELEBRATION_PERIOD}`;
const HIDE_FOR_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Bundled with the October celebration patch: no CDN refresh delay, no cropped artwork.
const CELEBRATION_IMAGE_URL = `${import.meta.env.BASE_URL}assets/guild/celebration/2026OCT-Top1Guild-Supernova.webp`;

const GUILD_ICONS: Record<string, string> = {
  '슈퍼노바': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/guild/2026_guild_logo/guild-Supernova.png',
  '아블루션': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/guild/2026_guild_logo/guild-Ablution.png',
  '루나 네이비': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/guild/2026_guild_logo/guild-LunaNavy.png',
  '와사비': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/guild/2026_guild_logo/guild-Wasabi.png',
  'Phoenix': 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/guild/2026_guild_logo/guild-Phoenix.png',
};

const RANKINGS = [
  { rank: 1, guild: '슈퍼노바', score: 8736 },
  { rank: 2, guild: '아블루션', score: 8403 },
  { rank: 3, guild: '루나 네이비', score: 8307 },
  { rank: 4, guild: '와사비', score: 8206 },
  { rank: 5, guild: 'Phoenix', score: 6268 },
] as const;

const GUILD_GUARDIANS = [
  { guild: '슈퍼노바', name: '이태우', score: 779.5, note: '역대 최고점 경신' },
  { guild: '아블루션', name: '정민준', score: 763.6, note: '개인 최고점 경신' },
  { guild: '루나 네이비', name: '이준혁', score: 723.6, note: '개인 최고점 경신' },
  { guild: '와사비', name: '한서현', score: 738.2, note: '개인 최고점 경신' },
  { guild: 'Phoenix', name: '이예준', score: 592.5, note: null },
] as const;

const MVP_TOP4 = [
  { rank: 'TOP 1', name: '이준혁' },
  { rank: 'TOP 2', name: '김서영' },
  { rank: '공동 TOP 3', name: '류은우' },
  { rank: '공동 TOP 3', name: '한서현' },
] as const;

const ACHIEVEMENTS = [
  { value: '2연패', label: '2개월 연속 길드 1위 수성' },
  { value: '8,736 GS', label: '10월 최종 길드 점수' },
  { value: '9.6점', label: '길드 평균 동료평가' },
  { value: '779.5점', label: '이태우 · 역대 최고 개인기여도 경신' },
  { value: '2개월 연속', label: '류은우 · 월간 MVP 본선 진출' },
] as const;

function formatScore(value: number) {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function getHiddenUntilKey(studentId: number | null) {
  return studentId ? `${CELEBRATION_HIDDEN_KEY}:student:${studentId}` : CELEBRATION_HIDDEN_KEY;
}

export function shouldOpenMonthlyCelebration(studentId: number | null) {
  if (typeof window === 'undefined') return false;
  const hiddenUntil = Number(window.localStorage.getItem(getHiddenUntilKey(studentId)) ?? 0);
  return !Number.isFinite(hiddenUntil) || hiddenUntil <= Date.now();
}

interface MonthlyCelebrationModalProps {
  isOpen: boolean;
  studentId: number | null;
  onClose: () => void;
}

function SectionTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 border-b border-white/10 pb-2 font-display text-lg font-bold text-white sm:text-xl">
      <span className="text-amber-300">{icon ?? <Sparkles className="h-4 w-4" />}</span>
      {children}
    </h3>
  );
}

function GoldEmphasis({ children }: { children: ReactNode }) {
  return <strong className="font-extrabold text-amber-200">{children}</strong>;
}

function CelebrationHeroPage() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-5">
      <section className="min-w-0 space-y-3.5">
        <div className="rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-100/[0.09] via-white/[0.035] to-violet-300/[0.065] p-4 sm:p-5">
          <div className="flex flex-wrap gap-1.5 text-[11px] font-bold sm:text-xs">
            <span className="rounded-full border border-amber-300/40 bg-amber-300/15 px-2.5 py-1 text-amber-200">10월 최고의 길드</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-white/90">2개월 연속 1위</span>
            <span className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2.5 py-1 text-violet-100">신뢰로 완성된 팀 (평균 동료평가 9.6)</span>
          </div>
          <h2 className="mt-3 font-display text-[29px] font-black leading-[1.2] tracking-[-0.04em] text-amber-100 sm:text-4xl">신뢰로 쌓아 올린 2연패</h2>
          <p className="mt-2 break-keep text-[13px] font-medium leading-[1.75] text-white/85 sm:text-sm">
            10월, 슈퍼노바는 다시 한 번 가장 높은 자리에 올랐습니다. 4인길드를 정상으로 끌어올린 것은 서로를 향한 믿음과 흔들리지 않는 신뢰였습니다.
          </p>
          <figure className="mt-3.5 overflow-hidden rounded-xl border border-amber-300/25 bg-[#130e24] shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
            <img src={CELEBRATION_IMAGE_URL} alt="2026년 10월 슈퍼노바 2개월 연속 우승. 두 개의 왕관을 쓴 수정과, 기운이 빠진 피닉스를 위로하는 아블루션의 돌고래가 등장하는 축전" className="block aspect-[4/3] w-full object-contain" loading="eager" />
          </figure>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 sm:p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold tracking-[0.14em] text-amber-200/90"><Star className="h-4 w-4" /> 10월 핵심 성과</div>
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            {ACHIEVEMENTS.map((item, index) => (
              <div key={item.label} className={`min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 ${index === 4 ? 'col-span-2' : ''}`}>
                <div className="text-base font-black leading-5 text-amber-200 sm:text-lg">{item.value}</div>
                <div className="mt-1 break-keep text-[11px] font-semibold leading-[1.5] text-white/75 sm:text-xs">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="min-w-0 space-y-3.5">
        <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(26,21,44,.95),rgba(17,14,31,.95))] p-4 sm:p-5">
          <SectionTitle icon={<Trophy className="h-5 w-5" />}>이번 달의 서사</SectionTitle>
          <div className="mt-3 space-y-3 break-keep text-[13px] font-medium leading-[1.85] text-white/83 sm:text-sm">
            <p>9월에 이어 10월에도 슈퍼노바는 가장 높은 자리를 지켜냈습니다. 점수 차이는 지난달보다 좁혀졌지만, 정상의 이름은 바뀌지 않았습니다. 슈퍼노바는 이번 달에도 가장 안정적이고 완성도 높은 전력을 보여주며, <GoldEmphasis>2개월 연속 최고의 길드</GoldEmphasis>로 선정되었습니다.</p>
            <p>이 팀의 진짜 힘은 단순한 점수에만 있지 않았습니다. 슈퍼노바 길드원들이 서로에게 남긴 동료평가 평균은 무려 <GoldEmphasis>9.6점</GoldEmphasis>. 다른 길드들이 평균 7점대 후반에서 8점대 초반에 머문 것과 비교하면, 서로를 향한 신뢰와 믿음이 얼마나 강했는지가 분명하게 드러났습니다.</p>
            <p>인원은 단 4명. 하지만 평균 전력은 가장 높았습니다. 서로의 역할을 믿고 맡기며, 각자가 자기 자리를 끝까지 책임졌기에 가능한 결과였습니다. 슈퍼노바는 이번 달에도 ‘적은 인원이 약점이 아니라, 더 높은 밀도의 팀워크가 될 수 있다’는 사실을 증명했습니다.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-300/15 bg-[linear-gradient(140deg,rgba(255,209,103,.075),rgba(255,255,255,.025))] p-4 sm:p-5">
          <SectionTitle icon={<Medal className="h-5 w-5" />}>기록으로 증명된 강함</SectionTitle>
          <div className="mt-3 space-y-3 break-keep text-[13px] font-medium leading-[1.85] text-white/83 sm:text-sm">
            <p>지난달 류은우가 단일 월 길드 개인기여도 역대 최고 기록을 세운 데 이어, 이번 달에는 <GoldEmphasis>이태우가 779.5점</GoldEmphasis>을 기록하며 다시 한 번 최고 기록을 경신했습니다. 2개월 연속 슈퍼노바에서 역대 최고 기록 보유자가 탄생했다는 사실은, 이 팀의 평균 전력이 얼마나 높은지 상징적으로 보여줍니다.</p>
            <p>또한 류은우는 지난달에 이어 이번 달에도 <GoldEmphasis>월간 MVP 본선</GoldEmphasis>에 진출했습니다. 비록 최종 우승에는 이르지 못했지만, 두 달 연속으로 그 무대에 올랐다는 사실만으로도 류은우가 10월의 최상위권 학생 중 한 명이었음은 분명합니다.</p>
            <p><GoldEmphasis>예선 최종전에 진출한 이태우</GoldEmphasis> 또한 언제든 더 높은 자리를 노릴 수 있다는 가능성을 보여주었습니다.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-300/30 bg-gradient-to-r from-amber-200/[0.12] via-amber-100/[0.045] to-transparent px-4 py-3.5 text-center">
          <p className="break-keep font-display text-[15px] font-bold leading-[1.7] text-amber-100 sm:text-base">
            작지만 가장 강한 팀.<br />믿음으로 하나 된 4인의 엘리트,<br />슈퍼노바의 2개월 연속 1위를 축하합니다.
          </p>
        </div>
      </section>
    </div>
  );
}

function CelebrationResultsPage() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.99fr)_minmax(0,1.01fr)] lg:gap-5">
      <div className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle icon={<Crown className="h-5 w-5" />}>10월 길드 최종 순위</SectionTitle>
            <span className="shrink-0 text-[10px] font-extrabold text-white/50">2026.10 · 공식 GS</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            {RANKINGS.map((row, index) => (
              <div key={row.guild} className={`grid grid-cols-[34px_36px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-[7px] sm:px-3 ${index > 0 ? 'border-t border-white/10' : ''} ${row.rank === 1 ? 'bg-amber-200/[0.11]' : 'bg-black/15'}`}>
                <div className={`text-[13px] font-black ${row.rank === 1 ? 'text-amber-200' : 'text-white/65'}`}>{row.rank}위</div>
                <img src={GUILD_ICONS[row.guild]} className="h-[30px] w-9 object-contain" alt="" loading="lazy" />
                <div className={`min-w-0 truncate text-[13px] font-bold sm:text-sm ${row.rank === 1 ? 'text-amber-100' : 'text-white/90'}`}>{row.guild}</div>
                <div className={`whitespace-nowrap text-right text-[15px] font-black tabular-nums sm:text-base ${row.rank === 1 ? 'text-amber-200' : 'text-white/90'}`}>{row.score.toLocaleString('ko-KR')} <span className="text-[10px] font-semibold text-white/50">GS</span></div>
              </div>
            ))}
          </div>
          <p className="mt-3 break-keep text-xs font-medium leading-[1.7] text-white/70">10월은 상위권 길드 간의 점수 차이가 9월보다 더 좁혀진 치열한 한 달이었습니다. 그 속에서도 끝내 가장 높은 자리를 지켜낸 길드는 <GoldEmphasis>슈퍼노바</GoldEmphasis>였습니다.</p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle icon={<ShieldCheck className="h-5 w-5" />}>길드의 수호신</SectionTitle>
            <span className="text-[11px] font-bold text-amber-200/85">길드별 기여도 1위 · 업적 신청 가능</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            {GUILD_GUARDIANS.map((row, index) => (
              <div key={row.guild} className={`grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 bg-black/15 px-2.5 py-[7px] sm:px-3 ${index > 0 ? 'border-t border-white/10' : ''}`}>
                <img className="h-8 w-8 object-contain" src={GUILD_ICONS[row.guild]} alt="" loading="lazy" />
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold leading-[1.45] text-white/55">{row.guild}</div>
                  <div className="truncate text-[13px] font-black text-white">{row.name}</div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-[15px] font-black tabular-nums text-amber-200 sm:text-base">{formatScore(row.score)}<span className="ml-0.5 text-[10px] text-white/50">점</span></div>
                  {row.note && <div className={`whitespace-nowrap text-[10px] font-bold ${row.guild === '슈퍼노바' ? 'text-amber-200' : 'text-emerald-200/85'}`}>{row.note}</div>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 break-keep text-xs font-medium leading-[1.7] text-white/70">이번 달에는 네 개 길드에서 개인 최고 기록이 새롭게 경신되었습니다. 특히 이태우는 <GoldEmphasis>779.5점</GoldEmphasis>으로 단일 월 개인기여도 역대 최고 기록을 새로 쓰며 기록실에 이름을 올렸습니다.</p>
        </section>
      </div>

      <div className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-300/[0.10] via-violet-200/[0.06] to-black/10 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10"><Trophy className="h-6 w-6 text-amber-200" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-extrabold tracking-[0.14em] text-amber-200">2026년 10월 월간 MVP</div>
              <h3 className="font-display text-3xl font-black leading-[1.2] text-amber-100 sm:text-4xl">이준혁</h3>
            </div>
            <span className="rounded-full border border-amber-300/30 bg-black/20 px-2.5 py-1 text-[11px] font-bold text-amber-200">TOP 1</span>
          </div>
          <div className="mt-3 rounded-xl border border-amber-200/20 bg-black/20 px-3.5 py-2.5 text-sm font-black text-amber-100">탄생 화신 「신뢰를 증명하는 자」</div>
          <p className="mt-3 break-keep text-[13px] font-medium leading-[1.8] text-white/83 sm:text-sm">10월 월간 MVP는 9월에 이은 두 번째 도전 끝에 이준혁이 거머쥐었습니다. 신뢰를 잃지 않는 한 달을 만들어낸 끝에 정상에 자신의 이름을 올리며 역사에 이름을 또렷하게 새겼습니다.</p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <SectionTitle icon={<Star className="h-5 w-5" />}>10월 월간 MVP TOP 4</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {MVP_TOP4.map((row) => (
              <div key={`${row.rank}-${row.name}`} className={`min-w-0 rounded-xl border px-3 py-2.5 ${row.rank === 'TOP 1' ? 'border-amber-300/35 bg-amber-300/[0.08]' : 'border-white/10 bg-black/15'}`}>
                <div className="text-[10px] font-extrabold tracking-[0.09em] text-amber-200/80">{row.rank}</div>
                <div className="mt-0.5 font-display text-lg font-black text-white sm:text-xl">{row.name}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 break-keep text-[13px] font-medium leading-[1.8] text-white/78 sm:text-sm">10월의 TOP4는 누구나 인정할만한 뛰어난 학생들의 각축전이었습니다.</p>
          <p className="mt-2 break-keep text-[13px] font-medium leading-[1.8] text-white/78 sm:text-sm">김서영, 류은우, 한서현은 각 월간MVP 본선 <GoldEmphasis>6회, 5회, 5회</GoldEmphasis> 무대에 오르며 변함없이 최상위권에 이름을 올리는 저력을 보여주었습니다.</p>
        </section>

        <section className="rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-200/[0.08] to-violet-300/[0.065] p-4 sm:p-5">
          <SectionTitle icon={<Sparkles className="h-5 w-5" />}>다음 장을 향하여</SectionTitle>
          <p className="mt-3 break-keep text-[13px] font-medium leading-[1.8] text-white/82 sm:text-sm"><GoldEmphasis>10월의 테마는 ‘신뢰’</GoldEmphasis>였습니다. 서로를 믿고 믿음을 줄 수 있는 이들의 승리를 축하합니다.</p>
          <p className="mt-2 break-keep text-[13px] font-medium leading-[1.8] text-white/82 sm:text-sm"><GoldEmphasis>11월의 테마는 ‘각성’과 ‘증명’</GoldEmphasis>입니다. 스스로를 약자라고 생각해왔던 이들이 증명하는 자리가 될 수 있기를 바랍니다.</p>
        </section>
      </div>
    </div>
  );
}

export function MonthlyCelebrationModal({ isOpen, studentId, onClose }: MonthlyCelebrationModalProps) {
  const [page, setPage] = useState<0 | 1>(0);
  const hiddenKey = useMemo(() => getHiddenUntilKey(studentId), [studentId]);

  useEffect(() => {
    if (!isOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setPage(0);
  }, [isOpen]);

  if (!isOpen) return null;

  function handleCloseForAWeek() {
    window.localStorage.setItem(hiddenKey, String(Date.now() + HIDE_FOR_DAYS_MS));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-2 py-2.5 backdrop-blur-md sm:px-5 sm:py-5" role="dialog" aria-modal="true" aria-label="2026년 10월 축전">
      <div className="relative flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[22px] border border-amber-300/25 bg-[radial-gradient(ellipse_at_top,rgba(120,88,205,.15),transparent_50%),linear-gradient(180deg,#171326_0%,#0e0c19_100%)] shadow-[0_26px_90px_rgba(0,0,0,.6)] sm:max-h-[93vh] sm:rounded-[26px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-black tracking-[0.16em] text-amber-200/85">B.R.A.N.D 2.0 · MONTHLY CELEBRATION</div>
            <h2 className="mt-0.5 flex items-center gap-2 truncate font-display text-lg font-black text-white sm:text-xl"><Crown className="h-4 w-4 shrink-0 text-amber-200" /> 2026년 10월 축전</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-bold text-white/65">{page + 1} / 2</span>
            <button type="button" onClick={onClose} aria-label="축전 닫기" className="rounded-full border border-white/10 bg-white/5 p-2 text-white/80 transition hover:text-amber-200"><X className="h-[18px] w-[18px]" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3.5 sm:px-5 sm:py-4" key={page}>
          {page === 0 ? <CelebrationHeroPage /> : <CelebrationResultsPage />}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black/25 px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={page === 0} onClick={() => setPage(0)} className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/85 transition hover:border-amber-300/30 disabled:cursor-not-allowed disabled:opacity-35 sm:text-sm"><ChevronLeft className="h-4 w-4" /> 이전</button>
            <button type="button" disabled={page === 1} onClick={() => setPage(1)} className="flex items-center gap-1 rounded-lg border border-amber-300/30 bg-amber-300/15 px-3 py-2 text-xs font-bold text-amber-100 transition hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:opacity-35 sm:text-sm">다음 <ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={handleCloseForAWeek} className="rounded-lg border border-white/15 px-2.5 py-2 text-[11px] font-bold text-white/65 transition hover:text-white sm:px-3 sm:text-xs">일주일간 다시 보지 않기</button>
            <button type="button" onClick={onClose} className="rounded-lg bg-gradient-to-r from-amber-300 to-amber-500 px-3.5 py-2 text-xs font-black text-slate-950 transition hover:brightness-110 sm:text-sm">닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
