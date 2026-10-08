import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Crown, Sparkles, Trophy, X } from 'lucide-react';

const CELEBRATION_PERIOD = '2026-09';
const CELEBRATION_HIDDEN_KEY = `brand:celebration:hidden-until:${CELEBRATION_PERIOD}`;
const HIDE_FOR_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const CELEBRATION_IMAGE_URL = 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/celebration/2026SEP-Top1Guild-Supernova.webp';

const GUILD_ICONS: Record<string, string> = {
  '슈퍼노바': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2026_guild_logo/guild-Supernova.png',
  '아블루션': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2026_guild_logo/guild-Ablution.png',
  '루나 네이비': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2026_guild_logo/guild-LunaNavy.png',
  '피닉스': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2026_guild_logo/guild-Phoenix.png',
  '와사비': 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/guild/2026_guild_logo/guild-Wasabi.png',
};

const RANKINGS = [
  { rank: 1, guild: '슈퍼노바', score: 8193.90 },
  { rank: 2, guild: '루나 네이비', score: 6106.09 },
  { rank: 3, guild: '피닉스', score: 6104.60 },
  { rank: 4, guild: '와사비', score: 5695.56 },
  { rank: 5, guild: '아블루션', score: 2705.54 },
] as const;

const GUILD_GUARDIANS = [
  { guild: '슈퍼노바', name: '류은우', score: 752.22 },
  { guild: '루나 네이비', name: '이준혁', score: 628.66 },
  { guild: '피닉스', name: '이예준', score: 635.10 },
  { guild: '와사비', name: '한서현', score: 557.92 },
  { guild: '아블루션', name: '김윤우', score: 505.00 },
] as const;

const MVP_TOP4 = [
  { label: 'TOP 1', name: '부희주' },
  { label: 'TOP 2', name: '이준혁' },
  { label: '공동 3위', name: '류은우' },
  { label: '공동 3위', name: '김윤우' },
] as const;


