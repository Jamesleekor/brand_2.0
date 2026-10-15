# 일일퀘스트 관리자 전달사항

2026-10-15 운영 DB: daily_quest_manager_submit_with_message / get_daily_quest_report_message 적용.
보고서 metadata에 메모·작성자 auth UID·저장시각을 보관한다. 기존 정산/지급 RPC 변경 없음.
빈칸 제출 가능, 2000자 제한. 없음 체크 시 전달사항 없음 자동 입력, 해제 시 작성 중 메모 복원.
제출 직전에 함께 저장. 제출 실패 시 전체 rollback. 반려 전 수정 불가.
학생/교사 보드가 별도 메모 조회 RPC를 조합한다. 15초 polling 유지.
DB: 권한·미로그인·길이·미존재 보고서 검사 통과.
확인 필요: Windows CMD 실실행, 사용자 npm run build, 학생/교사 로그인 제출·반려·재제출·정산 후 조회.
