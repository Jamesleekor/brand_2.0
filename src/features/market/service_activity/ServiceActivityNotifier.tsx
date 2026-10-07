import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/shared/components';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { statusText, useServiceActivity, type ServiceActivity } from './useServiceActivity';
const reviewUrl=(o:ServiceActivity)=>`/market/services?view=orders&review=${o.id}`;
const signature=(o:ServiceActivity)=>`${o.status}:${o.revision}:${o.updated_at}`;
export function ServiceActivityNotifier() {
 const studentId=useStudentId();const queryClient=useQueryClient();const board=useServiceActivity(true);const location=useLocation();
 const [notice,setNotice]=useState<ServiceActivity|null>(null);
 const [reviewPrompt,setReviewPrompt]=useState<ServiceActivity|null>(null);
 const [reviewingId,setReviewingId]=useState<number|null>(null);
 const prompted=useRef(new Set<number>());
 const finishPrompt=(o:ServiceActivity)=>{prompted.current.add(o.id);try{localStorage.setItem(`service-review-prompt:${studentId}:${o.id}`,'seen');}catch{}setReviewPrompt(null);};
 const [sound,setSound]=useState(()=>{try{return localStorage.getItem('service-alert-sound')==='on';}catch{return false;}});
 const seen=useRef<Map<number,string>|null>(null);const unlocked=useRef(false);
 useEffect(()=>{seen.current=null;setNotice(null);setReviewPrompt(null);setReviewingId(null);prompted.current.clear();},[studentId]);
 useEffect(()=>{if(location.pathname!=='/market/services')setReviewingId(null);},[location.pathname]);
 useEffect(()=>{
  if(!board.data||!studentId)return;
  if(reviewingId!==null){if(board.data.find(o=>o.id===reviewingId)?.has_review===true)setReviewingId(null);return;}
  if(reviewPrompt){if(board.data.find(o=>o.id===reviewPrompt.id)?.has_review)finishPrompt(reviewPrompt);return;}
  const candidate=board.data.find(o=>{
   if(!o.buyer||o.status!=='COMPLETED'||o.has_review!==false||prompted.current.has(o.id))return false;
   try{return localStorage.getItem(`service-review-prompt:${studentId}:${o.id}`)!=='seen';}catch{return true;}
  });
  if(candidate)setReviewPrompt(candidate);
 },[board.data,studentId,reviewPrompt,reviewingId]);
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
 if(!notice&&!reviewPrompt)return null;
 return <>
 {notice&&!reviewPrompt&&<aside role="status" aria-live="polite" className="fixed top-3 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-24px)] max-w-md rounded-card-lg border-2 border-gold bg-bg-deep p-4 shadow-card text-amber-50">
  <div className="flex justify-between gap-2"><span className="text-xs font-bold text-amber-50">🛍️ 서비스 거래 알림</span><button aria-label="알림 닫기" onClick={()=>setNotice(null)}>✕</button></div>
  <h2 className="mt-2 text-lg font-black leading-snug text-gold">{statusText(notice)}</h2><p className="mt-2 text-sm text-amber-50">{notice.title} · {notice.peer}</p>
  <div className="mt-3 flex justify-between gap-2"><Link className="btn-primary" onClick={()=>setNotice(null)} to={`/market/services?view=${notice.buyer?'orders':'sales'}`}>거래 확인</Link><button className="text-xs text-gold" onClick={()=>{setSound(!sound);try{localStorage.setItem('service-alert-sound',!sound?'on':'off');}catch{}}}>효과음 {sound?'켜짐':'꺼짐'}</button></div>
 </aside>}
 <Modal isOpen={!!reviewPrompt} onClose={()=>{if(reviewPrompt)finishPrompt(reviewPrompt);}} title="거래 완료 · 정산 처리됨" emoji="⭐">
  {reviewPrompt&&<div className="space-y-4 text-amber-50">
   <p className="text-base font-black leading-relaxed">{reviewPrompt.peer} 판매자와의 거래에 대한 평점 및 후기를 남기시겠습니까?</p>
   <p className="text-sm">{reviewPrompt.title}</p>
   <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={()=>finishPrompt(reviewPrompt)}>나중에</button><Link className="btn-primary flex-1 text-center" to={reviewUrl(reviewPrompt)} onClick={()=>{setReviewingId(reviewPrompt.id);finishPrompt(reviewPrompt);setNotice(null);}}>남기기</Link></div>
  </div>}
 </Modal>
 </>;
}

export function ServiceActivityLayout(){return <><ServiceActivityNotifier /><Outlet /></>;}
