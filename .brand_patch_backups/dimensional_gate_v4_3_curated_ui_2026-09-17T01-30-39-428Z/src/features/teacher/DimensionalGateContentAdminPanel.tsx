import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import type { TeacherCharacterRow } from '@/lib/rpc/character_c3_rpc';
import {
  dimensionalGateContentRpc,
  dimensionalGateContentExtrasRpc,
  dimensionalGateStoryAdminRpc,
  type DimensionalGateStoryPackage,
  type DimensionalGateSpecialCgAdminRow,
  type DimensionalGateContentMemory,
  type DimensionalGateContentReward,
} from '@/lib/rpc/dimensional_gate_teacher_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

interface Props { characters: TeacherCharacterRow[]; }

type ProfileForm = {
  isActive: boolean;
  storyScope: 'STANDARD' | 'MAJOR';
  dailyChatLimit: string;
  startAffinity: string;
  aiEnabled: boolean;
  systemPrompt: string;
  speakingStyle: string;
  expertise: string;
  deflectRules: string;
  imageryRules: string;
  warningLine1: string;
  warningLine2: string;
  lockLine: string;
};

const blankProfile: ProfileForm = {
  isActive: false, storyScope: 'STANDARD', dailyChatLimit: '3', startAffinity: '0', aiEnabled: true,
  systemPrompt: '', speakingStyle: '', expertise: 'general_brand', deflectRules: '', imageryRules: '',
  warningLine1: '', warningLine2: '', lockLine: '',
};

const blankMemories = (): DimensionalGateContentMemory[] => ([
  { memory_no: 1, unlock_affinity: 40, title: '', content: '', is_active: false },
  { memory_no: 2, unlock_affinity: 70, title: '', content: '', is_active: false },
  { memory_no: 3, unlock_affinity: 100, title: '', content: '', is_active: false },
]);
const blankRewards = (): DimensionalGateContentReward[] => ([
  { affinity_threshold: 40, reward_gold: 0, reward_crystal: 0, reward_bv: 0, gallery_asset_id: null, trust_visual_variant_no: null, is_active: true },
  { affinity_threshold: 70, reward_gold: 0, reward_crystal: 0, reward_bv: 0, gallery_asset_id: null, trust_visual_variant_no: null, is_active: true },
  { affinity_threshold: 100, reward_gold: 0, reward_crystal: 0, reward_bv: 0, gallery_asset_id: null, trust_visual_variant_no: null, is_active: true },
]);

const blankSpecialCgs = (): DimensionalGateSpecialCgAdminRow[] => ([
  { unlock_affinity: 40, title: '', image_url: '', home_background_allowed: false, is_active: false },
  { unlock_affinity: 70, title: '', image_url: '', home_background_allowed: false, is_active: false },
  { unlock_affinity: 100, title: '', image_url: '', home_background_allowed: false, is_active: false },
]);

