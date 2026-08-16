// =====================================================================
// B.R.A.N.D 2.0 — Error Code Mapping
// Stage 5 Sub-step 5-A · 생성일 2026-05-20
// =====================================================================
// PostgreSQL 에러 코드 (P0001~P0410+) → 한국어 사용자 메시지
// Stage 4에서 정의한 모든 에러 코드 매핑
//
// 사용 방법:
//   const message = getUserFriendlyError(error);
//   showToast(message);
// =====================================================================

/**
 * Supabase에서 발생하는 PostgresError 타입
 */
export interface PostgresError {
  message: string;
  details?: string;
  hint?: string;
  code: string; // PostgreSQL SQLSTATE 코드 (예: 'P0001')
}

/**
 * 에러 메시지 카테고리
 * UI에서 다른 색상·아이콘으로 표시 가능
 */
export type ErrorCategory =
  | "VALIDATION" // 입력 검증 실패 (학생 본인 잘못)
  | "PERMISSION" // 권한 부족
  | "BUSINESS" // 비즈니스 규칙 위반 (잔액 부족 등)
  | "STATE" // 상태 충돌 (이미 처리됨 등)
  | "NOT_FOUND" // 대상 없음
  | "SYSTEM"; // 시스템 오류 (재시도 권장)

/**
 * 에러 메시지 정보
 */
export interface ErrorMessage {
  category: ErrorCategory;
  title: string; // 짧은 제목 (Toast 헤더)
  description?: string; // 자세한 설명 (필요 시)
  hint?: string; // 사용자에게 안내할 행동
}

// =====================================================================
// 에러 코드 → 메시지 매핑 (학생용 한국어)
// =====================================================================

