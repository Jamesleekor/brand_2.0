# Arcade E2E 체크리스트 — 기록 인증 시스템 포함

이 문서는 **교사/학생 로그인 웹앱에서 실제로 확인하는 운영 E2E 체크리스트**다. Supabase SQL Editor는 앱의 교사 JWT 컨텍스트가 아니므로 teacher/student RPC 성공 여부는 SQL Editor에서 직접 판정하지 않는다.

## 0. 적용 전제

1. 기존 Arcade foundation / Game #01 authoritative validation / monthly snapshot / Guild 2 adapter가 production에 적용되어 있다.
2. `20260906_16_arcade_record_verification.sql` 적용 전에는 `supabase/PREFLIGHT_ARCADE_RECORD_VERIFICATION.sql`의 모든 `problem_count`가 0이어야 한다.
3. migration 적용 직후에는 `supabase/POSTCHECK_ARCADE_RECORD_VERIFICATION.sql`의 모든 `problem_count`가 0이어야 한다.
4. Game #01 `focus_reaction_01`만 현재 인증 validator 연결이 완료되어 있다.
5. 월간 Arcade 개인기여도 보너스는 **게임별 raw bonus를 합산하되 학생 1명당 월 최대 +90만 적용**한다. `final_total` 최대치는 990이다.
6. 과거 `FINALIZED` snapshot은 재작성하지 않는다.

---

# 1. 일반 Arcade 회귀 테스트

## 1.1 학생 Game #01

- `/arcade`에서 `집중 반응 #01`이 정상 표시된다.
- `ACTIVE` 기간에서는 일반 `게임 시작`이 가능하다.
- `VERIFICATION`, `READY_TO_FINALIZE`, `FINALIZED` 기간을 선택했을 때 일반 게임 시작 버튼은 비활성이다.
- 5초 COUNTDOWN 뒤 기존 Game #01 게임이 정상 시작된다.
- D/F/J/K 또는 터치 입력, GO / NO-GO, Life, Combo, recovery 표시가 기존과 동일하게 동작한다.
- Life 0 이후 기존 server-authoritative validator가 공식 점수/시간/stats를 계산한다.
- 개발자도구에서 화면 점수를 바꾸어도 서버 공식 점수에는 영향을 주지 못한다.
- 일반 run은 `run_context=STANDARD`이고 `verification_session_id`가 없다.

## 1.2 사전 테스트

- 공개일 전 교사가 허용한 학생만 사전 테스트가 가능하다.
- 사전 테스트 run은 `is_prerelease_test=true`, `run_context=STANDARD`이다.
- 사전 테스트 순위에는 사전 테스트 run만 나타난다.
- 사전 테스트 run은 일반 Top10, 월간 snapshot, Guild 2 보너스에 들어가지 않는다.

## 1.3 시즌 랭킹

- `SEASON` 기간은 새 인증 lifecycle에 들어가지 않는다.
- 시즌 leaderboard는 기존 `STANDARD` run 기간 범위 계산을 유지한다.
- 월간 인증 migration 적용 후에도 시즌 Top10이 빈 값으로 바뀌지 않는다.

---

# 2. 월간 기간 종료와 기록 동결

## 2.1 종료 전

- `ACTIVE` 월간 기간의 종료 시각 전에는 `기록 동결 + 인증 시작`이 실행되지 않는다.
- 최근 15분 이내 시작된 일반 Arcade run이 아직 COUNTDOWN/PLAYING/GAME_OVER/SUBMITTING이면 동결이 서버에서 차단된다.
- 진행 중 run이 정상 종료/제출된 뒤 동결을 다시 실행할 수 있다.
- `랭킹 기간 즉시 종료`로 종료값이 하루 중간 시각이 된 경우에도 eligible game의 마지막 날짜는 그 **당일**로 계산된다. 정상 월말 템플릿(다음 달 1일 00:00 exclusive)은 직전 달 마지막 날로 계산된다.

## 2.2 동결

교사 `/teacher/arcade`에서 종료된 월간 기간의 `🔒 기록 동결 + 인증 시작`을 실행한다.

확인:

