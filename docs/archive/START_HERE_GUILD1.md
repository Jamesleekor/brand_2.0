# Guild 1 적용 순서

이번 버전은 **DB migration이 필수**다.

## 1. Supabase
SQL Editor에서 아래 파일을 한 번 실행한다.

`supabase/APPLY_GUILD1_FOUNDATION.sql`

전체 스키마를 다시 실행하지 않는다.

### Migration이 의도적으로 멈추는 경우
아래 상황은 임의 자동수정하지 않는다.

- 한 학생에게 `left_at IS NULL`인 활성 길드 membership이 2개 이상 존재
- 기존 `guilds / guild_members / guild_seasons`에 Guild 1 RPC가 채우지 못하는 필수 legacy 컬럼 존재

오류 메시지에 student_id 또는 컬럼명이 표시되면 그 데이터를 확인한 뒤 다시 적용한다.

## 2. Post-check

`supabase/migrations/20260811_02_guild1_foundation_postcheck.sql`

- 첫 결과: 모든 객체 `true`
- 중복 활성 membership 질의: **0행**
- 속성 미설정 활성 길드 질의: 가능하면 **0행**. 결과가 있으면 교사 `길드 운영 → 길드·멤버 → 수정`에서 속성을 지정한다.
- Realtime publication: 환경에 publication이 있다면 6개 길드 테이블이 표시

## 3. Frontend
새 폴더라면:

```bash
npm ci
npm run build
npm run dev
```

## 4. 첫 테스트
교사 → **길드 운영** → `Guild 1 진단`.

그다음 순서:
1. 기존 길드 및 속성 확인
2. 학생 배정 현황 확인
3. 테스트 학생 1명 A→B 이동
4. 소속 이력 확인
5. 길드 세션 1개 생성
6. 해당 학생을 다시 이동
7. 과거 세션의 `당시 길드`가 바뀌지 않는지 확인
8. 새 전입 테스트 학생을 배정해도 과거 세션 대상이 늘어나지 않는지 확인

이 핵심 snapshot 테스트를 통과하기 전에는 Guild 2 GS Engine으로 넘어가지 않는다.
