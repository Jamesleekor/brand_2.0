# 모험가 도구함 — 24명 동시 참여 부하 테스트

**부하 테스트 전용 학급(B.R.A.N.D LOADTEST)에서만** 실행합니다. 다른 학급 교사 계정으로 실행하면 시작 전에 멈춥니다.

## 준비
1. 운영 DB에 `supabase/APPLY_ADVENTURER_TOOLBOX_V1.sql`이 적용되어 있어야 합니다.
2. 이 폴더의 `TOOLBOX_LOAD_TEST_CREDENTIALS.sample.csv`를 복사해 `TOOLBOX_LOAD_TEST_CREDENTIALS.csv`로 저장하고 LOADTEST 학생 이름·비밀번호를 채웁니다. (기존 레이드 부하 테스트 CSV를 그대로 복사해도 됩니다.)
3. 비밀번호 파일은 Git에 commit하지 않습니다.

## 실행
프로젝트 폴더에서 `RUN_TOOLBOX_LOAD_TESTER.cmd`를 더블클릭하고, LOADTEST 교사 이메일·비밀번호를 입력합니다.

## 확인하는 것
| 항목 | 통과 기준 |
| --- | --- |
| 부정출발 | 라운드 전에 누른 학생이 `FALSE_START`(5초 잠금)를 받음 |
| 라운드 열림 신호 | 학생 전원이 2초 안에 실시간 신호를 받음 |
| 버저 동시 입력 | 학생마다 2번씩 눌러도 순위 1~N이 빠짐·겹침 없이 한 번씩 |
| 버저 응답 | p95 1초 이하 |
| 정답 배점 | 1등 팀에 100점이 점수판에 한 번만 더해짐 |
| 투표·카드 | 두 번씩 제출(수정)해도 학생 수만큼만 남음, p95 2초·3초 이하 |

테스트가 끝나면 만든 활동은 모두 지웁니다. 결과는 `results/` 폴더에 REPORT.txt와 JSON으로 남습니다.
