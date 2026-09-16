// RAID_V15_E4D_AUDIO_ENGINE
import type { RaidStatus, TeacherRaidAudioProfile } from '@/lib/rpc/raid_admin_rpc';

type FeedbackTier = 'NORMAL' | 'CRIT' | 'POWERFUL' | 'DEVASTATING';
type BgmMode = 'NONE' | 'LOBBY' | 'BATTLE' | 'ENRAGE' | 'SUCCESS' | 'FAILURE';
type SfxSlot =
  | 'raid_start_sfx_url'
  | 'normal_hit_sfx_url'
  | 'crit_hit_sfx_url'
  | 'powerful_hit_sfx_url'
  | 'devastating_hit_sfx_url'
  | 'break_start_sfx_url'
  | 'break_success_sfx_url'
  | 'break_fail_sfx_url'
  | 'barrier_hit_sfx_url'
  | 'barrier_critical_sfx_url';
type SfxChannel = 'boss' | 'hit' | 'ui';

export type RaidAudioFeedback = {
  id: number;
  event_kind: 'ATTACK' | 'COMBAT';
  event_type: string;
  amount: number;
  impact_tier: FeedbackTier | null;
  payload: Record<string, unknown>;
};

const DEFAULT_PROFILE: TeacherRaidAudioProfile = {
  raid_id: 0,
  lobby_bgm_url: null,
  battle_bgm_url: null,
  enrage_bgm_url: null,
  raid_start_sfx_url: null,
  raid_success_bgm_url: null,
  raid_failure_bgm_url: null,
  normal_hit_sfx_url: null,
  crit_hit_sfx_url: null,
  powerful_hit_sfx_url: null,
  devastating_hit_sfx_url: null,
  break_start_sfx_url: null,
  break_success_sfx_url: null,
  break_fail_sfx_url: null,
  barrier_hit_sfx_url: null,
  barrier_critical_sfx_url: null,
  master_volume: 0.85,
  bgm_volume: 0.55,
  sfx_volume: 0.8,
  configured: false,
};

export class RaidBroadcastAudioEngine {
  private profile: TeacherRaidAudioProfile = DEFAULT_PROFILE;
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bossGain: GainNode | null = null;
  private hitGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private bgmOscillators: OscillatorNode[] = [];
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmMode: BgmMode = 'NONE';
  private unlocked = false;
  private muted = false;
  private nextAllowedAt = new Map<string, number>();
  private timers = new Set<number>();

  setProfile(profile: TeacherRaidAudioProfile | null | undefined) {
    this.profile = profile ?? DEFAULT_PROFILE;
    this.applyVolumes();
  }

  isUnlocked() {
    return this.unlocked;
  }

  isUsingConfiguredAssets() {
    return Boolean(this.profile.configured);
  }

  async unlock() {
    if (typeof window === 'undefined') return false;
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return false;
    if (!this.context) {
      this.context = new AudioContextCtor();
      this.masterGain = this.context.createGain();
      this.bgmGain = this.context.createGain();
      this.sfxGain = this.context.createGain();
      this.bossGain = this.context.createGain();
      this.hitGain = this.context.createGain();
      this.uiGain = this.context.createGain();
      this.bgmGain.connect(this.masterGain);
      this.bossGain.connect(this.sfxGain);
      this.hitGain.connect(this.sfxGain);
      this.uiGain.connect(this.sfxGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
      this.applyVolumes();
    }
    if (this.context.state !== 'running') await this.context.resume();
    this.unlocked = true;
    this.playSilentUnlockPulse();
    return true;
  }

  setMuted(muted: boolean) {
    const wasMuted = this.muted;
    this.muted = muted;
    this.applyVolumes();
    if (this.bgmAudio) this.bgmAudio.muted = muted;
    if (wasMuted && !muted && this.unlocked && this.bgmMode !== 'NONE' && !this.bgmAudio && this.bgmOscillators.length === 0) {
      const mode = this.bgmMode;
      this.bgmMode = 'NONE';
      void this.transitionBgm(mode);
    }
  }

  async syncRaidState(status: RaidStatus, enraged: boolean, options?: { playRaidStart?: boolean }) {
    if (!this.unlocked) return;
    if (status === 'LOBBY_OPEN') return this.transitionBgm('LOBBY');
    if (status === 'ACTIVE') {
      if (options?.playRaidStart) this.playSfx('raid_start_sfx_url', 'raid_start', 'ui', 0.95);
      return this.transitionBgm(enraged ? 'ENRAGE' : 'BATTLE');
    }
    if (status === 'PAUSED') return this.transitionBgm('NONE');
    if (status === 'COMPLETED') return this.transitionBgm('SUCCESS');
    if (status === 'FAILED') return this.transitionBgm('FAILURE');
    return this.transitionBgm('NONE');
  }

  handleFeedback(row: RaidAudioFeedback) {
    if (!this.unlocked || this.muted) return;
    if (row.event_kind === 'ATTACK') {
      this.handleAttack(row);
      return;
    }
    this.handleCombat(row);
  }

  playBarrierCritical() {
    if (!this.unlocked || this.muted) return;
    if (!this.allow('barrier-critical', 2300, 3100)) return;
    this.playSfx('barrier_critical_sfx_url', 'barrier_critical', 'boss', 0.9);
  }

  dispose() {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.stopSynthBgm(0);
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.src = '';
      this.bgmAudio = null;
    }
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.unlocked = false;
  }

