# B.R.A.N.D 2.0 전체 기능 구현 청사진 + 배포 우선순위 통합판
## 2026-08-17 최신판 · v23 / Guild 1~5 진행상황 반영

> 이 문서는 `2026-08-06 전체 기능 구현 청사진`과 `2026-08-07 청사진 + 개발 인수인계서`를 통합하고,
> 2026-08-17 현재까지 실제 진행된 Guild 1~5, Arcade/Guild5 연동, 학생 점령/FINAL UI 작업을 반영한 최신 기준 문서다.
>
> **이번 개정의 핵심은 “전체 기능을 원래 순서대로 완성”하는 것보다 “배포 전 필수 기능을 빠르게 안정화”하는 것으로 개발 우선순위를 바꾸는 것이다.**
>
> 배포 전 필수: **시장 / 상점 / 2차직업 / 업적 Core / 예금 / 적금 / 최종 데이터 마이그레이션·컷오버**
>
> 배포 후 후순위: **성좌맵 / BrandVN / 편린 콜렉션·통합 버프 / 대출·신용점수 및 기타 확장**

---

# 1. 문서의 목적

이 문서는 세 가지 역할을 동시에 가진다.

1. 현재 B.R.A.N.D 2.0의 **실제 구현 상태 기준점**
2. 배포까지 남은 시간을 고려한 **새 개발 우선순위**
3. 새 ChatGPT/Codex 세션이 그대로 이어서 작업할 수 있는 **개발 인수인계 기준**

과거 문서의 상세 기능 정의는 가능한 한 유지하되,
이미 구현된 영역은 다시 설계하지 않고 현재 상태를 기준으로 한다.

---

# 2. 완료 판정 원칙

화면이 보인다고 완료가 아니다.

기능별 COMPLETE 조건:

1. 운영 DB의 실제 table / enum / RPC와 일치
2. 자산·점수·권한 변경은 서버 RPC에서 원자 처리
3. 학생/교사 UI가 필요한 범위까지 연결
4. 성공/실패/빈 상태/중복 클릭/권한 오류 UX 존재
5. Realtime 또는 명시적 invalidate/refetch로 최신 상태 반영
6. TEST fixture E2E 통과
7. 필요한 실제 데이터 migration 완료
8. TypeScript/build 통과
9. 역할별 회귀 테스트 통과
10. RLS/RPC ACL/보안 검증 통과

**검증하지 않은 기능을 COMPLETE로 표기하지 않는다.**

---

# 3. 절대 규칙

- Production DB가 최종 권위다.
- 실제 schema/RPC/enum을 확인하지 않고 이름을 추측하지 않는다.
- DB 변경은 목적별 incremental migration으로만 적용한다.
- `PREFLIGHT → APPLY → POSTCHECK` 순서를 지킨다.
- `create_transaction` 같은 내부 원장 helper를 브라우저에 직접 공개하지 않는다.
- service_role key를 프런트에 넣지 않는다.
- 학생 wallet/balance를 직접 UPDATE하지 않는다.
- GOLD/BV/CRYSTAL 등 자산 이동은 transaction/ledger를 통해 처리한다.
- 취소는 원본 삭제가 아니라 reversal이다.
- 중복 클릭/동시 실행에 안전해야 한다.
- KST 날짜 경계를 일관되게 사용한다.
- 실제 1.0 데이터를 임의 데이터로 대체하여 migration 완료로 처리하지 않는다.
- 기존 LOCKED/CONFIRMED Guild 규칙은 배포 우선순위 변경을 이유로 재설계하지 않는다.

---

# 4. 2026-08-17 현재 상태

## 4.1 공통 기반 / 경제 Core

### ✅ 완료
- 학생/교사 로그인
- session restore
- 학생 대시보드
- 브랜드명 / 티어 / BV / GOLD
- wallet / transaction history
- 브랜드명 변경
- 교사 기본 dashboard
- P0 보안
- 교사 BV/GOLD 단일·다중 지급/차감
- P2P GOLD 송금
- GOLD ↔ CRYSTAL 교환
- 복지기금 기부
- 경제 거래 취소/정정
- wallet / transaction Realtime 기반

### FOLLOW-UP
- 전체 RPC ACL allowlist 최종 정리
- 최종 배포 직전 security regression