export const ERROR_MESSAGES: Record<string, ErrorMessage> = {
  // ===================================================================
  // P0001~P0009 — Aggregate Root (create_transaction) 에러
  // ===================================================================
  P0001: {
    category: "NOT_FOUND",
    title: "학생을 찾을 수 없어요",
    description: "시스템에서 해당 학생 정보를 찾을 수 없습니다.",
    hint: "로그인 상태를 확인하거나 선생님께 알려주세요.",
  },
  P0002: {
    category: "STATE",
    title: "비활성 학생이에요",
    description: "전출했거나 시스템에서 비활성화된 학생입니다.",
    hint: "선생님께 문의해주세요.",
  },
  P0003: {
    category: "SYSTEM",
    title: "지갑을 찾을 수 없어요",
    description: "학생 지갑이 생성되지 않았습니다.",
    hint: "잠시 후 다시 시도하거나 선생님께 알려주세요.",
  },
  P0004: {
    category: "BUSINESS",
    title: "잔액이 부족해요",
    description: "거래에 필요한 화폐가 부족합니다.",
    hint: "일일퀘스트나 출석으로 자산을 모은 후 다시 시도하세요.",
  },
  P0005: { category: "VALIDATION", title: "거래 금액이 허용 범위를 초과했어요" },
  P0006: { category: "VALIDATION", title: "세금 금액이 올바르지 않아요" },

  // ===================================================================
  // P0010~P0019 — Token Exchange (exchange_token) 에러
  // ===================================================================
  P0010: {
    category: "BUSINESS",
    title: "BV는 교환할 수 없어요",
    description:
      "BV(브랜드가치)는 명예 점수이므로 다른 화폐로 교환할 수 없습니다.",
    hint: "골드와 크리스탈만 교환 가능합니다.",
  },
  P0011: {
    category: "VALIDATION",
    title: "교환 금액이 잘못됐어요",
    description: "교환 금액은 0보다 커야 합니다.",
  },
  P0012: {
    category: "VALIDATION",
    title: "교환 단위를 확인해주세요",
    description: "교환 금액은 현재 학급에 설정된 교환 비율의 배수여야 합니다.",
    hint: "화면에 표시된 교환 단위 버튼을 사용해보세요.",
  },

  // ===================================================================
  // P0020~P0029 — P2P Transfer 에러
  // ===================================================================
  P0020: {
    category: "VALIDATION",
    title: "자기 자신에게 송금할 수 없어요",
    description: "받는 친구를 다시 선택해주세요.",
  },
  P0021: {
    category: "VALIDATION",
    title: "송금 금액이 잘못됐어요",
    description: "송금 금액은 0보다 커야 합니다.",
  },
  P0022: {
    category: "STATE",
    title: "비활성 학생이에요",
    description: "받는 친구가 시스템에서 비활성 상태입니다.",
    hint: "다른 친구에게 송금해보세요.",
  },
  P0023: {
    category: "PERMISSION",
    title: "다른 학급 학생에게는 송금할 수 없어요",
    description: "같은 학급의 친구에게만 송금 가능합니다.",
  },
  P0025: {
    category: "VALIDATION",
    title: "거래 평점을 확인해주세요",
    description: "평점은 1점부터 10점 사이여야 합니다.",
  },
  P0026: {
    category: "VALIDATION",
    title: "거래 수량을 확인해주세요",
    description: "수량은 1 이상의 정수여야 합니다.",
  },
  P0027: {
    category: "VALIDATION",
    title: "송금 태그가 너무 길어요",
    description: "태그는 50자 이하로 입력해주세요.",
  },
  P0028: {
    category: "VALIDATION",
    title: "송금 메모가 너무 길어요",
    description: "메모는 200자 이하로 입력해주세요.",
  },

  // ===================================================================
  // P0030~P0039 — Reverse Transaction 에러
  // ===================================================================
  P0030: {
    category: "NOT_FOUND",
    title: "원본 거래를 찾을 수 없어요",
    description: "회수할 거래를 찾을 수 없습니다.",
  },
  P0031: {
    category: "STATE",
    title: "이미 회수된 거래예요",
    description: "이 거래는 이미 회수 처리되었습니다.",
  },

  // ===================================================================
  // P0040~P0049 — School Terms 설정 에러
  // ===================================================================
  P0040: {
    category: "NOT_FOUND",
    title: "학급을 찾을 수 없어요",
    description: "존재하지 않는 학급입니다.",
  },
  P0041: {
    category: "VALIDATION",
    title: "1학기 일자가 잘못됐어요",
    description: "1학기 시작일이 종료일보다 늦거나 같습니다.",
    hint: "학사일정을 확인하고 다시 입력해주세요.",
  },
  P0042: {
    category: "VALIDATION",
    title: "2학기 일자가 잘못됐어요",
    description: "2학기 시작일이 종료일보다 늦거나 같습니다.",
  },
  P0043: {
    category: "VALIDATION",
    title: "학기 일자가 겹쳐요",
    description: "1학기 종료일이 2학기 시작일보다 늦거나 같습니다.",
    hint: "1학기는 2학기 시작 전에 끝나야 합니다.",
  },

  // ===================================================================
  // P0050~P0069 — Snack Market 에러
  // ===================================================================
  P0050: {
    category: "NOT_FOUND",
    title: "간식을 찾을 수 없어요",
  },
  P0060: {
    category: "VALIDATION",
    title: "구매 수량이 잘못됐어요",
    description: "구매 수량은 0보다 커야 합니다.",
  },
  P0061: {
    category: "STATE",
    title: "간식 판매가 중단됐어요",
    description: "현재 이 간식은 판매하지 않습니다.",
  },
  P0062: {
    category: "PERMISSION",
    title: "다른 학급 간식은 구매할 수 없어요",
  },
  P0063: {
    category: "BUSINESS",
    title: "재고가 부족해요",
    description: "요청한 수량보다 재고가 적습니다.",
    hint: "수량을 줄이거나 다음 입고를 기다려주세요.",
  },
  P0064: {
    category: "BUSINESS",
    title: "주간 구매 한도를 초과했어요",
    description: "이번 주에 구매할 수 있는 한도를 초과했습니다.",
    hint: "다음 주에 다시 구매하세요.",
  },

  // ===================================================================
  // P0070~P0089 — Auction 에러
  // ===================================================================
  P0070: {
    category: "VALIDATION",
    title: "낙찰가가 잘못됐어요",
    description: "낙찰가는 0보다 커야 합니다.",
  },
  P0071: {
    category: "VALIDATION",
    title: "시도 횟수가 잘못됐어요",
    description: "경매 시도는 1, 2, 3차 중 하나여야 합니다.",
  },
  P0072: {
    category: "NOT_FOUND",
    title: "경매 상품을 찾을 수 없어요",
  },
  P0073: {
    category: "STATE",
    title: "이미 종료된 경매예요",
    description: "낙찰 또는 최종 유찰된 상품입니다.",
  },
  P0074: {
    category: "STATE",
    title: "경매가 진행 중이 아니에요",
    description: "경매 회차가 진행 중일 때만 낙찰 처리 가능합니다.",
  },
  P0075: {
    category: "PERMISSION",
    title: "다른 학급 경매에는 참여할 수 없어요",
  },
  P0080: {
    category: "NOT_FOUND",
    title: "경매 상품을 찾을 수 없어요",
  },
  P0081: {
    category: "STATE",
    title: "이미 종료된 경매예요",
  },
  P0082: {
    category: "STATE",
    title: "시도 횟수가 맞지 않아요",
    description: "현재 시도 회차와 유찰 유형이 일치하지 않습니다.",
  },
  P0090: {
    category: "VALIDATION",
    title: "입찰가가 잘못됐어요",
  },

  // ===================================================================
  // P0701~P0733 — 실시간 온라인 경매
  // ===================================================================
  P0701: { category: "NOT_FOUND", title: "경매 회차를 찾을 수 없어요" },
  P0702: { category: "PERMISSION", title: "다른 학급 경매에는 접근할 수 없어요" },
  P0703: { category: "NOT_FOUND", title: "경매 상품을 찾을 수 없어요" },
  P0704: { category: "VALIDATION", title: "경매 회차를 확인해주세요" },
  P0705: { category: "VALIDATION", title: "학년도를 확인해주세요" },
  P0706: { category: "VALIDATION", title: "타이머 설정을 확인해주세요", description: "시작 시간은 10~300초, 연장 시간은 5~60초여야 합니다." },
  P0707: { category: "STATE", title: "이미 열린 경매가 있어요", description: "준비 중이거나 진행 중인 경매를 먼저 완료해주세요." },
  P0708: { category: "STATE", title: "완료된 경매는 수정할 수 없어요" },
  P0709: { category: "STATE", title: "상품 진행 중에는 목록을 바꿀 수 없어요" },
  P0710: { category: "VALIDATION", title: "상품명을 확인해주세요" },
  P0711: { category: "VALIDATION", title: "카테고리 또는 이모지가 너무 길어요" },
  P0712: { category: "VALIDATION", title: "시작가를 확인해주세요" },
  P0713: { category: "STATE", title: "입찰 이력이 있는 상품은 수정할 수 없어요" },
  P0714: { category: "VALIDATION", title: "상품 정보가 올바르지 않아요" },
  P0715: { category: "STATE", title: "진행 또는 입찰 이력이 있는 상품은 삭제할 수 없어요" },
  P0716: { category: "VALIDATION", title: "상품 이동 방향이 올바르지 않아요" },
  P0717: { category: "STATE", title: "준비 상태의 경매만 시작할 수 있어요" },
  P0718: { category: "STATE", title: "상품을 먼저 등록해주세요" },
  P0719: { category: "STATE", title: "경매 회차를 먼저 시작해주세요" },
  P0720: { category: "STATE", title: "이미 진행 중인 상품이 있어요" },
  P0721: { category: "STATE", title: "이미 종료된 상품이에요" },
  P0722: { category: "STATE", title: "일시정지할 수 없는 상태예요" },
  P0723: { category: "STATE", title: "재개할 수 없는 상태예요" },
  P0724: { category: "PERMISSION", title: "같은 학급의 활성 학생만 입찰할 수 있어요" },
  P0725: { category: "STATE", title: "현재 입찰 가능한 상품이 아니에요" },
  P0726: { category: "STATE", title: "입찰 시간이 종료됐어요" },
  P0727: { category: "VALIDATION", title: "현재가보다 높은 금액을 입력해주세요" },
  P0728: { category: "STATE", title: "이미 최고 입찰자예요", description: "다른 학생이 더 높은 금액으로 입찰할 때까지 기다려주세요." },
  P0729: { category: "BUSINESS", title: "입찰할 GOLD가 부족해요" },
  P0730: { category: "STATE", title: "유효한 입찰이 있어 수동 유찰할 수 없어요" },
  P0731: { category: "STATE", title: "진행 중인 상품이 있어요" },
  P0732: { category: "STATE", title: "아직 종료되지 않은 상품이 있어요" },
  P0733: { category: "BUSINESS", title: "최고 입찰액이 예약되어 있어요", description: "낙찰 정산 전까지 예약액을 제외한 GOLD만 사용할 수 있습니다." },
  P0734: { category: "STATE", title: "준비 상태의 경매만 삭제할 수 있어요" },
  P0735: { category: "STATE", title: "입찰 기록이 있는 경매는 삭제할 수 없어요" },

  // Feature 4 fault domains — 오류 코드만 봐도 모듈을 찾을 수 있음
  P4A10: { category: "PERMISSION", title: "[F4A] 학생 로그인이 필요해요" },
  P4A11: { category: "NOT_FOUND", title: "[F4A] 우편을 찾을 수 없어요" },
  P4A12: { category: "NOT_FOUND", title: "[F4A] 알림을 찾을 수 없어요" },
  P4A13: { category: "PERMISSION", title: "[F4A] 다른 학급 알림에는 접근할 수 없어요" },
  P4A20: { category: "PERMISSION", title: "[F4A] 담당 학급만 관리할 수 있어요" },
  P4A21: { category: "VALIDATION", title: "[F4A] 수신자를 확인해주세요" },
  P4A22: { category: "VALIDATION", title: "[F4A] 우편 제목을 확인해주세요" },
  P4A23: { category: "VALIDATION", title: "[F4A] 우편 내용을 확인해주세요" },
  P4A24: { category: "VALIDATION", title: "[F4A] 잘못된 수신 학생이 포함됐어요" },
  P4A25: { category: "VALIDATION", title: "[F4A] 알림 내용을 확인해주세요" },
  P4A26: { category: "VALIDATION", title: "[F4A] 알림 만료시간을 확인해주세요" },
  P4A27: { category: "VALIDATION", title: "[F4A] 수신자 목록에 중복이 있어요" },
  P4B10: { category: "PERMISSION", title: "[F4B] 담당 학급만 운영할 수 있어요" },
  P4B11: { category: "STATE", title: "[F4B] 같은 비상사태가 이미 발동 중이에요" },
  P4B12: { category: "VALIDATION", title: "[F4B] 비상사태 종료시간을 확인해주세요" },
  P4B13: { category: "STATE", title: "[F4B] 이미 종료됐거나 없는 비상사태예요" },
  P4B14: { category: "PERMISSION", title: "[F4B] 같은 학급 구성원만 상태를 정리할 수 있어요" },
  P4B15: { category: "VALIDATION", title: "[F4B] 비상사태 사유가 너무 길어요" },
  P4B20: { category: "VALIDATION", title: "[F4B] 퀘스트 제목을 확인해주세요" },
  P4B21: { category: "VALIDATION", title: "[F4B] 퀘스트 설명을 확인해주세요" },
  P4B22: { category: "VALIDATION", title: "[F4B] 퀘스트 보상을 확인해주세요" },
  P4B23: { category: "VALIDATION", title: "[F4B] 퀘스트 제한시간을 확인해주세요" },
  P4B24: { category: "NOT_FOUND", title: "[F4B] 돌발 퀘스트를 찾을 수 없어요" },
  P4B25: { category: "NOT_FOUND", title: "[F4B] 학생 정보를 확인할 수 없어요" },
  P4B26: { category: "PERMISSION", title: "[F4B] 다른 학급 퀘스트예요" },
  P4B27: { category: "STATE", title: "[F4B] 지금은 완료할 수 없는 퀘스트예요" },
  P4B28: { category: "STATE", title: "[F4B] 이미 완료한 퀘스트예요" },
  P4B30: { category: "VALIDATION", title: "[F4B] 수호대 임기 날짜를 확인해주세요" },
  P4B31: { category: "VALIDATION", title: "[F4B] 수호대 학생을 확인해주세요" },
  P4B32: { category: "STATE", title: "[F4B] 겹치는 수호대 임기가 있어요" },
  P4B33: { category: "NOT_FOUND", title: "[F4B] 수호대 임기를 찾을 수 없어요" },
  P4B34: { category: "VALIDATION", title: "[F4B] 수호대 메모가 너무 길어요" },
  P4C10: { category: "STATE", title: "[F4C] 현재 제출할 수 없는 과제예요" },
  P4C11: { category: "PERMISSION", title: "[F4C] 다른 학급 과제예요" },
  P4C12: { category: "STATE", title: "[F4C] 이미 제출한 과제예요" },
  P4C13: { category: "VALIDATION", title: "[F4C] 제출 내용이 너무 길어요" },
  P4C14: { category: "VALIDATION", title: "[F4C] 첨부 목록 형식이 올바르지 않아요" },
  P4C15: { category: "VALIDATION", title: "[F4C] 제출 내용이나 첨부 링크를 입력해주세요" },
  P4C16: { category: "VALIDATION", title: "[F4C] 첨부는 최대 5개까지 가능해요" },
  P4C17: { category: "VALIDATION", title: "[F4C] 첨부 링크는 http(s) 주소여야 해요" },
  P4C20: { category: "NOT_FOUND", title: "[F4C] 제출물을 찾을 수 없어요" },
  P4C21: { category: "PERMISSION", title: "[F4C] 담당 학급만 관리할 수 있어요" },
  P4C22: { category: "STATE", title: "[F4C] 이미 채점한 제출물이에요" },
  P4C23: { category: "VALIDATION", title: "[F4C] 점수 범위를 확인해주세요" },
  P4C24: { category: "NOT_FOUND", title: "[F4C] 제출물의 과제를 찾을 수 없어요" },
  P4C25: { category: "VALIDATION", title: "[F4C] 피드백이 너무 길어요" },
  P4C30: { category: "VALIDATION", title: "[F4C] 과제 제목을 확인해주세요" },
  P4C31: { category: "VALIDATION", title: "[F4C] 마감일은 미래여야 해요" },
  P4C32: { category: "VALIDATION", title: "[F4C] 점수·보상 설정을 확인해주세요" },
  P4C33: { category: "NOT_FOUND", title: "[F4C] 과제를 찾을 수 없어요" },
  P4C34: { category: "VALIDATION", title: "[F4C] 과제 설명 또는 과목명이 너무 길어요" },
  P4C35: { category: "STATE", title: "[F4C] 마감일이 지난 과제는 공개할 수 없어요" },
  P4C40: { category: "VALIDATION", title: "[F4C] 일괄 출석은 오늘 날짜만 가능해요" },
  P4C41: { category: "VALIDATION", title: "[F4C] 출석 입력 인원을 확인해주세요" },
  P4C42: { category: "VALIDATION", title: "[F4C] 출석 입력 형식이 올바르지 않아요" },
  P4C43: { category: "VALIDATION", title: "[F4C] 출석 학생을 확인해주세요" },
  P4C44: { category: "VALIDATION", title: "[F4C] 출석 정정 사유를 입력해주세요" },
  P4C45: { category: "NOT_FOUND", title: "[F4C] 출석 기록을 찾을 수 없어요" },
  P4C46: { category: "STATE", title: "[F4C] 자동 정정은 오늘 출석만 가능해요" },
  P4C47: { category: "VALIDATION", title: "[F4C] 출석 목록에 같은 학생이 중복되어 있어요" },
  P4D10: { category: "PERMISSION", title: "[F4D] 담당 학급만 관리할 수 있어요" },
  P4D11: { category: "VALIDATION", title: "[F4D] 미래 날짜 통계는 만들 수 없어요" },
  P4D20: { category: "VALIDATION", title: "[F4D] 기록 분류와 제목을 확인해주세요" },
  P4D21: { category: "VALIDATION", title: "[F4D] 기록 학생이 담당 학급과 다릅니다" },
  P4D22: { category: "NOT_FOUND", title: "[F4D] 기록 항목을 찾을 수 없어요" },
  P4D30: { category: "SYSTEM", title: "[F4D] 담당 학급을 확인할 수 없어요" },

  // ===================================================================
  // P0100~P0109 — DSL Evaluation 에러
  // ===================================================================
  P0100: {
    category: "SYSTEM",
    title: "평가 규칙에 문제가 있어요",
    description: "업적 평가 규칙이 안전성 검증을 통과하지 못했습니다.",
    hint: "선생님께 알려주세요.",
  },
  P0101: {
    category: "SYSTEM",
    title: "평가 규칙 형식 오류",
    description: "업적 평가 필터가 올바르지 않습니다.",
  },
  P0102: {
    category: "SYSTEM",
    title: "알 수 없는 평가 유형",
  },

  // ===================================================================
  // P0110~P0129 — Achievement 에러
  // ===================================================================
  P0110: {
    category: "NOT_FOUND",
    title: "업적을 찾을 수 없어요",
    description: "업적이 비활성화되었거나 존재하지 않습니다.",
  },
  P0111: {
    category: "STATE",
    title: "비활성 학생이에요",
  },
  P0112: {
    category: "STATE",
    title: "이미 달성한 업적이에요",
    description: "이 업적을 이미 보유 중입니다.",
  },
  P0120: {
    category: "NOT_FOUND",
    title: "업적을 찾을 수 없어요",
  },
  P0121: {
    category: "STATE",
    title: "비활성 학생이에요",
  },
  P0122: {
    category: "STATE",
    title: "이미 달성한 업적이에요",
    description: "이 업적은 이미 받았습니다.",
  },
  P0123: {
    category: "STATE",
    title: "이미 신청한 업적이에요",
    description: "이전 신청이 검토 중입니다. 결과를 기다려주세요.",
  },
  P0130: {
    category: "NOT_FOUND",
    title: "학생 업적을 찾을 수 없어요",
  },
  P0131: {
    category: "STATE",
    title: "이미 회수된 업적이에요",
  },
  P0140: {
    category: "NOT_FOUND",
    title: "업적 신청을 찾을 수 없어요",
  },
  P0141: {
    category: "STATE",
    title: "검토할 수 없는 상태예요",
    description: "대기 중이거나 자동 승인된 신청만 검토 가능합니다.",
  },
  P0142: {
    category: "STATE",
    title: "검토 기간이 종료됐어요",
    description: "자동 승인 후 24시간이 지나서 더 이상 회수할 수 없습니다.",
    hint: "필요시 거래 회수 함수를 사용해주세요.",
  },
  P0150: {
    category: "PERMISSION",
    title: "소유한 업적이 아니에요",
    description: "본인이 보유한 업적만 장착할 수 있습니다.",
  },

  // ===================================================================
  // P0160~P0169 — Guild Mission 에러
  // ===================================================================
  P0160: {
    category: "NOT_FOUND",
    title: "미션 로그를 찾을 수 없어요",
  },
  P0161: {
    category: "STATE",
    title: "이미 평가된 미션이에요",
  },
  P0162: {
    category: "VALIDATION",
    title: "정성 점수가 최대치를 초과했어요",
  },
  P0163: {
    category: "VALIDATION",
    title: "시너지 점수가 최대치를 초과했어요",
  },
  // Guild 2A — GS Engine / 개인 기여도
  P0164: {
    category: "VALIDATION",
    title: "선택한 월 형식을 확인해주세요",
    description: "월은 YYYY-MM 형식으로 선택해야 합니다.",
  },
  P0165: {
    category: "NOT_FOUND",
    title: "선택한 월에 해당하는 길드 시즌이 없어요",
    description: "길드 시즌의 시작일과 종료일을 먼저 확인해주세요.",
  },
  P0166: {
    category: "PERMISSION",
    title: "이 학급의 길드 점수에는 접근할 수 없어요",
  },
  P0167: {
    category: "VALIDATION",
    title: "길드 점수 입력 내용을 확인해주세요",
  },
  P0168: {
    category: "NOT_FOUND",
    title: "필요한 길드 기록을 찾을 수 없어요",
  },
  P0169: {
    category: "STATE",
    title: "이미 취소된 길드 기여 기록이에요",
  },

  // ===================================================================
  // P0170~P0199 — Cosmetic 에러
  // ===================================================================
  P0170: {
    category: "NOT_FOUND",
    title: "가격 옵션을 찾을 수 없어요",
  },
  P0171: {
    category: "VALIDATION",
    title: "가격 옵션이 아이템과 맞지 않아요",
  },
  P0172: {
    category: "NOT_FOUND",
    title: "꾸미기 아이템을 찾을 수 없어요",
    description: "아이템이 비활성화됐거나 존재하지 않습니다.",
  },
  P0173: {
    category: "BUSINESS",
    title: "구매 조건을 충족하지 못해요",
    // description은 동적으로 채워야 함 (조건 description 사용)
    hint: "조건을 확인하고 다시 도전해보세요.",
  },
  P0174: {
    category: "BUSINESS",
    title: "추가 조건을 충족하지 못해요",
  },
  P0175: {
    category: "BUSINESS",
    title: "시즌이 종료됐거나 아직 시작 전이에요",
    description: "한정 시즌 아이템은 정해진 기간에만 구매 가능합니다.",
  },
  P0176: {
    category: "STATE",
    title: "이미 보유한 아이템이에요",
  },
  P0180: {
    category: "STATE",
    title: "이미 보유한 아이템이에요",
  },
  P0190: {
    category: "NOT_FOUND",
    title: "소유 아이템을 찾을 수 없어요",
  },

  // ===================================================================
  // P0200~P0229 — Job 에러
  // ===================================================================
  P0200: {
    category: "STATE",
    title: "비활성 학생이에요",
  },
  P0201: {
    category: "BUSINESS",
    title: "2차직업 슬롯이 가득 찼어요",
    description: "현재 슬롯 한도에 도달했습니다.",
    hint: "BV로 슬롯을 확장하거나 기존 직업을 정리해주세요.",
  },
  P0202: {
    category: "STATE",
    title: "같은 이름으로 이미 신청했어요",
    description: "대기 중인 신청이 있습니다. 결과를 기다려주세요.",
  },
  P0210: {
    category: "NOT_FOUND",
    title: "신청을 찾을 수 없어요",
  },
  P0211: {
    category: "STATE",
    title: "이미 처리된 신청이에요",
  },
  P0220: {
    category: "NOT_FOUND",
    title: "시장 요청을 찾을 수 없어요",
  },
  P0221: {
    category: "STATE",
    title: "매칭된 요청만 완료할 수 있어요",
  },

  // ===================================================================
  // P0230~P0249 — Finance 에러
  // ===================================================================
  P0230: {
    category: "NOT_FOUND",
    title: "예금 상품을 찾을 수 없어요",
  },
  P0231: {
    category: "VALIDATION",
    title: "예금 금액이 범위를 벗어났어요",
    // description 동적: min/max 정보 포함
  },
  P0232: {
    category: "VALIDATION",
    title: "예금 기간은 1-4주여야 해요",
  },
  P0233: {
    category: "PERMISSION",
    title: "다른 학급 예금은 가입할 수 없어요",
  },
  P0234: {
    category: "SYSTEM",
    title: "해당 기간 이자율이 정의되지 않았어요",
    hint: "선생님께 알려주세요.",
  },
  P0240: {
    category: "NOT_FOUND",
    title: "예금을 찾을 수 없어요",
  },
  P0241: {
    category: "STATE",
    title: "활성 예금이 아니에요",
    description: "이미 만기되었거나 해지된 예금입니다.",
  },

  // ===================================================================
  // P0250~P0259 — Communication 에러
  // ===================================================================
  P0250: {
    category: "NOT_FOUND",
    title: "수신자를 찾을 수 없어요",
  },

  // ===================================================================
  // P0300~P0349 — Operations 에러
  // ===================================================================
  P0300: {
    category: "STATE",
    title: "같은 비상사태가 이미 활성 상태예요",
  },
  P0310: {
    category: "STATE",
    title: "활성 비상사태가 아니에요",
  },
  P0320: {
    category: "NOT_FOUND",
    title: "일일퀘스트를 찾을 수 없어요",
  },
  P0321: {
    category: "STATE",
    title: "비활성 학생이에요",
  },
  P0322: {
    category: "STATE",
    title: "오늘 이미 완료한 퀘스트예요",
    hint: "내일 다시 도전해보세요!",
  },
  P0330: {
    category: "STATE",
    title: "비활성 학생이에요",
  },
  P0331: {
    category: "STATE",
    title: "오늘 이미 출석했어요",
  },
  P0340: {
    category: "BUSINESS",
    title: "복지기금이 부족해요",
  },
  P0341: {
    category: "BUSINESS",
    title: "분배 대상 학생이 없어요",
  },

  // ===================================================================
  // P0400~P0419 — Assignment 에러
  // ===================================================================
  P0400: {
    category: "NOT_FOUND",
    title: "과제를 찾을 수 없어요",
    description: "비공개 또는 존재하지 않는 과제입니다.",
  },
  P0401: {
    category: "PERMISSION",
    title: "다른 학급 과제는 제출할 수 없어요",
  },
  P0402: {
    category: "STATE",
    title: "이미 제출한 과제예요",
  },
  P0410: {
    category: "NOT_FOUND",
    title: "제출을 찾을 수 없어요",
  },
  P0411: {
    category: "STATE",
    title: "이미 평가된 제출이에요",
  },
  P0412: {
    category: "VALIDATION",
    title: "점수가 범위를 벗어났어요",
    description: "0점부터 만점 사이의 점수를 입력해주세요.",
  },

  // ===================================================================
  // P0600~P0608 — 교사 자산 지급·차감
  // ===================================================================
  P0600: {
    category: "PERMISSION",
    title: "로그인이 필요해요",
    description: "교사 세션을 확인할 수 없습니다.",
    hint: "다시 로그인한 뒤 시도해주세요.",
  },
  P0601: {
    category: "VALIDATION",
    title: "학생을 선택해주세요",
    description: "자산을 변경할 학생을 한 명 이상 선택해야 합니다.",
  },
  P0602: {
    category: "VALIDATION",
    title: "선택 인원이 너무 많아요",
    description: "한 번에 최대 100명까지 처리할 수 있습니다.",
  },
  P0603: {
    category: "VALIDATION",
    title: "학생 선택을 확인해주세요",
    description: "중복되거나 잘못된 학생 정보가 포함되어 있습니다.",
  },
  P0604: {
    category: "VALIDATION",
    title: "지원하지 않는 자산이에요",
    description: "교사 패널에서는 BV와 골드만 조정할 수 있습니다.",
  },
  P0605: {
    category: "VALIDATION",
    title: "금액을 확인해주세요",
    description: "금액은 1 이상 10,000,000 이하의 정수여야 합니다.",
  },
  P0606: {
    category: "VALIDATION",
    title: "사유를 확인해주세요",
    description: "지급·차감 사유를 2자 이상 200자 이하로 입력해주세요.",
  },
  P0607: {
    category: "PERMISSION",
    title: "담당 학급을 확인할 수 없어요",
    description: "현재 교사 계정에 연결된 활성 학급이 없습니다.",
  },
  P0608: {
    category: "PERMISSION",
    title: "처리할 수 없는 학생이 포함되어 있어요",
    description: "담당 학급의 활성 학생만 자산을 변경할 수 있습니다.",
  },

  // ===================================================================
  // P0610~P0613 — 학생 기본 경제 행동
  // ===================================================================
  P0610: {
    category: "PERMISSION",
    title: "로그인이 필요해요",
    description: "현재 로그인 세션을 확인할 수 없습니다.",
    hint: "다시 로그인한 뒤 시도해주세요.",
  },
  P0611: {
    category: "STATE",
    title: "현재 자산동결 상태예요",
    description: "자산동결 비상사태가 끝난 뒤 다시 시도해주세요.",
  },
  P0612: {
    category: "VALIDATION",
    title: "기부 내용을 확인해주세요",
    description: "기부 금액은 1 이상이며 메시지는 200자 이하여야 합니다.",
  },
  P0613: {
    category: "BUSINESS",
    title: "이 기부는 지금 취소할 수 없어요",
    description: "기부금 일부가 이미 분배되어 복지기금 잔액이 부족합니다.",
  },

  // ===================================================================
  // P0620~P0625 — 교사 거래 취소·정정
  // ===================================================================
  P0620: {
    category: "NOT_FOUND",
    title: "거래를 찾을 수 없어요",
    description: "거래가 삭제됐거나 더 이상 존재하지 않습니다.",
  },
  P0621: {
    category: "PERMISSION",
    title: "담당 학급 거래가 아니에요",
    description: "현재 담당 학급의 거래만 취소할 수 있습니다.",
  },
  P0622: {
    category: "STATE",
    title: "이미 취소된 거래예요",
    description: "같은 거래를 두 번 취소할 수 없습니다.",
  },
  P0623: {
    category: "BUSINESS",
    title: "이 거래는 여기서 취소할 수 없어요",
    description: "전용 취소 절차가 필요한 거래 유형입니다.",
  },
  P0624: {
    category: "VALIDATION",
    title: "취소 사유를 확인해주세요",
    description: "취소 사유를 2자 이상 200자 이하로 입력해주세요.",
  },
  P0625: {
    category: "SYSTEM",
    title: "연결된 경제 기록을 찾을 수 없어요",
    description: "원본 거래와 상세 기록의 연결이 불완전합니다.",
    hint: "작업을 중단하고 관리자에게 알려주세요.",
  },
};

