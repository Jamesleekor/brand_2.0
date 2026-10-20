import { useEffect, useRef } from 'react';

import { getRaidFxParticleCount, normalizeRaidFxConfig, RAID_FX_INTENSITY_MULTIPLIER } from './raidFxPresets';
import type { RaidVisualFxConfig, RaidVisualFxPreset } from './raidVisualTypes';

type Particle = {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  phase: number;
  kind: number;
};

// Tiny, deterministic generator; no per-frame allocation or global randomness.
function makeRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function colorFor(preset: RaidVisualFxPreset, kind: number, opacity: number) {
  const alpha = Math.max(0, Math.min(0.72, opacity));
  switch (preset) {
    case 'WIND_FEATHER': return kind ? `rgba(202,247,239,${alpha})` : `rgba(243,218,154,${alpha})`;
    case 'FIRE_EMBER': return kind ? `rgba(250,122,54,${alpha})` : `rgba(254,215,117,${alpha})`;
    case 'WATER_SPRAY': return kind ? `rgba(157,223,249,${alpha})` : `rgba(221,247,255,${alpha})`;
    case 'LIGHT_PRISM': return kind ? `rgba(207,233,255,${alpha})` : `rgba(255,242,194,${alpha})`;
    case 'DARK_VOID': return kind ? `rgba(181,105,236,${alpha})` : `rgba(58,42,82,${alpha})`;
    default: return `rgba(255,255,255,${alpha})`;
  }
}

function renderParticle(
  ctx: CanvasRenderingContext2D,
  particle: Particle,
  preset: RaidVisualFxPreset,
  now: number,
) {
  const flicker = preset === 'LIGHT_PRISM'
    ? 0.5 + 0.5 * Math.sin(now * 0.0018 + particle.phase)
    : 0.88 + 0.12 * Math.sin(now * 0.00065 + particle.phase);
  const opacity = particle.opacity * flicker;
  ctx.fillStyle = colorFor(preset, particle.kind, opacity);
  ctx.strokeStyle = ctx.fillStyle;

  if (preset === 'WIND_FEATHER') {
    ctx.lineWidth = Math.max(0.7, particle.size * 0.45);
    ctx.beginPath();
    ctx.moveTo(particle.x - particle.size * 1.5, particle.y + particle.size * 0.5);
    ctx.lineTo(particle.x + particle.size * 1.5, particle.y - particle.size * 0.5);
    ctx.stroke();
  } else if (preset === 'DARK_VOID' && particle.kind === 0) {
    ctx.beginPath();
    ctx.moveTo(particle.x, particle.y - particle.size);
    ctx.lineTo(particle.x + particle.size * 0.6, particle.y);
    ctx.lineTo(particle.x, particle.y + particle.size);
    ctx.lineTo(particle.x - particle.size * 0.6, particle.y);
    ctx.fill();
  } else if (preset === 'LIGHT_PRISM' && particle.kind === 0) {
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(particle.x - particle.size * 1.6, particle.y);
    ctx.lineTo(particle.x + particle.size * 1.6, particle.y);
    ctx.moveTo(particle.x, particle.y - particle.size * 1.6);
    ctx.lineTo(particle.x, particle.y + particle.size * 1.6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function RaidFxCanvas({ fx }: { fx: RaidVisualFxConfig | null | undefined }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const config = normalizeRaidFxConfig(fx);
  const { preset, intensity } = config;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || preset === 'NONE') return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const random = makeRandom(0x77a031 + preset.length * 17 + intensity.length * 43);
    const count = getRaidFxParticleCount({ preset, intensity });
    const multiplier = RAID_FX_INTENSITY_MULTIPLIER[intensity];
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: random(), y: random(),
      size: 0.8 + random() * 2.3,
      speed: 0.25 + random() * 0.65,
      opacity: (0.16 + random() * 0.44) * Math.min(1.2, multiplier),
      phase: random() * Math.PI * 2,
      kind: random() >= 0.5 ? 1 : 0,
    }));
    let width = 0;
    let height = 0;
    let visible = !document.hidden;
    let inViewport = true;
    let stopped = false;
    let frameId = 0;
    let lastTime = 0;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let motionDisabled = Boolean(reducedMotion?.matches);

    const draw = (now: number, dt: number) => {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);
      for (const particle of particles) {
        if (dt > 0) {
          const movement = particle.speed * dt * 0.002;
          if (preset === 'WIND_FEATHER') {
            particle.x += movement * 0.52;
            particle.y -= movement * 0.18;
          } else if (preset === 'FIRE_EMBER') {
            particle.x += Math.sin(now * 0.00045 + particle.phase) * dt * 0.16;
            particle.y -= movement * 0.55;
          } else if (preset === 'WATER_SPRAY') {
            particle.x -= movement * 0.09;
            particle.y += movement * 0.32;
          } else if (preset === 'LIGHT_PRISM') {
            particle.y -= movement * 0.11;
          } else if (preset === 'DARK_VOID') {
            particle.x += (0.5 - particle.x) * movement * 0.48;
            particle.y -= movement * 0.075;
          }
          // Coordinates are normalized; speed is tuned to the 4-minute raid loop.
          if (particle.x > 1.05) particle.x = -0.05;
          if (particle.x < -0.05) particle.x = 1.05;
          if (particle.y > 1.05) particle.y = -0.05;
          if (particle.y < -0.05) particle.y = 1.05;
        }
        const x = particle.x;
        const y = particle.y;
        particle.x = x * width;
        particle.y = y * height;
        renderParticle(ctx, particle, preset, now);
        particle.x = x;
        particle.y = y;
      }
    };

    const stop = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    };
    const schedule = () => {
      if (!stopped && visible && inViewport && !motionDisabled && !frameId && width && height) {
        frameId = requestAnimationFrame(tick);
      }
    };
    function tick(now: number) {
      frameId = 0;
      if (stopped || !visible || !inViewport || motionDisabled) return;
      if (lastTime && now - lastTime < 33) {
        schedule();
        return;
      }
      const dt = lastTime ? Math.min((now - lastTime) / 33, 2) : 0;
      lastTime = now;
      draw(now, dt);
      schedule();
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(0, Math.floor(rect.width));
      height = Math.max(0, Math.floor(rect.height));
      if (width === 0 || height === 0) { stop(); return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now(), 0);
      schedule();
    };
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) schedule(); else stop();
    };
    const onReducedMotion = () => {
      motionDisabled = Boolean(reducedMotion?.matches);
      if (motionDisabled) { stop(); draw(performance.now(), 0); }
      else schedule();
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);
    if (!resizeObserver) window.addEventListener('resize', resize);
    const viewportObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => {
        inViewport = Boolean(entry?.isIntersecting);
        if (inViewport) schedule(); else stop();
      })
      : null;
    viewportObserver?.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion?.addEventListener?.('change', onReducedMotion);
    resize();

    return () => {
      stopped = true;
      stop();
      resizeObserver?.disconnect();
      viewportObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion?.removeEventListener?.('change', onReducedMotion);
    };
  }, [preset, intensity]);

  if (preset === 'NONE') return null;
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
