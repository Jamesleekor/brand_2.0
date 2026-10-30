/**
 * 「천공의 성좌판」 canvas renderer (visual only — never affects scoring).
 * Stars are pre-rendered once per size into sprites, so a frame is ~49 drawImage
 * calls: cheap on 4GB Chromebooks. No cell borders are drawn (spec §3.1).
 * Each type differs by colour + silhouette + inner mark (spec §5).
 */
import { STARLINK_GRID, cellCenter } from '../starlinkPointer';

export interface StarlinkStarStyle { name: string; core: string; light: string; deep: string }

export const STARLINK_STAR_STYLES: readonly StarlinkStarStyle[] = [
  { name: '태양별', core: '#FFC93C', light: '#FFF3C4', deep: '#B7791F' },
  { name: '빙정별', core: '#9EDCFF', light: '#F2FBFF', deep: '#2B7BB9' },
  { name: '몽환별', core: '#B88CFF', light: '#EBDDFF', deep: '#6B3FC4' },
  { name: '홍염별', core: '#FF5470', light: '#FFD0D8', deep: '#B0213C' },
  { name: '회오리별', core: '#2EE6C8', light: '#C9FFF5', deep: '#0E8C7A' },
  { name: '성환별', core: '#E4E8F5', light: '#FFFFFF', deep: '#8A93B2' },
];

export interface StarlinkFrame {
  /** null → board concealed (countdown or reshuffle veil). */
  board: readonly number[] | null;
  path: readonly number[];
  pathType: number | null;
  loopClosed: boolean;
  loopReady: boolean;
  /** Settle animation of the cells just removed (board still shows them). */
  removing: { cells: readonly number[]; progress: number } | null;
  /** Cells that just appeared after refill, 0→1 fade-in. */
  appearing: { cells: readonly number[]; progress: number } | null;
  veilProgress: number | null;
  timeMs: number;
}

type Sprite = HTMLCanvasElement;
interface SpriteSet { size: number; normal: Sprite[]; glow: Sprite[] }

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function starPolygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, points: number, outer: number, inner: number, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function radial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, s: StarlinkStarStyle) {
  const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.05, cx, cy, r);
  g.addColorStop(0, s.light);
  g.addColorStop(0.55, s.core);
  g.addColorStop(1, s.deep);
  return g;
}

