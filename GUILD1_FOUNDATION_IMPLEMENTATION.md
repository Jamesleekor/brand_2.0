# B.R.A.N.D 2.0 — Guild 1 Foundation

## 목적

Guild 1은 길드 점수·미션·동료평가·점령을 구현하기 전에 **누가 언제 어느 길드에 속했는지 재현 가능한 기반**을 먼저 만든다. 현재 길드원 목록을 과거 미션/평가의 기준으로 재사용하지 않는 것이 가장 중요한 원칙이다.

## 핵심 구현

- `guild_members`는 현재 row 덮어쓰기가 아니라 `joined_at ~ left_at` 시간 구간 이력으로 사용한다.
- 기존에 `student_id UNIQUE`가 있었다면 단일 UNIQUE만 제거하고 `uq_guild_members_one_active_per_student` partial unique index로 **학생당 활성 길드 1개**를 DB에서 강제한다.
- `guild_membership_events`에 ASSIGN / MOVE / REMOVE 감사 원장을 추가한다.
- 이벤트에는 당시 길드명과 membership id도 snapshot으로 남겨 이후 길드명이 바뀌어도 과거 이력을 설명할 수 있다.
- `guilds.element_code`를 길드 속성의 canonical source로 추가한다. 값은 `EARTH/WATER/LIGHT/WIND/FIRE` 다섯 가지다.
- 초기 2.0 호환을 위해 현재 `guild_members.element`도 길드 속성과 동기화하지만, 종료된 membership과 과거 snapshot은 수정하지 않는다.
- 교사는 길드 생성, 이름/슬로건/설명/로고/속성 수정, 활성/비활성화를 운영 화면에서 할 수 있다.
- 기존 `guild_seasons`는 삭제하지 않고 Guild 1 공통 컬럼을 증분 추가한다. 기존 alias 컬럼이 있으면 함께 동기화한다.
- 학교 출석과 분리된 `guild_sessions`를 추가한다.
- 세션 생성 순간 `guild_session_participants`에 당시 학생명/브랜드명/길드명/길드 속성을 snapshot한다.
- 이후 학생 전입·전출·길드 이동·길드명 변경이 일어나도 과거 세션 참석 대상과 당시 소속은 변하지 않는다.
- 기존 `guild_session_attendances`는 1.0 최종 이관 판단을 위해 건드리지 않는다.
- 교사 `/teacher/guild`에 **길드·멤버 / 시즌 / 길드 세션** 3개 운영 탭을 추가한다.
- 학생 `/guild`에는 공통 헤더에서 **이번 달 GS / 시즌 누적 GS / 현재 길드원 / 개인기여도 개편 예정**을 분리 표시하고, 길드 세션 및 본인 소속 이력을 표시한다.
- Realtime은 테이블별 별도 channel로 분리해 한 구독 오류가 다른 길드 실시간 갱신을 망가뜨리지 않게 한다.

## 안전장치

- 기존 데이터에 한 학생의 활성 membership이 2개 이상 있으면 migration을 임의 정리하지 않고 중단한다.
- 기존 `guilds`, `guild_members`, `guild_seasons`에 새 RPC가 채울 수 없는 미지의 `NOT NULL + no default` 컬럼이 있으면 설치 단계에서 컬럼명을 표시하고 중단한다.
- 새 쓰기 테이블은 authenticated 직접 INSERT/UPDATE/DELETE를 차단하고 교사 `SECURITY DEFINER` RPC만 허용한다.
- 길드 세션 참석은 학교 출석과 자동 연결하지 않는다.

## 미래 기능을 위한 불변 규칙

Guild 4 동료평가 구현 시 평가 대상/의무를 절대로 `guild_members WHERE left_at IS NULL`에서 매번 재계산하지 않는다. 평가 라운드 시작 순간 별도 participant/obligation snapshot을 만들어 종료까지 고정한다.

Guild 2 개인기여도는 시즌1 기존 산식을 사용하지 않는다. Guild 1은 세션 참석이라는 원자료만 정확히 축적한다.