function formatScore(value: number) {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getHiddenUntilKey(studentId: number | null) {
  return studentId ? `${CELEBRATION_HIDDEN_KEY}:student:${studentId}` : CELEBRATION_HIDDEN_KEY;
}

export function shouldOpenMonthlyCelebration(studentId: number | null) {
  if (typeof window === 'undefined') return false;
  const key = getHiddenUntilKey(studentId);
  const hiddenUntil = Number(window.localStorage.getItem(key) ?? 0);
  return !Number.isFinite(hiddenUntil) || hiddenUntil <= Date.now();
}

interface MonthlyCelebrationModalProps {
  isOpen: boolean;
  studentId: number | null;
  onClose: () => void;
}

export function MonthlyCelebrationModal({ isOpen, studentId, onClose }: MonthlyCelebrationModalProps) {
  const [page, setPage] = useState<0 | 1>(0);
  const hiddenKey = useMemo(() => getHiddenUntilKey(studentId), [studentId]);

  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setPage(0);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCloseForAWeek = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(hiddenKey, String(Date.now() + HIDE_FOR_DAYS_MS));
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 px-3 py-4 backdrop-blur-md sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-label="2026년 9월 축전"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-gold/25 bg-[radial-gradient(circle_at_top,rgba(126,87,255,0.2),transparent_32%),radial-gradient(circle_at_85%_15%,rgba(255,214,102,0.13),transparent_26%),linear-gradient(180deg,#161127_0%,#0d0a17_100%)] shadow-[0_24px_100px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/85 transition hover:border-gold/50 hover:text-gold"
          aria-label="축전 닫기"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4 sm:px-7">
          <div>
            <div className="text-[11px] font-black tracking-[0.18em] text-gold/85">B.R.A.N.D · MONTHLY CELEBRATION</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-display text-white sm:text-2xl">
              <Sparkles className="h-5 w-5 text-gold" />
              2026년 9월 축전
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-text-secondary">
            {page === 0 ? '1 / 2' : '2 / 2'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {page === 0 ? <CelebrationHeroPage /> : <CelebrationResultsPage />}
        </div>

        <div className="border-t border-white/8 bg-black/20 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-center gap-2 sm:justify-start">
              <button
                type="button"
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/80 transition disabled:cursor-not-allowed disabled:opacity-40 hover:border-gold/35 hover:text-gold"
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </button>
              <div className="flex items-center gap-2 px-1">
                <span className={`h-2.5 w-2.5 rounded-full ${page === 0 ? 'bg-gold shadow-[0_0_12px_rgba(255,215,0,0.55)]' : 'bg-white/20'}`} />
                <span className={`h-2.5 w-2.5 rounded-full ${page === 1 ? 'bg-gold shadow-[0_0_12px_rgba(255,215,0,0.55)]' : 'bg-white/20'}`} />
              </div>
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/80 transition disabled:cursor-not-allowed disabled:opacity-40 hover:border-gold/35 hover:text-gold"
              >
                다음
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleCloseForAWeek}
                className="rounded-full border border-gold/35 bg-gold/10 px-4 py-2.5 text-sm font-black text-gold transition hover:bg-gold/16"
              >
                일주일간 다시 보지 않기
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-gradient-to-r from-brand-primary to-gold px-5 py-2.5 text-sm font-black text-white shadow-brand-md transition hover:brightness-110"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CelebrationHeroPage() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
      <section className="overflow-hidden rounded-[26px] border border-gold/18 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-4 sm:p-5">
        <div className="rounded-[22px] border border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(255,215,0,0.12),transparent_42%),linear-gradient(180deg,rgba(17,12,32,0.92),rgba(10,8,20,0.96))] p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.14em] text-gold/85">
            <span className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1">9월 최고의 길드</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/75">유일한 4인 길드</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/75">유일한 3미션 성공</span>
          </div>

          <div className="mt-4 text-center">
            <div className="text-[13px] font-black tracking-[0.26em] text-bv/85">슈퍼노바</div>
            <h2 className="mt-2 break-keep font-display text-3xl text-white sm:text-5xl">
              네 사람으로 완성한
              <br />
              가장 찬란한 1위
            </h2>
          </div>

          <div className="mt-5 overflow-hidden rounded-[22px] border border-gold/20 bg-black/20 shadow-[0_14px_48px_rgba(0,0,0,0.35)]">
            <img
              src={CELEBRATION_IMAGE_URL}
              alt="2026년 9월 최고의 길드 슈퍼노바 축전"
              className="w-full object-cover"
            />
          </div>

          <div className="mt-5 space-y-4">
            <p className="break-keep text-base font-semibold leading-8 text-white/86 sm:text-[17px]">
              슈퍼노바는 <span className="text-gold">인원이 1명 부족한 유일한 4인 길드</span>였지만,
              전 길드 중 유일하게 <span className="text-gold">3개의 미션을 모두 성공</span>시키며
              2위와 2000점이 넘는 차이로 9월 정상에 올랐습니다.
            </p>

            <div className="grid gap-2.5">
              {[
                '2위 길드와 2,087.81점 차이의 압도적 1위',
                '길드원 전원 월간 MVP 12인 예선 진출',
                '그중 2인 TOP4 진출',
                '부희주, 9월 월간 MVP 최종 선정',
              ].map((line) => (
                <div
                  key={line}
                  className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold leading-6 text-white/90"
                >
                  ✦ {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(23,18,38,0.95),rgba(11,9,20,0.96))] p-4 sm:p-5">
          <div className="flex items-center gap-2 text-white">
            <Trophy className="h-5 w-5 text-gold" />
            <h3 className="font-display text-xl">이번 달의 서사</h3>
          </div>
          <div className="mt-3 space-y-2.5 text-sm font-semibold leading-7 text-white/82">
            <p className="break-keep">
              적은 인원은 약점이 아니었습니다. 슈퍼노바는 오히려 더 단단하고 정확한 협동으로 9월을 지배했습니다.
            </p>
            <p className="break-keep">
              이번 축전은 월간 종료 이후 확정된 9월 공식 결과를 바탕으로 제작되었습니다.
            </p>
          </div>
        </div>

        <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(23,18,38,0.95),rgba(11,9,20,0.96))] p-4 sm:p-5">
          <div className="text-[11px] font-black tracking-[0.18em] text-white/65">슈퍼노바를 향한 축하 메시지</div>
          <div className="mt-3 space-y-3 text-sm font-semibold leading-7 text-white/82">
            <p className="break-keep">
              적은 인원은 약점이 아니었습니다. 슈퍼노바는 오히려 더 단단하고 정확한 협동으로 9월을 지배했습니다.
            </p>
            <p className="break-keep">
              이번 축전은 월간 종료 이후 확정된 9월 공식 결과를 바탕으로 제작되었습니다.
            </p>
            <p className="break-keep">
              특히 어떤 길드도 성공하지 못했던 <span className="text-gold">영웅의표식: 지정업적</span> 미션에서, 이미 상대적으로 많은 업적을 달성해 새로운 업적을 채우기 까다로웠음에도 불구하고 해당 미션을 훌륭하게 성공시킨 <span className="text-gold">류은우, 이태우</span> 학생에게 큰 축하를 보냅니다.
            </p>
            <p className="break-keep">
              세션마다 다른 길드원들에게 일을 떠넘기지 않고 항상 진지하고 열심히 참여해준 다른 길드원들에게도 박수를 아끼지 않겠습니다.
            </p>
            <p className="break-keep">
              또한 길드원 전원의 월간MVP TOP 12 진출과 2인(<span className="text-gold">류은우, 부희주</span>)의 TOP4 진출, 부희주 학생의 최종 우승까지 다시 한 번 축하드립니다.
            </p>
          </div>
        </div>

        <div className="rounded-[26px] border border-gold/18 bg-[linear-gradient(180deg,rgba(255,215,0,0.08),rgba(255,255,255,0.02))] p-4">
          <div className="flex items-center gap-2 text-white">
            <Crown className="h-5 w-5 text-gold" />
            <div>
              <div className="text-sm font-black">9월 월간 MVP</div>
              <div className="text-2xl font-display text-gold">부희주</div>
            </div>
          </div>
          <p className="mt-2 break-keep text-sm font-semibold leading-6 text-white/78">
            4월 월간MVP 후보 선정 이후 5개월만에 2번째 후보 선정 후 월간MVP로 선정! 성장 서사가 가장 눈부시게 만난 달이었습니다.
          </p>
        </div>
      </section>
    </div>
  );
}

function CelebrationResultsPage() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,17,35,0.96),rgba(11,9,20,0.98))] p-4 sm:p-5">
          <div className="text-[11px] font-black tracking-[0.18em] text-gold/85">공식 길드 순위</div>
          <h3 className="mt-2 font-display text-2xl text-white">2026년 9월 길드 최종 순위</h3>
          <div className="mt-4 overflow-hidden rounded-[20px] border border-white/10">
            <div className="grid grid-cols-[56px_minmax(0,1fr)_110px] bg-white/5 px-3 py-2 text-[11px] font-black tracking-[0.12em] text-white/60 sm:grid-cols-[64px_minmax(0,1fr)_150px]">
              <div>순위</div>
              <div>길드</div>
              <div className="text-right">점수</div>
            </div>
            {RANKINGS.map((row) => (
              <div
                key={row.guild}
                className="grid grid-cols-[56px_minmax(0,1fr)_110px] items-center border-t border-white/8 px-3 py-3 text-sm sm:grid-cols-[64px_minmax(0,1fr)_150px]"
              >
                <div className="font-display text-xl text-gold">{row.rank}</div>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/5">
                    <img src={GUILD_ICONS[row.guild]} alt="" className="h-8 w-8 object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-black text-white">{row.guild}</div>
                    {row.rank === 1 && <div className="text-[11px] font-bold text-gold/85">2026년 9월 우승 길드</div>}
                  </div>
                </div>
                <div className="text-right font-display text-lg text-white">{formatScore(row.score)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,17,35,0.96),rgba(11,9,20,0.98))] p-4 sm:p-5">
          <div className="text-[11px] font-black tracking-[0.18em] text-bv/85">길드의 수호신</div>
          <h3 className="mt-2 font-display text-2xl text-white">길드별 기여도 1위</h3>
          <div className="mt-4 space-y-2.5">
            {GUILD_GUARDIANS.map((row) => (
              <div key={row.guild} className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/5">
                  <img src={GUILD_ICONS[row.guild]} alt="" className="h-8 w-8 object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-black tracking-[0.08em] text-white/55">{row.guild}</div>
                  <div className="truncate font-black text-white">{row.name}</div>
                  {row.name === '류은우' && (
                    <div className="mt-1 inline-flex max-w-full items-center rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[10px] font-black leading-none text-transparent bg-clip-text bg-gradient-to-r from-[#fff5c4] via-[#ffe372] to-[#f5b400] drop-shadow-[0_0_10px_rgba(255,215,0,0.28)] animate-pulse">
                      역대 최고 개인기여도 기록실 등재
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-display text-lg text-gold">{formatScore(row.score)}</div>
                  <div className="text-[11px] font-bold text-white/55">개인 기여도</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[26px] border border-gold/18 bg-[radial-gradient(circle_at_top,rgba(255,215,0,0.08),transparent_38%),linear-gradient(180deg,rgba(20,17,35,0.96),rgba(11,9,20,0.98))] p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr] lg:items-stretch">
          <div className="rounded-[22px] border border-gold/18 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5">
            <div className="text-[11px] font-black tracking-[0.18em] text-gold/85">월간 MVP</div>
            <div className="mt-3 font-display text-5xl leading-none text-transparent bg-clip-text bg-gradient-to-r from-[#fff5c4] via-[#ffe372] to-[#f5b400] drop-shadow-[0_0_16px_rgba(255,215,0,0.32)] sm:text-6xl">
              부희주
            </div>
            <div className="mt-3 text-lg font-black text-white">2026년 9월 최종 선정</div>

            <div className="mt-5 rounded-[18px] border border-white/10 bg-black/16 px-4 py-3 text-base font-black text-gold">
              탄생 화신 「딛고 일어서는 자」
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold leading-7 text-white/84 break-keep">
                ● 2026년 월간브랜드가치 상승량 최고점 경신
              </div>
              <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold leading-7 text-white/84 break-keep">
                → 기록실 비상의 궤적 역대 3위에 등재
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] font-black tracking-[0.18em] text-white/62">MVP TOP4 샤라웃</div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {MVP_TOP4.map((entry) => (
                <div key={`${entry.label}-${entry.name}`} className="rounded-[18px] border border-white/10 bg-black/18 px-4 py-4">
                  <div className="text-[11px] font-black tracking-[0.12em] text-gold/75">{entry.label}</div>
                  <div className="mt-1 text-2xl font-display text-white">{entry.name}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[16px] border border-white/10 bg-black/18 px-4 py-4 text-sm font-semibold leading-7 text-white/78 break-keep">
              슈퍼노바는 길드원 전원이 12인 예선에 진출했고, 그 중 <span className="text-gold">부희주·류은우</span> 두 명이 TOP4에 이름을 올렸습니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
