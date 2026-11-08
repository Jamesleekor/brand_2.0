// =====================================================================
// 퀴즈 로얄 — 문제 미디어(이미지·영상)
// ---------------------------------------------------------------------
// * 파일은 비공개 버킷 'quiz-media'의 <학급>/<대회>/ 폴더에 올린다.
// * 화면은 짧은 기간(10분)만 유효한 서명 주소로 연다. 학생 대표 계정은 서버 정책상
//   '지금 보여 주는 문제'의 파일만 서명 주소를 받을 수 있다(미리 열어 보기 불가).
// * YouTube·외부 https 주소도 쓸 수 있다(주소 자체가 학생에게 미리 가지 않는다).
// =====================================================================

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MediaType } from './quiz_types';

export const MEDIA_BUCKET = 'quiz-media';
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

export function mediaTypeOfFile(file: File): MediaType | null {
  if (IMAGE_TYPES.includes(file.type)) return 'IMAGE';
  if (VIDEO_TYPES.includes(file.type)) return 'VIDEO';
  return null;
}

/** 주소로 미디어 종류를 짐작한다(붙여넣기 '미디어 주소' 칸) */
export function mediaTypeOfUrl(url: string): MediaType | null {
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) return null;
  if (youtubeId(u)) return 'YOUTUBE';
  if (/\.(mp4|webm)(\?|#|$)/i.test(u)) return 'VIDEO';
  return 'IMAGE';
}

export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i.exec(url);
  return m ? m[1] : null;
}

/** 시작 초(t=90, t=1m30s) */
export function youtubeStart(url: string): number {
  const m = /[?&#](?:t|start)=(\d+h)?(\d+m)?(\d+)s?/i.exec(url);
  if (!m) return 0;
  return (parseInt(m[1] ?? '0', 10) * 3600) + (parseInt(m[2] ?? '0', 10) * 60) + parseInt(m[3] ?? '0', 10);
}

export async function uploadQuizMedia(client: SupabaseClient, classroomId: number, eventId: number, file: File):
  Promise<{ path: string; media_type: MediaType }> {
  const type = mediaTypeOfFile(file);
  if (!type) throw new Error('이미지(png·jpg·webp·gif) 또는 영상(mp4·webm)만 올릴 수 있어요.');
  if (file.size > MEDIA_MAX_BYTES) throw new Error('파일은 50MB까지 올릴 수 있어요. 영상은 짧게 잘라 주세요.');
  const ext = (file.name.split('.').pop() ?? (type === 'IMAGE' ? 'png' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const path = `${classroomId}/${eventId}/${Date.now()}-${rand}.${ext}`;
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
  if (error) throw new Error(`파일을 올리지 못했어요. (${error.message})`);
  return { path, media_type: type };
}

export async function removeQuizMedia(client: SupabaseClient, paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return;
  // 지우기 실패는 경기에 영향이 없으므로 조용히 넘어간다(용량만 남음)
  await client.storage.from(MEDIA_BUCKET).remove(list).catch(() => undefined);
}

const signedCache = new Map<string, { url: string; exp: number }>();

/** 저장소 경로면 서명 주소로, https 주소면 그대로 돌려준다. 권한이 없으면 null(아직 공개 전) */
export function useMediaSrc(client: SupabaseClient, path: string | null | undefined, url: string | null | undefined): { src: string | null; error: boolean } {
  const [state, setState] = useState<{ src: string | null; error: boolean }>({ src: url ?? null, error: false });
  useEffect(() => {
    let alive = true;
    if (!path) { setState({ src: url ?? null, error: false }); return; }
    const hit = signedCache.get(path);
    if (hit && hit.exp > Date.now() + 30_000) { setState({ src: hit.url, error: false }); return; }
    setState({ src: null, error: false });
    let tries = 0;
    const attempt = () => {
      void client.storage.from(MEDIA_BUCKET).createSignedUrl(path, 600).then(({ data, error }) => {
        if (!alive) return;
        if (error || !data?.signedUrl) {
          // 문제를 보여 주는 순간과 권한 반영 사이의 아주 짧은 틈이 있을 수 있어 두 번 더 시도한다
          tries += 1;
          if (tries < 3) window.setTimeout(attempt, 700);
          else setState({ src: null, error: true });
          return;
        }
        signedCache.set(path, { url: data.signedUrl, exp: Date.now() + 600_000 });
        setState({ src: data.signedUrl, error: false });
      });
    };
    attempt();
    return () => { alive = false; };
  }, [client, path, url]);
  return state;
}
