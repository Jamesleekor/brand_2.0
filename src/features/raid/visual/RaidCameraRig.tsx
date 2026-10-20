import { useEffect, useRef, type ReactNode } from 'react';
import { normalizeRaidCameraConfig } from './raidCameraPresets';
import type { RaidVisualCameraConfig } from './raidVisualTypes';
import type { RaidCinematicConfig, RaidCameraReaction } from './raidCinematicPresets';
import type { RaidCinematicPulse } from './useRaidCinematicEvents';

export interface RaidCameraEvents {
  patternRunId?: number | string | null;
  bossAttackSeq?: number | null;
  groggyActive?: boolean;
  enrageActive?: boolean;
  activePatternType?: string | null;
}
type LegacyKind='PATTERN'|'ATTACK'|'GROGGY'|'ENRAGE';
type ActiveReaction={kind:RaidCameraReaction;start:number};
const DURATION:Record<LegacyKind,number>={PATTERN:250,ATTACK:170,GROGGY:400,ENRAGE:1200};
const CINEMATIC_DURATION: Record<RaidCameraReaction,number>={
  NONE:0,EARTHQUAKE:1450,IMPACT_SHAKE:700,WHIPLASH:950,
  CRASH_ZOOM:750,CAMERA_ROLL:1200,TURBULENCE:1900,
};
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const jitter=(t:number,seed:number)=>
  .54*Math.sin(t*38+seed*16)+.29*Math.sin(t*67+seed*33)+.17*Math.sin(t*97+seed*71);

