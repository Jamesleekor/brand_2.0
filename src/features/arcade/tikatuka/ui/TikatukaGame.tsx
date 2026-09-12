import type { ComponentProps, ReactNode } from 'react';
import { TikatukaGame as TikatukaGameCore } from './TikatukaGameCore';
import './tikatuka-effects.css';

export function TikatukaGame(props: ComponentProps<typeof TikatukaGameCore>) {
  return (
    <div className="space-y-4">
      <TikatukaGameCore {...props} />
      <RakarukaRulesGuide />
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
            내 보드에 <b className="text-white">일반 주사위</b>를 놓았을 때, 상대의 <b className="text-white">같은 위치 줄</b>에 같은 숫자의 일반 주사위가 있으면 그 주사위를 전부 제거합니다.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Rule title="💥 알까기란?">
            <b>일반 주사위를 내 보드에 놓은 직후</b>, 상대 보드의 <b>같은 위치 줄</b>을 확인합니다. 그 줄에 방금 놓은 것과 <b>같은 숫자의 일반 주사위</b>가 있으면 전부 제거합니다.
          </Rule>
          <Rule title="🎯 예: 숫자 4">
            내가 <b>중단</b>에 일반 4를 놓았고 상대 <b>중단</b>에 일반 4가 2개 있다면 둘 다 제거됩니다. 상대 상단·하단의 4는 건드리지 않습니다.
          </Rule>
          <Rule title="🛡️ 실드는 제거되지 않음">
            같은 숫자라도 <b>실드 주사위는 알까기에 면역</b>입니다. 상대 줄에 실드 4만 있고 일반 4가 없다면 알까기 성공이 아니며 새 실드도 얻지 못합니다.
          </Rule>
          <Rule title="✨ 알까기 성공 보상">
            일반 주사위를 1개든 3개든 실제로 제거하면 <b>실드는 딱 1개</b> 얻습니다. 제거에 사용한 숫자와 같은 실드가 <b>다음 자기 턴</b>에 등장합니다.
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
          <Rule title="👀 상대 행동 읽는 법">
            상대는 <b>생각 중 → 굴림 → 타짜/홀드 여부 → 배치 → 알까기/실드 결과</b> 순서로 행동합니다. 각 장면이 끝나기 전에는 다음 행동으로 넘어가지 않습니다.
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
