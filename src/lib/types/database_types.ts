// =====================================================================
// B.R.A.N.D 2.0 — Database Type Definitions
// Stage 5 Sub-step 5-C · 생성일 2026-05-20
// =====================================================================
// 이 파일은 Supabase 자동 생성 + 수동 보강의 통합 진입점.
// 
// 자동 생성 명령 (Stage 7 마이그레이션 시):
//   npx supabase gen types typescript --project-id <id> > database.types.ts
// 
// 자동 생성된 파일:
//   - database.types.ts — 61 테이블 · 60+ 함수 · 42 ENUM 모두 포함
//   - 이 파일에서 re-export
// 
// 자동 생성으로 부족한 부분 (이 파일에서 보강):
//   - 도메인별 별칭 타입 (Student, Wallet 등 짧은 이름)
//   - 도메인 ENUM 상수 (TIER_LIST, GRADE_LIST 등)
//   - 한국어 라벨 (UI 표시용)
// =====================================================================

// =====================================================================
// 1. Supabase 자동 생성 타입 re-export
// =====================================================================
// 
// 운영 환경에서 활성화:
// 
// import type { Database } from './database.types';
// 
// // 테이블 row 타입
// export type Tables<T extends keyof Database['public']['Tables']> = 
//   Database['public']['Tables'][T]['Row'];
// 
// // 함수 인자 타입
// export type RpcArgs<T extends keyof Database['public']['Functions']> = 
//   Database['public']['Functions'][T]['Args'];
// 
// // 함수 반환 타입
// export type RpcReturns<T extends keyof Database['public']['Functions']> = 
//   Database['public']['Functions'][T]['Returns'];
// =====================================================================


// =====================================================================
// 2. 도메인별 별칭 타입 (자동 생성 후 활용 예시)
// =====================================================================
// 운영 환경에서 활성화:
// 
// import type { Tables } from './database.types';
// 
// export type Student = Tables<'students'>;
// export type Wallet = Tables<'wallets'>;
// export type Transaction = Tables<'transactions'>;
// export type Achievement = Tables<'achievements'>;
// export type StudentAchievement = Tables<'student_achievements'>;
// export type Guild = Tables<'guilds'>;
// export type GuildMember = Tables<'guild_members'>;
// export type CosmeticItem = Tables<'cosmetic_items'>;
// export type DepositProduct = Tables<'deposit_products'>;
// export type StudentDeposit = Tables<'student_deposits'>;
// export type CreditScore = Tables<'credit_scores'>;
// export type MailMessage = Tables<'mail_messages'>;
// export type Emergency = Tables<'emergencies'>;
// export type Assignment = Tables<'assignments'>;
// export type Classroom = Tables<'classrooms'>;
// =====================================================================


// =====================================================================
// 3. 시스템 ENUM 상수 (런타임 사용)
// =====================================================================

/**
 * 가치 토큰 타입 (Stage 4-A v2 결정)
 * - GOLD/CRYSTAL: 거래·소비·교환 가능
 * - BV: 명예 점수, 교환 불가
 */
export const VALUE_TOKEN_TYPES = ['GOLD', 'BV', 'CRYSTAL'] as const;
export type ValueTokenType = typeof VALUE_TOKEN_TYPES[number];

/**
 * 학생 역할
 */
export const STUDENT_ROLES = ['STUDENT', 'GUARD', 'TEACHER', 'ADMIN', 'TEST'] as const;
export type StudentRole = typeof STUDENT_ROLES[number];

/**
 * 22 티어 (Stage 0 표준, 절대 수정 금지)
 */
export const TIER_LIST = [
    '새싹', '브론즈', '빛나는 브론즈',
    '거친 실버', '성장한 실버', '진화한 실버',
    '은빛 극점',
    '금 광석', '제련된 골드', '정련된 골드', '태양의 황금',
    '루비 원석', '연마된 루비', '각성한 루비', '홍염의 정점',
    '다이아 원석', '세공된 다이아', '무결 다이아',
    '영원의 결정',
    '마스터', '천상의 마스터', '그랜드마스터'
] as const;
export type Tier = typeof TIER_LIST[number];

