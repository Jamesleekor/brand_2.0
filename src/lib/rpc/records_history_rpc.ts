import type { SupabaseClient } from '@supabase/supabase-js';

export type HallKey =
  | 'PIONEERS'
  | 'THRONE'
  | 'REPEATED_CROWNS'
  | 'ASCENT'
  | 'GOLDEN_CHRONICLE'
  | 'GUILD_HEGEMONY'
  | 'ARCADE_RULERS'
  | 'CONSTELLATION'
  | 'SOVEREIGN_PROOF';

export type HistoricalSubjectKind = 'STUDENT' | 'GUILD' | 'SYSTEM' | 'EMPTY_THRONE';
export type HistoricalSourceKind = 'CURATED' | 'PRODUCTION_SNAPSHOT' | 'PRODUCTION_DERIVED';

export interface RecordsGapEra {
  start_year: number;
  end_year: number;
  title: string;
  subtitle: string;
}

export interface HallAchievementDetail {
  name: string;
  achieved_on?: string | null;
}

export interface HallOfGloryEntry {
  id: number;
  record_key: string;
  hall_key: HallKey;
  record_type: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  subject_kind: HistoricalSubjectKind;
  subject_display_name: string;
  subject_brand_name: string | null;
  school_year: number | null;
  season_label: string | null;
  period_label: string | null;
  occurred_on: string | null;
  rank_position: number | null;
  value_primary: number | null;
  value_secondary: number | null;
  denominator: number | null;
  unit: string | null;
  comparison_value: number | null;
  source_kind: HistoricalSourceKind;
  metadata: Record<string, unknown> & {
    achievement_name?: string;
    achievement_names?: HallAchievementDetail[];
  };
  sort_order: number;
}

export interface HallOfGloryBoard {
  entries: HallOfGloryEntry[];
  gap_eras: RecordsGapEra[];
}

interface SupplementalHallBoard {
  entries: HallOfGloryEntry[];
}

export interface MonthlyMvpArchiveRow {
  id: number;
  period_key: string;
  school_year: number;
  month_no: number;
  period_label: string;
  winner_display_name: string;
  finalists: string[];
  source_kind: HistoricalSourceKind;
  metadata: Record<string, unknown>;
}

export interface MonthlyMvpArchiveBoard {
  rows: MonthlyMvpArchiveRow[];
  gap_eras: RecordsGapEra[];
}

export const recordsHistoryRpc = {
  hallOfGlory: async (supabase: SupabaseClient): Promise<HallOfGloryBoard> => {
    const [baseResult, guildResult, arcadeResult] = await Promise.all([
      supabase.rpc('student_get_records_hall_of_glory_enriched'),
      supabase.rpc('student_get_records_guild_hall'),
      supabase.rpc('student_get_records_arcade_hall'),
    ]);

    if (baseResult.error) throw baseResult.error;
    if (guildResult.error) throw guildResult.error;
    if (arcadeResult.error) throw arcadeResult.error;

    const base = (baseResult.data ?? { entries: [], gap_eras: [] }) as HallOfGloryBoard;
    const guild = (guildResult.data ?? { entries: [] }) as SupplementalHallBoard;
    const arcade = (arcadeResult.data ?? { entries: [] }) as SupplementalHallBoard;

    return {
      ...base,
      entries: [
        ...base.entries.filter((entry) => entry.hall_key !== 'GUILD_HEGEMONY' && entry.hall_key !== 'ARCADE_RULERS'),
        ...guild.entries,
        ...arcade.entries,
      ],
    };
  },

  monthlyMvpArchive: async (supabase: SupabaseClient): Promise<MonthlyMvpArchiveBoard> => {
    const { data, error } = await supabase.rpc('student_get_records_monthly_mvp_archive');
    if (error) throw error;
    return (data ?? { rows: [], gap_eras: [] }) as MonthlyMvpArchiveBoard;
  },
};
