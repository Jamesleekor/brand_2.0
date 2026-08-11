# 검증 결과

## TypeScript

실행:

```bash
node /opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/bin/tsc -b
```

결과:

```text
성공 — TypeScript 오류 없음
```

## Vite 전체 build

작업 컨테이너에서 실행:

```bash
npm run build
```

`tsc -b` 단계는 통과했지만, 사용자가 업로드한 `node_modules`가 Windows용이어서 Linux Rollup 네이티브 모듈을 찾지 못해 Vite 단계가 중단되었습니다.

```text
Cannot find module @rollup/rollup-linux-x64-gnu
```

소스 오류로 확인된 실패가 아니라 운영체제별 선택 의존성 문제입니다. 사용자의 Windows PC에서 반드시 다음을 실행해 최종 확인해야 합니다.

```bash
npm ci
npm run build
```

## 보안 정적 확인

- 프론트에서 `create_transaction` 직접 RPC 호출 없음
- 프론트 `.env.local`에 service role 키 없음
- 프론트는 `teacher_adjust_student_assets`만 호출
- migration은 `create_transaction`의 PUBLIC/anon/authenticated EXECUTE 차단을 재확인
