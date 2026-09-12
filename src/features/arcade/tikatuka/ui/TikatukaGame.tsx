import type { ComponentProps, ReactNode } from 'react';
import { TikatukaGame as TikatukaGameCore } from './TikatukaGameCore';

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
    <details open className="overflow-hidden rounded-card-xl border border-gold/25 bg-bg-deep/85">
      <summary className="cursor-pointer px-5 py-4 text-base font-black text-yellow-200">
        📖 알까기 · 실드 주사위 상세 규칙
      </summary>
      <div className="grid gap-3 border-t border-white/10 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Rule title="💥 알까기란?">
          <b>일반 주사위를 내 보드에 놓은 직후</b>, 상대 보드의 <b>같은 위치 줄</b>을 확인합니다. 그 줄에 방금 놓은 것과 <b>같은 숫자의 일반 주사위</b>가 있으면 전부 제거합니다.
        </Rule>
        <Rule title="🎯 예: 숫자 4">
          내가 <b>중단</b>에 일반 4를 놓았고 상대 <b>중단</b>에 일반 4가 2개 있다면 둘 다 제거됩니다. 상대 상단·하단의 4는 건드리지 않습니다.
        </Rule>
        <Rule title="🛡️ 실드는 제거되지 않음">
          같은 숫자라도 <b>실드 주사위는 알까기에 면역</b>입니다. 상대 줄에 실드 4만 있고 일반 4가 없다면 알까기 성공이 아니며 새 실드도 얻지 못합니다.
        </Rule>
        <Rule title="✨ 성공 보상">
          일반 주사위를 1개든 3개든 실제로 제거하면 <b>실드는 딱 1개</b> 얻습니다. 제거에 사용한 숫자와 같은 실드가 <b>다음 자기 턴</b>에 등장합니다.
        </Rule>
        <Rule title="↔️ 실드 배치">
          실드는 <b>내 보드 또는 상대 보드의 빈칸</b> 어디에나 놓을 수 있습니다. 상대 보드에 놓으면 그 주사위의 점수와 더블·트리플은 <b>상대 점수</b>로 계산됩니다.
        </Rule>
        <Rule title="✋ 실드와 특수기술">
          실드는 <b>홀드 가능</b>하지만 <b>타짜 사용은 불가</b>합니다. 홀드한 주사위가 있으면 다음 턴에는 실드 보상이나 새 굴림보다 홀드 주사위를 먼저 사용합니다.
        </Rule>
        <Rule title="⚡ 더블 · 트리플">
          한 줄에서 같은 눈 2개는 그 눈의 합계가 <b>3배</b>, 같은 눈 3개는 <b>5배</b>입니다. 실드도 같은 숫자라면 더블·트리플 계산에 완전히 포함됩니다.
        </Rule>
        <Rule title="👀 화면 읽는 법">
          상대는 먼저 <b>생각 중</b> 표시가 나오고, 굴림 → 특수기술 → 배치 → 알까기/실드 결과 순서로 보여줍니다. 금빛 <b>실드</b> 표식과 더블·트리플 배지를 확인하세요.
        </Rule>
      </div>
    </details>
  );
}

function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-card-md border border-white/10 bg-black/20 p-4">
      <div className="text-sm font-black text-white">{title}</div>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-200">{children}</p>
    </div>
  );
}
