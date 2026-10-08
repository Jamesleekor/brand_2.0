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
        <style>{CELEBRATION_VISUAL_STYLES}</style>
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

const CELEBRATION_VISUAL_STYLES = `
.celebration-guild-pyramid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; align-items:end; padding-top:14px; }
.celebration-podium-card { position:relative; grid-column:span 2; min-width:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px 7px; border:1px solid rgba(255,255,255,.12); border-radius:20px; background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018)); text-align:center; }
.celebration-podium-rank { display:flex; align-items:center; justify-content:center; gap:5px; color:#ffe7a3; font-size:12px; font-weight:900; }
.celebration-podium-logo { width:72px; height:72px; display:flex; align-items:center; justify-content:center; margin:10px 0; }
.celebration-podium-logo img { width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 4px 12px rgba(0,0,0,.25)); }
.celebration-podium-name { color:#fff4e3; font-size:14px; font-weight:900; line-height:1.5; word-break:keep-all; }
.celebration-podium-score { margin-top:6px; color:#fff1cf; font-size:17px; font-weight:800; font-variant-numeric:tabular-nums; }
.celebration-podium-rank-1 { min-height:224px; border-color:rgba(255,215,106,.48); background:radial-gradient(ellipse at 50% 12%,rgba(255,213,102,.18),transparent 68%),linear-gradient(180deg,rgba(255,215,106,.07),rgba(255,255,255,.025)); box-shadow:0 0 24px rgba(255,215,0,.07); }
.celebration-podium-rank-1 .celebration-podium-logo { width:94px; height:94px; }
.celebration-podium-rank-1 .celebration-podium-name { color:#ffe58d; }
.celebration-podium-rank-2,.celebration-podium-rank-3 { min-height:194px; }
.celebration-podium-rank-4 { grid-column:2 / span 2; }
.celebration-podium-rank-5 { grid-column:4 / span 2; }
.celebration-podium-rank-4,.celebration-podium-rank-5 { padding:12px 7px; }
.celebration-podium-rank-4 .celebration-podium-logo,.celebration-podium-rank-5 .celebration-podium-logo { width:52px; height:52px; margin:7px 0; }
.celebration-record-badge { max-width:150px; min-width:0; padding:5px 7px; border:1px solid rgba(255,215,0,.3); border-radius:10px; background:linear-gradient(135deg,rgba(255,215,0,.11),rgba(255,215,0,.025)); color:#ffe692; font-size:10px; font-weight:900; line-height:1.5; text-align:center; word-break:keep-all; text-shadow:0 0 9px rgba(255,215,0,.3); }
.celebration-mvp-name-wrap { position:relative; display:inline-block; isolation:isolate; padding:12px 24px 16px 4px; }
.celebration-mvp-name-wrap::before { content:''; position:absolute; z-index:-1; inset:-12px -16px; border-radius:50%; background:radial-gradient(ellipse,rgba(255,214,87,.15),transparent 68%); pointer-events:none; }
.celebration-mvp-name { color:#ffe58d; font-weight:900; background:linear-gradient(105deg,#f2bd45 0%,#ffe590 28%,#fff2b8 43%,#fff 48%,#fff 51%,#fff2b8 56%,#ffe590 68%,#e7ad35 100%); background-size:280% 100%; background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; filter:drop-shadow(0 0 12px rgba(255,211,86,.42)); animation:celebration-name-sheen 4s ease-in-out infinite; }
@keyframes celebration-name-sheen { 0%,16% { background-position:100% 50%; } 62%,100% { background-position:0% 50%; } }
.celebration-mvp-spark { position:absolute; width:14px; height:14px; pointer-events:none; opacity:0; animation:celebration-name-sparkle 3.1s ease-in-out infinite; }
.celebration-mvp-spark::before,.celebration-mvp-spark::after { content:''; position:absolute; top:50%; left:50%; background:linear-gradient(90deg,transparent,#fff5c6,white,#fff5c6,transparent); border-radius:50%; box-shadow:0 0 8px rgba(255,225,127,.7); }
.celebration-mvp-spark::before { width:100%; height:2px; transform:translate(-50%,-50%); }
.celebration-mvp-spark::after { width:2px; height:100%; transform:translate(-50%,-50%); }
.celebration-mvp-spark-0 { top:0; left:12%; animation-delay:0s; }
.celebration-mvp-spark-1 { top:12%; right:9%; width:18px; height:18px; animation-delay:.6s; }
.celebration-mvp-spark-2 { top:48%; left:-10px; width:11px; height:11px; animation-delay:1.2s; }
.celebration-mvp-spark-3 { bottom:1px; left:42%; animation-delay:1.8s; }
.celebration-mvp-spark-4 { top:46%; right:-2px; width:11px; height:11px; animation-delay:2.4s; }
.celebration-mvp-spark-5 { bottom:13%; left:7%; width:9px; height:9px; animation-delay:.9s; }
@keyframes celebration-name-sparkle { 0%,16%,72%,100% { opacity:0; transform:scale(.35) rotate(-12deg); } 34%,48% { opacity:1; transform:scale(1) rotate(0); } }
@media (max-width:480px) { .celebration-guild-pyramid { gap:7px; } .celebration-podium-card { border-radius:14px; padding-left:4px; padding-right:4px; } .celebration-podium-logo { width:54px; height:64px; } .celebration-podium-rank-1 .celebration-podium-logo { width:70px; height:80px; } .celebration-podium-name { font-size:12px; } .celebration-podium-score { font-size:13px; } .celebration-record-badge { max-width:110px; padding:4px; font-size:9px; } }
@media (prefers-reduced-motion:reduce) { .celebration-mvp-name { animation:none; background-position:50% 50%; } .celebration-mvp-spark { animation:none; opacity:.65; transform:none; } }
`;

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
          <div className="mt-4 space-y-4 text-sm font-semibold leading-7 text-white/85">
            <p className="break-keep">
              적은 인원은 약점이 아니었습니다. 슈퍼노바는 더 단단하고 정확한 협동으로 9월을 지배했습니다.
            </p>
            <p className="break-keep">
              특히 다른 길드가 성공하지 못했던 <span className="text-gold">영웅의 표식: 지정업적</span> 미션에서,
              이미 많은 업적을 달성해 새로운 업적을 채우기 까다로웠음에도 훌륭하게 도전을 완수한
              <span className="text-gold"> 류은우, 이태우</span>에게 큰 축하를 보냅니다.
            </p>
            <p className="break-keep">
              세션마다 서로에게 일을 떠넘기지 않고 진지하게 참여한 모든 길드원에게도 박수를 보냅니다.
              각자의 책임을 끝까지 다한 손길이 하나의 빛나는 결과를 만들었습니다.
            </p>
            <p className="break-keep">
              길드원 전원의 월간 MVP TOP 12 진출, <span className="text-gold">류은우·부희주</span>의 TOP 4 진출,
              그리고 부희주의 최종 우승까지. 함께 성장한 네 사람의 9월을 축하합니다.
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
            4월 월간MVP 후보 선정 이후 5개월만에 2번째 후보로 선정된 후 최종 우승을 거머쥐었습니다. 포기하지 않고 딛어온 성장의 서사가 가장 눈부시게 빛난 달이었습니다. 11월에 다시 한 번 좋은 기회가 오길 기원합니다.
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
          <div className="celebration-guild-pyramid mt-5">
            {[RANKINGS[1], RANKINGS[0], RANKINGS[2], RANKINGS[3], RANKINGS[4]].map((row) => (
              <div
                key={row.guild}
                className={`celebration-podium-card celebration-podium-rank-${row.rank}`}
              >
                <div className="celebration-podium-rank">
                  {row.rank === 1 && <Crown className="h-4 w-4" />}
                  <span>{row.rank}위</span>
                </div>
                <div className="celebration-podium-logo">
                  <img src={GUILD_ICONS[row.guild]} alt={`${row.guild} 길드 로고`} />
                </div>
                <div className="celebration-podium-name">{row.guild}</div>
                <div className="celebration-podium-score">{formatScore(row.score)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,17,35,0.96),rgba(11,9,20,0.98))] p-4 sm:p-5">
          <div className="text-[11px] font-black tracking-[0.18em] text-bv/85">길드의 수호신</div>
          <h3 className="mt-2 font-display text-2xl text-white">길드별 기여도 1위</h3>
          <div className="mt-4 space-y-2.5">
            {GUILD_GUARDIANS.map((row) => (
              <div key={row.guild} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/5">
                  <img src={GUILD_ICONS[row.guild]} alt="" className="h-8 w-8 object-contain" />
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0 shrink-0">
                    <div className="text-[11px] font-black tracking-[0.04em] text-white/75">{row.guild}</div>
                    <div className="font-black text-white">{row.name}</div>
                  </div>
                  {row.name === '류은우' && (
                    <div className="celebration-record-badge">
                      역대 최고 개인기여도 기록실 등재
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-lg text-gold">{formatScore(row.score)}</div>
                  <div className="text-[11px] font-bold text-white/75">개인 기여도</div>
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
            <div className="celebration-mvp-name-wrap mt-4">
              <div className="celebration-mvp-name font-display text-5xl leading-none sm:text-6xl">부희주</div>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <span key={index} className={`celebration-mvp-spark celebration-mvp-spark-${index}`} aria-hidden="true" />
              ))}
            </div>

            <div className="mt-5 rounded-[18px] border border-white/10 bg-black/16 px-4 py-3 text-base font-black text-gold">
              탄생 화신 「딛고 일어서는 자」
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold leading-7 text-white/84 break-keep">
                2026년 월간브랜드가치 상승량 최고점 경신
              </div>
              <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold leading-7 text-white/84 break-keep">
                기록실 비상의 궤적 역대 3위에 등재
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
            <h3 className="font-display text-xl text-white">9월 월간 MVP TOP 4</h3>
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