// =====================================================================
// PostgreSQL 표준 에러 코드 매핑 (시스템 에러)
// =====================================================================

export const POSTGRES_STANDARD_ERRORS: Record<string, ErrorMessage> = {
  "23505": {
    category: "STATE",
    title: "중복된 데이터예요",
    description: "같은 정보가 이미 존재합니다.",
  },
  "23503": {
    category: "BUSINESS",
    title: "참조 오류",
    description: "관련된 데이터가 없거나 손상되었습니다.",
    hint: "잠시 후 다시 시도해주세요.",
  },
  "23502": {
    category: "VALIDATION",
    title: "필수 정보가 빠졌어요",
  },
  "23514": {
    category: "VALIDATION",
    title: "입력값 조건을 만족하지 않아요",
    description: "값이 허용 범위를 벗어났습니다.",
  },
  "42501": {
    category: "PERMISSION",
    title: "권한이 없어요",
    description: "이 작업을 수행할 권한이 없습니다.",
  },
  "40001": {
    category: "SYSTEM",
    title: "동시 처리 충돌",
    description: "다른 사용자와 동시에 같은 데이터를 수정 중입니다.",
    hint: "잠시 후 다시 시도해주세요.",
  },
};

// =====================================================================
// 기본 폴백 메시지
// =====================================================================

