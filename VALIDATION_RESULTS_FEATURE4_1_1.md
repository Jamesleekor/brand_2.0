# Feature 4.1.1 validation

## 수행
- 전체 `src/**/*.ts`, `src/**/*.tsx` 61개를 TypeScript parser로 파싱: **syntax error 0**.
- 변경한 SQL은 기존 함수 시그니처/transaction type을 기준으로 정적 대조.
- Realtime은 `emergency_quest_requests` 등 선택 테이블 실패가 다른 채널까지 전파되지 않도록 채널 단위로 분리.

## 전체 npm build 상태
이 실행 환경의 내부 npm mirror에 `zustand@5.0.14` tarball이 없어 `npm ci` 단계에서 HTTP 404로 중단됩니다. 따라서 이 컨테이너에서는 최종 `npm run build`를 완주할 수 없었습니다.

실제 사용자 PC에서는 기존과 같이:

```bash
npm ci
npm run build
```

으로 최종 확인해야 합니다. 빌드 오류가 있으면 오류 로그 기준으로 수정합니다.

## DB 주의
프론트 코드만 교체하면 `emergency_quest_requests` schema-cache 오류는 해결되지 않습니다. 현재 DB에는 `supabase/APPLY_FEATURE4_1_1_CUMULATIVE.sql` 적용을 권장합니다.
