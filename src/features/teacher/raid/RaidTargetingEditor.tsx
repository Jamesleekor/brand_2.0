// RAID_TARGETING_V1_20261103
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

import {
  raidAdminRpc,
  type RaidStatus,
  type TeacherRaidPhase,
} from '@/lib/rpc/raid_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import {
  type RaidTargetingMode,
  type RaidTargetingZone,
  normalizeRaidTargeting,
  raidTargetingModeLabel,
} from '@/features/raid/targeting/raidTargeting';
import { cn } from '@/lib/utils/cn';

type EditorRect = Pick<RaidTargetingZone, 'x' | 'y' | 'width' | 'height'>;

const DEFAULT_RECTS: Record<Exclude<RaidTargetingMode, 'BODY'>, EditorRect> = {
  DOMAIN: { x: 0.30, y: 0.12, width: 0.40, height: 0.46 },
  ANCHOR: { x: 0.38, y: 0.18, width: 0.24, height: 0.36 },
};

function defaultRectForMode(mode: RaidTargetingMode): EditorRect | null {
  if (mode === 'BODY') return null;
  return { ...DEFAULT_RECTS[mode] };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round6(value: number) {
  return Number(value.toFixed(6));
}

function readMode(phase: TeacherRaidPhase): RaidTargetingMode {
  const raw = phase.metadata?.targeting_v1;
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const value = String(row.mode ?? '').toUpperCase();
  return value === 'DOMAIN' || value === 'ANCHOR' ? value : 'BODY';
}

function readStoredRect(phase: TeacherRaidPhase): EditorRect | null {
  const zone = phase.hit_zones.find((item) => item.zone_key === 'PRIMARY_TARGET');
  if (!zone) return null;
  const rect = { x: Number(zone.x), y: Number(zone.y), width: Number(zone.width), height: Number(zone.height) };
  if (!Object.values(rect).every(Number.isFinite)) return null;
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) return null;
  return rect;
}

function rectKey(rect: EditorRect | null) {
  return rect ? `${rect.x}:${rect.y}:${rect.width}:${rect.height}` : 'none';
}

