import { useEffect, useRef, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { statusText, useServiceActivity, type ServiceActivity } from './useServiceActivity';
const signature=(o:ServiceActivity)=>`${o.status}:${o.revision}:${o.updated_at}`;
export function ServiceActivityNotifier() {
 const studentId=useStudentId();const queryClient=useQueryClient();const board=useServiceActivity(true);
 const [notice,setNotice]=useState<ServiceActivity|null>(null);
 const [sound,setSound]=useState(()=>{try{return localStorage.getItem('service-alert-sound')==='on';}catch{return false;}});
 const seen=useRef<Map<number,string>|null>(null);const unlocked=useRef(false);
 useEffect(()=>{seen.current=null;setNotice(null);},[studentId]);
 useEffect(()=>{const allow=()=>{unlocked.current=true;};window.addEventListener('pointerdown',allow);return()=>window.removeEventListener('pointerdown',allow);},[]);
 useEffect(()=>{
  if(!board.data)return;
  const previous=seen.current;seen.current=new Map(board.data.map(o=>[o.id,signature(o)]));
  if(!previous)return;
  const changed=board.data.filter(o=>previous.get(o.id)!==signature(o));if(!changed.length)return;
  setNotice(changed[0]);
  if(sound&&unlocked.current){try{const context=new AudioContext();const oscillator=context.createOscillator();const gain=context.createGain();oscillator.connect(gain);gain.connect(context.destination);oscillator.frequency.value=880;gain.gain.setValueAtTime(0.06,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.25);oscillator.start();oscillator.stop(context.currentTime+0.25);oscillator.onended=()=>void context.close();}catch{/* Audio is optional. */}}
 },[board.data,sound]);
 useEffect(()=>{
  if(!studentId)return;let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>{void queryClient.invalidateQueries({queryKey:['service-activity',studentId]});void queryClient.invalidateQueries({queryKey:['secondary-job-service-market']});void queryClient.invalidateQueries({queryKey:['quick-service-board',studentId]});},250);};
  const channel=supabase.channel(`service-activity:${studentId}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'secondary_job_service_orders',filter:`buyer_student_id=eq.${studentId}`},refresh)
   .on('postgres_changes',{event:'*',schema:'public',table:'secondary_job_service_orders',filter:`seller_student_id=eq.${studentId}`},refresh).subscribe();
  return()=>{clearTimeout(timer);void supabase.removeChannel(channel);};
 },[studentId,queryClient]);
 if(!notice)return null;
 return <aside role="status" aria-live="polite" className="fixed top-3 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-24px)] max-w-md rounded-card-lg border-2 border-gold bg-bg-deep p-4 shadow-card text-amber-50">
  <div className="flex justify-between gap-2"><b className="text-gold">🔔 서비스 거래가 변경됐어요</b><button aria-label="알림 닫기" onClick={()=>setNotice(null)}>✕</button></div>
  <p className="mt-2 text-sm font-bold">{notice.title} · {notice.peer}</p><p className="mt-1 text-xs">{statusText(notice)}</p>
  <div className="mt-3 flex justify-between gap-2"><Link className="btn-primary" onClick={()=>setNotice(null)} to={`/market/services?view=${notice.buyer?'orders':'sales'}`}>거래 확인</Link><button className="text-xs text-gold" onClick={()=>{setSound(!sound);try{localStorage.setItem('service-alert-sound',!sound?'on':'off');}catch{}}}>효과음 {sound?'켜짐':'꺼짐'}</button></div>
 </aside>;
}

export function ServiceActivityLayout(){return <><ServiceActivityNotifier /><Outlet /></>;}
