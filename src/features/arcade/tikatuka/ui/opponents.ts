import type { Difficulty } from '../engine';

export interface RakarukaOpponentProfile {
  difficulty: Difficulty;
  characterUid: string;
  name: string;
  epithet: string;
  quote: string;
}

export const RAKARUKA_OPPONENTS: Record<Difficulty, RakarukaOpponentProfile> = {
  1: {
    difficulty: 1,
    characterUid: 'CHAR-001',
    name: '고양이 마스코트',
    epithet: 'B.R.A.N.D의 첫 마스코트',
    quote: '나와 라카루카를 배워보자냥!',
  },
  2: {
    difficulty: 2,
    characterUid: 'CHAR-004',
    name: '셀레네',
    epithet: '새벽을 여는 지혜',
    quote: '새벽 별을 읽는 것처럼, 주사위의 흐름도 천천히 읽어볼게요.',
  },
  3: {
    difficulty: 3,
    characterUid: 'CHAR-015',
    name: '리노',
    epithet: '숲의 전령',
    quote: '길 없는 숲에서도 길은 보여. 네 다음 수는 어디로 이어질까?',
  },
  4: {
    difficulty: 4,
    characterUid: 'CHAR-043',
    name: '코니',
    epithet: '길드의 접수원',
    quote: '어서 와! 접수는 끝났어. 이번에는 내가 상대해 줄게!',
  },
  5: {
    difficulty: 5,
    characterUid: 'CHAR-047',
    name: '제이든',
    epithet: '오타쿠 마법사',
    quote: '공략은 이미 머릿속에 있어. 멋있고 강하면, 그게 정답이잖아?',
  },
  6: {
    difficulty: 6,
    characterUid: 'CHAR-076',
    name: '에스메랄다',
    epithet: '마법소녀',
    quote: '별빛은 길을 잃지 않아. 복잡해질수록 길이 더 잘 보이거든.',
  },
  7: {
    difficulty: 7,
    characterUid: 'CHAR-064',
    name: '레티시아',
    epithet: '학생회장',
    quote: '규칙은 모두에게 공평해야 해요. 그럼, 정정당당하게 시작하죠.',
  },
  8: {
    difficulty: 8,
    characterUid: 'CHAR-052',
    name: '유스티아',
    epithet: '파르페 요정',
    quote: '달콤한 승부도 한 수 한 수 소중히 써야 가장 맛있답니다.',
  },
  9: {
    difficulty: 9,
    characterUid: 'CHAR-055',
    name: '라피나',
    epithet: '아케이드 퀸',
    quote: '몇 판이면 규칙은 다 읽혀. 자, 네 공략은 어디까지 준비됐어?',
  },
  10: {
    difficulty: 10,
    characterUid: 'CHAR-022',
    name: '아스텔',
    epithet: '은하수의 마법사',
    quote: '별의 궤적은 이미 답을 알고 있어. 그래도 네가 어떤 수를 두는지는 보고 싶네.',
  },
};

export function getRakarukaOpponent(difficulty: Difficulty): RakarukaOpponentProfile {
  return RAKARUKA_OPPONENTS[difficulty];
}