  private applyVolumes() {
    const master = this.muted ? 0 : clamp01(Number(this.profile.master_volume ?? 0.85));
    if (this.masterGain) this.masterGain.gain.value = master;
    if (this.bgmGain) this.bgmGain.gain.value = clamp01(Number(this.profile.bgm_volume ?? 0.55)) * 0.24;
    if (this.sfxGain) this.sfxGain.gain.value = clamp01(Number(this.profile.sfx_volume ?? 0.8));
    if (this.bossGain) this.bossGain.gain.value = 0.92;
    if (this.hitGain) this.hitGain.gain.value = 0.62;
    if (this.uiGain) this.uiGain.gain.value = 0.72;
    if (this.bgmAudio) this.bgmAudio.volume = this.externalBgmVolume();
  }

  private externalBgmVolume() {
    if (this.muted) return 0;
    return clamp01(Number(this.profile.master_volume ?? 0.85)) * clamp01(Number(this.profile.bgm_volume ?? 0.55));
  }

  private externalSfxVolume(multiplier = 1) {
    if (this.muted) return 0;
    return clamp01(Number(this.profile.master_volume ?? 0.85)) * clamp01(Number(this.profile.sfx_volume ?? 0.8)) * multiplier;
  }

  private handleAttack(row: RaidAudioFeedback) {
    const payload = row.payload ?? {};
    const tier = (row.impact_tier ?? 'NORMAL') as FeedbackTier;
    const normalHits = Math.max(0, Number(payload.normal_hits ?? 0));
    const critHits = Math.max(0, Number(payload.crit_hits ?? 0));
    const powerfulHits = Math.max(0, Number(payload.powerful_hits ?? 0));
    const devastatingHits = Math.max(0, Number(payload.devastating_hits ?? 0));

    if (tier === 'DEVASTATING' || devastatingHits > 0) {
      if (this.allow('hit-devastating', 420, 650)) this.playSfx('devastating_hit_sfx_url', 'devastating', 'hit', 1);
      return;
    }
    if (tier === 'POWERFUL' || powerfulHits > 0) {
      if (this.allow('hit-powerful', 330, 520)) this.playSfx('powerful_hit_sfx_url', 'powerful', 'hit', 0.95);
      return;
    }
    if ((tier === 'CRIT' || critHits > 0) && this.allow('hit-crit', 250, 450)) {
      this.playSfx('crit_hit_sfx_url', 'crit', 'hit', 0.9);
    }
    if (normalHits > 0 && this.allow('hit-normal', 120, 220)) {
      this.playSfx('normal_hit_sfx_url', 'normal', 'hit', 0.58);
      if (normalHits >= 8) this.schedule(105 + Math.random() * 45, () => {
        if (this.allow('hit-normal', 120, 220)) this.playSfx('normal_hit_sfx_url', 'normal', 'hit', 0.5);
      });
    }
  }

