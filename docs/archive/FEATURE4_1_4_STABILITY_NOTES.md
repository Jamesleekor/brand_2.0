# B.R.A.N.D 2.0 — Feature 4.1.4 stability patch

## Critical auction controls
- `새 경매 준비`, `경매 회차 시작`, 개별 상품 `▶ 시작`을 silent-failure 경로에서 분리.
- 회차/상품 시작은 browser `window.confirm()` 대신 공통 Portal Modal 확인창 사용.
- 핵심 시작 RPC는 전용 `criticalBusy` 상태로 처리하여 일반 `useRpcCall()`의 mutation 상태가 시작 버튼을 잠그지 않도록 분리.
- RPC 실패 시 toast에만 의존하지 않고 운영 화면 상단에 영구 오류 패널을 표시.
- 성공 시 서버 상태를 `refetch()`하여 UI 상태를 다시 동기화.
- 새 경매 생성도 전용 submit 상태/inline error를 사용해 조용한 실패를 금지.

## Dashboard overlap
- 티어/업적/신용 카드를 `absolute` positioning에서 제거.
- 상단 메뉴 아래의 CSS Grid 우측 column에 카드를 배치.
- 카드와 과제/기록실 등의 top-menu는 레이아웃 flow상 서로 다른 행에 존재하므로 viewport 크기에 따른 겹침을 제거.

## Tier icon first-load
- 원격 티어 이미지가 아직 다운로드되지 않았을 때 빈 영역 대신 해당 티어 emoji fallback 즉시 표시.
- 이미지 `onLoad` 후 원본 티어 아이콘으로 교체.
- `fetchPriority="high"` 및 raw.githubusercontent.com preconnect 추가.
- tier 값 변경 시 image state reset.

## Wallet UI
- 골드 / 브랜드가치(BV) / 크리스탈 label 확대 및 각 token 색상 적용.
- label을 emoji 옆으로 이동, amount 확대.
- BV 카드 티어명 가독성 상향.
- 송금/교환/기부 label 및 설명 확대/고대비화.
- transaction date/memo 행을 확대하고 색상 대비 상향.

## Friends UI
- 우리 반 친구들 목록을 2열 grid로 변경.
- 브랜드명 아래 학생 실명 색상과 크기 상향.
