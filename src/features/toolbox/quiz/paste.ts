// =====================================================================
// 퀴즈 로얄 — 엑셀(구글 시트)에서 복사한 표 붙여넣기 해석
// ---------------------------------------------------------------------
// 칸 순서(첫 줄이 제목 줄이면 제목 이름으로 칸을 찾는다):
//   구간 | 포지션 | 문제 | 정답 | 허용 표현 | 유형 | 주제 | 배점 | 시간(초) | 해설 | 미디어 주소
// * 구간: 개인 / 개인전 / 단체 / 단체전
// * 포지션: 선봉·차봉… 같은 이름 또는 1~5 번호(단체전은 비움)
// * 허용 표현: 여러 개면 | 로 나눈다 (예: 인플레이션|물가 상승)
// * 유형: 지식 / 추론,  주제: 세계관 / 경제 / 상식 / 수업
// * 배점·시간이 비면 대회 기본값을 쓴다
// * 미디어 주소: https:// 주소(YouTube·이미지·mp4). 파일은 붙여넣은 뒤 줄마다 올린다
// =====================================================================

import { mediaTypeOfUrl } from './quiz_media';
import type { QuizKind, QuizQuestionInput, QuizStage, QuizTheme } from './quiz_types';

export const PASTE_COLUMNS = ['구간', '포지션', '문제', '정답', '허용 표현', '유형', '주제', '배점', '시간(초)', '해설', '미디어 주소'] as const;

export const PASTE_TEMPLATE = [
  PASTE_COLUMNS.join('\t'),
  ['개인', '선봉', 'B.R.A.N.D에서 거래할 수 없고 22티어를 결정하는 값은?', 'BV', '브랜드가치|브랜드 가치', '지식', '경제', '', '', '명예·노력의 기록이에요', ''].join('\t'),
  ['개인', '선봉', '물건값이 계속 오르는 현상을 무엇이라고 할까요?', '인플레이션', '물가 상승', '지식', '경제', '', '30', '', ''].join('\t'),
  ['단체', '', '사진 속 장소는 어디일까요?', '경복궁', '', '추론', '수업', '15', '60', '', 'https://example.com/photo.jpg'].join('\t'),
].join('\n');

export interface ParsedRow {
  line: number;
  input: QuizQuestionInput | null;
  error: string | null;
  raw: string[];
}

/** 탭으로 나뉜 표 해석(따옴표 안의 줄바꿈·탭·"" 처리) */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_KEYS: Record<string, string[]> = {
  stage: ['구간', '라운드', '경기'],
  position: ['포지션', '순번', '선수'],
  prompt: ['문제', '질문', '지문'],
  answer: ['정답', '답'],
  accepted: ['허용', '허용 표현', '허용표현', '다른 정답', '인정'],
  kind: ['유형', '지식/추론', '형태'],
  theme: ['주제', '분류', '영역'],
  points: ['배점', '점수'],
  time: ['시간', '시간(초)', '제한 시간', '제한시간'],
  explanation: ['해설', '설명'],
  media: ['미디어', '미디어 주소', '이미지', '영상', '주소', 'url'],
};

function findHeader(row: string[]): Record<string, number> | null {
  const norm = row.map((c) => c.trim().toLowerCase().replace(/\s+/g, ' '));
  const map: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADER_KEYS)) {
    const idx = norm.findIndex((c) => names.some((n) => c === n.toLowerCase() || c.startsWith(n.toLowerCase())));
    if (idx >= 0) map[key] = idx;
  }
  return map.prompt !== undefined && map.answer !== undefined ? map : null;
}

const DEFAULT_MAP: Record<string, number> = { stage: 0, position: 1, prompt: 2, answer: 3, accepted: 4, kind: 5, theme: 6, points: 7, time: 8, explanation: 9, media: 10 };

function parseStage(v: string): QuizStage | null {
  const t = v.trim().toLowerCase();
  if (/^(개인|개인전|ind|individual)/.test(t)) return 'INDIVIDUAL';
  if (/^(단체|단체전|팀|team)/.test(t)) return 'TEAM';
  return null;
}

function parseKind(v: string): QuizKind | null {
  const t = v.trim();
  if (/^지식|knowledge/i.test(t)) return 'KNOWLEDGE';
  if (/^추론|reason/i.test(t)) return 'REASONING';
  return null;
}

function parseTheme(v: string): QuizTheme | null {
  const t = v.trim();
  if (!t) return null;
  if (/세계관|world/i.test(t)) return 'BRAND_WORLD';
  if (/경제|economy/i.test(t)) return 'BRAND_ECONOMY';
  if (/상식|general/i.test(t)) return 'GENERAL';
  if (/수업|교과|curriculum/i.test(t)) return 'CURRICULUM';
  return null;
}

function parseNum(v: string): number | null {
  const t = v.trim().replace(/[^0-9.]/g, '');
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) ? n : null;
}

export function parseQuestionTable(text: string, positions: string[]): ParsedRow[] {
  const rows = parseTsv(text);
  if (rows.length === 0) return [];
  const header = findHeader(rows[0]);
  const map = header ?? DEFAULT_MAP;
  const body = header ? rows.slice(1) : rows;
  const startLine = header ? 2 : 1;
  return body.map((raw, i) => {
    const get = (k: string) => (map[k] !== undefined ? (raw[map[k]] ?? '') : '').trim();
    const line = startLine + i;
    let stage = parseStage(get('stage'));
    const posText = get('position');
    // 구간을 비우고 포지션만 쓴 경우 개인전으로 본다
    if (!stage) stage = posText ? 'INDIVIDUAL' : null;
    if (!stage) return { line, input: null, error: '구간(개인/단체)을 알 수 없어요', raw };
    let position_index: number | null = null;
    if (stage === 'INDIVIDUAL') {
      const byName = positions.findIndex((p) => p === posText || posText.startsWith(p));
      const byNum = parseNum(posText);
      position_index = byName >= 0 ? byName : (byNum !== null && byNum >= 1 && byNum <= positions.length ? byNum - 1 : null);
      if (position_index === null) return { line, input: null, error: `포지션 "${posText}"을(를) 찾을 수 없어요 (${positions.join('·')} 또는 1~${positions.length})`, raw };
    }
    const prompt = get('prompt');
    const answer = get('answer');
    if (!prompt) return { line, input: null, error: '문제가 비어 있어요', raw };
    if (!answer) return { line, input: null, error: '정답이 비어 있어요', raw };
    if (prompt.length > 1000) return { line, input: null, error: '문제가 1000자를 넘어요', raw };
    if (answer.length > 300) return { line, input: null, error: '정답이 300자를 넘어요', raw };
    const media = get('media');
    const mediaType = media ? mediaTypeOfUrl(media) : null;
    if (media && !mediaType) return { line, input: null, error: '미디어 주소는 https:// 로 시작해야 해요', raw };
    const points = parseNum(get('points'));
    const time = parseNum(get('time'));
    if (time !== null && (time < 5 || time > 600)) return { line, input: null, error: '시간은 5~600초로 써 주세요', raw };
    const input: QuizQuestionInput = {
      stage, position_index, prompt, answer_key: answer,
      accepted: get('accepted').split(/[|;]/).map((x) => x.trim()).filter(Boolean),
      kind: parseKind(get('kind')), theme: parseTheme(get('theme')),
      points, time_limit_sec: time,
      explanation: get('explanation') || null,
      media_type: mediaType, media_url: mediaType ? media : null, media_path: null,
      media_on_device: mediaType === 'IMAGE',
    };
    return { line, input, error: null, raw };
  });
}
