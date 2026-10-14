import type { CSSProperties, ReactNode } from 'react';

import type { OwnedNameplateEffect } from '@/hooks/useNameplateEffects';
import { cn } from '@/lib/utils/cn';
import './nameplateEffect.css';

export type NameplateEffectVariant =
  | 'friend'
  | 'guild'
  | 'rankingChampion'
  | 'rankingPodium'
  | 'rankingElite'
  | 'rankingTopTen'
  | 'rankingStandard'
  | 'raidLobby'
  | 'raidBroadcast'
  | 'preview';

type Props = {
  effect: OwnedNameplateEffect | null | undefined;
  children: ReactNode;
  className?: string;
  variant: NameplateEffectVariant;
  replayKey?: string | number;
};

const RESIDUE_POINTS = [
  [4, 14, 0], [18, 96, -0.7], [39, 3, -1.4], [66, 95, -2.1],
  [90, 12, -2.8], [97, 80, -3.5], [75, 4, -4.2], [28, 98, -4.9],
] as const;

const SHARDS = [
  [-128, -70, -18, 0], [94, -82, 22, 1], [-154, 8, 31, 2], [150, -6, -28, 3],
  [-104, 74, 16, 4], [118, 78, -20, 5], [-28, -106, 34, 6], [30, 108, -30, 7],
] as const;

function style(values: Record<string, string | number>): CSSProperties {
  return values as unknown as CSSProperties;
}

export function NameplateEffect({ effect, children, className, variant, replayKey }: Props) {
  if (!effect) return <>{children}</>;

  return (
    <div
      key={replayKey}
      className={cn('nameplate-fx relative isolate min-w-0', className)}
      data-nameplate-effect={effect.effectKind.toLowerCase()}
      data-nameplate-variant={variant}
    >
      <div className="nameplate-fx__content relative z-10 min-w-0">{children}</div>

      {effect.effectKind === 'CORONATION' && (
        <>
          <span className="nameplate-fx__pillar" aria-hidden="true" />
          <span className="nameplate-fx__rays" aria-hidden="true" />
          <span className="nameplate-fx__shockwave nameplate-fx__shockwave--one" aria-hidden="true" />
          <span className="nameplate-fx__shockwave nameplate-fx__shockwave--two" aria-hidden="true" />
        </>
      )}

      {effect.effectKind === 'CONSTELLATION' && (
        <>
          <span className="nameplate-fx__nebula" aria-hidden="true" />
          <svg className="nameplate-fx__constellation" viewBox="0 0 360 120" preserveAspectRatio="none" aria-hidden="true">
            <path pathLength="1" d="M8 88L44 24L94 13L151 42L212 9L273 27L348 73L314 108L252 103L183 89L111 110L45 101Z" />
            {[['8','88'],['44','24'],['94','13'],['151','42'],['212','9'],['273','27'],['348','73'],['314','108'],['252','103'],['183','89'],['111','110'],['45','101']].map(([cx, cy], index) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" style={style({ '--node-delay': `${0.16 + index * 0.1}s`, '--node-idle-delay': `${2.9 - index * 0.35}s` })} />
            ))}
          </svg>
          <span className="nameplate-fx__comet" aria-hidden="true" />
        </>
      )}

      {effect.effectKind === 'SHARD_ASSEMBLY' && (
        <div className="nameplate-fx__shards" aria-hidden="true">
          {SHARDS.map(([x, y, rotation, index]) => (
            <span
              key={index}
              style={style({
                '--shard-x': `${x}px`,
                '--shard-y': `${y}px`,
                '--shard-r': `${rotation}deg`,
                '--shard-index': index,
                '--shard-delay': `${0.18 + index * 0.105}s`,
                '--shard-left': `${(index % 4) * 25}%`,
                '--shard-top': `${Math.floor(index / 4) * 50}%`,
              })}
            />
          ))}
          <i className="nameplate-fx__seam" />
        </div>
      )}

      {effect.effectKind === 'ROYAL_OPENING' && (
        <>
          <span className="nameplate-fx__spotlight" aria-hidden="true" />
          <span className="nameplate-fx__curtain nameplate-fx__curtain--left" aria-hidden="true" />
          <span className="nameplate-fx__curtain nameplate-fx__curtain--right" aria-hidden="true" />
          <span className="nameplate-fx__crown" aria-hidden="true">♛</span>
        </>
      )}

      <div className="nameplate-fx__residue" aria-hidden="true">
        {RESIDUE_POINTS.map(([x, y, delay], index) => (
          <i key={index} style={style({ '--particle-x': `${x}%`, '--particle-y': `${y}%`, '--particle-delay': `${delay}s` })} />
        ))}
      </div>
      <span className="nameplate-fx__afterglow" aria-hidden="true" />
    </div>
  );
}
