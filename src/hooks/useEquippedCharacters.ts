import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';

export type EquippedCharacterResourceKind = 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';

let equippedCharactersRealtimeChannelSeq = 0;

export interface EquippedCharacterIdentity {
  studentId: number;
  characterId: number;
  name: string;
  epithet: string | null;
  resourceKind: EquippedCharacterResourceKind;
  resourceUrl: string | null;
  emoji: string | null;
  fullImageUrl: string | null;
  cardImageUrl: string | null;
  avatarImageUrl: string | null;
}

export function getEquippedCharacterImageUrl(
  character: EquippedCharacterIdentity | null | undefined,
  preference: 'avatar' | 'card' | 'full' = 'avatar',
): string | null {
  if (!character || character.resourceKind === 'EMOJI') return null;

  const raw = preference === 'full'
    ? character.fullImageUrl || character.cardImageUrl || character.avatarImageUrl || character.resourceUrl
    : preference === 'card'
      ? character.cardImageUrl || character.avatarImageUrl || character.fullImageUrl || character.resourceUrl
      : character.avatarImageUrl || character.cardImageUrl || character.resourceUrl || character.fullImageUrl;

  return raw ? resolveAssetUrl(raw, 'character') : null;
}

/**
 * C1 SSOT adapter: classroom-visible equipped identity.
 *
 * student_character_profiles is intentionally readable by classroom members,
 * while ownership/event tables remain private.  This hook exposes only the
 * public-facing equipped identity needed by home/ranking/guild UI.
 */
export function useClassroomEquippedCharacters() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const queryClient = useQueryClient();

  const query = useQuery<EquippedCharacterIdentity[]>({
    queryKey: ['equipped-characters', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];

      const profilesRes = await supabase
        .from('student_character_profiles')
        .select('student_id,equipped_character_id')
        .eq('classroom_id', classroomId)
        .not('equipped_character_id', 'is', null);

      if (profilesRes.error) {
        throw new Error(`[Character C1:profiles] ${profilesRes.error.message}`);
      }

      const profiles = profilesRes.data ?? [];
      const characterIds = Array.from(new Set(
        profiles
          .map((row: any) => Number(row.equipped_character_id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ));

      if (characterIds.length === 0) return [];

      const charactersRes = await supabase
        .from('characters')
        .select('id,name,epithet,resource_kind,resource_url,emoji,full_image_url,card_image_url,avatar_image_url,is_active')
        .in('id', characterIds)
        .eq('is_active', true);

      if (charactersRes.error) {
        throw new Error(`[Character C1:characters] ${charactersRes.error.message}`);
      }

      const characterById = new Map<number, any>(
        (charactersRes.data ?? []).map((row: any) => [Number(row.id), row]),
      );

      return profiles.flatMap((profile: any) => {
        const characterId = Number(profile.equipped_character_id);
        const character = characterById.get(characterId);
        if (!character) return [];

        return [{
          studentId: Number(profile.student_id),
          characterId,
          name: String(character.name ?? '편린'),
          epithet: character.epithet ?? null,
          resourceKind: character.resource_kind as EquippedCharacterResourceKind,
          resourceUrl: character.resource_url ?? null,
          emoji: character.emoji ?? null,
          fullImageUrl: character.full_image_url ?? null,
          cardImageUrl: character.card_image_url ?? null,
          avatarImageUrl: character.avatar_image_url ?? null,
        } satisfies EquippedCharacterIdentity];
      });
    },
    enabled: classroomId !== null,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!classroomId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['equipped-characters', classroomId] });
      if (studentId) {
        void queryClient.invalidateQueries({ queryKey: ['character-collection'] });
      }
    };

    // This hook is mounted from more than one Home surface (e.g. TopHeader
    // and DashboardPage). Supabase Realtime channel topics must therefore be
    // unique per effect subscription; reusing the same subscribed topic can
    // throw when another instance tries to register postgres_changes handlers.
    const channelTopic = `equipped-characters:${classroomId}:${++equippedCharactersRealtimeChannelSeq}`;

    const channel = supabase
      .channel(channelTopic)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'student_character_profiles',
        filter: `classroom_id=eq.${classroomId}`,
      }, invalidate)
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [classroomId, studentId, queryClient]);

  const byStudentId = useMemo(() => new Map(
    (query.data ?? []).map((row) => [row.studentId, row] as const),
  ), [query.data]);

  return { ...query, byStudentId };
}

export function useMyEquippedCharacter() {
  const studentId = useStudentId();
  const { byStudentId, ...query } = useClassroomEquippedCharacters();
  return {
    ...query,
    character: studentId ? byStudentId.get(studentId) ?? null : null,
  };
}
