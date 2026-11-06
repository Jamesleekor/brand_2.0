// RAID_HUD_V3_20261106
// 교사용: 보스 얼굴 영역 그리기 + HUD 배치(자동/A/B/C/D) 고르기 + 학생 화면 미리보기.
// 화면 표시 전용 설정이라 타격 판정·전투 규칙에는 영향이 없다.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

import {
  raidAdminRpc,
  type RaidStatus,
  type TeacherRaidPhase,
} from '@/lib/rpc/raid_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import {
  type RaidHudFaceZone,
  type RaidHudPreset,
  type RaidTargetingMode,
  normalizeRaidHudFaceZone,
  normalizeRaidHudPreset,
} from '@/features/raid/targeting/raidTargeting';
import { buildHudV3Layout, hudRectOverlapArea, type HudRect } from '@/features/raid/hud/hudLayout';
import { cn } from '@/lib/utils/cn';

const PRESET_OPTIONS: Array<{ value: RaidHudPreset; label: string }> = [
  { value: 'AUTO', label: '자동 (추천)' },
  { value: 'A', label: 'A 기본' },
  { value: 'B', label: 'B 한쪽 쏠림' },
  { value: 'C', label: 'C 아래 모으기' },
  { value: 'D', label: 'D 세로 기둥' },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round6(value: number) {
  return Number(value.toFixed(6));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readHud(phase: TeacherRaidPhase | null) {
  const hud = asRecord(asRecord(phase?.metadata).hud_v3);
  return {
    face: normalizeRaidHudFaceZone(hud.face_zone),
    preset: normalizeRaidHudPreset(hud.preset),
  };
}

function readTargeting(phase: TeacherRaidPhase | null): { mode: RaidTargetingMode; zone: HudRect | null } {
  const mode = String(asRecord(asRecord(phase?.metadata).targeting_v1).mode ?? '').toUpperCase();
  const safeMode: RaidTargetingMode = mode === 'DOMAIN' || mode === 'ANCHOR' ? mode : 'BODY';
  const hz = phase?.hit_zones.find((item) => item.zone_key === 'PRIMARY_TARGET');
  if (safeMode === 'BODY' || !hz) return { mode: safeMode, zone: null };
  const zone = { x: Number(hz.x), y: Number(hz.y), width: Number(hz.width), height: Number(hz.height) };
  return Object.values(zone).every(Number.isFinite) ? { mode: safeMode, zone } : { mode: safeMode, zone: null };
}

const pct = (value: number) => `${(value * 100).toFixed(3)}%`;

export default function RaidHudLayoutEditor({
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
  const editable = raidStatus !== 'COMPLETED' && raidStatus !== 'FAILED' && raidStatus !== 'ARCHIVED';
  const stored = readHud(phase);
  const [face, setFace] = useState<RaidHudFaceZone | null>(stored.face);
  const [preset, setPreset] = useState<RaidHudPreset>(stored.preset);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const storedKey = `${phase?.id ?? 'none'}:${JSON.stringify(stored.face)}:${stored.preset}`;
  useEffect(() => {
    const next = readHud(phase);
    setFace(next.face);
    setPreset(next.preset);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const targeting = readTargeting(phase);
  const layout = useMemo(() => buildHudV3Layout({
    mode: targeting.mode,
    valid: targeting.zone !== null,
    primary_zone: targeting.zone,
    face_zone: face,
    hud_preset: preset,
  }), [targeting.mode, targeting.zone?.x, targeting.zone?.y, targeting.zone?.width, targeting.zone?.height, face, preset]); // eslint-disable-line react-hooks/exhaustive-deps

  const frames = [
    { key: 'boss', label: '보스 프레임', box: layout.boss },
    { key: 'tracker', label: '기믹 트래커', box: layout.tracker },
    { key: 'player', label: '내 프레임', box: layout.player },
    { key: 'barrier', label: '공명방벽 바', box: layout.barrier },
  ];
  const anyOverlap = frames.some((frame) => layout.protectedRects.some((rect) => hudRectOverlapArea(frame.box.rect, rect) > 0));
  const dirty = JSON.stringify(face) !== JSON.stringify(stored.face) || preset !== stored.preset;

  const eventPoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
      y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = eventPoint(event);
    dragStartRef.current = point;
    setFace({ x: round6(Math.min(point.x, 0.98)), y: round6(Math.min(point.y, 0.98)), width: 0.02, height: 0.02 });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !editable) return;
    const current = eventPoint(event);
    const start = dragStartRef.current;
    const x = clamp(Math.min(start.x, current.x), 0, 0.98);
    const y = clamp(Math.min(start.y, current.y), 0, 0.98);
    setFace({
      x: round6(x),
      y: round6(y),
      width: round6(clamp(Math.abs(current.x - start.x), 0.02, 1 - x)),
      height: round6(clamp(Math.abs(current.y - start.y), 0.02, 1 - y)),
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragStartRef.current = null;
  };

  const updatePercent = (key: keyof RaidHudFaceZone, value: string) => {
    const parsed = Number(value) / 100;
    if (!Number.isFinite(parsed)) return;
    setFace((current) => {
      if (!current) return current;
      const next = { ...current, [key]: parsed };
      next.x = clamp(next.x, 0, 0.98);
      next.y = clamp(next.y, 0, 0.98);
      next.width = clamp(next.width, 0.02, 1 - next.x);
      next.height = clamp(next.height, 0.02, 1 - next.y);
      return { x: round6(next.x), y: round6(next.y), width: round6(next.width), height: round6(next.height) };
    });
  };

  const save = async () => {
    if (!phase || !editable || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await raidAdminRpc.saveHudLayout(supabase, raidId, phase.phase_no, { face_zone: face, preset });
      if (result.success === false) {
        setMessage(
          result.type === 'SERVER' && (result.code === 'PGRST202' || /teacher_save_raid_hud_layout/.test(result.error))
            ? '서버에 HUD v3 SQL을 먼저 적용해 주세요. (APPLY_RAID_HUD_V3_FACE_ZONE_20261106.sql)'
            : `저장 실패: ${result.error}`,
        );
        return;
      }
      setMessage('HUD 배치를 저장했습니다. 학생 화면에는 다음 상태 갱신 때 반영됩니다.');
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!phase) return null;

  return (
    <section className="rounded-card-lg border border-pink-300/25 bg-bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black tracking-[0.14em] text-pink-200">HUD V3 · 모든 보스 타입</div>
          <h3 className="mt-1 text-lg font-black text-white">🗡 HUD 배치 · 보스 얼굴 영역</h3>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-amber-100">
            보스 얼굴을 드래그로 표시하면 학생 화면의 HUD가 얼굴을 가리지 않는 배치로 바뀝니다. 화면 표시만 바뀌고 공격 판정은 그대로입니다.
            현재 새 HUD는 학생 주소 뒤에 <span className="font-mono text-white">?hud=v3</span>를 붙였을 때만 보입니다.
          </p>
        </div>
        {!editable ? (
          <span className="rounded-pill border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100">끝난 레이드는 수정할 수 없음</span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-black">
            <span className="text-yellow-100">이미지 위를 드래그해서 보스 얼굴을 표시 · 학생 크롬북(1366×768) 기준 미리보기</span>
            <span className={cn('rounded-pill border px-2.5 py-1', anyOverlap ? 'border-red-300/50 bg-red-500/15 text-red-100' : 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100')}>
              {anyOverlap ? '겹침 있음' : '겹침 없음'}
            </span>
          </div>
          <div
            className="relative aspect-video select-none overflow-hidden rounded-card-lg border border-pink-300/30 bg-black touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {phase.loop_video_url ? (
              <video src={phase.loop_video_url} muted autoPlay loop playsInline className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
            ) : phase.image_url ? (
              <img src={phase.image_url} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-amber-100">보스 이미지 또는 IDLE 영상이 필요합니다.</div>
            )}

            {frames.map((frame) => {
              const overlap = layout.protectedRects.some((rect) => hudRectOverlapArea(frame.box.rect, rect) > 0);
              return (
                <div
                  key={frame.key}
                  className={cn(
                    'pointer-events-none absolute flex items-center justify-center rounded-[4px] border text-[10px] font-black',
                    overlap ? 'border-red-300 bg-red-500/35 text-red-50' : 'border-amber-200/80 bg-black/45 text-amber-50',
                  )}
                  style={{ left: pct(frame.box.rect.x), top: pct(frame.box.rect.y), width: pct(frame.box.rect.width), height: pct(frame.box.rect.height) }}
                >
                  {frame.label}
                </div>
              );
            })}

            {targeting.zone ? (
              <div
                className="pointer-events-none absolute rounded-[12px] border-2 border-dashed border-cyan-200/90 bg-cyan-300/10"
                style={{ left: pct(targeting.zone.x), top: pct(targeting.zone.y), width: pct(targeting.zone.width), height: pct(targeting.zone.height) }}
              >
                <span className="absolute left-1 top-1 rounded-pill bg-black/70 px-2 py-0.5 text-[10px] font-black text-cyan-100">
                  {targeting.mode === 'DOMAIN' ? '지배 영역' : '핵심 표적'}
                </span>
              </div>
            ) : null}

            {face ? (
              <div
                className="pointer-events-none absolute rounded-[10px] border-2 border-dashed border-pink-300 bg-pink-400/15 shadow-[0_0_20px_rgba(244,114,182,0.45)]"
                style={{ left: pct(face.x), top: pct(face.y), width: pct(face.width), height: pct(face.height) }}
              >
                <span className="absolute left-1 top-1 rounded-pill bg-black/70 px-2 py-0.5 text-[10px] font-black text-pink-100">보스 얼굴</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-card-md border border-pink-300/20 bg-bg-deep p-3">
            <div className="text-xs font-black text-yellow-100">HUD 배치</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={!editable}
                  onClick={() => setPreset(option.value)}
                  className={cn(
                    'rounded-card-md border px-3 py-2 text-xs font-black disabled:opacity-45',
                    option.value === 'AUTO' ? 'col-span-2' : '',
                    preset === option.value ? 'border-pink-200 bg-pink-500/25 text-white' : 'border-white/15 bg-black/25 text-cyan-100 hover:bg-white/5',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] font-bold text-cyan-100">
              지금 쓰이는 배치: <span className="text-white">{layout.auto ? '자동 → ' : ''}{layout.presetLabel}</span>
            </div>
          </div>

          <div className="rounded-card-md border border-pink-300/20 bg-bg-deep p-3">
            <div className="text-xs font-black text-yellow-100">얼굴 영역 미세 조정</div>
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
                    disabled={!editable || !face}
                    value={face ? Number((face[key] * 100).toFixed(1)) : ''}
                    onChange={(event) => updatePercent(key, event.target.value)}
                    className="w-full rounded-card-md border border-pink-300/20 bg-black/30 px-3 py-2 text-sm font-black text-white outline-none focus:border-pink-300/60 disabled:opacity-45"
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={!editable || !face}
              onClick={() => setFace(null)}
              className="mt-3 w-full rounded-card-md border border-pink-300/30 bg-pink-500/10 px-3 py-2 text-xs font-black text-pink-100 disabled:opacity-45"
            >
              얼굴 영역 지우기
            </button>
          </div>

          <div className="rounded-card-md border border-yellow-300/20 bg-yellow-500/5 p-3 text-[11px] font-bold leading-5 text-amber-100">
            얼굴은 딱 맞게만 그려도 됩니다. 배치 계산 때 주변에 여유를 조금 더 둡니다.
            {targeting.zone ? ' C/D 공격 영역(청록 점선)도 함께 피합니다.' : ''}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-pink-300/15 pt-4">
        <div className="text-xs font-bold text-amber-100">
          {message ?? (dirty ? '저장하지 않은 변경이 있습니다.' : '레이드 진행 중에도 바꿀 수 있습니다 (화면 표시 전용).')}
        </div>
        <button type="button" disabled={!editable || saving || !dirty} onClick={() => void save()} className="btn-primary min-w-32 disabled:opacity-45">
          {saving ? '저장 중...' : 'HUD 배치 저장'}
        </button>
      </div>
    </section>
  );
}
