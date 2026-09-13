import { AI_SEARCH_LIMITS } from '../engine/config';
import type { GameState } from '../engine/types';
import { createAIStateHash } from './stateHash';

export type AISearchAbortReason = 'cycle' | 'node_limit' | 'time_limit';

export interface AISearchLimits {
  maxNodes: number;
  hardTimeBudgetMs: number;
}

export interface AISearchContext {
  readonly limits: AISearchLimits;
  readonly startedAtMs: number;
  readonly now: () => number;
  readonly activePath: Set<string>;
  readonly memo: Map<string, number>;
  nodesVisited: number;
  abortedBy: AISearchAbortReason | null;
}

export interface AISearchVisit {
  ok: boolean;
  hash: string;
  reason?: AISearchAbortReason;
}

export function createAISearchContext(options?: {
  limits?: Partial<AISearchLimits>;
  now?: () => number;
}): AISearchContext {
  const now = options?.now ?? (() => Date.now());
  return {
    limits: {
      maxNodes: options?.limits?.maxNodes ?? AI_SEARCH_LIMITS.maxNodes,
      hardTimeBudgetMs: options?.limits?.hardTimeBudgetMs ?? AI_SEARCH_LIMITS.hardTimeBudgetMs,
    },
    startedAtMs: now(),
    now,
    activePath: new Set<string>(),
    memo: new Map<string, number>(),
    nodesVisited: 0,
    abortedBy: null,
  };
}

export function enterAISearchState(context: AISearchContext, state: GameState): AISearchVisit {
  const hash = createAIStateHash(state);

  if (context.activePath.has(hash)) {
    context.abortedBy ??= 'cycle';
    return { ok: false, hash, reason: 'cycle' };
  }
  if (context.nodesVisited >= context.limits.maxNodes) {
    context.abortedBy ??= 'node_limit';
    return { ok: false, hash, reason: 'node_limit' };
  }
  if (context.now() - context.startedAtMs >= context.limits.hardTimeBudgetMs) {
    context.abortedBy ??= 'time_limit';
    return { ok: false, hash, reason: 'time_limit' };
  }

  context.nodesVisited += 1;
  context.activePath.add(hash);
  return { ok: true, hash };
}

export function leaveAISearchState(context: AISearchContext, hash: string): void {
  context.activePath.delete(hash);
}