---

## 4.2 실시간 온라인 경매

### 상태
**DB/RPC/Realtime 구현 완료 / 전체 운영 E2E 최종 확인은 별도 체크**

구현 범위:
- 회차 생성
- 상품 등록/정렬
- 시작/일시정지/재개
- 실시간 입찰
- 서버 타이머
- GOLD 예약
- 낙찰
- 유찰/재시도
- 즉시 종료
- 최종 정산
- 중계 화면
- 학생 입찰 화면

배포 blocker 여부:
- 경매를 배포 첫날 반드시 사용할 경우 E2E 필요
- 아니라면 Release Critical Path와 병렬로 최종 검증 가능

---

## 4.3 Feature4 운영 기능

기존 구현 범위:
- 우편/전역 알림
- 돌발퀘스트
- 비상사태
- 출석
- 과제
- 기록실/랭킹/분석 기반

현재 방침:
- 이미 만들어진 영역은 새로 설계하지 않는다.
- 배포 전에는 치명적 회귀만 수정한다.
- 신규 대규모 확장은 Release Critical Path 뒤로 둔다.

---

## 4.4 Arcade

현재까지:
- Arcade 공통 foundation
- 월간 ranking period
- monthly finalization
- Guild2 adapter
- Game #01 기반
- 교사 즉시 기간 종료 기능
- Guild5 readiness 연결

배포 전략:
- Guild5를 막지 않는 현재 core를 유지
- 나머지 Arcade 게임 확장은 배포 필수 기능 뒤로 이동 가능

---

## 4.5 Guild 1~5

### 현재 판정
**Guild 1~5 구현 및 핵심 E2E 완료 후보 / v23 기준**

구현된 핵심:
- Guild1 membership / season / element
- Guild2 개인 기여도 / Draft GS
- Guild3 Mission lifecycle / contribution / official Mission GS
- Guild4 Peer Review / penalty / correction / Guild2 adapter
- Guild5 monthly FINAL / snapshot / ranking / conquest / reopen
- 학생 Guild FINAL UI
- 점령 interactive map
- territory tax metadata snapshot

### Known FOLLOW-UP
1. **G4 FINALIZED 후 원본 G3 Mission을 VOID**
   - Mission official GS는 제거됨
   - 이미 FINALIZED된 Peer 결과는 개인 기여도에 남는 현상
   - 실제 운영 가능성이 낮아 release blocker가 아닌 FOLLOW-UP으로 유지

2. Territory 세율
   - 현재 점령 snapshot/표시 metadata까지 구현
   - 실제 거래/시장/상점 세금 귀속 효과는 별도 경제 설계에서 연결

### 배포 전
- 최종 Guild3~5 통합 회귀 1회
- Git checkpoint
- Production 실제 5길드 데이터 확인

---

# 5. 개발 전략 변경

## 과거 순서

대체로:

`길드 → 시장/상점/직업 → 업적/성좌맵 → 금융 → BrandVN → 최종 migration`

이었다.

## 2026-08-17 이후 새 원칙

**“빠르게 독립 완료할 수 있고 배포 첫날 필요한 기능”을 먼저 끝낸다.**

따라서:

- 업적과 성좌맵을 분리한다.
- 금융을 예금/적금과 대출/신용으로 분리한다.
- 세계관/시각화 기능은 운영 기능보다 뒤로 미룬다.
- 큰 패키지를 한 번에 구현하지 않는다.
- 기능별 checkpoint를 더 자주 만든다.

---

# 6. 새 Release Critical Path

## P0 — Guild v23 마감 및 checkpoint

예상 범위:
- v23 build
- Guild 통합 회귀
- Known Issue 기록
- Git checkpoint

**새 기능 개발 전에 현재 상태를 되돌릴 수 있는 기준점을 만든다.**

---

## P1 — 배포 필수 Quick Win 묶음

### P1-A. 2차직업

이유:
- 기존 코드/DB 흔적이 이미 존재
- 과거 `승인 대기 조회` 런타임 문제를 수정한 이력이 있음
- 신규 경제 원장보다 상대적으로 작고 독립적

필수 범위:
- 금 광석 이상 해금
- 2차직업 catalog
- 학생 신청
- 교사 승인/거절
- 활성 2차직업 표시
- 교체/해제 정책
- 승인/거절 알림
- 중복 활성 방지
- 권한/보상 연결이 있다면 서버에서 검증

