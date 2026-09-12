import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { GameEvent } from '../engine';
import { TikatukaGame as TikatukaGameCore } from './TikatukaGameCore';
import { getEventLogText, RAKARUKA_UI_EVENT, rowLabel } from './presentation';
import './tikatuka-effects.css';

type KnockEvent = Extract<GameEvent, { type: 'DICE_KNOCKED' }>;

interface HistoryEntry {
  id: number;
  text: string;
  actor: 'player' | 'ai' | 'system';
}

function eventActor(event: GameEvent): HistoryEntry['actor'] {
  if ('side' in event) return event.side === 'player' ? 'player' : 'ai';
  if (event.type === 'DICE_KNOCKED') return event.attackingSide === 'player' ? 'player' : 'ai';
  return 'system';
}

export function TikatukaGame(props: ComponentProps<typeof TikatukaGameCore>) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [impact, setImpact] = useState<KnockEvent | null>(null);
  const sequenceRef = useRef(0);
  const impactTimerRef = useRef<number | null>(null);
  const gameEndedRef = useRef(false);
  const seenEventsRef = useRef(new WeakSet<object>());

  useEffect(() => {
    const handleEvent = (raw: Event) => {
      const event = (raw as CustomEvent<GameEvent>).detail;
      if (!event) return;

      // React development StrictMode may replay an effect. The engine event object is
      // the same reference, so record/animate it only once without suppressing later
      // legitimate events that merely have identical values.
      if (seenEventsRef.current.has(event)) return;
      seenEventsRef.current.add(event);

      if (event.type === 'DIE_ROLLED' && gameEndedRef.current) {
        setHistory([]);
        sequenceRef.current = 0;
        gameEndedRef.current = false;
        seenEventsRef.current = new WeakSet<object>();
        seenEventsRef.current.add(event);
      }

      const text = getEventLogText(event);
      if (text) {
        sequenceRef.current += 1;
        const entry: HistoryEntry = { id: sequenceRef.current, text, actor: eventActor(event) };
        setHistory((current) => [...current.slice(-19), entry]);
      }

      if (event.type === 'DICE_KNOCKED') {
        setImpact(event);
        if (impactTimerRef.current !== null) window.clearTimeout(impactTimerRef.current);
        impactTimerRef.current = window.setTimeout(() => {
          setImpact(null);
          impactTimerRef.current = null;
        }, 2_700);
      }

      if (event.type === 'GAME_FINISHED') gameEndedRef.current = true;
    };

    window.addEventListener(RAKARUKA_UI_EVENT, handleEvent as EventListener);
    return () => {
      window.removeEventListener(RAKARUKA_UI_EVENT, handleEvent as EventListener);
      if (impactTimerRef.current !== null) window.clearTimeout(impactTimerRef.current);
    };
  }, []);

  return (
    <div className="relative space-y-4">
      <TikatukaGameCore {...props} />
      <RakarukaActionHistory entries={history} />
      <RakarukaRulesGuide />
      {impact && <KnockImpactOverlay event={impact} />}
    </div>
  );
}