/** Transform the BOSS MEDIA ONLY: never apply camera transforms to HUD or hit-zone layers. */
export function RaidCameraRig({ children,camera,events,active=true,qaBoost=false,cinematic,pulse }: {
  children:ReactNode;
  camera:RaidVisualCameraConfig|Record<string,unknown>|null|undefined;
  events?:RaidCameraEvents;
  active?:boolean;
  qaBoost?:boolean;
  cinematic?:RaidCinematicConfig;
  pulse?:RaidCinematicPulse|null;
}){
  const layerRef=useRef<HTMLDivElement|null>(null);
  const legacyReactionRef=useRef<{kind:LegacyKind;start:number}|null>(null);
  const cinematicReactionRef=useRef<ActiveReaction|null>(null);
  const scheduleRef=useRef<(()=>void)|null>(null);
  const previousRef=useRef<{ready:boolean;pattern:number|string|null;seq:number|null;groggy:boolean;enrage:boolean}>({
    ready:false,pattern:null,seq:null,groggy:false,enrage:false,
  });
  const {preset,event_reactions:configuredReactions}=normalizeRaidCameraConfig(camera);
  const reactToEvents=camera!=null&&configuredReactions;
  const cinematicEnabled=Boolean(cinematic?.enabled);
  const pattern=events?.patternRunId??null;
  const seq=events?.bossAttackSeq??null;
  const groggy=events?.groggyActive===true;
  const enrage=events?.enrageActive===true;
  const precisionTargetActive=['WEAK_POINT','MULTI_CORE','SPLIT_TARGET','SEAL','REGEN'].includes(events?.activePatternType??'');

  useEffect(()=>{
    const old=previousRef.current;
    previousRef.current={ready:true,pattern,seq,groggy,enrage};
    if(cinematicEnabled||!old.ready||!reactToEvents||!active)return;
    let kind:LegacyKind|null=null;
    if(groggy&&!old.groggy)kind='GROGGY';
    else if(seq!==null&&old.seq!==null&&seq>old.seq)kind='ATTACK';
    else if(pattern!==null&&pattern!==old.pattern)kind='PATTERN';
    else if(enrage&&!old.enrage)kind='ENRAGE';
    if(kind){legacyReactionRef.current={kind,start:performance.now()};scheduleRef.current?.();}
  },[active,pattern,seq,groggy,enrage,reactToEvents,cinematicEnabled]);

  useEffect(()=>{
    if(!cinematicEnabled||!pulse||!reactToEvents||!active)return;
    const kind=cinematic?.camera_reactions[pulse.trigger]??'NONE';
    cinematicReactionRef.current=kind==='NONE'?null:{kind,start:performance.now()};
    scheduleRef.current?.();
  },[active,pulse,cinematic,reactToEvents,cinematicEnabled]);

  useEffect(()=>{
    const el=layerRef.current;if(!el)return;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let motionOff=Boolean(reduced?.matches);
    let visible=!document.hidden,onscreen=true,stopped=false,raf=0;
    const epoch=performance.now();
    const stop=()=>{if(raf)cancelAnimationFrame(raf);raf=0;};
    function frame(now:number){
      raf=0;
      if(stopped||!active||!visible||!onscreen||motionOff)return;
      const t=(now-epoch)*.001;
      let x=0,y=0,tilt=0,scale=1;
      if(preset==='MAJESTIC_PUSH')scale=1.014+.006*Math.sin(t*.22);
      else if(preset==='HEAVY_BREATH'){
        scale=1.013+.005*Math.sin(t*.75);y=1.2*Math.sin(t*.75+.5);
      }else if(preset==='TIDAL_FLOAT'){
        scale=1.013;y=2.2*Math.sin(t*.38);tilt=.11*Math.sin(t*.23);
      }else if(preset==='VOID_UNSTABLE'){
        scale=1.016+.003*Math.sin(t*.42);
        x=1.15*Math.sin(t*.61)+.35*Math.sin(t*1.06);
        y=1*Math.sin(t*.52);tilt=.15*Math.sin(t*.43);
      }
      if(qaBoost&&!cinematicEnabled&&preset!=='LOCKED'){
        scale=1.075+.035*Math.sin(t*.94);x=13*Math.sin(t*.97);
        y=9*Math.sin(t*.72);tilt=.85*Math.sin(t*.83);
      }
      if(cinematicEnabled){
        // Enrage has a separate SUSTAINED phase, not just a one-shot zoom.
        if(enrage&&cinematic?.enrage_atmosphere){
          scale+=.026+.007*Math.sin(t*1.9);
          x+=4.2*Math.sin(t*2.4)+2.3*jitter(t*.5,2);
          y+=3.1*Math.sin(t*1.8)+2*jitter(t*.45,5);
          tilt+=.35*Math.sin(t*1.6);
        }
        const reaction=reactToEvents?cinematicReactionRef.current:null;
        if(reaction){
          const length=CINEMATIC_DURATION[reaction.kind];
          const p=length?clamp((now-reaction.start)/length,0,1):1;
          if(p>=1)cinematicReactionRef.current=null;
          else{
            const fall=Math.pow(1-p,1.18);
            const kick=Math.sin(Math.PI*Math.min(1,p*1.8));
            switch(reaction.kind){
              case 'EARTHQUAKE':
                x+=31*jitter(p*2.1,4)*fall;y+=25*jitter(p*2.4,15)*fall;
                tilt+=1.35*jitter(p*1.3,8)*fall;scale+=.085*fall+.025*kick;break;
              case 'IMPACT_SHAKE':
                x+=24*jitter(p*1.55,3)*fall;y+=16*jitter(p*1.67,7)*fall;
                tilt+=.9*jitter(p,9)*fall;scale+=.065*fall+.02*kick;break;
              case 'WHIPLASH':
                x+=32*Math.sin(Math.PI*p*1.5)*fall;
                y-=14*Math.sin(Math.PI*p*1.2)*fall;tilt+=1.8*kick*fall;scale+=.07*fall;break;
              case 'CRASH_ZOOM':
                scale+=.097*Math.sin(Math.PI*Math.min(1,p*1.1))*fall;
                x+=7*Math.sin(p*Math.PI*2)*fall;break;
              case 'CAMERA_ROLL':
                tilt+=2.05*Math.sin(Math.PI*p*1.65)*fall;
                x+=11*Math.sin(Math.PI*p*2)*fall;scale+=.12*fall+.015*kick;break;
              case 'TURBULENCE':
                x+=22*jitter(p*.84,2)*fall;y+=19*jitter(p*.88,7)*fall;
                tilt+=1.2*jitter(p*.72,10)*fall;scale+=.08*fall+.02*Math.sin(p*TAU)*fall;break;
              default:break;
            }
          }
        }
      }else{
        const reaction=reactToEvents?legacyReactionRef.current:null;
        if(reaction){
          const p=Math.max(0,(now-reaction.start)/DURATION[reaction.kind]);
          if(p>=1)legacyReactionRef.current=null;
          else{
            const wave=Math.sin(Math.PI*p);
            if(reaction.kind==='PATTERN')scale+=(qaBoost?.042:.007)*wave;
            if(reaction.kind==='ATTACK'){
              x+=(qaBoost?12:1.9)*Math.sin(p*Math.PI*8)*(1-p);
              y+=(qaBoost?9:1.5)*Math.cos(p*Math.PI*7)*(1-p);
            }
            if(reaction.kind==='GROGGY'){
              scale-=(qaBoost?.04:.007)*wave;y-=(qaBoost?8:1.3)*wave;
            }
            if(reaction.kind==='ENRAGE')scale+=(qaBoost?.05:.008)*wave;
          }
        }
      }
      // During coordinate-critical mechanics, cap boss-media motion to preserve visual aiming.
      const limit=precisionTargetActive?3:cinematicEnabled?39:qaBoost?22:3;
      const tiltLimit=precisionTargetActive ? 0.22 : cinematicEnabled ? 2.3 : qaBoost ? 1.25 : 0.25;
      const scaleMax=precisionTargetActive?1.03:cinematicEnabled?1.17:qaBoost?1.16:1.03;
      el!.style.transform=`translate3d(${clamp(x,-limit,limit).toFixed(2)}px,${clamp(y,-limit,limit).toFixed(2)}px,0) rotate(${clamp(tilt,-tiltLimit,tiltLimit).toFixed(3)}deg) scale(${clamp(scale,1,scaleMax).toFixed(4)})`;
      if(preset!=='LOCKED'||(enrage&&cinematicEnabled)||legacyReactionRef.current||cinematicReactionRef.current)raf=requestAnimationFrame(frame);
    }
    function schedule(){if(!stopped&&!raf&&active&&visible&&onscreen&&!motionOff)raf=requestAnimationFrame(frame);}
    scheduleRef.current=schedule;
    function visibility(){visible=!document.hidden;if(visible)schedule();else stop();}
    function motion(){motionOff=Boolean(reduced?.matches);if(motionOff){stop();el!.style.transform='none';}else schedule();}
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([entry])=>{
      onscreen=Boolean(entry?.isIntersecting);if(onscreen)schedule();else stop();
    });observer?.observe(el);
    document.addEventListener('visibilitychange',visibility);
    reduced?.addEventListener?.('change',motion);schedule();
    return()=>{stopped=true;stop();observer?.disconnect();document.removeEventListener('visibilitychange',visibility);
      reduced?.removeEventListener?.('change',motion);scheduleRef.current=null;
      el!.style.transform='none';};
  },[active,preset,reactToEvents,qaBoost,cinematicEnabled,enrage,cinematic?.enrage_atmosphere,precisionTargetActive]);
  return <div ref={layerRef} className="absolute inset-0 transform-gpu">{children}</div>;
}
const TAU=Math.PI*2;