/**
 * 업적 등급
 */
export const ACHIEVEMENT_GRADES = ['희귀', '유니크', '에픽', '초월', '유일', '히든'] as const;
export type AchievementGrade = typeof ACHIEVEMENT_GRADES[number];

/**
 * 업적 평가 유형
 */
export const ACHIEVEMENT_EVAL_TYPES = ['QUALITATIVE', 'QUANTITATIVE'] as const;
export type AchievementEvalType = typeof ACHIEVEMENT_EVAL_TYPES[number];

/**
 * 업적 신청 상태
 */
export const ACHIEVEMENT_APPLICATION_STATUS = [
    'PENDING', 'PENDING_REVIEW', 'AUTO_APPROVED', 'AUTO_REJECTED',
    'APPROVED', 'REJECTED'
] as const;
export type AchievementApplicationStatus = typeof ACHIEVEMENT_APPLICATION_STATUS[number];

/**
 * 신용 등급
 */
export const CREDIT_GRADES = ['S', 'A+', 'A', 'B+', 'B', 'C', 'D'] as const;
export type CreditGrade = typeof CREDIT_GRADES[number];

/**
 * 길드 멤버 속성 (서열 없음 — 수평적)
 */
export const GUILD_ELEMENTS = ['땅', '물', '빛', '바람', '불'] as const;
export type GuildElement = typeof GUILD_ELEMENTS[number];

/**
 * 비상사태 유형
 */
export const EMERGENCY_TYPES = [
    'HYPERINFLATION', 'EMPLOYMENT_FREEZE', 'ASSET_FREEZE'
] as const;
export type EmergencyType = typeof EMERGENCY_TYPES[number];

/**
 * 출석 상태
 */
export const ATTENDANCE_STATUS = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUS[number];

/**
 * 랭킹 유형
 */
export const RANKING_TYPES = [
    'TIER', 'BRAND_VALUE', 'GOLD_ASSET', 'CRYSTAL_ASSET',
    'ACHIEVEMENT_COUNT', 'CONTRIBUTION'
] as const;
export type RankingType = typeof RANKING_TYPES[number];

/**
 * 꾸미기 구매 조건 타입
 */
export const COSMETIC_CONDITION_TYPES = [
    'NONE', 'ACH_COUNT', 'ACH_GRADE', 'TIER',
    'ASSET', 'BV_THRESHOLD', 'TAX_PAID'
] as const;
export type CosmeticConditionType = typeof COSMETIC_CONDITION_TYPES[number];


// =====================================================================
// 4. 한국어 라벨 매핑 (UI 표시용)
// =====================================================================

export const VALUE_TOKEN_LABELS: Record<ValueTokenType, string> = {
    GOLD: '골드',
    BV: '브랜드가치',
    CRYSTAL: '크리스탈',
};

export const VALUE_TOKEN_EMOJIS: Record<ValueTokenType, string> = {
    GOLD: '🪙',
    BV: '⭐',
    CRYSTAL: '💎',
};

export const STUDENT_ROLE_LABELS: Record<StudentRole, string> = {
    STUDENT: '학생',
    GUARD: '수호대',
    TEACHER: '선생님',
    ADMIN: '관리자',
    TEST: '테스트',
};

export const ACHIEVEMENT_GRADE_COLORS: Record<AchievementGrade, string> = {
    희귀: '#9CA3AF',     // gray-400
    유니크: '#3B82F6',   // blue-500
    에픽: '#A855F7',     // purple-500
    초월: '#F59E0B',     // amber-500
    유일: '#EF4444',     // red-500
    히든: '#000000',     // black
};

