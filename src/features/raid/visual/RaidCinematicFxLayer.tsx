import { useEffect, useRef } from 'react';
import type { RaidVisualFxConfig } from './raidVisualTypes';
import type { RaidCinematicConfig, RaidEventFx } from './raidCinematicPresets';
import { normalizeRaidFxConfig } from './raidFxPresets';
import type { RaidCinematicPulse } from './useRaidCinematicEvents';

type Flake={x:number;y:number;angle:number;length:number;velocity:number;phase:number};
const TAU=Math.PI*2;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function noise(t:number,seed:number){return Math.sin(t*1.19+seed*73.9)*.54+Math.sin(t*2.83+seed*33.4)*.30+Math.sin(t*6.13+seed*9.1)*.16;}
function rand(seed:number){return (Math.sin(seed*123.456+78.12)*43758.5453)%1;}
function palette(preset:RaidVisualFxConfig['preset']) {
  switch(preset){
    case 'FIRE_EMBER':return {light:'255,183,107',edge:'246,70,35',dark:'100,17,20'};
    case 'WATER_SPRAY':return {light:'144,238,255',edge:'30,129,210',dark:'10,41,90'};
    case 'WIND_FEATHER':return {light:'199,251,230',edge:'83,177,157',dark:'31,70,78'};
    case 'LIGHT_PRISM':return {light:'255,250,211',edge:'155,195,255',dark:'55,71,133'};
    default:return {light:'216,154,255',edge:'122,51,204',dark:'27,10,69'};
  }
}
function strokeFork(ctx:CanvasRenderingContext2D,x:number,y:number,len:number,angle:number,seed:number){
  ctx.beginPath(); ctx.moveTo(x,y);
  let px=x,py=y;
  for(let i=0;i<5;i++){
    const a=angle+noise(i*.63,seed)*.29;
    px+=Math.cos(a)*len/5;py+=Math.sin(a)*len/5;ctx.lineTo(px,py);
    if(i===2){ctx.moveTo(px,py);ctx.lineTo(px+Math.cos(a+.72)*len*.17,py+Math.sin(a+.72)*len*.17);ctx.moveTo(px,py);}
  }
  ctx.stroke();
}
function drawAtmosphere(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,fx:RaidVisualFxConfig,enrage:boolean,cinematic:RaidCinematicConfig,flakes:Flake[]){
  const pal=palette(fx.preset);
  const centerX=w*.5,centerY=h*.52,rad=Math.min(w,h)*.32;
  const density=fx.preset==='NONE'?0:fx.intensity==='HIGH'?1.25:fx.intensity==='LOW'?.58:1;
  // Volumetric edge shading: gradients rather than opaque dots.
  if(fx.preset!=='NONE'){
    const left=ctx.createRadialGradient(w*.12,h*.6,0,w*.12,h*.6,w*.67);
    left.addColorStop(0,`rgba(${pal.edge},${.11*density})`);left.addColorStop(1,`rgba(${pal.dark},0)`);
    ctx.fillStyle=left;ctx.fillRect(0,0,w,h);
  }
  for(const [i,f] of flakes.entries()){
    if(fx.preset==='NONE')break;
    const pos=(f.y-t*f.velocity*.015+1e4)%1;
    const x=(f.x*w+noise(t*.3+f.phase,i)*w*.065+w)%w;
    const y=pos*h;
    const a=f.angle+Math.sin(t*.35+f.phase)*.36;
    const length=(f.length*(enrage?1.55:1)*density)*Math.min(w,h)/780;
    const glow=ctx.createLinearGradient(x-Math.cos(a)*length,y-Math.sin(a)*length,x+Math.cos(a)*length,y+Math.sin(a)*length);
    glow.addColorStop(0,`rgba(${pal.edge},0)`);glow.addColorStop(.48,`rgba(${pal.light},${.13*density*(enrage?1.35:1)})`);glow.addColorStop(1,`rgba(${pal.edge},0)`);
    ctx.strokeStyle=glow;ctx.lineWidth=i%5===0?2.3:1.1;ctx.beginPath();ctx.moveTo(x-Math.cos(a)*length,y-Math.sin(a)*length);
    ctx.quadraticCurveTo(x+Math.sin(a)*length*.45,y-Math.cos(a)*length*.2,x+Math.cos(a)*length,y+Math.sin(a)*length);ctx.stroke();
  }
  if(enrage&&cinematic.enrage_atmosphere){
    const pulse=.65+.35*Math.sin(t*1.5);
    const aura=ctx.createRadialGradient(centerX,centerY,rad*.42,centerX,centerY,rad*1.78);
    aura.addColorStop(0,`rgba(${pal.edge},0)`);aura.addColorStop(.55,`rgba(${pal.edge},${.17*pulse})`);aura.addColorStop(1,`rgba(${pal.dark},0)`);
    ctx.fillStyle=aura;ctx.fillRect(0,0,w,h);
    ctx.save();ctx.translate(centerX,centerY);ctx.rotate(t*.09);
    for(let i=0;i<3;i++){
      ctx.beginPath();ctx.ellipse(0,0,rad*(1.15+i*.11),rad*(.61+i*.07),i*.83+t*.055,Math.PI*.07,Math.PI*1.43);
      ctx.strokeStyle=`rgba(${pal.light},${.17+Math.sin(t+i)*.07})`;ctx.lineWidth=1.6+i*.4;ctx.stroke();
    }
    ctx.restore();
    // Intermittent branching dimensional filaments (no flashing full-screen).
    if(Math.sin(t*2.7)>0.84){
      ctx.strokeStyle=`rgba(${pal.light},.38)`;ctx.lineWidth=1.4;
      strokeFork(ctx,w*.25,h*.18,w*.23,1.19,Math.floor(t*3));
      strokeFork(ctx,w*.77,h*.7,w*.18,-1.9,Math.floor(t*3)+4);
    }
  }
}
function drawEvent(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,type:RaidEventFx,p:number,fx:RaidVisualFxConfig){
  if(type==='NONE')return;
  const pal=palette(fx.preset);const x=w*.5,y=h*.53,r=Math.hypot(w,h)*.52;
  const fade=Math.pow(1-p,1.35);
  ctx.save();
  if(type==='IMPACT_WAVE'){
    const rad=(.07+p*.89)*r;
    const g=ctx.createRadialGradient(x,y,Math.max(1,rad-28),x,y,rad+40);
    g.addColorStop(0,`rgba(${pal.edge},0)`);g.addColorStop(.43,`rgba(${pal.light},${.38*fade})`);g.addColorStop(.55,`rgba(${pal.edge},${.27*fade})`);g.addColorStop(1,`rgba(${pal.edge},0)`);
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,rad+42,0,TAU);ctx.fill();
    ctx.strokeStyle=`rgba(${pal.light},${.78*fade})`;ctx.lineWidth=4+8*(1-p);
    ctx.beginPath();ctx.ellipse(x,y,rad,rad*.78,0,0,TAU);ctx.stroke();
  }else if(type==='SCREEN_CRACK'||type==='VOID_RIFT'){
    const crack=type==='SCREEN_CRACK'; const extent=Math.min(w,h)*(crack?.94:.72)*Math.min(1,p*4);
    ctx.lineCap='round'; ctx.shadowColor=`rgba(${pal.light},.65)`;ctx.shadowBlur=crack?11:26;
    ctx.strokeStyle=`rgba(${pal.light},${.8*fade})`;ctx.lineWidth=crack?1.7:5;
    for(let i=0;i<(crack?11:5);i++){
      const theta=(i*2.399+Math.sin(i*4.3)*.2);
      strokeFork(ctx,x,y,extent*(.56+(i%4)*.13),theta,i+6);
    }
    if(!crack){
      ctx.translate(x,y);ctx.rotate(.38+noise(t,2)*.09);
      const gradient=ctx.createLinearGradient(-24,0,24,0);
      gradient.addColorStop(0,`rgba(${pal.edge},0)`);gradient.addColorStop(.47,`rgba(${pal.edge},${.45*fade})`);
      gradient.addColorStop(.52,`rgba(${pal.light},${.85*fade})`);gradient.addColorStop(1,`rgba(${pal.edge},0)`);
      ctx.fillStyle=gradient;ctx.beginPath();ctx.moveTo(-extent*.11,-extent*.7);ctx.lineTo(extent*.08,-extent*.34);ctx.lineTo(-extent*.02,extent*.65);ctx.lineTo(-extent*.13,extent*.2);ctx.closePath();ctx.fill();
    }
  }else if(type==='FLASH_BURST'){
    const g=ctx.createRadialGradient(x,y,5,x,y,r*(.9+p*.26));
    g.addColorStop(0,`rgba(255,255,255,${.8*fade})`);g.addColorStop(.14,`rgba(${pal.light},${.55*fade})`);
    g.addColorStop(.65,`rgba(${pal.edge},${.17*fade})`);g.addColorStop(1,`rgba(${pal.dark},0)`);
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.strokeStyle=`rgba(${pal.light},${.52*fade})`;ctx.lineWidth=3;
    for(let i=0;i<18;i++){const a=i*TAU/18+t*.05;const iR=r*.11,oR=r*(.25+.58*p);
      ctx.beginPath();ctx.moveTo(x+Math.cos(a)*iR,y+Math.sin(a)*iR);ctx.lineTo(x+Math.cos(a)*oR,y+Math.sin(a)*oR);ctx.stroke();}
  }else if(type==='ENERGY_SURGE'){
    ctx.save();ctx.translate(x,y);ctx.rotate(t*.24);
    for(let i=0;i<22;i++){const a=i*TAU/22+Math.sin(i*4)*.13;
      const start=r*(.05+p*.16),end=r*(.22+.72*p);
      ctx.strokeStyle=`rgba(${i%3?pal.edge:pal.light},${(.16+(i%5)*.07)*fade})`;
      ctx.lineWidth=i%4===0?5:2;ctx.beginPath();ctx.moveTo(Math.cos(a)*start,Math.sin(a)*start);
      ctx.quadraticCurveTo(Math.cos(a+.13)*end*.7,Math.sin(a+.13)*end*.7,Math.cos(a)*end,Math.sin(a)*end);ctx.stroke();
    }ctx.restore();
    const halo=ctx.createRadialGradient(x,y,1,x,y,r*.45);
    halo.addColorStop(0,`rgba(${pal.light},${.32*fade})`);halo.addColorStop(1,`rgba(${pal.edge},0)`);
    ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);
  }else if(type==='DISTORTION'){
    // Lightweight scanline refraction illusion; no readback / getImageData / GPU shader.
    for(let i=0;i<14;i++){
      const yy=h*(i+.5)/14,delta=noise(t*17,i)*w*.02*fade;
      ctx.fillStyle=`rgba(${pal.edge},${.07*fade})`;ctx.fillRect(Math.max(0,delta),yy,Math.max(0,w-Math.abs(delta)),h*.018);
      ctx.strokeStyle=`rgba(${pal.light},${.14*fade})`;ctx.lineWidth=.9;
      ctx.beginPath();ctx.moveTo(Math.max(0,delta),yy);ctx.lineTo(w+Math.min(0,delta),yy);ctx.stroke();
    }
    const g=ctx.createRadialGradient(x,y,r*.06,x,y,r*.55);
    g.addColorStop(0,`rgba(${pal.light},${.19*fade})`);g.addColorStop(1,`rgba(${pal.dark},0)`);ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  }
  ctx.restore();
}
const DURATIONS: Record<RaidEventFx,number>={NONE:0,IMPACT_WAVE:720,SCREEN_CRACK:1250,FLASH_BURST:490,VOID_RIFT:1350,ENERGY_SURGE:1100,DISTORTION:900};