export function DimensionalGateContentAdminPanel({ characters }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(characters[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<ProfileForm>(blankProfile);
  const [memories, setMemories] = useState<DimensionalGateContentMemory[]>(blankMemories);
  const [rewards, setRewards] = useState<DimensionalGateContentReward[]>(blankRewards);
  const [specialCgs, setSpecialCgs] = useState<DimensionalGateSpecialCgAdminRow[]>(blankSpecialCgs);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [storyJson, setStoryJson] = useState('');
  const [storyEditorLabel, setStoryEditorLabel] = useState('');

  useEffect(() => {
    if (selectedId == null && characters[0]) setSelectedId(characters[0].id);
  }, [characters, selectedId]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    if (!needle) return characters;
    return characters.filter((row) => [row.name, row.character_uid, row.epithet].filter(Boolean).some((v) => String(v).toLocaleLowerCase('ko-KR').includes(needle)));
  }, [characters, search]);

  const query = useQuery({
    queryKey: ['dimensional-gate-content', selectedId],
    queryFn: async () => {
      if (!selectedId) throw new Error('편린을 선택해주세요.');
      const result = await dimensionalGateContentRpc.get(supabase, selectedId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: selectedId !== null,
    staleTime: 5_000,
    retry: 1,
  });


  const extrasQuery = useQuery({
    queryKey: ['dimensional-gate-content-extras', selectedId],
    queryFn: async () => {
      if (!selectedId) throw new Error('편린을 선택해주세요.');
      const result = await dimensionalGateContentExtrasRpc.get(supabase, selectedId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: selectedId !== null,
    staleTime: 5_000,
    retry: 1,
  });

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    const p = data.profile;
    setProfile(p ? {
      isActive: p.is_active,
      storyScope: p.story_scope,
      dailyChatLimit: String(p.daily_chat_limit),
      startAffinity: String(p.start_affinity),
      aiEnabled: p.ai_enabled,
      systemPrompt: p.system_prompt ?? '',
      speakingStyle: p.speaking_style ?? '',
      expertise: Array.isArray(p.expertise) ? p.expertise.join(', ') : '',
      deflectRules: p.deflect_rules ?? '', imageryRules: p.imagery_rules ?? '',
      warningLine1: p.warning_line_1 ?? '', warningLine2: p.warning_line_2 ?? '', lockLine: p.lock_line ?? '',
    } : blankProfile);
    const memoryMap = new Map(data.memories.map((m) => [m.memory_no, m]));
    setMemories(blankMemories().map((m) => memoryMap.get(m.memory_no) ?? m));
    const rewardMap = new Map(data.rewards.map((r) => [r.affinity_threshold, r]));
    setRewards(blankRewards().map((r) => rewardMap.get(r.affinity_threshold) ?? r));
    setMessage(null);
  }, [query.data]);


  useEffect(() => {
    const data = extrasQuery.data;
    if (!data) return;
    const map = new Map(data.special_cgs.map((row) => [row.unlock_affinity, row]));
    setSpecialCgs(blankSpecialCgs().map((row) => map.get(row.unlock_affinity) ?? row));
  }, [extrasQuery.data]);

  const saveProfile = async () => {
    if (!selectedId || saving) return;
    const daily = Number(profile.dailyChatLimit), start = Number(profile.startAffinity);
    if (!Number.isInteger(daily) || daily < 0 || daily > 20 || !Number.isInteger(start) || start < 0 || start > 100) {
      setMessage('일일 대화는 0~20, 시작 호감도는 0~100 정수로 입력해주세요.'); return;
    }
    setSaving('profile'); setMessage(null);
    const result = await dimensionalGateContentRpc.saveProfile(supabase, {
      characterId: selectedId, isActive: profile.isActive, storyScope: profile.storyScope,
      dailyChatLimit: daily, startAffinity: start, aiEnabled: profile.aiEnabled,
      systemPrompt: profile.systemPrompt, speakingStyle: profile.speakingStyle,
      expertise: profile.expertise.split(',').map((v) => v.trim()).filter(Boolean),
      deflectRules: profile.deflectRules, imageryRules: profile.imageryRules,
      warningLine1: profile.warningLine1, warningLine2: profile.warningLine2, lockLine: profile.lockLine,
    });
    setSaving(null);
    if (result.success === false) { setMessage(result.error); return; }
    setMessage('AI 프로필을 저장했습니다.');
    await refresh();
  };

  const saveMemories = async () => {
    if (!selectedId || saving) return;
    setSaving('memories'); setMessage(null);
    const payload = memories.map((m) => ({ ...m, is_active: Boolean(m.title.trim() && m.content.trim()) }));
    const result = await dimensionalGateContentRpc.saveMemories(supabase, selectedId, payload);
    setSaving(null);
    if (result.success === false) { setMessage(result.error); return; }
    setMessage('기억 I·II·III를 저장했습니다.'); await refresh();
  };

  const saveRewards = async () => {
    if (!selectedId || saving) return;
    setSaving('rewards'); setMessage(null);
    const result = await dimensionalGateContentRpc.saveRewards(supabase, selectedId, rewards);
    setSaving(null);
    if (result.success === false) { setMessage(result.error); return; }
    setMessage('40·70·100 보상 규칙을 저장했습니다.'); await refresh();
  };


  const saveSpecialCgs = async () => {
    if (!selectedId || saving) return;
    const payload = specialCgs.map((row) => ({ ...row, is_active: Boolean(row.image_url.trim()) && row.is_active }));
    setSaving('special-cg'); setMessage(null);
    const result = await dimensionalGateContentExtrasRpc.saveSpecialCgs(supabase, selectedId, payload);
    setSaving(null);
    if (result.success === false) { setMessage(result.error); return; }
    setMessage(`특별 CG를 저장했습니다. 활성 ${result.data.saved}장`);
    await refresh();
  };

  const makeStoryTemplate = () => {
    const nextNo = Math.max(0, ...(query.data?.episodes.map((e) => e.episode_no) ?? [])) + 1;
    const template: DimensionalGateStoryPackage = {
      episode: {
        episode_no: nextNo,
        title: `${nextNo}편 제목`,
        required_affinity: 0,
        default_bgm_url: null,
        estimated_minutes: 5,
        headphone_recommended: false,
        sort_order: nextNo,
        is_active: true,
      },
      cuts: [
        { cut_order: 10, cut_type: 'TITLE', content: `${nextNo}편 제목` },
        { cut_order: 20, cut_type: 'LINE', speaker: selected?.name ?? '', content: '대사를 입력하세요.' },
        {
          cut_order: 30,
          cut_type: 'CG',
          background_url: 'https://...',
          gallery: { title: '화첩 장면', image_url: 'https://...', home_background_allowed: true, is_active: true },
        },
      ],
    };
    setStoryJson(JSON.stringify(template, null, 2));
    setStoryEditorLabel(`새 ${nextNo}편`);
    setMessage('스토리 JSON 템플릿을 만들었습니다. 저장 전 제목·대사·이미지 URL을 수정하세요.');
  };

  const loadStoryPackage = async (episodeId: number, episodeNo: number) => {
    if (saving) return;
    setSaving('story-load'); setMessage(null);
    const result = await dimensionalGateStoryAdminRpc.getPackage(supabase, episodeId);
    setSaving(null);
    if (result.success === false) { setMessage(result.error); return; }
    setStoryJson(JSON.stringify(result.data, null, 2));
    setStoryEditorLabel(`${episodeNo}편 편집`);
    setMessage(`${episodeNo}편 패키지를 불러왔습니다. 에피소드 ID와 학생 진행 기록은 저장 후에도 유지됩니다.`);
  };

  const parseStoryPackage = (): DimensionalGateStoryPackage => {
    let parsed: unknown;
    try { parsed = JSON.parse(storyJson); } catch { throw new Error('JSON 문법을 확인해주세요.'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('스토리 패키지는 JSON 객체여야 합니다.');
    const pkg = parsed as DimensionalGateStoryPackage;
    if (!pkg.episode || !Array.isArray(pkg.cuts)) throw new Error('episode 객체와 cuts 배열이 필요합니다.');
    const epNo = Number(pkg.episode.episode_no);
    const affinity = Number(pkg.episode.required_affinity);
    if (!Number.isInteger(epNo) || epNo < 1 || epNo > 99) throw new Error('episode_no는 1~99 정수여야 합니다.');
    if (!String(pkg.episode.title ?? '').trim()) throw new Error('에피소드 제목이 필요합니다.');
    if (!Number.isInteger(affinity) || affinity < 0 || affinity > 100) throw new Error('required_affinity는 0~100 정수여야 합니다.');
    if ((pkg.episode.is_active ?? true) && pkg.cuts.length === 0) throw new Error('공개 에피소드는 최소 1개 컷이 필요합니다.');
    const allowed = new Set(['TITLE','NARRATION','LINE','CHOICE','CG']);
    const seen = new Set<number>();
    for (const cut of pkg.cuts) {
      const order = Number(cut.cut_order);
      if (!Number.isInteger(order) || order < 1) throw new Error('모든 cut_order는 1 이상의 정수여야 합니다.');
      if (seen.has(order)) throw new Error(`cut_order ${order}가 중복되었습니다.`);
      seen.add(order);
      if (!allowed.has(String(cut.cut_type))) throw new Error(`cut_order ${order}의 cut_type이 잘못되었습니다.`);
      if (cut.cut_type === 'CHOICE' && (!Array.isArray(cut.choices) || cut.choices.length === 0)) throw new Error(`선택지 컷 ${order}에 choices가 필요합니다.`);
      if (cut.gallery && cut.cut_type !== 'CG') throw new Error(`gallery는 CG 컷에만 사용할 수 있습니다. (cut ${order})`);
      if (cut.gallery && !String(cut.gallery.image_url || cut.background_url || '').trim()) throw new Error(`화첩 CG cut ${order}에 이미지 URL이 필요합니다.`);
    }
    return pkg;
  };

  const saveStoryPackage = async () => {
    if (!selectedId || saving) return;
    let pkg: DimensionalGateStoryPackage;
    try { pkg = parseStoryPackage(); } catch (error) { setMessage(error instanceof Error ? error.message : '스토리 JSON을 확인해주세요.'); return; }
    setSaving('story'); setMessage(null);
    const result = await dimensionalGateStoryAdminRpc.savePackage(supabase, selectedId, pkg);
    setSaving(null);
    if (result.success === false) { setMessage(result.error); return; }
    setStoryEditorLabel(`${result.data.episode_no}편 편집`);
    setMessage(`${result.data.episode_no}편 저장 완료 · ${result.data.cut_count}컷 · 화첩 CG ${result.data.active_gallery_count}장`);
    await refresh();
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-content', selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-content-extras', selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-teacher-board'] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-roster'] }),
    ]);
  };

  const selected = characters.find((row) => row.id === selectedId) ?? null;
  const episodeCount = query.data?.episodes.filter((e) => e.is_active).length ?? 0;
  const recommended = profile.storyScope === 'MAJOR' ? '4~6편' : '2~3편';

  return (
    <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
        <div className="border-b border-line p-3">
          <div className="text-xs font-black text-white">편린 콘텐츠</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="편린 검색" className="mt-2 w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-text-primary outline-none" />
        </div>
        <div className="max-h-[680px] overflow-y-auto p-2">
          {filtered.map((row) => (
            <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={cn('mb-1 w-full rounded-card-md border px-3 py-2.5 text-left', selectedId === row.id ? 'border-brand-primary/50 bg-brand-primary/15' : 'border-transparent hover:border-line hover:bg-bg-deep')}>
              <div className="truncate text-sm font-black text-white">{row.name}</div>
              <div className="truncate font-mono text-[9px] font-bold text-text-muted">{row.character_uid}</div>
            </button>
          ))}
        </div>
      </aside>

      {!selected ? <EmptyState emoji="🌀" title="편린을 선택해주세요" /> : query.isLoading ? (
        <div className="grid min-h-[420px] place-items-center"><LoadingSpinner size="lg" /></div>
      ) : query.isError ? (
        <div className="rounded-card-lg border border-danger/30 bg-danger-bg p-5 text-center text-xs font-bold text-danger">콘텐츠 정보를 불러오지 못했습니다.</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div><h2 className="font-display text-lg text-white">{selected.name} · 차원관문 콘텐츠</h2><p className="text-[10px] font-bold text-text-muted">{selected.character_uid} · 만남 이벤트 {episodeCount}편 / 권장 {recommended} · 화첩 {query.data?.gallery_count ?? 0}장</p></div>
              <label className="flex items-center gap-2 text-xs font-black text-text-secondary"><input type="checkbox" checked={profile.isActive} onChange={(e) => setProfile((p) => ({ ...p, isActive: e.target.checked }))} /> 차원관문 공개</label>
            </div>
            {message && <div className="mt-3 rounded-card-md border border-brand-primary/25 bg-brand-primary/10 px-3 py-2 text-[10px] font-black text-brand-glow">{message}</div>}
            {extrasQuery.data?.health && <ContentHealthBanner health={extrasQuery.data.health} />}
          </div>

          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <SectionTitle title="AI 프로필" description="캐릭터 자체의 성격·말투만 작성합니다. 학생 활동 사실은 서버 Context가 별도로 제공합니다." />
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <SelectField label="콘텐츠 규모" value={profile.storyScope} onChange={(v) => setProfile((p) => ({ ...p, storyScope: v as 'STANDARD' | 'MAJOR' }))} options={[['STANDARD','일반 2~3편'],['MAJOR','주요 4~6편']]} />
              <InputField label="일일 대화" value={profile.dailyChatLimit} onChange={(v) => setProfile((p) => ({ ...p, dailyChatLimit: v }))} />
              <InputField label="시작 호감도" value={profile.startAffinity} onChange={(v) => setProfile((p) => ({ ...p, startAffinity: v }))} />
              <label className="rounded-card-md border border-line bg-bg-deep px-3 py-2"><div className="text-[9px] font-black text-text-muted">AI 사용</div><div className="mt-2"><input type="checkbox" checked={profile.aiEnabled} onChange={(e) => setProfile((p) => ({ ...p, aiEnabled: e.target.checked }))} /> <span className="ml-1 text-xs font-bold text-white">활성</span></div></label>
            </div>
            <TextareaField label="Persona / 시스템 프롬프트" value={profile.systemPrompt} onChange={(v) => setProfile((p) => ({ ...p, systemPrompt: v }))} rows={5} />
            <TextareaField label="말투·관계 표현 규칙" value={profile.speakingStyle} onChange={(v) => setProfile((p) => ({ ...p, speakingStyle: v }))} rows={4} />
            <InputField label="전문분야 capability (쉼표 구분)" value={profile.expertise} onChange={(v) => setProfile((p) => ({ ...p, expertise: v }))} />
            <div className="grid gap-2 md:grid-cols-2"><TextareaField label="모르는 분야 처리" value={profile.deflectRules} onChange={(v) => setProfile((p) => ({ ...p, deflectRules: v }))} rows={3} /><TextareaField label="비유·상징 규칙" value={profile.imageryRules} onChange={(v) => setProfile((p) => ({ ...p, imageryRules: v }))} rows={3} /></div>
            <div className="grid gap-2 md:grid-cols-3"><InputField label="경고 대사 1" value={profile.warningLine1} onChange={(v) => setProfile((p) => ({ ...p, warningLine1: v }))} /><InputField label="경고 대사 2" value={profile.warningLine2} onChange={(v) => setProfile((p) => ({ ...p, warningLine2: v }))} /><InputField label="잠금 대사" value={profile.lockLine} onChange={(v) => setProfile((p) => ({ ...p, lockLine: v }))} /></div>
            <SaveButton loading={saving === 'profile'} onClick={() => { void saveProfile(); }}>AI 프로필 저장</SaveButton>
          </div>

          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <SectionTitle title="기억 I · II · III" description="40 / 70 / 100에서 영구 해금됩니다. 호감도가 나중에 떨어져도 회수되지 않습니다." />
            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              {memories.map((memory, index) => (
                <div key={memory.memory_no} className="rounded-card-md border border-line bg-bg-deep/55 p-3">
                  <div className="text-xs font-black text-violet-200">기억 {memory.memory_no} · 호감도 {memory.unlock_affinity}</div>
                  <input value={memory.title} onChange={(e) => setMemories((rows) => rows.map((r, i) => i === index ? { ...r, title: e.target.value } : r))} placeholder="기억 제목" className="mt-2 w-full rounded-card-md border border-line bg-bg-card px-3 py-2 text-xs font-bold text-white outline-none" />
                  <textarea value={memory.content} onChange={(e) => setMemories((rows) => rows.map((r, i) => i === index ? { ...r, content: e.target.value } : r))} rows={7} placeholder="학생이 읽고 AI가 기억할 내용" className="mt-2 w-full resize-y rounded-card-md border border-line bg-bg-card px-3 py-2 text-[11px] font-semibold leading-relaxed text-white outline-none" />
                </div>
              ))}
            </div>
            <SaveButton loading={saving === 'memories'} onClick={() => { void saveMemories(); }}>기억 3개 저장</SaveButton>
          </div>

          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <SectionTitle title="40 · 70 · 100 보상" description="경제 보상 수치는 직접 정합니다. 신뢰 100 특별 전시 이미지는 기존 2·3번 이미지 중 하나를 지정합니다." />
            <div className="mt-3 space-y-2">
              {rewards.map((reward, index) => (
                <div key={reward.affinity_threshold} className="grid gap-2 rounded-card-md border border-line bg-bg-deep/55 p-3 sm:grid-cols-[80px_1fr_1fr_1fr_150px] sm:items-end">
                  <div><div className="text-[9px] font-black text-text-muted">호감도</div><div className="mt-1 text-lg font-black text-white">{reward.affinity_threshold}</div></div>
                  <NumberRewardField label="골드" value={reward.reward_gold} onChange={(v) => setRewards((rows) => rows.map((r,i) => i===index ? { ...r, reward_gold:v } : r))} />
                  <NumberRewardField label="크리스탈" value={reward.reward_crystal} onChange={(v) => setRewards((rows) => rows.map((r,i) => i===index ? { ...r, reward_crystal:v } : r))} />
                  <NumberRewardField label="BV" value={reward.reward_bv} onChange={(v) => setRewards((rows) => rows.map((r,i) => i===index ? { ...r, reward_bv:v } : r))} />
                  <label><div className="mb-1 text-[9px] font-black text-text-muted">신뢰 전시 이미지</div><select disabled={reward.affinity_threshold !== 100} value={reward.trust_visual_variant_no ?? ''} onChange={(e) => setRewards((rows) => rows.map((r,i) => i===index ? { ...r, trust_visual_variant_no: e.target.value ? Number(e.target.value) as 2|3 : null } : r))} className="w-full rounded-card-md border border-line bg-bg-card px-2 py-2 text-xs font-bold text-white disabled:opacity-40"><option value="">없음</option><option value="2" disabled={!query.data?.character.showcase_image_url_2}>이미지 2</option><option value="3" disabled={!query.data?.character.showcase_image_url_3}>이미지 3</option></select></label>
                </div>
              ))}
            </div>
            <SaveButton loading={saving === 'rewards'} onClick={() => { void saveRewards(); }}>보상 규칙 저장</SaveButton>
          </div>

          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <SectionTitle title="관계 특별 CG" description="40·70·100에서 영구 해금되는 화첩 일러스트입니다. 홈 배경 허용 시 기존 꾸미기 시스템에 자동 연결됩니다." />
            <div className="mt-3 space-y-2">
              {specialCgs.map((row, index) => (
                <div key={row.unlock_affinity} className="grid gap-2 rounded-card-md border border-line bg-bg-deep/55 p-3 lg:grid-cols-[70px_180px_minmax(0,1fr)_120px_90px] lg:items-end">
                  <div><div className="text-[9px] font-black text-text-muted">호감도</div><div className="mt-1 text-lg font-black text-violet-200">{row.unlock_affinity}</div></div>
                  <InputField label="제목" value={row.title} onChange={(v) => setSpecialCgs((rows) => rows.map((r,i) => i===index ? { ...r, title:v } : r))} />
                  <InputField label="이미지 URL" value={row.image_url} onChange={(v) => setSpecialCgs((rows) => rows.map((r,i) => i===index ? { ...r, image_url:v, is_active: Boolean(v.trim()) } : r))} />
                  <label className="rounded-card-md border border-line bg-bg-card px-3 py-2"><div className="text-[9px] font-black text-text-muted">홈 배경</div><div className="mt-1"><input type="checkbox" checked={row.home_background_allowed} onChange={(e) => setSpecialCgs((rows) => rows.map((r,i) => i===index ? { ...r, home_background_allowed:e.target.checked } : r))} /> <span className="ml-1 text-[10px] font-bold text-white">허용</span></div></label>
                  <label className="rounded-card-md border border-line bg-bg-card px-3 py-2"><div className="text-[9px] font-black text-text-muted">사용</div><div className="mt-1"><input type="checkbox" checked={row.is_active} disabled={!row.image_url.trim()} onChange={(e) => setSpecialCgs((rows) => rows.map((r,i) => i===index ? { ...r, is_active:e.target.checked } : r))} /> <span className="ml-1 text-[10px] font-bold text-white">활성</span></div></label>
                </div>
              ))}
            </div>
            <SaveButton loading={saving === 'special-cg'} onClick={() => { void saveSpecialCgs(); }}>특별 CG 저장</SaveButton>
          </div>

          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <SectionTitle title="만남 이벤트 · JSON 패키지" description={`현재 ${episodeCount}편 · ${profile.storyScope === 'MAJOR' ? '주요 편린 권장 4~6편' : '일반 편린 권장 2~3편'} · 에피소드 ID를 유지한 채 안전하게 덮어씁니다.`} />
              <button type="button" onClick={makeStoryTemplate} className="rounded-card-md border border-brand-primary/40 bg-brand-primary/10 px-3 py-2 text-[10px] font-black text-brand-glow">+ 새 편 템플릿</button>
            </div>
            {(query.data?.episodes.length ?? 0) === 0 ? <div className="mt-3 rounded-card-md border border-dashed border-line bg-bg-deep/40 p-5 text-center text-[10px] font-bold text-text-muted">아직 등록된 만남 이벤트가 없습니다. 위 버튼으로 템플릿을 만들거나, ChatGPT가 만든 스토리 패키지 JSON을 아래에 붙여넣으세요.</div> : <div className="mt-3 space-y-1.5">{query.data?.episodes.map((e) => <div key={e.episode_id} className="flex items-center justify-between gap-3 rounded-card-md border border-line bg-bg-deep/55 px-3 py-2"><div><div className="text-xs font-black text-white">{e.episode_no}편 · {e.title}</div><div className="text-[9px] font-bold text-text-muted">호감도 {e.required_affinity} · {e.cut_count}컷{e.is_active ? '' : ' · 비공개'}</div></div><button type="button" disabled={Boolean(saving)} onClick={() => { void loadStoryPackage(e.episode_id,e.episode_no); }} className="shrink-0 rounded-card-md border border-line bg-bg-card px-2.5 py-1.5 text-[9px] font-black text-text-secondary hover:text-white disabled:opacity-40">JSON 편집</button></div>)}</div>}
            <div className="mt-4 rounded-card-md border border-line bg-bg-deep/50 p-3">
              <div className="flex items-center justify-between gap-2"><div className="text-xs font-black text-white">{storyEditorLabel || '스토리 패키지 편집기'}</div><div className="text-[9px] font-bold text-text-muted">TITLE · NARRATION · LINE · CHOICE · CG</div></div>
              <textarea value={storyJson} onChange={(e) => setStoryJson(e.target.value)} rows={20} spellCheck={false} placeholder={'{\n  \"episode\": { ... },\n  \"cuts\": [ ... ]\n}'} className="mt-2 w-full resize-y rounded-card-md border border-line bg-[#090b14] px-3 py-3 font-mono text-[10px] leading-relaxed text-slate-200 outline-none focus:border-brand-primary/50" />
              <div className="mt-2 text-[9px] font-bold leading-relaxed text-text-muted">CG 컷에 <code className="text-violet-200">gallery</code>를 넣으면 실제 도달 시 화첩에 등록됩니다. <code className="text-violet-200">home_background_allowed: true</code>면 기존 홈 배경 시스템과 자동 연결됩니다. 기존 화첩 자산 ID는 삭제하지 않아 학생 해금 기록을 보존합니다.</div>
              <SaveButton loading={saving === 'story'} onClick={() => { void saveStoryPackage(); }}>스토리 패키지 검증·저장</SaveButton>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


function ContentHealthBanner({ health }: { health: import('@/lib/rpc/dimensional_gate_teacher_rpc').DimensionalGateContentHealth }) {
  const checks = [
    ['AI 프로필', health.profile_ready, '필수'],
    ['기억 3개', health.active_memory_count === 3, `${health.active_memory_count}/3`],
    ['40·70·100 보상', health.active_reward_count === 3, `${health.active_reward_count}/3`],
    ['만남 이벤트', health.active_episode_count >= health.recommended_episode_min, `${health.active_episode_count}/${health.recommended_episode_min}~${health.recommended_episode_max}`],
  ] as const;
  return <div className={cn('mt-3 rounded-card-md border px-3 py-3', health.ready_for_release ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10')}>
    <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-black text-white">{health.ready_for_release ? '✓ 공개 기본 기준 충족' : '⚠ 공개 전 확인 필요'}</span>{checks.map(([label,ok,value]) => <span key={label} className={cn('rounded-full border px-2 py-0.5 text-[9px] font-black',ok?'border-success/30 text-success':'border-warning/30 text-warning')}>{ok?'✓':'○'} {label} {value}</span>)}</div>
    <div className="mt-1 text-[9px] font-bold text-text-muted">총 {health.total_cut_count}컷 · 스토리 CG {health.active_story_cg_count}장 · 관계 특별 CG {health.active_special_cg_count}장</div>
  </div>;
}

function SectionTitle({ title, description }: { title: string; description: string }) { return <div><h3 className="text-sm font-black text-white">{title}</h3><p className="mt-0.5 text-[10px] font-bold text-text-muted">{description}</p></div>; }
function InputField({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) { return <label className="block"><div className="mb-1 text-[9px] font-black text-text-muted">{label}</div><input value={value} onChange={(e)=>onChange(e.target.value)} className="w-full rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none" /></label>; }
function TextareaField({ label, value, onChange, rows }: { label:string; value:string; onChange:(v:string)=>void; rows:number }) { return <label className="mt-2 block"><div className="mb-1 text-[9px] font-black text-text-muted">{label}</div><textarea rows={rows} value={value} onChange={(e)=>onChange(e.target.value)} className="w-full resize-y rounded-card-md border border-line bg-bg-deep px-3 py-2 text-[11px] font-semibold leading-relaxed text-white outline-none" /></label>; }
function SelectField({ label,value,onChange,options }:{label:string;value:string;onChange:(v:string)=>void;options:Array<[string,string]>}) { return <label><div className="mb-1 text-[9px] font-black text-text-muted">{label}</div><select value={value} onChange={(e)=>onChange(e.target.value)} className="w-full rounded-card-md border border-line bg-bg-deep px-2 py-2 text-xs font-bold text-white">{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>; }
function NumberRewardField({ label,value,onChange }:{label:string;value:number;onChange:(v:number)=>void}) { return <label><div className="mb-1 text-[9px] font-black text-text-muted">{label}</div><input type="number" min={0} value={value} onChange={(e)=>onChange(Math.max(0,Number(e.target.value)||0))} className="w-full rounded-card-md border border-line bg-bg-card px-2 py-2 text-xs font-bold text-white" /></label>; }
function SaveButton({ children,loading,onClick }:{children:string;loading:boolean;onClick:()=>void}) { return <div className="mt-3 flex justify-end"><button type="button" disabled={loading} onClick={onClick} className="rounded-card-md bg-brand-primary px-4 py-2 text-xs font-black text-white disabled:opacity-50">{loading?'저장 중…':children}</button></div>; }
