import { Crown, Gamepad2, ShieldCheck, Trophy, Zap } from 'lucide-react';
import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';
import { arcadeGameLabel, arcadeKoreanText, arcadeRecordGroups } from './records_arcade_display';
import './records-arcade-rulers.css';

export function RecordsArcadeRulersHall({ entries }: { entries: HallOfGloryEntry[] }) {
  const groups = arcadeRecordGroups(entries);
  const highs = groups.filter(rows => rows[0].record_type.startsWith('ALL_TIME_HIGH_SCORE'));
  const honors = groups.filter(rows => !rows[0].record_type.startsWith('ALL_TIME_HIGH_SCORE'));

  return <section id="hall-arcade_rulers" className="arcade-rulers scroll-mt-24" aria-labelledby="arcade-rulers-title">
    <header className="arcade-rulers-header">
      <div className="arcade-rulers-heading"><span className="arcade-rulers-emblem"><Gamepad2 aria-hidden="true" size={30}/></span><div><div className="arcade-rulers-kicker">HALL 07 · 공인기록 전시관</div><h3 id="arcade-rulers-title">아케이드의 지배자</h3><p>공인기록으로 증명되는 게임의 왕좌</p></div></div>
      <span className="arcade-rulers-seal"><ShieldCheck aria-hidden="true" size={16}/>월간 확정 기록 기준</span>
    </header>
    <div className="arcade-rulers-content">
      {!groups.length?<div className="arcade-rulers-empty"><Gamepad2 aria-hidden="true" size={36}/><h4>첫 번째 지배자를 기다립니다</h4><p>월간 순위가 확정되면 공인 점수와 명예 기록이 이곳에 전시됩니다.</p></div>:<>
        {highs.length>0&&<section aria-labelledby="arcade-highs-title"><div className="arcade-rulers-section-title"><h4 id="arcade-highs-title"><Zap aria-hidden="true" size={17}/>게임별 역대 최고 점수</h4><span>동점 기록 공동 전시</span></div><div className="arcade-rulers-score-grid">{highs.map(rows=><HighScoreCabinet key={rows[0].record_type} rows={rows}/>)}</div></section>}
        {honors.length>0&&<section aria-labelledby="arcade-honors-title"><div className="arcade-rulers-section-title"><h4 id="arcade-honors-title"><Trophy aria-hidden="true" size={17}/>지배자의 명예 기록</h4><span>{honors.length}개 부문</span></div><div className="arcade-rulers-honor-grid">{honors.map(rows=><HonorCard key={rows[0].record_type} rows={rows}/>)}</div></section>}
      </>}
    </div>
  </section>;
}

function HighScoreCabinet({ rows }: { rows: HallOfGloryEntry[] }) {
  const first = rows[0];
  return <article className="arcade-score-cabinet"><div className="arcade-cabinet-marquee"><Gamepad2 aria-hidden="true" size={18}/><h5>{arcadeGameLabel(first)}</h5><span className="arcade-cabinet-lights" aria-hidden="true"><i/><i/><i/></span></div><div className="arcade-cabinet-screen"><div className="arcade-score-label"><Crown aria-hidden="true" size={15}/><span>최고 점수 보유자{rows.length>1?' · 공동 기록':''}</span></div>{rows.map(row=><div className="arcade-score-holder" key={row.record_key}><div className="arcade-holder-name"><strong>{row.subject_display_name}</strong>{row.subject_brand_name&&row.subject_brand_name!==row.subject_display_name&&<span>{row.subject_brand_name}</span>}<span>{recordPeriod(row)||'확정 기록'}</span></div><div className="arcade-record-value"><b>{row.value_primary==null?'—':formatNumber(row.value_primary)}</b><span>{arcadeKoreanText(row.unit)||'점'}</span></div></div>)}</div><div className="arcade-cabinet-footer"><span className="arcade-cabinet-controls" aria-hidden="true"><i/><i/><i/></span><span>{sourceLabel(rows)}</span></div></article>;
}

function HonorCard({ rows }: { rows: HallOfGloryEntry[] }) {
  const first = rows[0];
  return <article className="arcade-honor-card"><div className="arcade-honor-heading"><h5>{arcadeKoreanText(first.title)}</h5><Trophy aria-hidden="true" size={17}/></div>{first.description&&<p className="arcade-honor-description">{arcadeKoreanText(first.description)}</p>}{rows.map(row=><div className="arcade-honor-holder" key={row.record_key}><div className="arcade-holder-name"><strong>{row.subject_display_name}</strong>{row.subject_brand_name&&row.subject_brand_name!==row.subject_display_name&&<span>{row.subject_brand_name}</span>}{recordPeriod(row)&&<span>{recordPeriod(row)}</span>}{row.metadata?.ongoing===true&&<span className="arcade-ongoing">기록 유지 중</span>}</div><div className="arcade-record-value arcade-record-value-small"><b>{row.value_primary==null?'—':formatNumber(row.value_primary)}{row.denominator!=null&&row.denominator>0?` / ${formatNumber(row.denominator)}`:''}</b>{row.unit&&<span>{arcadeKoreanText(row.unit)}</span>}</div></div>)}<div className="arcade-honor-footer">{sourceLabel(rows)}</div></article>;
}

function recordPeriod(entry: HallOfGloryEntry) {
  const label = entry.period_label || entry.season_label || entry.subtitle || entry.occurred_on || '';
  // Grand-slam subtitles contain the qualification, so preserve it beside the period.
  const qualification = entry.record_type.startsWith('GRAND_SLAMMER') && entry.subtitle && entry.subtitle!==label ? ` · ${entry.subtitle}` : '';
  return arcadeKoreanText(label + qualification);
}

function sourceLabel(rows: HallOfGloryEntry[]) {
  return rows.some(row=>row.source_kind==='PRODUCTION_DERIVED')?'확정 기록 집계':'공식 보존 기록';
}