/** Draws one star of `type` centred in a square sprite of `size` px. */
function drawStar(ctx: CanvasRenderingContext2D, type: number, size: number, glow: boolean) {
  const s = STARLINK_STAR_STYLES[type];
  const c = size / 2;
  const r = size * (glow ? 0.34 : 0.31);
  ctx.save();
  if (glow) {
    const halo = ctx.createRadialGradient(c, c, r * 0.4, c, c, size * 0.5);
    halo.addColorStop(0, `${s.core}cc`);
    halo.addColorStop(1, `${s.core}00`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (type) {
    case 0: { // 태양별: 8-ray burst + central gem
      starPolygon(ctx, c, c, 8, r * 1.08, r * 0.5);
      ctx.fillStyle = radial(ctx, c, c, r * 1.08, s); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c, c - r * 0.34); ctx.lineTo(c + r * 0.26, c); ctx.lineTo(c, c + r * 0.34); ctx.lineTo(c - r * 0.26, c); ctx.closePath();
      ctx.fillStyle = '#FFFBEA'; ctx.fill(); ctx.strokeStyle = s.deep; ctx.lineWidth = size * 0.02; ctx.stroke();
      break;
    }
    case 1: { // 빙정별: hexagonal crystal + sharp crystal lines
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) { const a = Math.PI / 6 + (i * Math.PI) / 3; const x = c + Math.cos(a) * r; const y = c + Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); ctx.fillStyle = radial(ctx, c, c, r, s); ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = size * 0.035;
      for (let i = 0; i < 3; i += 1) { const a = Math.PI / 2 + (i * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(c - Math.cos(a) * r * 0.72, c - Math.sin(a) * r * 0.72); ctx.lineTo(c + Math.cos(a) * r * 0.72, c + Math.sin(a) * r * 0.72); ctx.stroke(); }
      break;
    }
    case 2: { // 몽환별: soft orb + crescent moon mark
      ctx.beginPath(); ctx.arc(c, c, r * 0.95, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, c, c, r, s); ctx.fill();
      ctx.beginPath(); ctx.arc(c - r * 0.08, c, r * 0.55, Math.PI * 0.5, Math.PI * 1.5, false); ctx.arc(c + r * 0.12, c, r * 0.42, Math.PI * 1.5, Math.PI * 0.5, true); ctx.closePath();
      ctx.fillStyle = '#FBF6FF'; ctx.fill();
      break;
    }
    case 3: { // 홍염별: sharp 12-point flare + hot core
      starPolygon(ctx, c, c, 12, r * 1.1, r * 0.62, -Math.PI / 2 + Math.PI / 12);
      ctx.fillStyle = radial(ctx, c, c, r * 1.1, s); ctx.fill();
      starPolygon(ctx, c, c, 4, r * 0.42, r * 0.16);
      ctx.fillStyle = '#FFF1F3'; ctx.fill();
      break;
    }
    case 4: { // 회오리별: disc + spiral
      ctx.beginPath(); ctx.arc(c, c, r * 0.92, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, c, c, r, s); ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= 40; i += 1) { const t = i / 40; const a = t * Math.PI * 3.2; const rr = r * 0.08 + t * r * 0.66; const x = c + Math.cos(a) * rr; const y = c + Math.sin(a) * rr; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.strokeStyle = '#F2FFFC'; ctx.lineWidth = size * 0.045; ctx.stroke();
      break;
    }
    default: { // 성환별: 5-point star wrapped by a tilted ring
      ctx.beginPath(); ctx.ellipse(c, c, r * 1.12, r * 0.42, -0.45, Math.PI, Math.PI * 2);
      ctx.strokeStyle = s.deep; ctx.lineWidth = size * 0.05; ctx.stroke();
      starPolygon(ctx, c, c, 5, r * 0.86, r * 0.38);
      ctx.fillStyle = radial(ctx, c, c, r * 0.86, s); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c, c, r * 1.12, r * 0.42, -0.45, 0, Math.PI);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = size * 0.05; ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

export class StarlinkRenderer {
  private sprites: SpriteSet | null = null;
  private background: HTMLCanvasElement | null = null;
  private backgroundSize = 0;

  private ensureSprites(spriteSize: number): SpriteSet {
    if (this.sprites && this.sprites.size === spriteSize) return this.sprites;
    const normal: Sprite[] = [];
    const glow: Sprite[] = [];
    for (let type = 0; type < 6; type += 1) {
      const a = makeCanvas(spriteSize); drawStar(a.getContext('2d')!, type, spriteSize, false); normal.push(a);
      const b = makeCanvas(spriteSize); drawStar(b.getContext('2d')!, type, spriteSize, true); glow.push(b);
    }
    this.sprites = { size: spriteSize, normal, glow };
    return this.sprites;
  }

  private ensureBackground(size: number): HTMLCanvasElement {
    if (this.background && this.backgroundSize === size) return this.background;
    const bg = makeCanvas(size);
    const ctx = bg.getContext('2d')!;
    const g = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
    g.addColorStop(0, '#2A2161');
    g.addColorStop(0.55, '#141A44');
    g.addColorStop(1, '#070A1F');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    // faint nebula clouds
    const clouds: Array<[number, number, number, string]> = [[0.22, 0.28, 0.32, '#6A3FB533'], [0.8, 0.72, 0.36, '#2D6BB52e'], [0.68, 0.18, 0.22, '#B53F8A22']];
    for (const [x, y, r, color] of clouds) {
      const n = ctx.createRadialGradient(size * x, size * y, 0, size * x, size * y, size * r);
      n.addColorStop(0, color); n.addColorStop(1, '#00000000');
      ctx.fillStyle = n; ctx.fillRect(0, 0, size, size);
    }
    // distant dim dots (fixed pseudo-random, far smaller/dimmer than playable stars)
    let seed = 0x5EED1234;
    for (let i = 0; i < 90; i += 1) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const x = ((seed >>> 0) % 10000) / 10000 * size;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const y = ((seed >>> 0) % 10000) / 10000 * size;
      ctx.fillStyle = `rgba(220,226,255,${0.12 + (i % 5) * 0.04})`;
      ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }
    this.background = bg; this.backgroundSize = size;
    return bg;
  }

  draw(ctx: CanvasRenderingContext2D, sizePx: number, frame: StarlinkFrame) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sizePx, sizePx);
    ctx.drawImage(this.ensureBackground(sizePx), 0, 0);
    const cell = sizePx / STARLINK_GRID;
    const spriteSize = Math.max(16, Math.round(cell * 1.1));
    const sprites = this.ensureSprites(spriteSize);
    const rect = { width: sizePx, height: sizePx };
    const pulse = 0.5 + 0.5 * Math.sin(frame.timeMs / 140);

    if (!frame.board) {
      if (frame.veilProgress !== null) this.drawVeil(ctx, sizePx, frame.veilProgress, frame.timeMs);
      return;
    }

    const inPath = new Set(frame.path);
    const removing = frame.removing ? new Set(frame.removing.cells) : null;
    const appearing = frame.appearing ? new Set(frame.appearing.cells) : null;

    // path light beam (two strokes: wide translucent glow + bright core; no shadowBlur)
    if (frame.path.length >= 2 && frame.pathType !== null) {
      const style = STARLINK_STAR_STYLES[frame.pathType];
      const pts = frame.path.map((c) => cellCenter(c, rect));
      if (frame.loopClosed) pts.push(pts[0]);
      for (const [width, color] of [[cell * (frame.loopClosed ? 0.42 : 0.3), `${style.core}55`], [cell * (frame.loopClosed ? 0.16 : 0.11), style.light]] as const) {
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      }
    }

    for (let i = 0; i < frame.board.length; i += 1) {
      const type = frame.board[i];
      const center = cellCenter(i, rect);
      let scale = 1;
      let alpha = 1;
      let sprite = sprites.normal[type];
      const loopFamily = frame.loopClosed && frame.pathType === type;
      if (inPath.has(i) || loopFamily) { sprite = sprites.glow[type]; scale = loopFamily ? 1.12 + 0.06 * pulse : 1.16; }
      if (frame.loopReady && frame.path[0] === i) { sprite = sprites.glow[type]; scale = 1.1 + 0.14 * pulse; }
      if (removing?.has(i)) { const p = frame.removing!.progress; scale = 1.15 + 0.5 * p; alpha = Math.max(0, 1 - p); sprite = sprites.glow[type]; }
      if (appearing?.has(i)) { const p = frame.appearing!.progress; alpha = Math.min(1, p); scale = 0.6 + 0.4 * p; }
      if (alpha <= 0) continue;
      const d = spriteSize * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, center.x - d / 2, center.y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
  }

  /** Reshuffle veil: hides the final board completely (spec §23). Visual noise only. */
  private drawVeil(ctx: CanvasRenderingContext2D, size: number, progress: number, timeMs: number) {
    ctx.fillStyle = 'rgba(32,22,78,0.55)';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 26; i += 1) {
      const a = (i * 2.4 + timeMs / 260) % (Math.PI * 2);
      const r = size * (0.12 + ((i * 37) % 30) / 100) * (0.6 + 0.4 * Math.sin(progress * Math.PI));
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      ctx.fillStyle = STARLINK_STAR_STYLES[i % 6].light;
      ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(timeMs / 90 + i));
      ctx.beginPath(); ctx.arc(x, y, size * 0.006 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