function RakarukaActionHistory({ entries }: { entries: HistoryEntry[] }) {
  const visible = entries.slice(-12).reverse();
  return (
    <section className="overflow-hidden rounded-card-xl border border-white/15 bg-[#0a0e15] shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-5 py-4">
        <div>
          <h3 className="text-lg font-black text-white">📜 행동 기록</h3>
          <p className="mt-1 text-sm font-semibold text-slate-300">방금 무슨 일이 있었는지 놓쳤다면 여기에서 다시 확인할 수 있습니다.</p>
        </div>
        <span className="rounded-pill border border-white/15 bg-white/5 px-3 py-1 text-xs font-black text-slate-300">최근 12개</span>
      </div>
      <div className="max-h-72 overflow-y-auto p-3">
        {!visible.length ? (
          <div className="rounded-card-md border border-white/10 bg-black/20 p-4 text-sm font-semibold text-slate-400">게임을 시작하면 당신과 상대 AI의 행동이 순서대로 기록됩니다.</div>
        ) : (
          <div className="space-y-2">
            {visible.map((entry) => (
              <div
                key={entry.id}
                className={`grid grid-cols-[42px_1fr] items-start gap-3 rounded-card-md border px-3 py-3 ${entry.actor === 'ai' ? 'border-rose-400/25 bg-rose-400/[0.06]' : entry.actor === 'player' ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}
              >
                <span className="text-xs font-black text-slate-500">#{entry.id}</span>
                <span className={`text-sm font-bold leading-6 ${entry.actor === 'ai' ? 'text-rose-100' : entry.actor === 'player' ? 'text-emerald-100' : 'text-slate-200'}`}>{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function KnockImpactOverlay({ event }: { event: KnockEvent }) {
  const value = event.attackingDie?.value ?? event.removedDice[0]?.value ?? '?';
  return (
    <div className="rakaruka-knock-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="rakaruka-knock-card w-full max-w-xl rounded-3xl border border-rose-300/50 bg-[#12090d]/95 p-6 text-center shadow-2xl backdrop-blur-xl">
        <div className="text-sm font-black tracking-[0.18em] text-rose-300">💥 알까기</div>
        <div className="mt-2 text-xl font-black text-white">{event.attackingSide === 'player' ? '당신' : '상대 AI'}이(가) {event.targetSide === 'player' ? '당신' : '상대'} {rowLabel(event.row)}을 공격!</div>
        <div className="mt-6 flex items-center justify-center gap-5 sm:gap-8">
          <div className="rakaruka-attack-die flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-cyan-300 bg-cyan-400/15 font-display text-4xl font-black text-white shadow-[0_0_28px_rgba(34,211,238,0.35)]">{value}</div>
          <div className="text-3xl font-black text-rose-300">➜</div>
          <div className="flex gap-2">
            {event.removedDice.map((die) => (
              <div key={die.id} className="rakaruka-target-die flex h-16 w-16 items-center justify-center rounded-xl border-2 border-rose-300/70 bg-rose-400/15 font-display text-3xl font-black text-white">{die.value}</div>
            ))}
          </div>
        </div>
        <div className="mt-5 text-base font-black text-yellow-200">같은 숫자 일반 주사위 {event.removedDice.length}개 제거 · 공격 주사위는 보드에 놓이지 않습니다</div>
      </div>
    </div>
  );
}

function RakarukaRulesGuide() {
  return (
    <details open className="overflow-hidden rounded-card-xl border border-gold/30 bg-bg-deep/90">
      <summary className="cursor-pointer px-5 py-4 text-lg font-black text-yellow-200">
        📖 처음이라면 꼭 읽기 · 알까기 / 실드 / 타짜 / 홀드
      </summary>
      <div className="border-t border-white/10 p-5">
        <div className="mb-4 rounded-card-md border border-danger/35 bg-danger/10 p-4">
          <div className="text-base font-black text-rose-200">💥 알까기 핵심 한 줄</div>
          <p className="mt-2 text-base font-semibold leading-7 text-slate-100">
            현재 <b className="text-white">일반 주사위와 같은 숫자</b>가 상대 줄에 있다면, 내 보드에 놓는 대신 <b className="text-white">그 상대 줄을 클릭해 공격</b>할 수 있습니다. 공격 주사위는 보드에 들어가지 않고 소모됩니다.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Rule title="💥 알까기란?">
            일반 주사위가 나온 턴에는 두 선택지가 있습니다. <b>내 빈 줄에 정상 배치</b>하거나, 상대 줄에 같은 숫자의 일반 주사위가 있다면 <b>그 줄을 알까기로 공격</b>합니다. 둘을 동시에 할 수는 없습니다.
          </Rule>
          <Rule title="🎯 예: 숫자 4">
            내가 일반 4를 들고 있고 상대 <b>중단</b>에 일반 4가 2개 있다면 상대 중단에 <b>‘알까기 가능’</b> 표시가 뜹니다. 그 줄을 누르면 내 4는 배치되지 않고 상대의 일반 4 두 개를 제거합니다.
          </Rule>
          <Rule title="🔥 더블·트리플을 깨기">
            상대 줄에 실드 없이 같은 숫자가 2개·3개 연결되어 있다면 한 번의 알까기로 <b>그 숫자의 일반 주사위를 전부 제거</b>할 수 있습니다. 큰 더블·트리플을 한 번에 무너뜨리는 것이 알까기의 핵심입니다.
          </Rule>
          <Rule title="🛡️ 실드는 제거되지 않음">
            같은 숫자라도 <b>실드 주사위는 알까기에 면역</b>입니다. 일반 4 두 개와 실드 4 한 개가 함께 있다면 일반 4 두 개만 사라지고 실드 4는 남습니다.
          </Rule>
          <Rule title="✨ 알까기 성공 보상">
            일반 주사위를 1개든 3개든 실제로 제거하면 <b>실드는 딱 1개</b> 얻습니다. 공격에 사용한 숫자와 같은 실드가 <b>다음 자기 턴</b>에 등장합니다.
          </Rule>
          <Rule title="↔️ 실드 배치">
            실드는 <b>내 보드 또는 상대 보드의 빈 줄</b> 어디에나 놓을 수 있습니다. 상대 보드에 놓으면 그 주사위의 점수와 더블·트리플은 <b>상대 점수</b>로 계산됩니다.
          </Rule>
          <Rule title="🃏 타짜">
            현재 <b>일반 주사위</b>를 버리고 새 일반 주사위를 한 번 다시 굴립니다. 같은 숫자가 다시 나올 수도 있고, <b>실드 주사위에는 사용할 수 없습니다.</b>
          </Rule>
          <Rule title="✋ 홀드">
            현재 주사위를 그대로 보관하고 이번 턴을 넘깁니다. 다음 자기 턴에는 새로 굴리지 않고 <b>보관한 그 주사위가 가장 먼저</b> 돌아옵니다. 실드도 홀드할 수 있습니다.
          </Rule>
          <Rule title="⚡ 더블 · 트리플">
            한 줄에서 같은 눈 2개는 그 눈의 합계가 <b>3배</b>, 같은 눈 3개는 <b>5배</b>입니다. 실드도 같은 숫자라면 더블·트리플 계산에 완전히 포함됩니다.
          </Rule>
          <Rule title="📜 행동 기록">
            화면 아래 행동 기록에는 굴림, 배치, 타짜, 홀드, 알까기, 실드 획득이 순서대로 남습니다. 상대 행동을 놓쳤다면 기록을 확인하면 됩니다.
          </Rule>
          <Rule title="🏁 승리 판정">
            상단·중단·하단에서 더 많은 줄을 이기면 승리합니다. 줄 승수가 같으면 양쪽 주사위의 <b>원래 눈 합계</b>가 높은 쪽이 승리하고, 그것도 같으면 무승부입니다.
          </Rule>
        </div>
      </div>
    </details>
  );
}

function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-card-md border border-white/10 bg-black/20 p-4">
      <div className="text-base font-black text-white">{title}</div>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-200">{children}</p>
    </div>
  );
}
