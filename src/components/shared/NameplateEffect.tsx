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
          <svg className="nameplate-fx__constellation" viewBox="0 0 360 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <g className="nameplate-fx__astral-seal">
              <path className="nameplate-fx__orbit" pathLength="1" d="M180 5a55 55 0 1 1 0 110a55 55 0 1 1 0-110" />
              <path className="nameplate-fx__triangle" pathLength="1" d="M180 12L221.57 84L138.43 84Z" style={style({ '--draw-delay': '.3s' })} />
              <path className="nameplate-fx__triangle" pathLength="1" d="M180 108L138.43 36L221.57 36Z" style={style({ '--draw-delay': '1.2s' })} />
              <path className="nameplate-fx__inner" pathLength="1" d="M180 36L200.78 48L200.78 72L180 84L159.22 72L159.22 48Z" />
              {[[180,12],[221.57,84],[138.43,84],[180,108],[138.43,36],[221.57,36]].map(([cx, cy], index) => (
                <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy})`}>
                  <g className="nameplate-fx__star" style={style({ '--node-delay': `${.28 + index * .32}s`, '--node-idle-delay': `${3.7 + index * .23}s` })}>
                    <circle className="nameplate-fx__star-halo" r="5.5" />
                    <path className="nameplate-fx__star-cut" d="M0-5L1.15-1.15L5 0L1.15 1.15L0 5L-1.15 1.15L-5 0L-1.15-1.15Z" />
                    <circle className="nameplate-fx__star-core" r="1.15" />
                  </g>
                </g>
              ))}
              <g transform="translate(180 60)">
                <g className="nameplate-fx__star nameplate-fx__star--heart" style={style({ '--node-delay': '2.45s', '--node-idle-delay': '4.2s' })}>
                  <path className="nameplate-fx__star-cut" d="M0-11L2-2L11 0L2 2L0 11L-2 2L-11 0L-2-2Z" />
                  <circle className="nameplate-fx__star-core" r="2" />
                </g>
              </g>
            </g>
            <path className="nameplate-fx__wing" pathLength="1" d="M125 60H72L48 44L24 60M235 60H288L312 76L336 60" />
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