  private handleCombat(row: RaidAudioFeedback) {
    const event = String(row.event_type || '');
    const patternType = String(row.payload?.pattern_type ?? '');
    if (event === 'BARRIER_DAMAGED' || event === 'BOSS_ATTACK_RESOLVED') {
      if (this.allow('barrier-hit', 260, 380)) this.playSfx('barrier_hit_sfx_url', 'barrier_hit', 'boss', 0.78);
      return;
    }
    if (event === 'BARRIER_COLLAPSED') {
      this.playSfx('barrier_critical_sfx_url', 'barrier_collapse', 'boss', 1);
      return;
    }
    if (event === 'PATTERN_STARTED' && (patternType === 'BREAK' || patternType === 'ULTIMATE')) {
      if (this.allow('break-start', 900, 1200)) this.playSfx('break_start_sfx_url', 'break_start', 'ui', 0.84);
      return;
    }
    if (event === 'BREAK_SUCCESS' || event === 'ULTIMATE_SUCCESS') {
      this.playSfx('break_success_sfx_url', 'break_success', 'ui', 0.94);
      return;
    }
    if (event === 'BREAK_FAILED' || event === 'ULTIMATE_FAILED') {
      this.playSfx('break_fail_sfx_url', 'break_fail', 'ui', 0.94);
      return;
    }
    if (event.endsWith('_SUCCESS') || event === 'GROGGY_STARTED') {
      if (this.allow('mechanic-success', 520, 780)) this.synth('ui_success', 'ui', 0.58);
      return;
    }
    if (event.endsWith('_FAILED')) {
      if (this.allow('mechanic-fail', 520, 780)) this.synth('ui_fail', 'ui', 0.62);
    }
  }

  private async transitionBgm(mode: BgmMode) {
    if (!this.unlocked || mode === this.bgmMode) return;
    this.bgmMode = mode;
    this.fadeOutExternalBgm(600);
    this.stopSynthBgm(0);
    if (mode === 'NONE') return;

    const url = this.bgmUrl(mode);
    if (url) {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.loop = mode === 'LOBBY' || mode === 'BATTLE' || mode === 'ENRAGE';
      audio.volume = 0;
      audio.muted = this.muted;
      this.bgmAudio = audio;
      try {
        await audio.play();
        this.fadeAudio(audio, 0, this.externalBgmVolume(), 600);
        return;
      } catch {
        if (this.bgmAudio === audio) this.bgmAudio = null;
      }
    }

    if (mode === 'SUCCESS') this.synthJingle(true);
    else if (mode === 'FAILURE') this.synthJingle(false);
    else this.startSynthBgm(mode);
  }

  private bgmUrl(mode: BgmMode) {
    if (mode === 'LOBBY') return this.profile.lobby_bgm_url;
    if (mode === 'BATTLE') return this.profile.battle_bgm_url;
    if (mode === 'ENRAGE') return this.profile.enrage_bgm_url || this.profile.battle_bgm_url;
    if (mode === 'SUCCESS') return this.profile.raid_success_bgm_url;
    if (mode === 'FAILURE') return this.profile.raid_failure_bgm_url;
    return null;
  }

  private playSfx(slot: SfxSlot, synthKind: string, channel: SfxChannel, multiplier: number) {
    const url = this.profile[slot];
    if (url) {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = Math.min(1, this.externalSfxVolume(multiplier));
      audio.muted = this.muted;
      void audio.play().catch(() => this.synth(synthKind, channel, multiplier));
      return;
    }
    this.synth(synthKind, channel, multiplier);
  }

