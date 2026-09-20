import type { RaidElement } from '@/lib/rpc/raid_admin_rpc';
import type {
  RaidV15CombatConfig,
  RaidV15Pattern,
} from '@/lib/rpc/raid_v15_admin_rpc';

export type RaidBossPresetKey =
  | 'VAELION_WIND_01'
  | 'IGNIS_FIRE_02'
  | 'TRITON_WATER_03'
  | 'NOXVAR_DARK_04';

export type RaidBossPreset = {
  key: RaidBossPresetKey;
  raidNo: number;
  bossName: string;
  bossTitle: string;
  raidTitle: string;
  element: RaidElement;
  description: string;
  visualAccent: string;
  environment: string;
  camera: string;
  idleLoop: string;
  commonMechanics: string[];
  specialPatterns: string[];
  combat: RaidV15CombatConfig;
  patterns: RaidV15Pattern[];
};

const BASE_COMBAT: Pick<
  RaidV15CombatConfig,
  | 'enabled'
  | 'barrier_base_per_adventurer'
  | 'barrier_resonance_factor'
  | 'presence_window_seconds'
  | 'default_groggy_seconds'
  | 'default_groggy_multiplier'
  | 'enrage_player_damage_multiplier'
> = {
  enabled: true,
  barrier_base_per_adventurer: 4000,
  barrier_resonance_factor: 0.1,
  presence_window_seconds: 20,
  default_groggy_seconds: 7,
  default_groggy_multiplier: 1.4,
  enrage_player_damage_multiplier: 1,
};