export default function RaidTargetingEditor({
  raidId,
  raidStatus,
  phase,
  onSaved,
}: {
  raidId: number;
  raidStatus: RaidStatus;
  phase: TeacherRaidPhase | null;
  onSaved: () => void | Promise<void>;
}) {
  const editable = raidStatus === 'DRAFT' || raidStatus === 'LOBBY_OPEN';
  const initialMode = phase ? readMode(phase) : 'BODY';
  const initialRect = phase ? readStoredRect(phase) : null;
  const [mode, setMode] = useState<RaidTargetingMode>(initialMode);
  const [rect, setRect] = useState<EditorRect | null>(
    initialRect ?? defaultRectForMode(initialMode),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const persistedKey = `${phase?.id ?? 'none'}:${phase ? readMode(phase) : 'BODY'}:${rectKey(phase ? readStoredRect(phase) : null)}`;

  useEffect(() => {
    if (!phase) {
      setMode('BODY');
      setRect(null);
      return;
    }
    const nextMode = readMode(phase);
    const stored = readStoredRect(phase);
    setMode(nextMode);
    setRect(stored ?? defaultRectForMode(nextMode));
    setMessage(null);
  }, [persistedKey, phase]);

  const publicPreview = useMemo(() => normalizeRaidTargeting({
    mode,
    valid: mode === 'BODY' || rect !== null,
    primary_zone: mode === 'BODY' ? null : rect,
  }), [mode, rect]);

  const changeMode = (next: RaidTargetingMode) => {
    setMode(next);
    setMessage(null);
    if (next !== 'BODY' && !rect) setRect(defaultRectForMode(next));
  };

  const eventPoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
      y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editable || mode === 'BODY') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = eventPoint(event);
    dragStartRef.current = point;
    setRect({ x: point.x, y: point.y, width: 0.04, height: 0.04 });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !editable || mode === 'BODY') return;
    const current = eventPoint(event);
    const start = dragStartRef.current;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.max(0.04, Math.abs(current.x - start.x));
    const height = Math.max(0.04, Math.abs(current.y - start.y));
    setRect({
      x: round6(clamp(x, 0, 0.96)),
      y: round6(clamp(y, 0, 0.96)),
      width: round6(Math.min(width, 1 - x)),
      height: round6(Math.min(height, 1 - y)),
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
  };

  const updatePercent = (key: keyof EditorRect, value: string) => {
    if (!rect) return;
    const parsed = Number(value) / 100;
    if (!Number.isFinite(parsed)) return;
    setRect((current) => {
      if (!current) return current;
      const next = { ...current, [key]: parsed };
      next.x = clamp(next.x, 0, 0.99);
      next.y = clamp(next.y, 0, 0.99);
      next.width = clamp(next.width, 0.01, 1 - next.x);
      next.height = clamp(next.height, 0.01, 1 - next.y);
      return {
        x: round6(next.x), y: round6(next.y), width: round6(next.width), height: round6(next.height),
      };
    });
  };

  const save = async () => {
    if (!phase || !editable || saving) return;
    if (mode !== 'BODY' && !rect) {
      setMessage('공격 영역을 먼저 지정해주세요.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await raidAdminRpc.saveTargeting(
        supabase,
        raidId,
        phase.phase_no,
        mode === 'BODY'
          ? { mode }
          : {
              mode,
              x: rect!.x,
              y: rect!.y,
              width: rect!.width,
              height: rect!.height,
              show_initial_guide_ms: 1500,
              show_miss_guide_ms: 900,
              miss_repeat_threshold: 3,
            },
      );
      if (result.success === false) {
        setMessage(`저장 실패: ${result.error}`);
        return;
      }
      setMessage(`${raidTargetingModeLabel(mode)} 설정을 저장했습니다.`);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!phase) {
    return (
      <section className="rounded-card-lg border border-amber-300/25 bg-amber-500/5 p-5">
        <div className="text-sm font-black text-amber-100">🎯 C·D 타입 공격 판정</div>
        <p className="mt-2 text-xs font-bold text-cyan-100">1페이즈를 먼저 저장한 뒤 공격 영역을 설정할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <section className="rounded-card-lg border border-cyan-300/25 bg-bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black tracking-[0.14em] text-cyan-200">TARGETING V1 · C/D TYPE</div>
          <h3 className="mt-1 text-lg font-black text-white">🎯 공격 판정 방식</h3>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-amber-100">
            A/B는 기존 직접 공격을 유지하고, C는 지배 영역, D는 핵심 표적 안에서만 기본 공격이 인정됩니다.
            패턴의 약점·마력핵 등은 이 영역 밖에서도 정상 공격됩니다.
          </p>
        </div>
        {!editable ? (
          <span className="rounded-pill border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100">
            전투 시작 후 설정 고정
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {([
          ['BODY', 'A/B · 직접 공격', '기존 방식 · 화면 전체 공격'],
          ['DOMAIN', 'C · 영역전', '환경의 넓은 지배 영역 공격'],
          ['ANCHOR', 'D · 표적전', '원거리 거대 보스 핵심 부위 공격'],
        ] as const).map(([value, title, description]) => (
          <button
            key={value}
            type="button"
            disabled={!editable}
            onClick={() => changeMode(value)}
            className={cn(
              'rounded-card-md border p-3 text-left transition disabled:opacity-45',
              mode === value
                ? 'border-yellow-300/65 bg-yellow-400/10'
                : 'border-cyan-300/20 bg-bg-deep hover:border-cyan-300/45',
            )}
          >
            <div className="text-sm font-black text-white">{title}</div>
            <div className="mt-1 text-[11px] font-bold text-cyan-100">{description}</div>
          </button>
        ))}
      </div>

      {mode !== 'BODY' ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
          <div>
            <div className="mb-2 text-xs font-black text-yellow-100">
              이미지 위를 드래그해서 {mode === 'DOMAIN' ? '지배 영역' : '핵심 표적'}을 지정
            </div>
            <div
              className="relative aspect-video overflow-hidden rounded-card-lg border border-cyan-300/30 bg-black touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {phase.loop_video_url ? (
                <video
                  src={phase.loop_video_url}
                  muted
                  autoPlay
                  loop
                  playsInline
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
              ) : phase.image_url ? (
                <img
                  src={phase.image_url}
                  alt=""
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-amber-100">
                  보스 이미지 또는 IDLE 영상이 필요합니다.
                </div>
              )}

              {rect ? (
                <div
                  className={cn(
                    'pointer-events-none absolute flex items-center justify-center rounded-[24px] border-4 backdrop-blur-[1px]',
                    mode === 'DOMAIN'
                      ? 'border-cyan-200/90 bg-cyan-300/10 shadow-[0_0_35px_rgba(34,211,238,0.45)]'
                      : 'border-yellow-200/90 bg-yellow-300/10 shadow-[0_0_35px_rgba(250,204,21,0.45)]',
                  )}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                  }}
                >
                  <span className="rounded-pill border border-white/35 bg-black/70 px-3 py-1 text-xs font-black text-white">
                    {mode === 'DOMAIN' ? '지배 영역' : '핵심 표적'}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-card-md border border-cyan-300/20 bg-bg-deep p-3">
              <div className="text-xs font-black text-yellow-100">좌표 미세 조정</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  ['x', 'X'],
                  ['y', 'Y'],
                  ['width', '너비'],
                  ['height', '높이'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-[11px] font-black text-cyan-100">{label} (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      disabled={!editable || !rect}
                      value={rect ? Number((rect[key] * 100).toFixed(1)) : ''}
                      onChange={(event) => updatePercent(key, event.target.value)}
                      className="w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-sm font-black text-white outline-none focus:border-cyan-300/60 disabled:opacity-45"
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={!editable}
                onClick={() => setRect(defaultRectForMode(mode))}
                className="mt-3 w-full rounded-card-md border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100 disabled:opacity-45"
              >
                권장 기본 영역으로 초기화
              </button>
            </div>

            <div className="rounded-card-md border border-yellow-300/20 bg-yellow-500/5 p-3 text-xs font-bold leading-5">
              <div className="font-black text-yellow-100">{raidTargetingModeLabel(publicPreview.mode)}</div>
              <div className="mt-1 text-white">{publicPreview.hint_text}</div>
              <div className="mt-1 text-cyan-100">범위 밖: {publicPreview.miss_text}</div>
              <div className="mt-2 text-amber-100">
                공격 영역은 항상 표시되지 않고, 전투 시작과 연속 빗나감 때 잠깐 다시 강조됩니다.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-card-md border border-cyan-300/20 bg-bg-deep px-4 py-3 text-xs font-bold leading-5 text-cyan-100">
          기존 A/B 보스와 같은 방식입니다. 화면 어디를 공격해도 BODY 판정으로 처리됩니다.
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cyan-300/15 pt-4">
        <div className="text-xs font-bold text-amber-100">
          {message ?? (mode === 'BODY' ? '기존 레이드는 자동으로 BODY를 유지합니다.' : 'C/D 모드는 저장 후 레이드 시작 시 유효한 공격 영역이 있는지 서버가 다시 확인합니다.')}
        </div>
        <button
          type="button"
          disabled={!editable || saving || (mode !== 'BODY' && !rect)}
          onClick={() => void save()}
          className="btn-primary min-w-32 disabled:opacity-45"
        >
          {saving ? '저장 중...' : '공격 판정 저장'}
        </button>
      </div>
    </section>
  );
}
