import {
  Crown,
  Gamepad2,
  Hourglass,
  Medal,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';
import { arcadeGameLabel, arcadeKoreanText, arcadeRecordGroups } from './records_arcade_display';
import './records-arcade-rulers.css';

type RecordGroup = HallOfGloryEntry[];

/** HALL 07: each distinction is a dedicated exhibit, never a generic two-column card. */
export function RecordsArcadeRulersHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const groups = arcadeRecordGroups(entries);
  const highs = groups.filter((rows) => rows[0].record_type.startsWith('ALL_TIME_HIGH_SCORE'));
  const honors = groups.filter((rows) => !rows[0].record_type.startsWith('ALL_TIME_HIGH_SCORE'));
  const oneGame = honors.find((rows) => rows[0].record_type === 'MOST_MONTHLY_WINS_ONE_GAME');
  const differentGames = honors.find((rows) => rows[0].record_type === 'MOST_DIFFERENT_GAMES_WON');
  const longestReign = honors.find((rows) => rows[0].record_type === 'LONGEST_OVERALL_THRONE');
  const additionalHonors = honors.filter((rows) =>
    !['MOST_MONTHLY_WINS_ONE_GAME', 'MOST_DIFFERENT_GAMES_WON', 'LONGEST_OVERALL_THRONE'].includes(rows[0].record_type)
  );

  return (
    <section id="hall-arcade_rulers" className="arcade-hall07 scroll-mt-24" aria-labelledby="arcade-rulers-title">
      <header className="arcade07-entrance">
        <div className="arcade07-entrance-glow" aria-hidden="true" />
        <div className="arcade07-entrance-number" aria-hidden="true">07</div>
        <div className="arcade07-entrance-inner">
          <p className="arcade07-overline"><span className="arcade07-live-light" /> HALL 07 <span className="arcade07-overline-rule">/</span> ARCADE HALL OF FAME</p>
          <div className="arcade07-entrance-mark" aria-hidden="true"><Gamepad2 size={27} strokeWidth={1.7} /></div>
          <h3 id="arcade-rulers-title">아케이드의 <em>지배자</em></h3>
          <p className="arcade07-entrance-lead">최고의 플레이는 사라져도, 그 이름은 남는다.</p>
          <div className="arcade07-entrance-bottom">
            <span><ShieldCheck aria-hidden="true" size={15} /> 공인 월간 성적 기반</span>
            <span><Crown aria-hidden="true" size={15} /> 동점 기록 공동 명예 등재</span>
          </div>
        </div>
      </header>

      <div className="arcade07-interior">
        {groups.length === 0 ? (
          <div className="arcade07-empty">
            <Gamepad2 aria-hidden="true" size={43} />
            <h4>아직 열리지 않은 전설의 무대</h4>
            <p>월간 기록이 공인되면 이곳에 최초의 챔피언이 등장합니다.</p>
          </div>
        ) : (
          <>
            {highs.length > 0 && (
              <section className="arcade07-chapter" aria-labelledby="arcade-highs-title">
                <ChapterHeading
                  index="I"
                  eyebrow="THE IMMORTAL HIGH SCORES"
                  title="전설의 하이스코어"
                  description="각 게임의 역대 최고 점수. 전광판의 중심에는 숫자보다 먼저, 그 기록을 남긴 이름이 빛납니다."
                />
                <div className="arcade07-score-stages">
                  {highs.map((rows, index) => (
                    <HighScoreStage key={rows[0].record_type} rows={rows} index={index} />
                  ))}
                </div>
              </section>
            )}

            {honors.length > 0 && (
              <section className="arcade07-chapter arcade07-chapter-honors" aria-labelledby="arcade-honors-title">
                <ChapterHeading
                  index="II"
                  eyebrow="THE CROWNED LEGENDS"
                  title="왕좌를 증명한 자들"
                  description="한 번의 고득점을 넘어, 우승의 횟수와 영역 그리고 지켜 낸 시간으로 불멸의 이름을 새긴 기록자들."
                />
                <div className="arcade07-honor-exhibits">
                  {oneGame && <DominionMonument rows={oneGame} />}
                  {differentGames && <CrownGallery rows={differentGames} />}
                  {longestReign && <ReignSanctuary rows={longestReign} />}
                  {additionalHonors.map((rows) => (
                    <SpecialExhibit key={rows[0].record_type} rows={rows} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <footer className="arcade07-exit"><span>✦</span> LEGENDS ARE NOT GIVEN. THEY ARE EARNED. <span>✦</span></footer>
    </section>
  );
}

function ChapterHeading({ index, eyebrow, title, description }: {
  index: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="arcade07-chapter-heading">
      <div className="arcade07-chapter-index" aria-hidden="true">{index}</div>
      <div className="arcade07-chapter-heading-text">
        <div className="arcade07-chapter-eyebrow">{eyebrow}</div>
        <h4 id={index === 'I' ? 'arcade-highs-title' : 'arcade-honors-title'}>{title}</h4>
        <p>{description}</p>
      </div>
      <span className="arcade07-chapter-line" aria-hidden="true" />
    </div>
  );
}

function HighScoreStage({ rows, index }: { rows: RecordGroup; index: number }) {
  const first = rows[0];
  return (
    <article className={`arcade07-champion-stage ${index % 2 === 0 ? 'arcade07-champion-cyan' : 'arcade07-champion-magenta'}`}>
      <div className="arcade07-stage-lines" aria-hidden="true" />
      <div className="arcade07-stage-emblem" aria-hidden="true">
        <span className="arcade07-stage-ring"><Gamepad2 size={37} strokeWidth={1.3} /></span>
        <span className="arcade07-stage-index">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="arcade07-stage-honoree">
        <div className="arcade07-stage-game"><span className="arcade07-glyph">◆</span> GAME {String(index + 1).padStart(2, '0')} <span className="arcade07-stage-game-line">/</span> {arcadeGameLabel(first)}</div>
        <div className="arcade07-stage-status"><Crown aria-hidden="true" size={17} /> {rows.length > 1 ? 'CO-CHAMPIONS · 공동 최고 기록' : 'HIGH SCORE CHAMPION'}</div>
        <div className="arcade07-stage-names">
          {rows.map((entry) => (
            <div className="arcade07-stage-person" key={entry.record_key}>
              <strong>{entry.subject_display_name}</strong>
              {entry.subject_brand_name && entry.subject_brand_name !== entry.subject_display_name && <span>{entry.subject_brand_name}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="arcade07-stage-record">
        <div className="arcade07-stage-score-line">
          <div className="arcade07-stage-big-score"><strong>{first.value_primary == null ? '—' : formatNumber(first.value_primary)}</strong><small>{arcadeKoreanText(first.unit) || '점'}</small></div>
          {recordPeriod(first) && <span className="arcade07-stage-score-period">{recordPeriod(first)}</span>}
        </div>
      </div>
    </article>
  );
}

function ExhibitTitle({ order, english, title, subtitle }: { order: string; english: string; title: string; subtitle: string }) {
  return (
    <header className="arcade07-exhibit-title">
      <span className="arcade07-exhibit-order">{order}</span>
      <div>
        <p>{english}</p>
        <h5>{title}</h5>
        <span>{subtitle}</span>
      </div>
    </header>
  );
}

function DominionMonument({ rows }: { rows: RecordGroup }) {
  return (
    <article className="arcade07-exhibit arcade07-dominion">
      <div className="arcade07-dominion-crest" aria-hidden="true">
        <div className="arcade07-dominion-crown"><Crown size={66} strokeWidth={1.2} /></div>
        <span>SUPREME</span>
        <strong>VICTOR</strong>
      </div>
      <div className="arcade07-dominion-content">
        <ExhibitTitle order="01" english="THE SOVEREIGN OF ONE GAME" title="한 종목을 지배한 자" subtitle="동일 게임에서 달성한 최다 월간 우승 횟수" />
        <div className="arcade07-dominion-winners">
          {rows.map((entry) => (
            <div className="arcade07-dominion-winner" key={entry.record_key}>
              <div className="arcade07-dominion-identity">
                <strong>{entry.subject_display_name}</strong>
                {displayAlias(entry) && <span>{displayAlias(entry)}</span>}
                <div className="arcade07-dominion-game"><Gamepad2 size={19} aria-hidden="true" /><b>{arcadeGameLabel(entry)}</b></div>
              </div>
              <div className="arcade07-dominion-count">
                <strong>{number(entry.value_primary)}</strong><span>{arcadeKoreanText(entry.unit) || '회'} 우승</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function CrownGallery({ rows }: { rows: RecordGroup }) {
  return (
    <article className="arcade07-exhibit arcade07-gallery">
      <ExhibitTitle order="02" english="THE COLLECTION OF CROWNS" title="왕관의 수집가" subtitle="서로 다른 게임에서 월간 우승을 차지한 종목 수" />
      <div className="arcade07-gallery-plinths">
        {rows.map((entry) => (
          <div className="arcade07-gallery-plinth" key={entry.record_key}>
            <div className="arcade07-gallery-crest" aria-hidden="true"><Trophy size={29} strokeWidth={1.35} /></div>
            <div className="arcade07-gallery-name">{entry.subject_display_name}</div>
            {displayAlias(entry) && <div className="arcade07-gallery-alias">{displayAlias(entry)}</div>}
            <div className="arcade07-gallery-divider" aria-hidden="true"><span /></div>
            <div className="arcade07-gallery-count"><strong>{number(entry.value_primary)}</strong><span>{arcadeKoreanText(entry.unit) || '종'}</span></div>
            <div className="arcade07-gallery-caption">DISTINCT GAMES WON</div>
          </div>
        ))}
      </div>
      <div className="arcade07-footnote"><ShieldCheck size={13} aria-hidden="true" /> 동점 기록자는 동등한 명예로 함께 전시됩니다.</div>
    </article>
  );
}

function ReignSanctuary({ rows }: { rows: RecordGroup }) {
  return (
    <article className="arcade07-exhibit arcade07-reign">
      <ExhibitTitle order="03" english="THE UNBROKEN REIGN" title="왕좌를 가장 오래 지킨 자" subtitle="아케이드 전체에서 최고 기록의 왕좌를 가장 오래 유지한 기간" />
      <div className="arcade07-reign-archive">
        <div className="arcade07-reign-clock" aria-hidden="true"><Hourglass size={58} strokeWidth={1.1} /><span>THE AGE OF</span><strong>ROYALTY</strong></div>
        <div className="arcade07-reign-list">
          {rows.map((entry) => (
            <div className="arcade07-reign-line" key={entry.record_key}>
              <div className="arcade07-reign-person">
                <Crown size={18} aria-hidden="true" />
                <div>
                  <strong>{entry.subject_display_name}</strong>
                  {displayAlias(entry) && <span className="arcade07-reign-alias">{displayAlias(entry)}</span>}
                  <div className="arcade07-reign-game"><Gamepad2 size={17} aria-hidden="true" /><b>{arcadeGameLabel(entry)}</b></div>
                </div>
              </div>
              <div className="arcade07-reign-duration"><strong>{number(entry.value_primary)}</strong><span>{arcadeKoreanText(entry.unit) || '일'}</span></div>
              <div className="arcade07-reign-track" aria-hidden="true"><span /></div>
              {entry.metadata?.ongoing === true && <div className="arcade07-ongoing"><Sparkles size={13} /> 기록 유지 중</div>}
            </div>
          ))}
        </div>
      </div>

    </article>
  );
}

/** Expansion exhibit for future honorable record types (e.g. six-game Grand Slam). */
function SpecialExhibit({ rows }: { rows: RecordGroup }) {
  const first = rows[0];
  return (
    <article className="arcade07-exhibit arcade07-special">
      <ExhibitTitle order="✦" english="EXTRAORDINARY ACHIEVEMENT" title={arcadeKoreanText(first.title)} subtitle={arcadeKoreanText(first.subtitle || first.description || '새롭게 탄생한 아케이드 공식 명예 기록')} />
      <div className="arcade07-special-winners">
        {rows.map((entry) => (
          <div className="arcade07-special-winner" key={entry.record_key}>
            <span className="arcade07-special-medal"><Medal size={23} /></span>
            <div><strong>{entry.subject_display_name}</strong><span>{displayAlias(entry)}{recordPeriod(entry) ? ` · ${recordPeriod(entry)}` : ''}</span></div>
            <div className="arcade07-special-score"><strong>{number(entry.value_primary)}{entry.denominator != null && entry.denominator > 0 ? ` / ${formatNumber(entry.denominator)}` : ''}</strong><span>{arcadeKoreanText(entry.unit)}</span></div>
          </div>
        ))}
      </div>
    </article>
  );
}

function displayAlias(entry: HallOfGloryEntry): string {
  return entry.subject_brand_name && entry.subject_brand_name !== entry.subject_display_name ? entry.subject_brand_name : '';
}

function number(value: number | null): string {
  return value == null ? '—' : formatNumber(value);
}

function recordPeriod(entry: HallOfGloryEntry): string {
  const label = entry.period_label || entry.season_label || entry.subtitle || entry.occurred_on || '';
  const qualification = entry.record_type.startsWith('GRAND_SLAMMER') && entry.subtitle && entry.subtitle !== label ? ` · ${entry.subtitle}` : '';
  return arcadeKoreanText(label + qualification);
}

