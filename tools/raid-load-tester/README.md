# B.R.A.N.D Raid 8/12/24 Player Load Tester

- 실제 Supabase anon 인증을 사용해 각 학생을 독립 세션으로 로그인합니다.
- `get_raid_battle_state`로 ACTIVE Raid / 참가 상태를 pre-flight 확인합니다.
- 실제 `submit_raid_tap_batch` RPC를 호출합니다.
- 클라이언트와 같은 1.55~2.0초 batching, 학생별 local token bucket, BUSY backpressure 재시도를 사용합니다.
- 결과는 `tools/raid-load-tester/results/`에 REPORT.txt / JSON / CSV로 저장됩니다.

## 자격 증명
`RAID_LOAD_TEST_CREDENTIALS.csv` 파일에 다음 헤더를 사용합니다.

```csv
student_name,password,classroom_id
김나연,실제비밀번호,1
...
```

비밀번호 파일은 Git에 commit하지 마세요. 테스트 후 삭제하거나 안전하게 보관하세요.
