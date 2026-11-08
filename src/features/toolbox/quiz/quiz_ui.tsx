// =====================================================================
// 퀴즈 로얄 — 공통 화면 부품
// =====================================================================

import { useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatClock } from '../ui';
import { useMediaSrc, youtubeId, youtubeStart } from './quiz_media';
import type { MediaType, QPhase, QuizPhase } from './quiz_types';
import { PHASE_LABEL, QPHASE_LABEL } from './quiz_types';

/** 중계 화면을 새 창으로 연다(교실 화면 쪽으로 옮겨 전체 화면으로 쓴다) */
export function openQuizScreen(id: number) {
  const url = new URL(window.location.href);
  url.hash = `/teacher/toolbox/quiz/${id}/screen`;
  window.open(url.href, `quiz-screen-${id}`, 'noopener');
}

/** 공동 순위(10·10·5 → 1·1·3) */
export function rankMap(scores: Record<string, number>): Map<string, number> {
  const entries = Object.entries(scores);
  const out = new Map<string, number>();
  for (const [k, v] of entries) out.set(k, 1 + entries.filter(([, w]) => w > v).length);
  return out;
}

export function PhaseChip({ phase, q }: { phase: QuizPhase; q?: QPhase }) {
  const live = phase === 'INDIVIDUAL' || phase === 'TEAM';
  const cls = phase === 'COMPLETED' ? 'tbx-chip' : live ? 'tbx-chip tbx-chip--live' : phase === 'SETUP' ? 'tbx-chip' : 'tbx-chip tbx-chip--violet';
  return <span className={cls}>{PHASE_LABEL[phase]}{live && q ? ` · ${QPHASE_LABEL[q]}` : ''}</span>;
}

export function TimerText({ ms, total, big }: { ms: number | null; total?: number; big?: boolean }) {
  if (ms === null) return <span className={big ? 'qz-timer qz-timer--big' : 'qz-timer'}>--:--</span>;
  const danger = ms <= 5_000;
  const warn = !danger && total ? ms <= total * 1000 * 0.25 : false;
  return (
    <span className={`${big ? 'qz-timer qz-timer--big' : 'qz-timer'}${danger ? ' qz-timer--danger' : warn ? ' qz-timer--warn' : ''}`}>
      {formatClock(ms)}
    </span>
  );
}

export function TimerBar({ ms, total }: { ms: number | null; total: number }) {
  const pct = ms === null ? 0 : Math.max(0, Math.min(100, (ms / (total * 1000)) * 100));
  return <div className="qz-timebar" aria-hidden="true"><div className={ms !== null && ms <= 5000 ? 'qz-timebar__fill qz-timebar__fill--danger' : 'qz-timebar__fill'} style={{ width: `${pct}%` }} /></div>;
}

/**
 * 문제 미디어. mode:
 *  - screen: 교실 큰 화면(영상 소리 O, 교사 운영 화면의 재생 명령을 따른다)
 *  - device: 태블릿(이미지만, 영상은 소리 없이)
 *  - thumb: 교사 화면 미리보기
 */
export function QuizMedia({ client, type, path, url, mode, command }: {
  client: SupabaseClient; type: MediaType | null; path: string | null; url: string | null;
  mode: 'screen' | 'device' | 'thumb'; command?: { cmd: string; rev: number } | null;
}) {
  const { src, error } = useMediaSrc(client, type === 'YOUTUBE' ? null : path, type === 'YOUTUBE' ? null : url);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const lastRev = useRef<number>(command?.rev ?? 0);

  useEffect(() => {
    if (!command || command.rev === lastRev.current) return;
    lastRev.current = command.rev;
    const v = videoRef.current;
    if (v) {
      if (command.cmd === 'play') void v.play().catch(() => undefined);
      else if (command.cmd === 'pause') v.pause();
      else if (command.cmd === 'restart') { v.currentTime = 0; void v.play().catch(() => undefined); }
    }
    const f = frameRef.current;
    if (f?.contentWindow) {
      const send = (func: string, args: unknown[] = []) => f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
      if (command.cmd === 'play') send('playVideo');
      else if (command.cmd === 'pause') send('pauseVideo');
      else if (command.cmd === 'restart') { send('seekTo', [url ? youtubeStart(url) : 0, true]); send('playVideo'); }
    }
  }, [command?.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!type) return null;
  const cls = `qz-media qz-media--${mode}`;
  if (type === 'YOUTUBE') {
    const id = url ? youtubeId(url) : null;
    if (!id) return <div className={cls}><span className="tbx-small">영상 주소를 확인해 주세요</span></div>;
    if (mode === 'thumb') return <div className={cls}><img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="YouTube 영상 미리보기" /><span className="qz-media__tag">YouTube</span></div>;
    if (mode === 'device') return <div className={cls}><span className="qz-media__note">🎬 영상은 교실 화면을 봐 주세요</span></div>;
    const start = url ? youtubeStart(url) : 0;
    return (
      <div className={cls}>
        <iframe ref={frameRef} title="문제 영상" allow="autoplay; encrypted-media" allowFullScreen
          src={`https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1${start ? `&start=${start}` : ''}`} />
      </div>
    );
  }
  if (error) return <div className={cls}><span className="tbx-small">미디어를 불러오지 못했어요</span></div>;
  if (!src) return <div className={cls}><span className="tbx-small">불러오는 중…</span></div>;
  if (type === 'IMAGE') return <div className={cls}><img src={src} alt="문제 그림" draggable={false} /></div>;
  // VIDEO
  if (mode === 'device') return <div className={cls}><span className="qz-media__note">🎬 영상은 교실 화면을 봐 주세요</span></div>;
  return (
    <div className={cls}>
      <video ref={videoRef} src={src} controls={mode === 'thumb' || mode === 'screen'} playsInline preload="auto" muted={mode === 'thumb'} />
    </div>
  );
}

/** 길드 이름 앞 작은 동그라미(엠블럼이 있으면 엠블럼) */
export function GuildMark({ name, logo, color }: { name: string; logo?: string | null; color: string }) {
  if (logo) return <img className="qz-mark" src={logo} alt="" aria-hidden="true" />;
  return <span className="qz-mark qz-mark--text" style={{ background: color }} aria-hidden="true">{name.slice(0, 1)}</span>;
}