export const RAID_BOSS_PRESETS: RaidBossPreset[] = [
  {
    key: 'VAELION_WIND_01',
    raidNo: 1,
    bossName: '천공의 지배자, 바엘리온',
    bossTitle: '천공의 지배자',
    raidTitle: '제1차 레이드 · 천공의 지배자',
    element: 'WIND',
    description:
      '폭풍을 먹고 자라난 고대의 환수. 바엘리온이 날개를 펼치는 순간 거센 돌풍이 전장을 뒤덮고, 그 포효는 구름마저 갈라놓는다.',
    visualAccent: '금색 · 상아색 · 옅은 청록',
    environment: '밝은 황금빛 하늘, 부유 유적, 얇은 바람 고리. 전경에는 깃털과 잎이 천천히 횡단한다.',
    camera: '평상시 100→102%의 매우 느린 푸시인. 큰 날갯짓이나 BREAK 실패 때만 100~140ms의 짧은 흔들림.',
    idleLoop: '가슴의 풍맥이 천천히 회전하고 깃털·갈기·날개 끝이 바람에 반응한다. 머리는 거의 고정해 위엄을 유지한다.',
    commonMechanics: ['폭풍핵 노출(WEAK_POINT)', '창공 압쇄(BREAK→GROGGY)', '천공의 격노(ENRAGE)'],
    specialPatterns: ['황금풍 흡수(ABSORB)', '천공멸절(ULTIMATE)'],
    combat: {
      ...BASE_COMBAT,
      enrage_boss_damage_multiplier: 1.2,
      boss_attack_interval_seconds: 14,
      boss_attack_telegraph_seconds: 2.5,
      boss_attack_fixed_damage: 0,
      boss_attack_barrier_ratio: 0.035,
      boss_attack_name: '황금 돌풍',
      metadata: { boss_preset_key: 'VAELION_WIND_01', boss_preset_version: 1 },
    },
    patterns: [
      pattern(10, '폭풍핵 노출', 'WEAK_POINT', 22, 7, {
        x: 0.43, y: 0.51, width: 0.14, height: 0.2,
        multiplier: 2.0, body_multiplier: 0.7,
      }),
      pattern(20, '황금풍 흡수', 'ABSORB', 52, 4, { heal_ratio: 0.8 }),
      pattern(30, '창공 압쇄', 'BREAK', 84, 9, {
        objective_hp_ratio: 0.035,
        groggy_seconds: 6,
        groggy_multiplier: 1.35,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.1,
      }),
      pattern(40, '천공멸절', 'ULTIMATE', 124, 10, {
        objective_hp_ratio: 0.045,
        groggy_seconds: 7,
        groggy_multiplier: 1.4,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.16,
      }),
      ratioPattern(50, '천공의 격노', 'ENRAGE', 0.2, 1, {
        boss_damage_multiplier: 1.2,
        player_damage_multiplier: 1,
      }),
    ],
  },
  {
    key: 'IGNIS_FIRE_02',
    raidNo: 2,
    bossName: '작열하는 홍염, 이그니스',
    bossTitle: '작열하는 홍염',
    raidTitle: '제2차 레이드 · 작열하는 홍염',
    element: 'FIRE',
    description:
      '태양의 잔불을 심장에 품은 고대의 사자. 이그니스의 포효가 울릴 때마다 대지가 갈라지고, 쏟아진 불씨는 전장을 거대한 화로로 바꾼다.',
    visualAccent: '주홍 · 적색 · 용암빛 금색',
    environment: '화산성 폐허, 재와 불씨, 지면의 용암 균열. 전경에는 느린 재 입자와 간헐적인 열기 왜곡을 둔다.',
    camera: '바엘리온보다 조금 공격적인 미세 줌. 포효·DAMAGE_CHECK 실패 순간에는 짧고 묵직한 진동을 준다.',
    idleLoop: '갈기의 화염이 큰 덩어리로 흐르고 가슴의 홍염핵이 호흡처럼 밝아진다. 의미 없는 불꽃 파편 증식은 피한다.',
    commonMechanics: ['홍염핵 노출(WEAK_POINT)', '대지 작열(BREAK→GROGGY)', '진홍 광폭화(ENRAGE)'],
    specialPatterns: ['작열의 낙인(DOT)', '태양핵 폭주(DAMAGE_CHECK)'],
    combat: {
      ...BASE_COMBAT,
      enrage_boss_damage_multiplier: 1.28,
      boss_attack_interval_seconds: 12,
      boss_attack_telegraph_seconds: 2.5,
      boss_attack_fixed_damage: 0,
      boss_attack_barrier_ratio: 0.04,
      boss_attack_name: '홍염 충격파',
      metadata: { boss_preset_key: 'IGNIS_FIRE_02', boss_preset_version: 1 },
    },
    patterns: [
      pattern(10, '홍염핵 노출', 'WEAK_POINT', 24, 7, {
        x: 0.42, y: 0.56, width: 0.16, height: 0.22,
        multiplier: 2.05, body_multiplier: 0.72,
      }),
      pattern(20, '작열의 낙인', 'DOT', 54, 9, {
        tick_interval_seconds: 1.5,
        tick_fixed_damage: 0,
        tick_barrier_percent: 0.008,
        interrupt_target: {
          key: 'EMBER_CORE', label: '작열핵',
          x: 0.43, y: 0.57, width: 0.14, height: 0.2,
          hp_ratio: 0.012,
        },
      }),
      pattern(30, '대지 작열', 'BREAK', 88, 9, {
        objective_hp_ratio: 0.04,
        groggy_seconds: 6,
        groggy_multiplier: 1.35,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.12,
      }),
      pattern(40, '태양핵 폭주', 'DAMAGE_CHECK', 124, 8, {
        target_damage_ratio: 0.05,
        groggy_seconds: 4,
        groggy_multiplier: 1.2,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.12,
      }),
      ratioPattern(50, '진홍 광폭화', 'ENRAGE', 0.2, 1, {
        boss_damage_multiplier: 1.28,
        player_damage_multiplier: 1,
      }),
    ],
  },
  {
    key: 'TRITON_WATER_03',
    raidNo: 3,
    bossName: '해일의 포식자, 트리톤',
    bossTitle: '해일의 포식자',
    raidTitle: '제3차 레이드 · 해일의 포식자',
    element: 'WATER',
    description:
      '깊은 바다의 격류를 사냥하며 성장한 청람의 늑대. 트리톤이 발을 내딛는 순간 해류가 뒤집히고, 서로 다른 두 물길이 하나의 거대한 해일로 합쳐진다.',
    visualAccent: '심해 청색 · 빙청색 · 흰 물보라',
    environment: '침수된 고대 신전과 거대한 파도, 낮은 물안개. 전경에는 물방울과 넓은 물보라를 드물게 통과시킨다.',
    camera: '좌우로 흔들기보다 물 위에 떠 있는 듯한 느린 상하 부유. 큰 해일 순간에만 카메라가 살짝 뒤로 밀린다.',
    idleLoop: '물로 이루어진 갈기와 어깨의 파도가 크게 한 번 순환하고, 가슴의 수류핵이 일정한 속도로 회전한다.',
    commonMechanics: ['심해핵 노출(WEAK_POINT)', '심해 압쇄(BREAK→GROGGY)', '대해의 격류(ENRAGE)'],
    specialPatterns: ['해류 장막(SHIELD)', '쌍류 공명(SPLIT_TARGET)'],
    combat: {
      ...BASE_COMBAT,
      enrage_boss_damage_multiplier: 1.22,
      boss_attack_interval_seconds: 15,
      boss_attack_telegraph_seconds: 3,
      boss_attack_fixed_damage: 0,
      boss_attack_barrier_ratio: 0.035,
      boss_attack_name: '해일 충돌',
      metadata: { boss_preset_key: 'TRITON_WATER_03', boss_preset_version: 1 },
    },
    patterns: [
      pattern(10, '심해핵 노출', 'WEAK_POINT', 22, 7, {
        x: 0.43, y: 0.55, width: 0.14, height: 0.22,
        multiplier: 2.0, body_multiplier: 0.75,
      }),
      pattern(20, '해류 장막', 'SHIELD', 50, 9, {
        shield_hp_ratio: 0.035,
        boss_damage_while_shield: 0,
        groggy_seconds: 4,
        groggy_multiplier: 1.2,
      }),
      pattern(30, '심해 압쇄', 'BREAK', 84, 10, {
        objective_hp_ratio: 0.04,
        groggy_seconds: 6,
        groggy_multiplier: 1.35,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.1,
      }),
      pattern(40, '쌍류 공명', 'SPLIT_TARGET', 118, 11, {
        targets: [
          { key: 'LEFT_TIDE', label: '좌측 해류핵', x: 0.14, y: 0.4, width: 0.2, height: 0.27, hp_ratio: 0.011 },
          { key: 'RIGHT_TIDE', label: '우측 해류핵', x: 0.66, y: 0.4, width: 0.2, height: 0.27, hp_ratio: 0.011 },
        ],
        max_difference_percent: 22,
        unbalanced_efficiency: 0.4,
        success_bonus_damage_ratio: 0.015,
        groggy_seconds: 4,
        groggy_multiplier: 1.2,
      }),
      ratioPattern(50, '대해의 격류', 'ENRAGE', 0.2, 1, {
        boss_damage_multiplier: 1.22,
        player_damage_multiplier: 1,
      }),
    ],
  },
  {
    key: 'NOXVAR_DARK_04',
    raidNo: 4,
    bossName: '월식의 심연, 녹스바르',
    bossTitle: '월식의 심연',
    raidTitle: '제4차 레이드 · 월식의 심연',
    element: 'DARK',
    description:
      '월식이 드리운 차원의 틈에서 깨어난 고대 심연룡. 녹스바르의 심장에는 빛을 삼키는 월식핵이 뛰고 있으며, 그 맥동은 주변 공간마저 뒤틀어 버린다.',
    visualAccent: '보라 · 마젠타 · 검붉은 월식광',
    environment: '보랏빛 안개, 부유하는 거대 파편, 뒤틀린 폐허와 월식. 작은 잔파편보다 큰 공간 균열과 넓은 암흑 구름을 사용한다.',
    camera: '평상시는 느린 푸시인. 코어 맥동 때 1~2도의 미세 틸트, ULTIMATE 전조에서만 조금 더 강한 줌인과 흔들림을 사용한다.',
    idleLoop: '흉곽의 월식핵이 수축·팽창하고 목과 날개가 아주 느리게 호흡한다. 배경의 월식 고리는 천천히 회전한다.',
    commonMechanics: ['월식핵 노출(WEAK_POINT)', '공허 압쇄(BREAK→GROGGY)', '심연 개방(ENRAGE)'],
    specialPatterns: ['심연 역류(REFLECT)', '삼중 월식핵(MULTI_CORE)', '월식 종언(ULTIMATE)'],
    combat: {
      ...BASE_COMBAT,
      enrage_boss_damage_multiplier: 1.3,
      boss_attack_interval_seconds: 13,
      boss_attack_telegraph_seconds: 3,
      boss_attack_fixed_damage: 0,
      boss_attack_barrier_ratio: 0.04,
      boss_attack_name: '심연 파동',
      metadata: { boss_preset_key: 'NOXVAR_DARK_04', boss_preset_version: 1 },
    },
    patterns: [
      pattern(10, '월식핵 노출', 'WEAK_POINT', 20, 6, {
        x: 0.43, y: 0.58, width: 0.14, height: 0.2,
        multiplier: 2.1, body_multiplier: 0.68,
      }),
      pattern(20, '심연 역류', 'REFLECT', 46, 5, {
        reflect_ratio: 0.25,
        boss_damage_multiplier: 0.35,
      }),
      pattern(30, '공허 압쇄', 'BREAK', 78, 9, {
        objective_hp_ratio: 0.045,
        groggy_seconds: 6,
        groggy_multiplier: 1.4,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.13,
      }),
      pattern(40, '삼중 월식핵', 'MULTI_CORE', 108, 12, {
        mode: 'FIXED_ORDER',
        cores: [
          { key: 'LEFT_ECLIPSE', label: '좌측 월식핵', x: 0.18, y: 0.38, width: 0.15, height: 0.22, hp_ratio: 0.009 },
          { key: 'CENTER_ECLIPSE', label: '중앙 월식핵', x: 0.43, y: 0.57, width: 0.14, height: 0.2, hp_ratio: 0.009 },
          { key: 'RIGHT_ECLIPSE', label: '우측 월식핵', x: 0.67, y: 0.38, width: 0.15, height: 0.22, hp_ratio: 0.009 },
        ],
        reset_on_wrong: false,
        wrong_barrier_fixed: 0,
        wrong_barrier_percent: 0.015,
        wrong_boss_heal_ratio: 0,
        wrong_time_penalty_seconds: 0,
      }),
      pattern(50, '월식 종언', 'ULTIMATE', 142, 10, {
        objective_hp_ratio: 0.055,
        groggy_seconds: 7,
        groggy_multiplier: 1.45,
        fail_damage_fixed: 0,
        fail_damage_percent: 0.2,
      }),
      ratioPattern(60, '심연 개방', 'ENRAGE', 0.18, 1, {
        boss_damage_multiplier: 1.3,
        player_damage_multiplier: 1,
      }),
    ],
  },
];