**배포 전 최소 COMPLETE**
- 신청 → 승인 → 학생 프로필 반영
- 거절
- 중복 신청 방어
- 자격 미달 방어
- E2E

---

### P1-B. 업적 Core

**성좌맵과 분리하여 먼저 배포한다.**

필수 범위:

교사:
- 업적 master 생성/수정/비활성화
- 신청 검토
- 승인/거절
- 자동평가가 이미 존재하면 현재 규칙만 연결
- 보상 지급
- 중복 보상 방지

학생:
- 업적 목록
- 공개/숨김 정책
- 신청
- evidence 입력
- 달성 업적
- 업적 점수/기본 진행도

Migration:
- 기존 업적 master
- 학생 보유 업적
- 필요한 신청 상태

**배포 전 제외 가능**
- 성좌 시각화
- 은하→성좌 drill-down
- 성좌 버프

---

### P1-C. 상점

우선 **간식 상점**을 완결한다.

교사:
- 상품 등록/수정/비활성화
- 이미지
- 가격
- 재고
- 구매 제한
- 재입고
- 구매 내역

학생:
- 상품 목록
- 가격/재고/한도
- 수량
- 구매
- 성공/실패

서버:
- 서버 가격 사용
- wallet + stock + limit 단일 transaction
- 동시 구매에서 음수 재고 방지
- 모든 구매 transaction 기록

### 꾸미기/편린 상점

배포 첫날 반드시 필요한 아이템만 우선 연결한다.

후순위 가능:
- 복잡한 세트/collection UI
- BrandVN 연동
- collection buff

---

## P2 — 금융 Core

### P2-A. 예금

필수:
- 상품 목록
- 가입
- 원금
- 이율
- 가입/만기 시각
- 예상 수령액
- 중도해지
- 중도해지 penalty
- 만기 지급
- 지급 transaction
- 중복 만기 처리 방지

기존 `deposit_products`, `student_deposits`를 먼저 조사한다.

---

### P2-B. 적금

1.0 규칙을 임의 변경하지 않고 포팅한다.

필수:
- 회차당 납입액
- 총 회차
- 주당 이자율
- 누적 원금에 대한 이자
- 잔액 부족 시 해당 회차 skip
- 강제 해지 없음
- 실제 납입 원금+이자만 만기 지급
- 미납 횟수
- 중도해지 penalty
- schedule idempotency
- transaction ledger

**대출/신용점수와 분리한다.**

---

## P3 — 시장

시장 기능은 배포 필수지만, 상점/2차직업/업적보다 동시성·분쟁 상태가 복잡할 수 있으므로
**Quick Win 완료 후 집중 구현한다.**

구현 시작 전:
- 현재 production에 존재하는 market/marketplace 관련 tables/RPC/UI 조사
- 과거 “시장”이 `학생 거래소`, `시장 의뢰`, 또는 둘 다인지 실제 current code 기준 확정
- 이름만 보고 새 schema를 추측하지 않는다.

### 만약 학생 거래소 모델이라면

필수:
- 판매 등록
- 판매 취소
- 구매
- 가격
- 수량/소유권
- 판매자/구매자 transaction
- 동시 구매 lock
- 중복 판매 방지
- 수수료/세율이 있다면 server calculation
- 거래 기록

### 만약 시장 의뢰 모델도 운영한다면

별도 sub-feature:
- 의뢰 등록
- 보상 escrow
- 수락
- 완료 요청
- 확인
- 지급
- 취소/만료/분쟁

**시장 거래와 의뢰를 하나의 거대한 migration으로 묶지 않는다.**

---

# 7. 배포 전 반드시 완료해야 하는 기능 순서

## Fast-first 권장 순서

### Wave 0
1. Guild v23 최종 checkpoint

### Wave 1 — 기존 기반 재사용이 큰 기능
2. 2차직업
3. 업적 Core

### Wave 2 — 경제적으로 단순한 독립 기능
4. 간식 상점
5. 예금

### Wave 3 — 시간 상태/자동처리가 필요한 기능
6. 적금