  private synth(kind: string, channel: SfxChannel, multiplier = 1) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const gain = this.channelGain(channel);
    if (!gain) return;
    const now = this.context.currentTime;
    const note = (frequency: number, duration: number, type: OscillatorType, amp: number, delay = 0, endFrequency?: number) => {
      if (!this.context) return;
      const osc = this.context.createOscillator();
      const env = this.context.createGain();
      const start = now + delay;
      const end = start + duration;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(30, frequency), start);
      if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), end);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * multiplier), start + Math.min(0.025, duration * 0.2));
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env); env.connect(gain);
      osc.start(start); osc.stop(end + 0.02);
    };

    if (kind === 'normal') { note(170, .075, 'triangle', .16); note(92, .06, 'sine', .10, .008); }
    else if (kind === 'crit') { note(540, .11, 'square', .12, 0, 910); note(1180, .08, 'sine', .07, .035); }
    else if (kind === 'powerful') { note(125, .16, 'sawtooth', .20, 0, 62); note(390, .10, 'triangle', .10, .02, 210); }
    else if (kind === 'devastating') { note(88, .28, 'sawtooth', .26, 0, 42); note(260, .18, 'square', .11, .015, 96); note(720, .12, 'triangle', .08, .04, 300); }
    else if (kind === 'raid_start') { note(196, .16, 'triangle', .13); note(294, .18, 'triangle', .13, .12); note(440, .30, 'triangle', .16, .24); }
    else if (kind === 'break_start') { note(330, .12, 'square', .10); note(330, .12, 'square', .10, .18); note(220, .20, 'sawtooth', .12, .36); }
    else if (kind === 'break_success' || kind === 'ui_success') { note(330, .16, 'triangle', .10); note(494, .20, 'triangle', .11, .10); note(659, .28, 'sine', .12, .21); }
    else if (kind === 'break_fail' || kind === 'ui_fail') { note(330, .16, 'sawtooth', .10); note(220, .20, 'sawtooth', .11, .10); note(110, .34, 'triangle', .13, .22); }
    else if (kind === 'barrier_hit') { note(142, .16, 'sine', .20, 0, 74); note(520, .08, 'triangle', .05, .01, 260); }
    else if (kind === 'barrier_critical') { note(720, .16, 'square', .08); note(520, .16, 'square', .08, .19); note(720, .16, 'square', .08, .38); }
    else if (kind === 'barrier_collapse') { note(115, .55, 'sawtooth', .25, 0, 38); note(58, .70, 'square', .12, .05, 31); }
  }

  private startSynthBgm(mode: 'LOBBY' | 'BATTLE' | 'ENRAGE') {
    if (!this.context || !this.bgmGain || this.muted) return;
    this.stopSynthBgm(0);
    const config = mode === 'LOBBY'
      ? [{ f: 110, type: 'sine' as OscillatorType, detune: 0 }, { f: 164.81, type: 'triangle' as OscillatorType, detune: 4 }]
      : mode === 'BATTLE'
        ? [{ f: 82.41, type: 'sawtooth' as OscillatorType, detune: -3 }, { f: 123.47, type: 'triangle' as OscillatorType, detune: 5 }]
        : [{ f: 98, type: 'sawtooth' as OscillatorType, detune: -6 }, { f: 146.83, type: 'square' as OscillatorType, detune: 4 }, { f: 196, type: 'triangle' as OscillatorType, detune: 8 }];
    const now = this.context.currentTime;
    for (const item of config) {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = item.type;
      osc.frequency.value = item.f;
      osc.detune.value = item.detune;
      gain.gain.value = mode === 'LOBBY' ? 0.035 : mode === 'BATTLE' ? 0.026 : 0.03;
      osc.connect(gain); gain.connect(this.bgmGain);
      osc.start(now);
      this.bgmOscillators.push(osc);
    }
  }

  private stopSynthBgm(fadeMs: number) {
    if (!this.context || this.bgmOscillators.length === 0) return;
    const stopAt = this.context.currentTime + Math.max(0, fadeMs) / 1000;
    for (const osc of this.bgmOscillators) {
      try { osc.stop(stopAt + 0.03); } catch { /* already stopped */ }
    }
    this.bgmOscillators = [];
  }

  private synthJingle(success: boolean) {
    if (!this.context || this.muted) return;
    const notes = success ? [392, 523.25, 659.25, 783.99] : [293.66, 246.94, 196, 146.83];
    notes.forEach((frequency, index) => this.schedule(index * 150, () => this.toneUi(frequency, success ? .24 : .32, success ? 'triangle' : 'sawtooth', success ? .11 : .09)));
  }

  private toneUi(frequency: number, duration: number, type: OscillatorType, amp: number) {
    if (!this.context || !this.uiGain || this.muted) return;
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    const now = this.context.currentTime;
    osc.type = type; osc.frequency.value = frequency;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(amp, now + .02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env); env.connect(this.uiGain); osc.start(now); osc.stop(now + duration + .03);
  }

  private fadeOutExternalBgm(durationMs: number) {
    const audio = this.bgmAudio;
    if (!audio) return;
    this.bgmAudio = null;
    this.fadeAudio(audio, audio.volume, 0, durationMs, () => { audio.pause(); audio.src = ''; });
  }

  private fadeAudio(audio: HTMLAudioElement, from: number, to: number, durationMs: number, done?: () => void) {
    const start = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - start) / Math.max(1, durationMs));
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * progress));
      if (progress < 1) this.schedule(40, step); else done?.();
    };
    step();
  }

  private allow(key: string, minMs: number, maxMs: number) {
    const now = performance.now();
    if (now < (this.nextAllowedAt.get(key) ?? 0)) return false;
    this.nextAllowedAt.set(key, now + minMs + Math.random() * Math.max(0, maxMs - minMs));
    return true;
  }

  private schedule(delayMs: number, fn: () => void) {
    const timer = window.setTimeout(() => { this.timers.delete(timer); fn(); }, delayMs);
    this.timers.add(timer);
  }

  private channelGain(channel: SfxChannel) {
    if (channel === 'boss') return this.bossGain;
    if (channel === 'hit') return this.hitGain;
    return this.uiGain;
  }

  private playSilentUnlockPulse() {
    if (!this.context || !this.uiGain) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain); gain.connect(this.uiGain);
    osc.start(); osc.stop(this.context.currentTime + 0.01);
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
