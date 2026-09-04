import { MonthlyMvpGallery } from '@/components/shared/MonthlyMvpGallery';

export function RecordsMonthlyMvpPanel() {
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-card-lg border border-gold/35 bg-[linear-gradient(145deg,rgba(255,217,61,0.10),rgba(177,151,252,0.08)_45%,rgba(15,11,26,0.82))] p-4 sm:p-5">
        <div aria-hidden="true" className="absolute -right-8 -top-10 text-8xl opacity-[0.06]">👑</div>
        <div className="relative">
          <div className="text-2xs font-black tracking-[0.20em] text-gold">B.R.A.N.D MONTHLY MVP ARCHIVE</div>
          <h2 className="font-display text-xl sm:text-2xl text-white mt-1">월간 MVP 명예관</h2>
          <p className="text-xs sm:text-sm text-text-secondary font-bold mt-2 max-w-2xl">
            한 달 전체를 대표해 선정된 B.R.A.N.D의 주인공들을 보존하는 특별 전시관입니다. 주간 MVP보다 한 단계 높은 명예 기록으로 분리해 전시합니다.
          </p>
          <div className="mt-3 inline-flex rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-2xs font-black text-gold">
            2023년부터 전 시즌 월간 MVP 아카이브 예정
          </div>
        </div>
      </section>

      <MonthlyMvpGallery variant="records" />

      <section className="rounded-card-md border border-dashed border-line bg-bg-deep/70 px-4 py-4">
        <div className="text-sm font-extrabold text-text-primary">역대 월간 MVP 아카이브 확장</div>
        <p className="text-xs text-text-secondary mt-1">
          현재 갤러리에 등록된 기록은 그대로 보존합니다. 2023년 이후의 과거 월간 MVP 명단과 이미지 자료를 이관하면 연도·시즌별 전체 전시로 확장합니다.
        </p>
      </section>
    </div>
  );
}