### Wave 4 — 거래 상태가 가장 복잡한 필수 기능
7. 시장/거래소
8. 필요 시 꾸미기/편린 상점 최소본

### Wave 5 — Release hardening
9. 실제 데이터 migration
10. 전체 역할 E2E
11. build/security regression
12. cutover

---

# 8. 왜 이 순서인가

## 2차직업 / 업적을 먼저

현재 코드에는 과거부터 관련 query/UI 흔적이 있고,
런타임 호환 문제를 수정했던 기록이 있다.

따라서 완전한 greenfield보다 **현재 DB 정의를 확인하고 기존 surface를 살리는 작업**이 될 가능성이 높다.

## 상점을 금융보다 먼저

간식 상점은 핵심 상태가 비교적 단순하다.

`상품 → 재고 → 구매 → GOLD 차감`

으로 명확하며 기존 wallet/transaction 패턴을 그대로 재사용할 수 있다.

## 예금을 적금보다 먼저

예금:
- 가입
- 보유
- 만기/해지

적금:
- 반복 schedule
- 회차
- skip
- 누적 이자
- idempotency

이므로 예금을 먼저 안정화하고 같은 금융 공통 UI/RPC를 적금이 재사용한다.

## 시장을 Quick Win 뒤에

학생 간 거래 시장은:
- 판매자
- 구매자
- 재고/소유권
- 가격
- 동시 구매
- 취소
- 수수료

가 함께 움직이므로 예상보다 커질 가능성이 있다.

배포 필수이지만, 먼저 작은 COMPLETE를 여러 개 확보한 뒤 집중한다.

---

# 9. 배포 후로 명시적으로 미루는 기능

## 9.1 성좌맵

업적 Core와 분리.

후순위:
- 은하→성좌 drill-down
- 별/노드 활성화
- 성좌별 진행도 visualization
- 모바일/Chromebook SVG optimization
- 성좌 buff

업적 데이터는 먼저 정상 운영할 수 있어야 한다.

---

## 9.2 BrandVN

후순위로 이동.

포함:
- 캐릭터 affinity
- 대화
- spoiler gate
- story CG
- LLM server layer
- AI logging/cost
- 캐릭터별 설정

이 기능은 세계관 가치가 높지만 **배포 첫날 경제/운영 필수 기능은 아니다.**

---

## 9.3 편린 Collection / 통합 Buff

BrandVN/성좌맵과 함께 후순위.

예:
- 상점 할인
- 시장 할인
- 세금 감면
- 경매 환급

**Release Critical 경제 RPC는 buff가 없어도 정상 동작해야 한다.**

---

## 9.4 대출 / 신용점수

예금/적금과 분리.

배포 후:
- 대출 신청/승인
- 상환
- 연체
- 신용점수
- loan eligibility

---

# 10. 원래 기능 중 배포 전 “유지하되 확장하지 않는” 영역

- Feature4 우편/알림
- 출석/과제
- 비상사태/돌발퀘스트
- 기록실/분석
- Arcade 추가 게임
- 경매 추가 연출/효과음
- 복지/세금의 고급 자동화
- Hall of Fame 고도화
- Guild 추가 애니메이션/장식

치명적 버그는 수정하되,
Release Critical Path를 늦추는 신규 확장은 하지 않는다.

---

# 11. 세부 기능 청사진 — 2차직업

## 학생
- 해금 여부 표시
- catalog
- 상세
- 신청
- 신청 상태
- 승인 시 활성 직업 표시
- 현재 2차직업 확인

## 교사
- catalog 관리
- 신청 목록
- 승인
- 거절 + reason
- 강제 해제/정정이 필요한 경우 audit

## 서버
- tier qualification
- classroom scope
- duplicate pending 차단
- duplicate active 차단
- history 보존

## Migration
- 기존 2차직업 catalog
- 기존 active assignment
- 필요한 신청 이력

---

# 12. 세부 기능 청사진 — 업적 Core

## Master
- code/id
- name
- grade
- condition
- hint
- hidden
- evaluation type
- rewards
- active

## Student
- visible achievement list
- hidden masking
- progress
- application
- evidence
- holdings
- score

## Teacher
- CRUD
- review queue
- approve
- reject
- automated resolution where already defined
- manual correction

## Reward safety
- idempotency
- achievement holding unique constraint
- reward ledger
- reversal/correction policy

