# 모험가 도구함 · 길드 대항 퀴즈 로얄 v1 (2026-11-07)

11월 길드미션 1(M07 '퀴즈 로얄')을 위한 퀴즈 전용 환경. 기획 원본: `BRAND_Quiz_Royal_Implementation_Spec_v1_0`.

## 구조 결정 (명세서 대비 바뀐 점)
| 명세서 | 구현 | 이유 |
|---|---|---|
| 도구함 활동 표에 통합 여부 미정 | 도구함 화면이 **입구**, 안쪽은 퀴즈 전용 표·서버 함수 | 기존 도구함 표(종류 제한·7일 자동 정리)와 섞이지 않게 |
| 문제 표 학생 열람(정답만 분리) | 문제 표 **학생 접근 완전 차단**, 지금 문제 1개만 서버 함수로 전달 | 시작 전 지문 25개 유출 방지 |
| 태블릿 QR·일회용 코드 페어링 | 길드별 **제출 대표 계정 1개**(크롬북) 지정 | 새 인증 없음, 선수 교체 때 재로그인 없음 |
| 중계 화면 DB 권한 분리 | 중계 화면은 교사 창 → 서버가 **공개용 응답만** 생성 | 같은 교사 로그인이라 권한 분리 불가. 정답은 채점 확정 뒤에만 |
| 표 11개 | 표 7개(대회·참가 길드·출전표·문제·답안·이력·신호) | 점수는 판정 기록 합산, 공개 점수·발표는 스냅샷 |
| 시작→잠금→공개→확정→다음 | 시작→(자동 마감)→공개→확정→다음 | 시간 0 또는 모두 제출 시 자동 마감 |
| request_id 중복 방지 | 대상 문제·회차를 같이 보내고 지난 것이면 거절(P7T05) | 연타·늦은 화면이 저절로 무해 |
| 리허설 모드 | 리허설 대회(끝나면 삭제 가능) | 별도 모드 불필요 |
| (추가) | 마감 **유예 1초**(설정 0~2초) | 0초 직전 전송 지연으로 억울한 거절 방지 |
| (추가) | 문제 **이미지·영상**(비공개 저장소 / YouTube·https 주소), '문제만 보여 주기' 단계, 교사 화면에서 영상 재생 조종 | 학생 크롬북은 무음 → 소리는 교실 화면 |
| (추가) | 엑셀·구글 시트 **표 붙여넣기** 문제 입력 | 25문제 한 번에 |

## 파일
- DB: `supabase/migrations/20261107_01_quiz_royal.sql` (= `supabase/APPLY_QUIZ_ROYAL_V1.sql`), `PREFLIGHT_/POSTCHECK_/ROLLBACK_QUIZ_ROYAL_V1.sql`
- 시험: `supabase/tests/quiz_royal/` (로컬 PostgreSQL 16 시나리오 119개 항목 + 5대 동시 제출), `tools/quiz-royal-load-tester/` (실제 DB, LOADTEST 학급)
- 화면: `src/features/toolbox/quiz/`
  - `QuizHubSection` 교사 도구함 입구 · `QuizSetupPage` 준비(설정·길드·문제·출전표·점검) · `QuizConsolePage` 진행 · `QuizRecords` 결과·기록·CSV
  - `QuizScreenPage` 교실 중계 화면 · `StudentQuizPage` 길드 태블릿 · `StudentQuizEntry` 학생 도구함 입구
- 기존 파일 수정(추가만, `QUIZ_ROYAL_V1` 표시): `App.tsx`(경로 4개), `TeacherToolbox.tsx`·`StudentToolbox.tsx`(입구 1줄씩), `lib/supabase/client.ts`(빠른 경로 2개), `.gitignore`

## 경로
- 교사: `/teacher/toolbox/quiz/:id/setup`, `/teacher/toolbox/quiz/:id`, `/teacher/toolbox/quiz/:id/screen`
- 학생(대표 계정): `/toolbox/quiz/:id`

## 서버 함수
교사: `teacher_quiz_list/create/save_setup/save_questions/upsert_question/delete_question/set_roster/open_lobby/start/q/grade/correct/publish_board/ceremony/screen/end/delete/state/presence/screen_state/audit`
학생: `student_quiz_feed/state/submit`
`teacher_quiz_q` 동작: SHOW · START · PAUSE · RESUME · LOCK · REVEAL · AUTO_GRADE · FINALIZE · VOID · REISSUE · NEXT · MEDIA

## 실시간
`quiz_pulse` 행 2개: `Q<id>-T`(교사·중계, 교사만 읽기), `Q<id>-D`(태블릿, 지정 대표 계정만 읽기). 상태가 바뀌면 rev만 오르고 화면이 한 번 다시 읽는다. 끊기면 3초 간격 확인. 학생 도구함 입구는 대기실 열기·종료 때 도구함 학생 신호에 `QUIZ`를 한 번 실어 보낸다(학생 24명 화면은 그 두 번만 반응).

## 적용 순서
1. `PREFLIGHT_QUIZ_ROYAL_V1.sql` → 모두 true
2. `APPLY_QUIZ_ROYAL_V1.sql`
3. `POSTCHECK_QUIZ_ROYAL_V1.sql` → 모두 true
4. 화면 반영(GitHub Desktop commit·push → Actions 배포)
5. 리허설 대회로 E2E 확인 → (선택) LOADTEST 통합 시험

## E2E 확인표 (리허설 대회, 교사 PC 확장 모드 + 크롬북 2대 이상)
- [ ] 도구함에 '길드 대항 퀴즈 로얄' 칸이 보이고 리허설 대회를 만들 수 있다
- [ ] 문제 표 붙여넣기 → 미리 보기 → 저장, 잘못된 줄은 줄 번호로 안내되고 저장되지 않는다
- [ ] 문제에 그림 1개·영상 1개를 올리고 목록에 미리보기가 보인다
- [ ] 출전표: 4인 길드 1명 중복은 경고 없음, 5인 길드 중복은 경고
- [ ] 대기실 열기 → 대표 계정 도구함 맨 위에 퀴즈 카드 → 들어가면 교사 화면에 '연결됨'
- [ ] 대표가 아닌 학생 계정에는 카드가 없다
- [ ] 중계 화면 새 창 → '교실 화면 시작' 클릭 → 전체 화면
- [ ] 시작 전: 중계·태블릿 모두 지문 없음, 선수 교체 안내
- [ ] 시작 → 태블릿 지문·타이머, 제출 → '제출 완료', 중계에는 🔒만
- [ ] 일시정지 → 태블릿·중계 지문 가림, 재개 → 남은 시간 이어짐
- [ ] 시간 0 → 태블릿 '답안 마감', 교사 화면 자동 마감
- [ ] 공개 → 중계에 다섯 답 일제 공개(정답은 아직 없음) → O/X → 확정 → 정답·정오
- [ ] 중간 공개 시점 알림 → '순위판 공개' 눌러야 작은 순위판 변경
- [ ] 영상 문제: '문제만 보여 주기' → 교사 화면 ▶ 재생으로 교실 화면 영상 재생(소리)
- [ ] 태블릿 새로고침·교사 창 새로고침 후에도 상태 유지
- [ ] 개인전 발표(낮은 순위부터) → 단체전 → 최종 발표(5·4·3위는 한 길드씩, 마지막 1·2위는 동시에 공개 + 1위 축포) → 종료 → 결과·기록·CSV
- [ ] 리허설 대회 삭제