export const DEFAULT_ERROR: ErrorMessage = {
  category: "SYSTEM",
  title: "알 수 없는 오류가 발생했어요",
  description: "문제가 계속되면 선생님께 알려주세요.",
  hint: "잠시 후 다시 시도해주세요.",
};

// =====================================================================
// 핵심 함수 — 에러 → 사용자 메시지 변환
// =====================================================================

/**
 * Supabase/PostgreSQL 에러를 사용자 친화 메시지로 변환
 *
 * @param error - Supabase에서 받은 에러 객체
 * @returns 사용자에게 표시할 메시지 정보
 */
export function getUserFriendlyError(
  error: PostgresError | Error | null | undefined,
): ErrorMessage {
  if (!error) return DEFAULT_ERROR;

  // PostgresError로 캐스팅 시도
  const pgError = error as PostgresError;

  // 1. 커스텀 에러 코드 우선 (P0001~)
  if (pgError.code && ERROR_MESSAGES[pgError.code]) {
    return ERROR_MESSAGES[pgError.code];
  }

  // 2. PostgreSQL 표준 에러 코드
  if (pgError.code && POSTGRES_STANDARD_ERRORS[pgError.code]) {
    return POSTGRES_STANDARD_ERRORS[pgError.code];
  }

  // 3. RLS 권한 거부 패턴 매칭
  if (
    pgError.message?.includes("permission denied") ||
    pgError.message?.includes("row-level security")
  ) {
    return {
      category: "PERMISSION",
      title: "권한이 없어요",
      description: "이 작업을 수행할 권한이 없습니다.",
    };
  }

  // 4. JWT/인증 에러
  if (
    pgError.message?.includes("JWT") ||
    pgError.message?.includes("jwt") ||
    pgError.message?.includes("not authenticated")
  ) {
    return {
      category: "PERMISSION",
      title: "로그인이 필요해요",
      description: "세션이 만료되었거나 로그인하지 않았습니다.",
      hint: "다시 로그인해주세요.",
    };
  }

  // 5. 네트워크 에러
  if (
    pgError.message?.includes("Network") ||
    pgError.message?.includes("fetch")
  ) {
    return {
      category: "SYSTEM",
      title: "네트워크 오류",
      description: "서버와 통신하지 못했습니다.",
      hint: "인터넷 연결을 확인하고 다시 시도해주세요.",
    };
  }

  // 6. 폴백
  return DEFAULT_ERROR;
}

