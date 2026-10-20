import { useEffect, useRef, useState } from 'react';
import type { RaidCameraEvents } from './RaidCameraRig';
import type { RaidCinematicTrigger } from './raidCinematicPresets';

export interface RaidCinematicPulse {
  id: number;
  trigger: RaidCinematicTrigger;
}
/** Shared edge detection for the Student, Broadcast and teacher preview views.
 * Initial state never fires a synthetic event, including when mounting mid-fight.
 */
export function useRaidCinematicEvents(events: RaidCameraEvents | undefined, active: boolean): RaidCinematicPulse | null {
  const snapshot = useRef<{ready:boolean;pattern:string|number|null;seq:number|null;groggy:boolean;enrage:boolean}>(
    {ready:false,pattern:null,seq:null,groggy:false,enrage:false}
  );
  const sequence=useRef(0);
  const [pulse,setPulse]=useState<RaidCinematicPulse|null>(null);
  const pattern=events?.patternRunId??null;
  const seq=events?.bossAttackSeq??null;
  const groggy=events?.groggyActive===true;
  const enrage=events?.enrageActive===true;
  useEffect(()=>{
    const old=snapshot.current;
    snapshot.current={ready:true,pattern,seq,groggy,enrage};
    if(!active||!old.ready)return;
    let trigger:RaidCinematicTrigger|null=null;
    if(enrage&&!old.enrage)trigger='ENRAGE';
    else if(groggy&&!old.groggy)trigger='GROGGY';
    else if(seq!==null&&old.seq!==null&&seq>old.seq)trigger='BOSS_ATTACK';
    else if(pattern!==null&&pattern!==old.pattern)trigger='PATTERN';
    if(trigger)setPulse({id:++sequence.current,trigger});
  },[active,pattern,seq,groggy,enrage]);
  return pulse;
}