/** One independent Canvas2D overlay shared by Student, Broadcast and teacher preview. */
export function RaidCinematicFxLayer({fx,cinematic,pulse,enrageActive,active=true}: {
  fx:RaidVisualFxConfig|null|undefined;
  cinematic:RaidCinematicConfig;
  pulse: RaidCinematicPulse|null;
  enrageActive:boolean;
  active?:boolean;
}){
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const eventRef=useRef<{kind:RaidEventFx;started:number}|null>(null);
  const enqueueRef=useRef<(()=>void)|null>(null);
  const config=normalizeRaidFxConfig(fx);
  useEffect(()=>{
    if(!pulse||!active)return;
    const kind=cinematic.event_fx[pulse.trigger];
    eventRef.current=kind==='NONE'?null:{kind,started:performance.now()};
    enqueueRef.current?.();
  },[pulse,cinematic,active]);
  useEffect(()=>{
    const el=canvasRef.current;if(!el||!cinematic.enabled)return;
    const ctx=el.getContext('2d',{alpha:true});if(!ctx)return;
    const flakes:Flake[]=Array.from({length:28},(_,i)=>({
      x:(rand(i*7)+1)%1,y:(rand(i*31)+1)%1,angle:rand(i*17)*TAU,
      length:17+(rand(i*13)+1)*44,velocity:.25+(rand(i*11)+1)*.85,phase:i*.81
    }));
    let w=0,h=0,raf=0,last=0;let onscreen=true,visible=!document.hidden,stopped=false;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion=Boolean(reduced?.matches);
    const stop=()=>{if(raf)cancelAnimationFrame(raf);raf=0;last=0;};
    function draw(now:number){
      if(!w||!h)return;
      ctx!.clearRect(0,0,w,h);
      if(reducedMotion){return;}
      const t=now*.001;
      drawAtmosphere(ctx!,w,h,t,config,enrageActive,cinematic,flakes);
      const event=eventRef.current;
      if(event){
        const dur=DURATIONS[event.kind];const p=dur?clamp((now-event.started)/dur,0,1):1;
        if(p>=1)eventRef.current=null;
        else drawEvent(ctx!,w,h,t,event.kind,p,config);
      }
    }
    function frame(now:number){
      raf=0;if(stopped||!visible||!onscreen||!active||reducedMotion)return;
      if(last&&now-last<33){schedule();return;}
      last=now;draw(now);schedule();
    }
    function schedule(){if(!stopped&&!raf&&visible&&onscreen&&active&&!reducedMotion&&w&&h)raf=requestAnimationFrame(frame);}
    enqueueRef.current=schedule;
    function resize(){const b=el!.getBoundingClientRect();w=Math.floor(b.width);h=Math.floor(b.height);
      if(!w||!h){stop();return;}const dpr=Math.min(window.devicePixelRatio||1,1.25);
      el!.width=Math.round(w*dpr);el!.height=Math.round(h*dpr);ctx!.setTransform(dpr,0,0,dpr,0,0);draw(performance.now());schedule();}
    function visibility(){visible=!document.hidden;if(visible)schedule();else stop();}
    function motion(){reducedMotion=Boolean(reduced?.matches);if(reducedMotion){stop();ctx!.clearRect(0,0,w,h);}else schedule();}
    const ro=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);ro?.observe(el);
    if(!ro)window.addEventListener('resize',resize);
    const io=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([e])=>{onscreen=Boolean(e?.isIntersecting);if(onscreen)schedule();else stop();});io?.observe(el);
    document.addEventListener('visibilitychange',visibility);reduced?.addEventListener?.('change',motion);resize();
    return()=>{stopped=true;stop();enqueueRef.current=null;
      ro?.disconnect();io?.disconnect();if(!ro)window.removeEventListener('resize',resize);
      document.removeEventListener('visibilitychange',visibility);reduced?.removeEventListener?.('change',motion);
    };
  },[config.preset,config.intensity,cinematic.enabled,cinematic.enrage_atmosphere,enrageActive,active]);
  if(!cinematic.enabled)return null;
  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full"/>;
}