export const CREDIT_GRADE_LABELS: Record<CreditGrade, string> = {
    'S': '최우수',
    'A+': '우수+',
    'A': '우수',
    'B+': '양호+',
    'B': '양호',
    'C': '보통',
    'D': '대출불가',
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
    PRESENT: '출석',
    LATE: '지각',
    ABSENT: '결석',
    EXCUSED: '인정결석',
};

export const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
    HYPERINFLATION: '하이퍼인플레이션',
    EMPLOYMENT_FREEZE: '고용 동결',
    ASSET_FREEZE: '자산 동결',
};

export const RANKING_TYPE_LABELS: Record<RankingType, string> = {
    TIER: '티어 순위',
    BRAND_VALUE: 'BV 순위',
    GOLD_ASSET: '골드 자산 순위',
    CRYSTAL_ASSET: '크리스탈 자산 순위',
    ACHIEVEMENT_COUNT: '업적 수 순위',
    CONTRIBUTION: '누적 기부 순위',
};


// =====================================================================
// 5. 티어 헬퍼 함수 (UI 빈번 사용)
// =====================================================================

/**
 * 티어 인덱스 반환 (낮을수록 낮은 티어)
 */
export function getTierIndex(tier: Tier): number {
    return TIER_LIST.indexOf(tier);
}

/**
 * 두 티어 비교 (a > b이면 양수)
 */
export function compareTiers(a: Tier, b: Tier): number {
    return getTierIndex(a) - getTierIndex(b);
}

/**
 * 티어가 임계값 이상인가
 */
export function isTierAtLeast(tier: Tier, threshold: Tier): boolean {
    return getTierIndex(tier) >= getTierIndex(threshold);
}

/**
 * 티어 색상 (UI 표시)
 */
export function getTierColor(tier: Tier): string {
    const index = getTierIndex(tier);
    if (index >= 19) return '#FFD700';      // 마스터+ = 금색
    if (index >= 15) return '#DC2626';      // 다이아 = 빨강
    if (index >= 11) return '#EF4444';      // 루비 = 진빨강
    if (index >= 7) return '#F59E0B';       // 골드 = 주황
    if (index >= 3) return '#94A3B8';       // 실버 = 회색
    return '#92400E';                       // 브론즈 = 갈색
}


// =====================================================================
// 6. 공통 입력 타입 (Zod 스키마와 일치)
// =====================================================================

export interface PaginationInput {
    limit?: number;
    offset?: number;
}

export interface DateRangeInput {
    startDate: string;  // ISO date
    endDate: string;
}

export interface ClassroomScopedInput {
    classroomId: number;
}


// =====================================================================
// 7. 시스템 상수
// =====================================================================

export const SYSTEM_CONSTANTS = {
    // 토큰 교환 (Stage 4-A v2)
    EXCHANGE_RATE_GOLD_TO_CRYSTAL: 2,    // 골드 2 → 크리스탈 1
    EXCHANGE_RATE_CRYSTAL_TO_GOLD: 1,    // 크리스탈 1 → 골드 2
    
    // 세금
    DEFAULT_INCOME_TAX_RATE: 0.10,       // 10%
    
    // 경매
    MAX_AUCTION_ATTEMPTS: 3,
    AUCTION_PRICE_DECREASE_PER_FAIL: 0.10,  // 10% 인하
    
    // 신용점수
    CREDIT_SCORE_MAX: 1000,
    CREDIT_SCORE_WEIGHTS: {
        track_a: 0.30,
        investment: 0.25,
        social: 0.20,
        norm: 0.25,
    },
    
    // 길드 GS
    GUILD_GS_WEIGHTS: {
        alpha: 0.50,         // BV 증가량
        participation: 0.15, // 미션 참여
        attendance: 0.10,    // 세션 출석
    },
    
    // 출석 마일스톤
    ATTENDANCE_MILESTONE_DAYS: [3, 7, 14, 28] as const,
    
    // 자동 평가 검토 윈도우
    REVIEW_WINDOW_HOURS: 24,
    
    // 활동 피드
    ACTIVITY_FEED_DISPLAY_HOURS: 48,
} as const;
