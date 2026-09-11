export const RECORDS_LEGACY_PATHS = [
  {
    code: 'GRANDMASTER_LINEAGE',
    numeral: 'Ⅰ',
    title: '정상에 오른 자들의 길',
    officialRecord: '역대 그랜드마스터 달성자 · 6인',
    holder: '여섯 명의 그랜드마스터',
    meaning: 'B.R.A.N.D에서 가장 높은 티어의 정점에 도달했던 사람들의 계보를 잇는 길입니다.',
  },
  {
    code: 'FIRST_50000_GOLD',
    numeral: 'Ⅱ',
    title: '황금의 개척자',
    officialRecord: '최초의 50,000 GOLD 보유 · 이혜준',
    holder: '이혜준',
    meaning: '누구보다 먼저 큰 자산의 벽을 넘어 새로운 경제 기록을 열었던 길입니다.',
  },
  {
    code: 'HIGHEST_BV',
    numeral: 'Ⅲ',
    title: '가장 높은 이름',
    officialRecord: '역대 최고 BV · 115,300 · 김승현',
    holder: '김승현',
    meaning: '오랜 시간 여러 활동과 성취를 쌓아 가장 높은 BV에 도달한 기록의 길입니다.',
  },
  {
    code: 'HIGHEST_ASSETS',
    numeral: 'Ⅳ',
    title: '황금의 정점',
    officialRecord: '역대 최고 자산 보유량 · 최민재',
    holder: '최민재',
    meaning: 'B.R.A.N.D 역사상 가장 큰 자산 규모에 도달한 기록의 길입니다.',
  },
  {
    code: 'MOST_MVP_NOMINATIONS',
    numeral: 'Ⅴ',
    title: '왕관에 가장 가까웠던 자',
    officialRecord: '역대 최다 월간 MVP 후보 · 7회 · 김승현',
    holder: '김승현',
    meaning: '한 번의 순간이 아니라 여러 달에 걸쳐 반복해서 최상위 경쟁권에 이름을 올린 길입니다.',
  },
  {
    code: 'HIGHEST_MONTHLY_BV_GAIN',
    numeral: 'Ⅵ',
    title: '가장 가파른 비상',
    officialRecord: '역대 최고 월간 BV 상승 · +17,700 · 김승현',
    holder: '김승현',
    meaning: '한 달이라는 제한된 시간 안에서 가장 큰 성장 폭을 만들어낸 기록의 길입니다.',
  },
] as const;

export type RecordsLegacyPathCode = (typeof RECORDS_LEGACY_PATHS)[number]['code'];

export function getRecordsLegacyPath(code: string | null | undefined) {
  return RECORDS_LEGACY_PATHS.find((path) => path.code === code) ?? null;
}