/**
 * 짧은 메시지만 반환 (Toast용)
 */
export function getErrorTitle(
  error: PostgresError | Error | null | undefined,
): string {
  return getUserFriendlyError(error).title;
}

/**
 * 전체 메시지 반환 (모달용)
 */
export function getFullErrorMessage(
  error: PostgresError | Error | null | undefined,
): string {
  const msg = getUserFriendlyError(error);
  let result = msg.title;
  if (msg.description) result += `\n${msg.description}`;
  if (msg.hint) result += `\n${msg.hint}`;
  return result;
}

/**
 * 카테고리별 토스트 색상 추천
 */
export function getErrorColor(category: ErrorCategory): string {
  switch (category) {
    case "VALIDATION":
      return "yellow";
    case "PERMISSION":
      return "red";
    case "BUSINESS":
      return "orange";
    case "STATE":
      return "blue";
    case "NOT_FOUND":
      return "gray";
    case "SYSTEM":
      return "red";
  }
}

// =====================================================================
// 사용 예시
// =====================================================================
//
// ```typescript
// const { data, error } = await supabase.rpc('purchase_snack', {
//   p_student_id: 1,
//   p_snack_id: 5,
//   p_quantity: 1
// });
//
// if (error) {
//   const userMsg = getUserFriendlyError(error);
//   showToast({
//     title: userMsg.title,
//     description: userMsg.description,
//     color: getErrorColor(userMsg.category)
//   });
// } else {
//   showToast({ title: '간식을 구매했어요!', color: 'green' });
// }
// ```
