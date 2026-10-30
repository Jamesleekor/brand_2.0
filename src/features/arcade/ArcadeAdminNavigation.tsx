import { Link } from 'react-router-dom';

export type ArcadeAdminGame = 'focus' | 'pure' | 'rakaruka' | 'periods';
export type ArcadeAdminSection = 'overview' | 'verification' | 'official' | 'records' | 'audit' | 'progress' | 'periods';

type Props = {
  activeGame: ArcadeAdminGame;
  activeSection: ArcadeAdminSection;
};

const GAME_TABS = [
  { key: 'focus', icon: '⚡', eyebrow: 'GAME 01', title: '집중 반응', subtitle: '집중력 · 기록 인증' },
  { key: 'pure', icon: '⏱️', eyebrow: 'GAME 02', title: '순수 반응 속도', subtitle: '반응속도 · 기록 인증' },
  { key: 'rakaruka', icon: '🛡️', eyebrow: 'GAME 03', title: '라카루카', subtitle: '대전 · 난이도 관리' },
] as const;

const COMMON_TAB = { key: 'periods', icon: '🗓️', eyebrow: 'SHARED', title: '공통 기간 관리', subtitle: '랭킹 기간 · 월간 확정' } as const;

const GAME_PANELS = [
  { key: 'overview', title: '운영 개요' },
  { key: 'verification', title: '공인 도전' },
  { key: 'records', title: '기록 · 순위' },
  { key: 'audit', title: '감사 기록' },
] as const;

const RAKARUKA_PANELS = [
  { key: 'overview', title: '운영 개요' },
  { key: 'official', title: '공인 도전' },
  { key: 'records', title: '기록 · 순위' },
  { key: 'progress', title: '난이도 · 진행도' },
] as const;

export function ArcadeAdminNavigation({ activeGame, activeSection }: Props) {
  const panels = activeGame === 'periods' ? [] : activeGame === 'rakaruka' ? RAKARUKA_PANELS : GAME_PANELS;
  const tabs = [...GAME_TABS, COMMON_TAB];
  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black tracking-[0.2em] text-gold">B.R.A.N.D 2.0 · TEACHER CONTROL</div>
          <h1 className="mt-1 font-display text-2xl text-white sm:text-3xl">🕹️ Arcade 운영 센터</h1>
          <p className="mt-1 text-sm font-semibold leading-6 text-[#f2e9d8]">게임별 기록과 인증을 관리하고, 모든 게임의 기간·월간 확정은 공통 화면에서 처리합니다.</p>
        </div>
        <Link to="/teacher/guild/scores" className="btn-secondary self-start text-xs">📊 Guild 2 점수 보기</Link>
      </div>
      <nav aria-label="아케이드 게임 선택" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tabs.map((tab) => {
          const active = tab.key === activeGame;
          const target = tab.key === 'periods' ? '/teacher/arcade?game=periods' : `/teacher/arcade?game=${tab.key}&panel=overview`;
          return (
            <Link
              key={tab.key}
              to={target}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[90px] flex-col justify-center rounded-card-lg border px-3 py-3 text-left transition-colors sm:px-4 ${active ? 'border-gold/75 bg-gold/15 shadow-card' : 'border-line bg-bg-card/70 hover:border-gold/40 hover:bg-bg-deep'}`}
            >
              <span className={`text-[10px] font-black tracking-[0.14em] ${active ? 'text-gold' : 'text-[#f1e0bd]'}`}>{tab.eyebrow}</span>
              <span className="mt-1 text-sm font-black text-white sm:text-base">{tab.icon} {tab.title}</span>
              <span className="mt-1 text-[11px] font-semibold text-[#f2e9d8]">{tab.subtitle}</span>
            </Link>
          );
        })}
      </nav>
      {activeGame !== 'periods' && (
        <nav aria-label="게임별 운영 메뉴" className="flex flex-wrap gap-2 rounded-card-lg border border-line bg-bg-deep/60 p-2">
          {panels.map((panel) => {
            const active = activeSection === panel.key;
            return (
              <Link
                key={panel.key}
                to={`/teacher/arcade?game=${activeGame}&panel=${panel.key}`}
                aria-current={active ? 'page' : undefined}
                className={`min-h-10 rounded-card-md border px-3 py-2 text-center text-xs font-black transition-colors sm:text-sm ${active ? 'border-gold/70 bg-gold/15 text-white' : 'border-transparent text-[#f2e9d8] hover:border-line hover:bg-bg-card'}`}
              >
                {panel.title}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
