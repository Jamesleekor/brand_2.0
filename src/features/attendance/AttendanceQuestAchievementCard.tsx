// 출석·일일퀘스트 기록 창 — LIFE-002 「퀘스트 마스터」 안내 카드 (명세 10장)
// 보유 여부와 선택 주 기록은 서로 다른 축이다. 공식 신청 가능/불가 판정은 하지 않는다.
// 공간을 적게 쓰도록 3줄 구성: ① 이름·보유·선택 주 배지 ② 조건 ③ 일수 요약. 보조 설명은 ⓘ 안에 접는다.
import type { AttendanceQuestAchievement, AttendanceQuestWeek } from '@/lib/rpc/attendance_quest_rpc';
import { cn } from '@/lib/utils/cn';
import { AQ, weekRecordView } from './attendanceQuestModel';

interface Props {
  achievement: AttendanceQuestAchievement;
  week: AttendanceQuestWeek | null;
}

export function AttendanceQuestAchievementCard({ achievement, week }: Props) {
  if (!achievement.visible) return null;

  const view = week ? weekRecordView(week) : null;
  const hasUnconfirmed = week ? week.unconfirmed_days > 0 : false;
  const isLegacyWeek = week ? week.warning_codes.includes('LEGACY_WEEK') : false;

  return (
    <section className={cn('rounded-card-lg px-3.5 py-2.5 min-w-0', AQ.panel)} aria-label={`업적 ${achievement.name} 기록 안내`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className={cn('font-display text-[15px] tracking-tight whitespace-nowrap', AQ.ivory)}>🏆 {achievement.name}</h4>
        <span
          className={cn(
            'text-[11px] font-extrabold px-1.5 py-0.5 rounded-card-sm border whitespace-nowrap',
            achievement.active_ownership ? cn('border-[#8BE6C2]/50', AQ.mint) : cn('border-[#4a3f63]', AQ.cream),
          )}
        >
          {achievement.active_ownership ? '보유 중' : '미보유'}
        </span>
        {view && (
          <span className={cn('ml-auto text-[11.5px] font-extrabold px-2 py-0.5 rounded-card-sm whitespace-nowrap', AQ.panelSoft, view.className)}>
            선택 주: {view.badge}
          </span>
        )}
      </div>

      <p className={cn('text-[12px] font-bold mt-1 [word-break:keep-all]', AQ.cream)}>{achievement.condition_text}</p>

      {week && view ? (
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[12px] font-extrabold', AQ.ivory)}>
          <span className="whitespace-nowrap">전체 완료 <span className={AQ.mint}>{week.complete_days}일</span></span>
          <span className="whitespace-nowrap">미달 <span className={AQ.apricot}>{week.failed_days}일</span></span>
          {week.unconfirmed_days > 0 && (
            <span className="whitespace-nowrap">확정 전 <span className={AQ.lavender}>{week.unconfirmed_days}일</span></span>
          )}
          {week.closed_days > 0 && <span className="whitespace-nowrap">휴업 {week.closed_days}일</span>}
          {view.text && <span className={cn('font-bold [word-break:keep-all]', view.className)}>· {view.text}</span>}
        </div>
      ) : (
        <div className="h-4 mt-1.5 w-2/3 rounded bg-white/10 animate-pulse" aria-hidden="true" />
      )}

      {(hasUnconfirmed || isLegacyWeek) && (
        <p className={cn('text-[11.5px] font-bold mt-1 [word-break:keep-all]', AQ.lavender)}>
          {hasUnconfirmed && '확정 전 날은 기존 검증 화면과 다를 수 있어요. 신청 전 확정 기록을 확인해 주세요.'}
          {hasUnconfirmed && isLegacyWeek && ' '}
          {isLegacyWeek && '2학기 첫 주는 이전 시스템 기록이라 검증 도우미에 없을 수 있어요.'}
        </p>
      )}

      <details className="mt-0.5">
        <summary className={cn('inline-flex items-center min-h-[28px] cursor-pointer select-none text-[11.5px] font-bold', AQ.cream)}>
          ⓘ 이 카드는?
        </summary>
        <p className={cn('text-[11.5px] font-bold pb-1 [word-break:keep-all]', AQ.cream)}>
          선택한 주의 확정 기록만 보여줍니다. 업적 보유 여부는 별도로 표시하며, 신청 가능 여부를 판정하지 않습니다.
        </p>
      </details>
    </section>
  );
}
