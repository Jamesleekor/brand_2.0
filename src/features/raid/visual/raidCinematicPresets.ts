export type RaidCinematicTrigger = 'PATTERN' | 'BOSS_ATTACK' | 'GROGGY' | 'ENRAGE';
export type RaidEventFx = 'NONE' | 'IMPACT_WAVE' | 'SCREEN_CRACK' | 'FLASH_BURST' | 'VOID_RIFT' | 'ENERGY_SURGE' | 'DISTORTION';
export type RaidCameraReaction = 'NONE' | 'EARTHQUAKE' | 'IMPACT_SHAKE' | 'WHIPLASH' | 'CRASH_ZOOM' | 'CAMERA_ROLL' | 'TURBULENCE';
export type RaidCinematicMap<T extends string> = Record<RaidCinematicTrigger, T>;
export interface RaidCinematicConfig {
  enabled: boolean;
  enrage_atmosphere: boolean;
  event_fx: RaidCinematicMap<RaidEventFx>;
  camera_reactions: RaidCinematicMap<RaidCameraReaction>;
}
export const RAID_CINEMATIC_TRIGGERS: readonly RaidCinematicTrigger[] = ['PATTERN', 'BOSS_ATTACK', 'GROGGY', 'ENRAGE'];
export const RAID_EVENT_FX: ReadonlyArray<{value: RaidEventFx;label:string}> = [
  {value:'NONE',label:'없음'},
  {value:'IMPACT_WAVE',label:'충격파 · IMPACT_WAVE'},
  {value:'SCREEN_CRACK',label:'화면 균열 · SCREEN_CRACK'},
  {value:'FLASH_BURST',label:'섬광 · FLASH_BURST'},
  {value:'VOID_RIFT',label:'공간 균열 · VOID_RIFT'},
  {value:'ENERGY_SURGE',label:'에너지 폭발 · ENERGY_SURGE'},
  {value:'DISTORTION',label:'화면 왜곡 · DISTORTION'},
];
export const RAID_CAMERA_REACTIONS: ReadonlyArray<{value: RaidCameraReaction;label:string}> = [
  {value:'NONE',label:'없음'},
  {value:'EARTHQUAKE',label:'지진 · EARTHQUAKE'},
  {value:'IMPACT_SHAKE',label:'충격 진동 · IMPACT_SHAKE'},
  {value:'WHIPLASH',label:'반동 · WHIPLASH'},
  {value:'CRASH_ZOOM',label:'급확대 · CRASH_ZOOM'},
  {value:'CAMERA_ROLL',label:'화면 기울임 · CAMERA_ROLL'},
  {value:'TURBULENCE',label:'난기류 · TURBULENCE'},
];
export const RAID_CINEMATIC_DEFAULTS: RaidCinematicConfig = {
  enabled: false, // Opt-in: existing live raids keep identical visual behaviour.
  enrage_atmosphere: true,
  event_fx: { PATTERN:'ENERGY_SURGE', BOSS_ATTACK:'IMPACT_WAVE', GROGGY:'DISTORTION', ENRAGE:'SCREEN_CRACK' },
  camera_reactions: { PATTERN:'CRASH_ZOOM', BOSS_ATTACK:'IMPACT_SHAKE', GROGGY:'WHIPLASH', ENRAGE:'EARTHQUAKE' },
};
function isObject(x: unknown): x is Record<string,unknown> { return !!x && typeof x==='object' && !Array.isArray(x); }
function validValue<T extends string>(x: unknown, options: readonly {value:T}[], fallback:T):T {
  return options.find(t=>t.value===x)?.value ?? fallback;
}
export function normalizeRaidCinematicConfig(raw: unknown): RaidCinematicConfig {
  const v=isObject(raw)?raw:{};
  const fx=isObject(v.event_fx)?v.event_fx:{};
  const cam=isObject(v.camera_reactions)?v.camera_reactions:{};
  return {
    enabled: v.enabled===true,
    enrage_atmosphere: v.enrage_atmosphere!==false,
    event_fx: {
      PATTERN:validValue(fx.PATTERN,RAID_EVENT_FX,RAID_CINEMATIC_DEFAULTS.event_fx.PATTERN),
      BOSS_ATTACK:validValue(fx.BOSS_ATTACK,RAID_EVENT_FX,RAID_CINEMATIC_DEFAULTS.event_fx.BOSS_ATTACK),
      GROGGY:validValue(fx.GROGGY,RAID_EVENT_FX,RAID_CINEMATIC_DEFAULTS.event_fx.GROGGY),
      ENRAGE:validValue(fx.ENRAGE,RAID_EVENT_FX,RAID_CINEMATIC_DEFAULTS.event_fx.ENRAGE),
    },
    camera_reactions: {
      PATTERN:validValue(cam.PATTERN,RAID_CAMERA_REACTIONS,RAID_CINEMATIC_DEFAULTS.camera_reactions.PATTERN),
      BOSS_ATTACK:validValue(cam.BOSS_ATTACK,RAID_CAMERA_REACTIONS,RAID_CINEMATIC_DEFAULTS.camera_reactions.BOSS_ATTACK),
      GROGGY:validValue(cam.GROGGY,RAID_CAMERA_REACTIONS,RAID_CINEMATIC_DEFAULTS.camera_reactions.GROGGY),
      ENRAGE:validValue(cam.ENRAGE,RAID_CAMERA_REACTIONS,RAID_CINEMATIC_DEFAULTS.camera_reactions.ENRAGE),
    },
  };
}
