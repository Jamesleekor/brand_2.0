# Feature 3 정적 검증 결과

## 통과

```text
tsc -b
오류 0개

tsc --noEmit
오류 0개
```

정적 확인:

- 프론트에서 `create_transaction` 직접 호출 없음
- 학생 경매 쓰기는 `place_live_auction_bid`만 사용
- 교사 경매 쓰기는 전용 teacher RPC만 사용
- 기존 미완성 경매 함수는 migration에서 authenticated/anon 차단
- 학생·교사·중계 화면이 동일한 상태 RPC와 Realtime 이벤트 사용
- 서버 시간 기반 countdown offset 적용
- 만료 정산 호출은 멱등 함수 사용
- 1.1배 즉시 입찰 계산은 서버에서 수행
- 최고 입찰 GOLD 예약은 중앙 `create_transaction`에서 보호

## 이 환경에서 실행하지 못한 항목

Vite 번들은 현재 컨테이너의 `node_modules`가 Windows용 Rollup optional dependency를 포함해 Linux 네이티브 패키지를 찾지 못했습니다.

```text
Cannot find module @rollup/rollup-linux-x64-gnu
```

사용자 Windows 환경에서 `npm ci` 후 `npm run build`로 최종 번들을 확인해야 합니다.

운영 Supabase SQL 실행과 실제 동시 입찰 테스트는 사용자 환경에서 수행해야 합니다.
