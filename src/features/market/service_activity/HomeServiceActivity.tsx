import { useRef, useState } from 'react';
import { useStudentId } from '@/stores/auth_store';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { secondaryJobServiceStudentRpc as rpc } from '@/lib/rpc/secondary_job_service_rpc';
import { useServiceActivity, needsAction, isFinished, statusText, type ServiceActivity } from './useServiceActivity';
type Action='ACCEPT'|'REJECT'|'DELIVER'|'CONFIRM'|'REVISION'|'ACCEPT_QUOTE';
export function HomeServiceActivity(){
 const board=useServiceActivity();const queryClient=useQueryClient();const studentId=useStudentId();
 const dismissalKey=`service-activity-dismissed:${studentId}`;
 const [action,setAction]=useState<{order:ServiceActivity;type:Action}|null>(null);const [text,setText]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false);
 const [dismissed,setDismissed]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(dismissalKey)??'[]');}catch{return [];}});
 const dismiss=(o:ServiceActivity)=>setDismissed(v=>{const next=[...v,`${o.id}:${o.updated_at}`].slice(-100);try{localStorage.setItem(dismissalKey,JSON.stringify(next));}catch{}return next;});
 const rows=(board.data??[]).filter(o=>!isFinished(o)||!dismissed.includes(`${o.id}:${o.updated_at}`)).sort((a,b)=>Number(needsAction(b))-Number(needsAction(a)));
 const open=(order:ServiceActivity,type:Action)=>{setAction({order,type});setText('');setError('');};
 const run=async()=>{
  if(!action||lock.current)return;const {order:o,type}=action;
  if(type==='DELIVER'&&(text.trim().length<10||text.trim().length>2000)){setError('납품 내용을 10~2000자로 적어주세요.');return;}
  if((type==='REVISION'||type==='REJECT')&&(text.trim().length<2||text.trim().length>500)){setError('사유를 2~500자로 적어주세요.');return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const result=type==='DELIVER'?await rpc.deliver(supabase,{p_order_id:o.id,p_delivery_text:text.trim()}):type==='ACCEPT_QUOTE'?await rpc.acceptQuote(supabase,{p_order_id:o.id}):o.buyer?await rpc.buyerAction(supabase,{p_order_id:o.id,p_action:type,p_reason:text.trim()||null}):await rpc.sellerAction(supabase,{p_order_id:o.id,p_action:type,p_reason:text.trim()||null});
   if(result.success===false){setError(result.error);return;}
   setAction(null);for(const key of ['service-activity','secondary-job-service-market','wallet','transactions','mail','secondary-job-service-reputation'])void queryClient.invalidateQueries({queryKey:[key]});
  }catch(e){setError(e instanceof Error?e.message:'처리하지 못했어요. 다시 시도해주세요.');}finally{lock.current=false;setBusy(false);}
 };
 if(board.isLoading)return <div className="p-3 text-xs text-amber-50">서비스 거래 확인 중…</div>;
 if(board.isError)return <div className="p-3 text-xs text-warning">서비스 거래를 불러오지 못했어요. <button className="underline" onClick={()=>void board.refetch()}>다시 확인</button></div>;
 if(!rows.length)return null;
 const labels:Record<Action,string>={ACCEPT:'주문 수락',REJECT:'주문 거절',DELIVER:'납품 등록',CONFIRM:'구매 완료',REVISION:'수정 요청',ACCEPT_QUOTE:'견적 수락'};
 return <section className="rounded-card-lg border border-gold/40 bg-bg-card p-3.5 text-amber-50">
  <div className="flex justify-between gap-2"><h2 className="font-display text-base text-gold">🛍️ 서비스 거래 {board.actionCount>0&&<span className="rounded-pill bg-danger px-2 text-white">{board.actionCount}</span>}</h2><Link to="/market/services" className="text-xs text-gold underline">전체 보기</Link></div>
  <p className="mt-1 text-xs">내 확인이 필요한 거래부터 표시해요.</p>
  <div className="mt-3 max-h-[420px] overflow-y-auto space-y-2">{rows.map(o=><article key={o.id} className={`rounded-card-md border p-3 ${needsAction(o)?'border-gold bg-gold/5':'border-line bg-bg-deep'}`}>
   <div className="flex justify-between gap-2"><b className="text-sm">{o.title}</b><span className="text-xs text-gold">{o.amount===null?'견적 대기':`${o.amount.toLocaleString()}G`}</span></div>
   <p className="mt-1 text-xs">{o.buyer?'구매':'판매'} · {o.peer}</p><p className="mt-1 text-xs font-bold text-gold">{statusText(o)}</p>
   <details className="mt-2 text-xs"><summary className="cursor-pointer">요청·납품 내용 확인</summary><div className="mt-2 whitespace-pre-wrap break-words">요청: {o.request}{o.note&&`\n메모: ${o.note}`}{o.quote_note&&`\n견적: ${o.quote_note}`}{o.delivery&&`\n납품: ${o.delivery}`}{o.reason&&`\n사유: ${o.reason}`}</div></details>
   <div className="mt-2 flex flex-wrap gap-2">
    {o.trade_mode!=='QUICK'&&<>
     {!o.buyer&&o.status==='REQUESTED'&&<><button className="btn-primary" onClick={()=>open(o,'ACCEPT')}>수락</button><button className="btn-secondary" onClick={()=>open(o,'REJECT')}>거절</button></>}
     {!o.buyer&&['ACCEPTED','REVISION_REQUESTED'].includes(o.status)&&<button className="btn-primary" onClick={()=>open(o,'DELIVER')}>납품 등록</button>}
     {o.buyer&&o.status==='QUOTE_OFFERED'&&<button className="btn-primary" onClick={()=>open(o,'ACCEPT_QUOTE')}>견적 수락</button>}
     {o.buyer&&o.status==='DELIVERED'&&<><button className="btn-primary" onClick={()=>open(o,'CONFIRM')}>구매 완료</button><button className="btn-secondary" onClick={()=>open(o,'REVISION')}>수정 요청</button></>}
    </>}
    <Link className="btn-secondary" to={`/market/services?view=${o.buyer?'orders':'sales'}`}>거래 상세</Link>
    {o.buyer&&o.status==='COMPLETED'&&o.has_review===false&&<Link className="btn-primary" to={`/market/services?view=orders&review=${o.id}`}>평점·후기 남기기</Link>}
    {isFinished(o)&&<button className="text-xs text-gold underline" onClick={()=>dismiss(o)}>확인했어요</button>}
   </div>
  </article>)}</div>
  <Modal isOpen={!!action} onClose={()=>{if(!busy)setAction(null);}} title={action?labels[action.type]:'서비스 거래'} emoji="🛍️">
   {action&&<div className="space-y-3 text-amber-50"><p className="font-bold">{action.order.title} · {action.order.peer}</p>
    {action.type==='CONFIRM'&&<><p className="text-xs">실제로 서비스를 받았는지 확인해주세요. 구매 완료 후 판매자에게 대금이 정산됩니다.</p><div className="whitespace-pre-wrap break-words rounded-card-md border border-line p-3 text-xs">{action.order.delivery??'납품 내용을 거래 상세에서 확인해주세요.'}</div></>}
    {action.type==='ACCEPT_QUOTE'&&<p className="text-xs">견적 {action.order.amount?.toLocaleString()} GOLD를 수락하면 대금이 보관되고 서비스가 시작됩니다.</p>}
    {['DELIVER','REVISION','REJECT'].includes(action.type)&&<label className="block text-xs font-bold">{action.type==='DELIVER'?'제공한 서비스 내용':'사유'}<textarea className="input-field mt-2 w-full" rows={4} maxLength={action.type==='DELIVER'?2000:500} value={text} disabled={busy} onChange={e=>setText(e.target.value)}/></label>}
    {error&&<p role="alert" className="text-xs font-bold text-danger">{error}</p>}
    <button className="btn-primary w-full" disabled={busy} onClick={()=>void run()}>{busy?'처리 중…':labels[action.type]}</button>
   </div>}
  </Modal>
 </section>;
}
