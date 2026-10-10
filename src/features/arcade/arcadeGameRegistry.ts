export interface ArcadeGameUiMeta {
  code: string;
  number: string;
  emoji: string;
  shortName: string;
  title: string;
  subtitle: string;
  rules: string[];
  studentImplemented: boolean;
  teacherManaged: boolean;
  periodRecordsSupported: boolean;
}

export const ARCADE_GAME_UI: Record<string, ArcadeGameUiMeta> = {
  focus_reaction_01: {
    code: 'focus_reaction_01',
    number: 'Game #01',
    emoji: '🎯',
    shortName: '집중 반응',
    title: '집중 반응 #01',
    subtitle: '4-Lane Visual Reaction · Go / No-Go',
    rules: [
      'D / F / J / K 또는 터치로 4개 레인을 조작합니다.',
      '파란 신호는 누르고, 빨간 ✕ 신호는 누르지 않습니다.',
      'Life 3, Combo, 실제 경과시간 기반 판정입니다.',
    ],
    studentImplemented: true,
    teacherManaged: true,
    periodRecordsSupported: true,
  },
  pure_reaction_02: {
    code: 'pure_reaction_02',
    number: 'Game #02',
    emoji: '⚡',
    shortName: '순수 반응 속도',
    title: '순수 반응속도 #02',
    subtitle: 'Pure Visual Reaction · 5 Trials',
    rules: [
      '마력핵이 점화되는 순간 Space 또는 화면을 누릅니다.',
      '총 5회 반응의 평균 속도로 SCORE를 계산합니다.',
      '신호 전 입력, 120ms 미만 입력, 3000ms 이상 반응은 즉시 GAME OVER입니다.',
    ],
    studentImplemented: true,
    teacherManaged: true,
    periodRecordsSupported: true,
  },
  rakaruka_03: {
    code: 'rakaruka_03',
    number: 'Game #03',
    emoji: '🎲',
    shortName: '라카루카',
    title: '라카루카 #03',
    subtitle: 'Tactical Dice Duel · AI Strategy',
    rules: [
      '3×3 주사위 보드에서 더블·트리플로 점수를 키웁니다.',
      '같은 눈의 상대 일반 주사위는 알까기로 제거하고 다음 자기 턴에 같은 눈의 실드를 얻습니다.',
      '타짜·홀드·실드를 활용해 Lv.1부터 Lv.10 AI에 순차적으로 도전합니다.',
    ],
    studentImplemented: true,
    teacherManaged: false,
    periodRecordsSupported: true,
  },
  starlink_04: {
    code: 'starlink_04',
    number: 'Game #04',
    emoji: '✨',
    shortName: '스타링크',
    title: '스타링크 #04',
    subtitle: '천공의 성좌판 · 60초 연결 퍼즐',
    rules: [
      '같은 별을 3개 이상 이어서 제거합니다.',
      '긴 연결과 콤보로 점수를 높이고, 별 5개 이상의 고리를 완성할 수 있습니다.',
      '고리를 완성하면 같은 종류의 별 전체가 제거됩니다.',
    ],
    // Flip only after the actual Starlink React game/validator is integrated.
    studentImplemented: false,
    teacherManaged: true,
    periodRecordsSupported: true,
  },
};

export function arcadeGameMeta(code: string): ArcadeGameUiMeta | null {
  return ARCADE_GAME_UI[code] ?? null;
}

export function arcadeGameLabel(code: string): string {
  const meta = arcadeGameMeta(code);
  return meta ? `${meta.number} · ${meta.shortName}` : code;
}

export function isStudentArcadeGameImplemented(code: string): boolean {
  return ARCADE_GAME_UI[code]?.studentImplemented === true;
}

export function isTeacherArcadeGameManaged(code: string): boolean {
  return ARCADE_GAME_UI[code]?.teacherManaged === true;
}

export function isPeriodRecordsGameSupported(code: string): boolean {
  return ARCADE_GAME_UI[code]?.periodRecordsSupported === true;
}