## 이번 Release에서 제외
- constellation visual graph
- constellation buff

---

# 13. 세부 기능 청사진 — 상점

## Snack Shop first

DB 확인:
- snack catalog
- pricing
- stock
- purchase history
- purchase limits

Purchase RPC:
1. authenticated student
2. classroom check
3. product active
4. server price
5. quantity
6. stock lock
7. weekly/student limit
8. wallet lock
9. GOLD deduction
10. purchase insert
11. commit
12. UI invalidate

Teacher:
- catalog
- stock
- price
- limits
- purchase log

Student:
- cards/list
- price
- stock
- limit
- confirm
- purchase result

---

# 14. 세부 기능 청사진 — 예금

## Product
- principal min/max
- interest rate
- duration
- early withdrawal policy
- active period

## Student
- products
- subscribe
- holdings
- maturity
- expected payout
- early withdrawal
- history

## Server
- principal deduction
- maturity snapshot
- payout
- idempotency key
- duplicate maturity prevention
- KST policy

---

# 15. 세부 기능 청사진 — 적금

## Product
- installment amount
- total rounds
- interval
- weekly rate
- early termination rule

## Account
- principal paid
- rounds paid
- rounds missed
- next due
- accrued interest
- maturity

## Processor
- due account lock
- idempotent installment attempt
- enough GOLD → pay
- insufficient GOLD → miss/skip
- no forced termination
- next due
- maturity payout

## 운영
- processor retry
- manual teacher health check
- audit
- duplicate cron execution safety

---

# 16. 세부 기능 청사진 — 시장

현재 코드/DB 조사 후 정확한 모델을 확정한다.

Release에서 최소한 필요한 시장 모델만 구현하고,
의뢰·auction·shop 등 다른 경제 기능과 책임을 섞지 않는다.

공통 안전 조건:
- 판매자가 실제 소유
- 구매자가 실제 지불 가능
- listing lock
- double purchase 불가
- seller credit / buyer debit 원자 처리
- fee/tax server-side
- ownership transfer
- transaction history
- cancellation/audit
- other-classroom 접근 차단

---

# 17. 데이터 Migration 전략도 변경한다

과거에는 모든 기능 구현 후 대규모 final migration을 생각했지만,
이제는 **기능별 migration 준비 + 마지막 cutover delta** 방식으로 진행한다.

## 기능 구현 시
- master import dry-run
- current student state dry-run
- duplicate/orphan 검사
- mapping report 작성

## 배포 직전
1. 전체 backup
2. student-auth mapping 확인
3. master 최종 import
4. holdings/status import
5. wallet/transaction reconcile
6. guild state reconcile
7. achievement holdings reconcile
8. 2nd job reconcile
9. shop/market ownership reconcile
10. deposit/installment balance reconcile
11. derived aggregate refresh
12. 24명 individual reconciliation sheet
13. read-only 병행 검증
14. final delta sync
15. cutover
16. legacy write 중단

---

# 18. Release Gate

배포 전 다음이 모두 만족되어야 한다.

## 필수 기능
- [ ] Guild v23 checkpoint
- [ ] 시장
- [ ] 상점
- [ ] 2차직업
- [ ] 업적 Core
- [ ] 예금
- [ ] 적금

## 기존 핵심 회귀
- [ ] 로그인/session
- [ ] wallet/transaction
- [ ] 교사 지급/차감
- [ ] P2P/교환/기부
- [ ] Guild 1~5
- [ ] Guild5 FINAL
- [ ] Arcade readiness가 Guild5를 불필요하게 막지 않음
- [ ] 필요한 경우 경매 E2E

## 기술
- [ ] npm run build
- [ ] TypeScript
- [ ] RLS
- [ ] RPC grants
- [ ] 다른 classroom 접근 차단
- [ ] duplicate-click
- [ ] concurrency
- [ ] Realtime/cache

## 데이터
- [ ] 24명 account mapping
- [ ] wallet balance
- [ ] guild membership
- [ ] achievements
- [ ] second jobs
- [ ] market/shop holdings
- [ ] deposits/installments
- [ ] migration report

---

# 19. 배포 후 개발 순서

Release 안정화 후:

1. 성좌맵
2. 편린/캐릭터 collection
3. BrandVN
4. 통합 Buff Engine
5. 대출
6. 신용점수
7. Arcade Game #02~#06
8. 시장 의뢰 등 시장 확장
9. 복지/세금 고급화
10. 기록실/분석 고도화
11. UI/UX polish
12. 운영 자동화

성좌맵과 BrandVN은 이 시점부터 기능적 완성도가 아니라
**세계관/경험 품질을 높이는 독립 프로젝트**로 다룬다.

---

# 20. 권장 작업 패키지 크기

Guild 작업에서 한 기능 묶음이 너무 커져 개발 시간이 길어진 경험을 반영한다.

앞으로 한 패키지는 원칙적으로:

- DB migration 1~3개
- 한 개 명확한 lifecycle
- 학생/교사 UI 한 묶음
- 하나의 E2E checklist

정도로 제한한다.

예:

### SECOND_JOB-A
DB compatibility + backend

### SECOND_JOB-B
student/teacher frontend

### SECOND_JOB-C
E2E + migration

이 구조를 업적/상점/예금/적금/시장에도 반복한다.

---

# 21. 구현 표준 절차

각 패키지:

1. 실제 DB 조사
2. LOCKED rule 확인
3. PREFLIGHT
4. Backend incremental migration
5. POSTCHECK
6. RPC wrapper / type / Zod
7. Student UI
8. Teacher UI
9. static/build
10. TEST E2E
11. regression
12. PATCH + full ZIP
13. Git checkpoint

오류가 나면:
- 전체 기능을 다시 쓰지 않는다.
- SQLSTATE/RPC/화면 영역별로 원인을 그룹화한다.
- 현재 단계만 수정한다.

---

# 22. 다음 작업의 실제 시작 순서

Guild v23 체크포인트를 만든 직후:

```text
1. SECOND_JOB
2. ACHIEVEMENT CORE
3. SNACK SHOP
4. DEPOSIT
5. INSTALLMENT SAVINGS
6. MARKET / MARKETPLACE
7. RELEASE MIGRATION + FULL REGRESSION
8. CUTOVER
```

단, 현재 Production 조사 결과 특정 기능이 이미 70~80% 구현되어 있다면
**더 빨리 끝나는 기능을 한 단계 앞으로 당겨도 된다.**

새 원칙은:

> **의존성이 없고 배포 필수이며 빠르게 COMPLETE 가능한 것을 먼저 닫는다.**

---

# 23. 새 세션 시작 시 상태 요약

```text
기준 코드: Guild5 v23 계열
공통 경제 Core: 완료
교사 자산 지급/차감: E2E 완료
P2P/교환/기부/경제 취소: E2E 완료

경매: 구현 완료, 전체 운영 E2E 최종 검증 별도
Feature4: 주요 기능 구현 상태, 배포 전 신규 확장 중단
Arcade: Core + Game01 + monthly finalization + Guild5 adapter
Guild1~5: 핵심 구현/E2E 완료 후보, v23 checkpoint 예정

Release Critical 미구현:
- 시장
- 상점
- 2차직업
- 업적 Core
- 예금
- 적금
- 실제 데이터 migration/cutover

Post-release:
- 성좌맵
- BrandVN
- 편린 collection
- 통합 buff
- 대출
- 신용점수
- 기타 확장
```

---

# 24. 핵심 인수인계 문장

> **B.R.A.N.D 2.0은 2026-08-17 현재 공통 경제 Core와 Guild 1~5의 핵심 구현을 마친 상태이며, 배포 일정 때문에 이후 개발 순서를 “전체 시스템의 논리적 순서”가 아니라 “배포 필수 + 빠른 COMPLETE” 기준으로 변경한다. Guild v23 checkpoint 후 2차직업 → 업적 Core → 상점 → 예금 → 적금 → 시장 순으로 작은 독립 패키지로 닫고, 즉시 실제 데이터 migration·전체 회귀·cutover로 이동한다. 성좌맵과 BrandVN, 편린 콜렉션/버프, 대출/신용점수는 배포 후로 미룬다. 모든 DB 변경은 실제 Production schema 확인 후 PREFLIGHT → incremental APPLY → POSTCHECK로 진행하며, 검증되지 않은 기능은 COMPLETE로 간주하지 않는다.**