- period 상태가 `ACTIVE -> VERIFICATION` 또는 대상이 전혀 없으면 `READY_TO_FINALIZE`가 된다.
- eligible game 목록과 `target_rank_count / threshold_percent / max_attempts`가 해당 기간의 `arcade_verification_period_games`에 고정된다.
- 학생별 일반 최고 run이 `arcade_verification_provisional_entries`에 1개씩 고정된다.
- 같은 학생/게임에서 여러 일반 run이 있어도 최고 점수 1개만 provisional source가 된다.
- 동점 source 선택은 `score DESC -> game_over_at ASC -> run_id ASC`이다.
- 동결 뒤 새 일반 run이 생겨도 그 달 provisional source는 바뀌지 않는다.
- 동결 뒤 Game #01 전역 인증 설정을 바꾸어도 이미 동결된 그 달의 80%/3회 설정은 바뀌지 않는다.
- 동결 뒤 일반 감사 화면에서는 해당 provisional source를 기존 `무효 처리`로 바꾸지 못한다. 인증 관리의 보정 절차를 사용해야 한다.
- 인증 관리에서 수동 official source로 채택한 STANDARD run도 legacy `무효 처리` RPC로 다시 무효화할 수 없다.
- FINALIZED Top10뿐 아니라 full-rank snapshot의 source run도 legacy `무효 처리`로 변경할 수 없다.

---

# 3. 인증 세션 생성

현재 Top10 학생 중 1명을 선택해 `인증 시작`을 누른다.

확인:

- 학생+게임+기간당 ACTIVE session은 최대 1개다.
- provisional source run과 **같은 `rule_version_id`**가 session에 고정된다.
- threshold는 `ceil(provisional_score * 80 / 100)`이다.
- threshold는 session 생성 후 일반 플레이나 설정 변경으로 바뀌지 않는다.
- max attempts는 3이다.
- 이미 official result가 있는 학생은 새 session을 시작할 수 없다.
- 현재 Top10 밖 학생은 session을 시작할 수 없다.

### Threshold 경계 테스트

가능하면 별도 fixture에서 다음을 확인한다.

- provisional `25000` -> threshold `20000`
- provisional `25001` -> threshold `20001`
- provisional `25003` -> threshold `20003`

---

# 4. 학생 `기록 인증 도전` 화면

인증 session이 활성화된 학생으로 로그인한다.

- `/arcade`에 `🏅 기록 인증 도전` 카드가 표시된다.
- 카드에 잠정 SCORE, 인증 기준, 사용 기회, 남은 기회, 1/2/3차 결과가 표시된다.
- session을 교사가 만들지 않은 학생에게는 인증 카드가 나타나지 않는다.
- 학생은 자기 힘으로 session을 생성할 수 없다.
- `기록 인증 도전 시작`은 `student_create_arcade_verification_run`으로만 run을 발급한다.
- 발급된 run은 `run_context=VERIFICATION`, `is_prerelease_test=false`, `verification_session_id=session.id`다.
- verification run은 provisional source와 같은 rule version을 사용한다.
- 동일 `idempotency_key` 재전송은 새 run을 만들지 않고 동일 run을 반환한다.
- 이미 진행 중인 verification run이 있으면 새 run을 발급하지 않는다.
- 현재 Top10 밖으로 밀린 학생은 새 verification run을 발급받지 못한다.

### 페이지 새로고침 중단 상황

- COUNTDOWN/PLAYING 중 페이지를 새로고침해 게임 화면을 잃으면 새 run을 또 만들 수 없다.
- 학생 화면에 진행 중 run이 있다는 안내가 표시된다.
- 교사는 해당 run을 `기술 취소`한 뒤 다시 기회를 줄 수 있다.

---

# 5. 인증 시도 판정

## 5.1 유효 성공

1차 verification run의 server `official_score >= threshold`가 되도록 플레이한다.

- attempt는 `TERMINAL`, `consumed=true`, `valid_run=true`가 된다.
- `success_achieved=true`가 된다.
- 3회를 모두 쓰기 전이라도 성공 상태는 유지된다.
- 남은 기회가 있다면 더 높은 점수에 추가 도전할 수 있다.
- 이후 더 낮은 점수/실패가 나와도 이미 달성한 성공이 취소되지 않는다.

## 5.2 성공 후 공식 source

세션 종료 시:

- verification 최고점이 provisional보다 높으면 verification run이 official source가 된다.
- verification 최고점이 provisional 이하이면 provisional source가 그대로 official source가 된다.
- score/duration/stats/achieved_at는 반드시 **같은 source run**에서 온다.