export function getRaidBossPreset(key: RaidBossPresetKey | null | undefined) {
  if (!key) return null;
  return RAID_BOSS_PRESETS.find((preset) => preset.key === key) ?? null;
}

export function cloneRaidBossPresetPatterns(preset: RaidBossPreset): RaidV15Pattern[] {
  return preset.patterns.map((item) => ({
    ...item,
    config: structuredClone(item.config),
  }));
}

function pattern(
  seq: number,
  name: string,
  patternType: RaidV15Pattern['pattern_type'],
  triggerSeconds: number,
  durationSeconds: number,
  config: Record<string, unknown>,
): RaidV15Pattern {
  return {
    seq,
    name,
    pattern_type: patternType,
    trigger_kind: 'TIME_SECONDS',
    trigger_value: triggerSeconds,
    duration_seconds: durationSeconds,
    config,
    is_enabled: true,
  };
}

function ratioPattern(
  seq: number,
  name: string,
  patternType: RaidV15Pattern['pattern_type'],
  hpRatio: number,
  durationSeconds: number,
  config: Record<string, unknown>,
): RaidV15Pattern {
  return {
    seq,
    name,
    pattern_type: patternType,
    trigger_kind: 'HP_RATIO',
    trigger_value: hpRatio,
    duration_seconds: durationSeconds,
    config,
    is_enabled: true,
  };
}
