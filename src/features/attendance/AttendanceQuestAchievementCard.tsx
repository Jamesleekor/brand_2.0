// 출석·일일퀘스트 기록 창 — LIFE-002 「퀘스트 마스터」 안내 카드 (명세 10장)
// 보유 여부와 선택 주 기록은 서로 다른 축이다. 공식 신청 가능/불가 판정은 하지 않는다.
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
    <section className={cn('rounded-card-lg px-3.5 py-3 min-w-0', AQ.panel)} aria-label={`업적 ${achievement.name} 기록 안내`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className={cn('font-display text-[16px] tracking-tight', AQ.ivory)}>🏆 {achievement.name}</h4>
        <span
          className={cn(
            'text-[11.5px] font-extrabold px-2 py-1 rounded-card-sm border whitespace-nowrap',
            achievement.active_ownership ? cn('border-[#8BE6C2]/50', AQ.mint) : cn('border-[#3b3152]', AQ.cream),
          )}
        >
          {achievement.active_ownership ? '보유 중' : '미보유'}
        </span>
      </div>

      <p className={cn('text-[12.5px] font-bold mt-1.5 [word-break:keep-all]', AQ.cream)}>{achievement.condition_text}</p>

      {week && view ? (
        <>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={cn('text-[11.5px] font-extrabold px-2 py-1 rounded-card-sm whitespace-nowrap', AQ.panelSoft, view.className)}>
              선택 주: {view.badge}
            </span>
            <span className={cn('text-[12.5px] font-bold [word-break:keep-all]', AQ.ivory)}>{view.text}</span>
          </div>
          <div className={cn('flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[12.5px] font-extrabold', AQ.ivory)}>
            <span className="whitespace-nowrap">전체 완료 <span className={AQ.mint}>{week.complete_days}일</span></span>
            <span className="whitespace-nowrap">미달 <span className={AQ.apricot}>{week.failed_days}일</span></span>
            {week.unconfirmed_days > 0 && (
              <span className="whitespace-nowrap">확정 전 <span className={AQ.lavender}>{week.unconfirmed_days}일</span></span>
            )}
            {week.closed_days > 0 && <span className="whitespace-nowrap">휴업 {week.closed_days}일</span>}
          </div>
        </>
      ) : (
        <div className="h-10 mt-2 rounded bg-white/10 animate-pulse" aria-hidden="true" />
      )}

      {isLegacyWeek && (
        <p className={cn('text-[11.5px] font-bold mt-2 [word-break:keep-all]', AQ.cream)}>
          2학기 첫 주는 이전 시스템 기록이에요. 업적 검증 도우미에는 나오지 않을 수 있어요.
        </p>
      )}
      {hasUnconfirmed && (
        <p className={cn('text-[11.5px] font-bold mt-2 [word-break:keep-all]', AQ.lavender)}>
          정산 전 체크를 포함하는 기존 검증 화면과 잠시 다르게 보일 수 있어요. 신청 전에는 확정된 기록을 확인해 주세요.
        </p>
      )}
      <p className={cn('text-[11.5px] font-bold mt-2 [word-break:keep-all]', AQ.cream)}>
        이 카드는 선택한 주의 확정 기록을 보여줍니다. 업적 보유 여부는 별도로 표시합니다.
      </p>
    </section>
  );
}