## 5.3 3회 모두 threshold 미달, valid run 존재

- 각 valid run은 기회를 1회 소모한다.
- 3회 종료 후 session이 자동 완료된다.
- official source는 3회 중 가장 높은 valid verification run이다.
- provisional 의심 점수가 그대로 남아 있지 않는다.

## 5.4 valid run 없음

- REJECTED terminal run도 PLAYING 이후 정상 terminal outcome이면 기회를 1회 소모한다.
- 3회 모두 valid score가 없다면 official result는 `ranking_eligible=false`가 된다.
- 공식 점수를 임의 0점으로 만들지 않는다.
- 해당 학생은 current ranking에서 제외된다.

---

# 6. 기술 오류 / 복구

## 6.1 기술 취소

진행 중 인증 run에서 브라우저/기기/네트워크 문제를 가정한다.

교사가 `기술 취소`:

- run은 삭제되지 않고 `EXPIRED`로 남는다.
- rejection code/reason으로 기술 취소가 감사 가능해야 한다.
- attempt는 `TECHNICAL_CANCELLED`가 된다.
- `consumed=false`다.
- 학생의 3회 기회는 줄지 않는다.
- 다음 발급의 내부 issue number는 증가해도 학생에게 보이는 opportunity는 빈 1/2/3 슬롯을 사용한다.

## 6.2 consumed invalid attempt 복구

- 복구 대상은 `TERMINAL + consumed=true + valid_run=false`만 가능하다.
- valid score가 존재한 attempt는 복구할 수 없다.
- 진행 중 verification run이 있으면 복구할 수 없다.
- 복구 후 해당 opportunity slot을 다시 사용할 수 있다.
- 동시에 consumed 상태의 같은 opportunity number가 둘 이상 존재할 수 없다.

---

# 7. 순위 재계산과 새 Top10

다음 시나리오를 만든다.

1. 기존 10위 A가 인증 실패로 점수 하락 또는 순위 제외
2. 기존 11위 B가 새 10위로 승격

확인:

- A 결과 직후 leaderboard가 official override를 이용해 재계산된다.
- B는 current Top10으로 올라온다.
- B에 official verification result가 없으므로 period는 `VERIFICATION` 상태를 유지한다.
- B는 새 `인증 시작` 대상이 된다.
- B까지 해결되기 전에는 최종확정이 불가능하다.
- 인증 순서는 1위부터 순서대로일 필요가 없다.

Top10 미만 참가 게임이라면 실제 존재하는 reward-range 학생만 인증하면 된다.

---

# 8. 수동 보정

수동 보정은 예외적인 교사 감사 기능으로만 사용한다.

## 8.1 source 보정

- 다른 학생 run ID는 거부된다.
- 다른 게임 run ID는 거부된다.
- 다른 월의 일반 run은 거부된다.
- prerelease run은 거부된다.
- INVALIDATE된 일반 run은 거부된다.
- verification source는 동일 target period/student/game session에 속한 run만 허용된다.
- 진행 중 verification run이 있으면 보정이 차단된다.
- 보정 사유와 actor/time이 audit/correction 이력에 남는다.

## 8.2 기록 없음

- `source_run_id=NULL` 보정은 `ranking_eligible=false` 공식 결과를 만든다.
- 0점 기록을 만들지 않는다.
- 순위 재계산 뒤 새 Top10이 생기면 그 학생이 인증 대상으로 올라온다.

---

# 9. READY_TO_FINALIZE / 최종 확정

현재 각 game reward-range 학생 전부 official result가 생기면:

- period 상태가 `READY_TO_FINALIZE`가 된다.
- 관리자 화면에 `✅ 최종 랭킹 확정 + Guild 2 반영` 버튼이 나타난다.

최종 확정 직전 서버는 다시 확인한다.

- current Top10에 미인증 학생이 없어야 한다.
- 진행 중 verification run이 없어야 한다.
- 과거에 session을 시작했지만 현재 Top10 밖으로 밀린 idle ACTIVE session은 `OVERRIDDEN` 처리되고 audit가 남는다.

최종 확정 후:

- `arcade_monthly_finalizations` 1개가 생성된다.
- 동결 시 고정된 game set만 snapshot으로 만든다.
- Top10 snapshot과 full-rank snapshot이 생성된다.
- period는 `FINALIZED`가 된다.
- 다시 finalization을 실행할 수 없다.
- FINALIZED rank resolver와 leaderboard는 live runs가 아니라 immutable snapshot을 읽는다.

---

# 10. Guild 2 +90 CAP

최종 snapshot 뒤 Guild 2를 확인한다.

게임별 raw bonus:

- 1위 +30
- 2위 +27
- 3위 +24
- 4~6위 +18
- 7~10위 +15

월 합산 정책:

- 여러 게임의 `arcade_raw_total`은 그대로 합산 보존한다.
- 예: 4개 게임 1위면 raw `120`이다.
- `arcade_applied = min(arcade_raw_total, 90)`이다.
- 위 예에서 실제 개인기여도 반영은 **+90**이다.
- `final_total <= 990`이다.
- 인증 전/VERIFICATION/READY 단계에서는 해당 월 Arcade bonus가 지급 완료된 것으로 처리되지 않는다.

---

# 11. 통계 / 기록실 회귀

## 11.1 일반 기록실

- `ACTIVE`, `VERIFICATION`, `READY_TO_FINALIZE`, `FINALIZED` 기간이 기간 선택 목록에 보인다.
- `VERIFICATION`은 `기록 인증 중`, READY는 `인증 완료 · 최종 확정 대기`로 구분된다.
- 개인 시도 history에는 `STANDARD` run만 표시된다.
- verification run은 일반 플레이 횟수/일반 PB/일반 시도 목록에 들어가지 않는다.

## 11.2 통계

- all-time PB는 `STANDARD` verified run만 사용한다.
- 일반 play/submission/verified/rejected count에서 verification run이 제외된다.
- VERIFICATION/READY 기간의 현재 rank는 frozen provisional + official override를 사용한다.
- FINALIZED 기간은 immutable snapshot을 사용한다.

## 11.3 명예 기록

- Arcade 공식 명예기록은 `FINALIZED` snapshot만 사용한다.
- 인증 도중의 임시 순위는 공식 명예기록으로 승격되지 않는다.

---

# 12. 권한 / 보안

- 학생은 verification table을 직접 SELECT/INSERT/UPDATE/DELETE할 수 없다.
- 학생은 teacher verification RPC를 호출해도 `ensure_teacher_role()`에서 거부된다.
- 학생은 session/threshold/attempt/result/official source를 직접 수정할 수 없다.
- 학생에게 공개되는 것은 자기 verification state와 자기 run 발급뿐이다.
- internal helper `arcade_capture_verification_attempt`, `arcade_finalize_verification_session`, `arcade_refresh_verification_readiness`는 authenticated 직접 EXECUTE가 없어야 한다.
- 모든 새 SECURITY DEFINER 함수는 `search_path=public,pg_temp`가 고정되어 있어야 한다.

---

# 13. TEST fixture reset

B.R.A.N.D TEST 학급에서 기존 fixture reset을 실행한다.

- verification audit/correction/result/attempt/session/provisional/period-game 보조 데이터가 FK 순서대로 제거된다.
- verification run은 기존 reset이 삭제하기 전에 session FK가 안전하게 해제된다.
- 일반 production 학급 DELETE에서는 verification cleanup trigger가 아무 동작도 하지 않는다.
- reset 후 기존 fixture baseline 검증이 그대로 통과한다.

---

# 14. 최종 COMPLETE 판정

아래가 모두 만족될 때만 인증 시스템을 COMPLETE로 판정한다.

- [ ] 사용자 로컬 `npm run build` 성공
- [ ] PREFLIGHT problem_count 전부 0
- [ ] migration 정상 적용
- [ ] POSTCHECK problem_count 전부 0
- [ ] Supabase security advisor 신규 치명 이슈 없음
- [ ] 일반 Game #01 회귀 통과
- [ ] 인증 성공 시나리오 통과
- [ ] 실패-valid 시나리오 통과
- [ ] 실패-no-valid 시나리오 통과
- [ ] 기술 취소/복구 통과
- [ ] 새 Top10 승격 반복 인증 통과
- [ ] 최종확정 차단/허용 조건 통과
- [ ] +90 CAP 통과
- [ ] 통계/기록실 오염 없음
- [ ] FINALIZED immutable 유지
