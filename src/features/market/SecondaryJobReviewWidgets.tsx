import { useState } from 'react';
import { Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import {
  secondaryJobServiceReviewStudentRpc,
  type MyServiceReview,
  type SellerReputation,
} from '@/lib/rpc/secondary_job_service_review_rpc';

export function SellerReputationBadge({ reputation }: { reputation: SellerReputation | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!reputation) return null;

  const ratingVisible = reputation.rating_count >= 5 && reputation.average_rating !== null;
  return <>
    <div className="mt-2 rounded-card-sm bg-bg-deep px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {ratingVisible
            ? <span className="font-black text-gold">⭐ {Number(reputation.average_rating).toFixed(1)} / 10</span>
            : <span className="font-bold text-text-secondary">⭐ 평균 평점은 평가 5건부터 공개</span>}
          <span className="text-text-muted ml-2">평가 {reputation.rating_count}건</span>
        </div>
        <button type="button" className="text-2xs font-black text-brand-glow underline disabled:no-underline disabled:text-text-muted"
          disabled={reputation.visible_review_count===0} onClick={()=>setOpen(true)}>
          후기 {reputation.visible_review_count}개 보기
        </button>
      </div>
    </div>

    <Modal isOpen={open} onClose={()=>setOpen(false)} title={`${reputation.seller_name} 후기`} emoji="💬">
      <div className="space-y-2">
        <div className="text-xs text-text-secondary">{reputation.can_view_individual_ratings?'내 서비스 후기에서는 작성자 이름은 숨기고 개별 평점과 후기 내용을 함께 표시합니다.':'후기 작성자와 개별 평점은 공개되지 않습니다. 공식 평균은 유효 평가 5건부터 표시됩니다.'}</div>
        {!reputation.reviews.length
          ? <div className="bg-bg-deep rounded-card-md p-4 text-sm text-text-muted">공개된 후기가 없습니다.</div>
          : reputation.reviews.map((review,index)=><div key={`${index}-${review.review_text.slice(0,20)}`} className="bg-bg-deep rounded-card-md p-3">
              {reputation.can_view_individual_ratings && <div className="text-xs font-black text-gold">{review.rating===null?'⭐ 평점 집계 제외':`⭐ ${review.rating} / 10`}</div>}
              <div className={cn('text-sm text-text-primary whitespace-pre-wrap',reputation.can_view_individual_ratings?'mt-1.5':'')}>“{review.review_text}”</div>
            </div>)}
      </div>
    </Modal>
  </>;
}

export function OrderReviewAction({
  orderId,
  completed,
  serviceTitle,
  existingReview,
  busy,
  onDone,
}: {
  orderId: number;
  completed: boolean;
  serviceTitle: string;
  existingReview: MyServiceReview | null | undefined;
  busy: boolean;
  onDone: () => void;
}) {
  const { call, isLoading } = useRpcCall();
  const [open,setOpen] = useState(false);
  const [rating,setRating] = useState<number|null>(null);
  const [text,setText] = useState('');

  if (!completed) return null;

  if (existingReview) {
    return <div className="mt-3 bg-bg-deep border border-line rounded-card-sm p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-black text-gold">내 평가 · {existingReview.rating} / 10</div>
        <div className="text-2xs text-text-muted">제출 완료 · 수정 불가</div>
      </div>
      <div className="text-xs text-text-secondary mt-2 whitespace-pre-wrap">{existingReview.review_text}</div>
      {(!existingReview.is_review_visible || !existingReview.is_rating_valid) && (
        <div className="text-2xs text-warning mt-2">교사 관리에 의해 후기 공개 또는 평점 집계 상태가 조정되었습니다. 내 원본 기록은 그대로 보존됩니다.</div>
      )}
    </div>;
  }

  const submit = async () => {
    if (rating===null || text.trim().length<2) return;
    await call(()=>secondaryJobServiceReviewStudentRpc.submit(supabase,{
      p_order_id:orderId,
      p_rating:rating,
      p_review_text:text,
    }),{
      successTitle:'평점과 후기 등록 완료',
      successDescription:'판매자에게는 평점과 후기 내용이 보이지만 작성자 이름은 숨겨집니다.',
      onSuccess:()=>{setOpen(false);setRating(null);setText('');onDone();},
    });
  };

  return <>
    <div className="mt-3 bg-brand-primary/10 border border-brand-primary/30 rounded-card-sm p-3 flex flex-wrap items-center justify-between gap-2">
      <div><div className="text-xs font-black text-white">⭐ 이 거래는 평가할 수 있어요</div><div className="text-2xs text-text-secondary mt-0.5">0~10점과 후기를 한 번 남길 수 있습니다.</div></div>
      <button className="btn-primary" disabled={busy||isLoading} onClick={()=>{setOpen(true);setRating(null);setText('');}}>평점·후기 남기기</button>
    </div>

    <Modal isOpen={open} onClose={()=>setOpen(false)} title={`${serviceTitle} 평가`} emoji="⭐">
      <div className="space-y-4">
        <div>
          <div className="text-xs font-bold text-text-secondary mb-2">평점 0~10점</div>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({length:11},(_,score)=><button key={score} type="button" onClick={()=>setRating(score)}
              className={cn('rounded-card-sm border py-2 text-sm font-black',rating===score?'border-gold bg-gold/15 text-gold':'border-line bg-bg-deep text-text-secondary')}>{score}</button>)}
          </div>
        </div>
        <label className="block"><span className="text-xs font-bold text-text-secondary">후기 (2~1000자)</span>
          <textarea rows={5} maxLength={1000} className="input-field w-full mt-1 resize-none" value={text} onChange={(e)=>setText(e.target.value)} placeholder="서비스를 이용한 소감을 남겨주세요." />
        </label>
        <div className="bg-bg-deep rounded-card-sm p-2.5 text-xs text-text-secondary"><b className="text-white">판매자에게는 이 거래의 평점과 후기 내용이 보이지만 작성자 이름은 숨겨집니다.</b> 다른 학생에게는 개별 점수 없이 후기 내용만 보이며, 공식 평균 점수는 유효 평가 5건 이상부터 공개됩니다.</div>
        <button className="btn-primary w-full" disabled={busy||isLoading||rating===null||text.trim().length<2} onClick={submit}>평점·후기 제출</button>
        {(rating===null||text.trim().length<2) && <div className="text-xs text-warning text-center">평점을 선택하고 후기 2자 이상을 입력하면 제출 버튼이 활성화됩니다.</div>}
        <div className="text-2xs text-text-muted text-center">제출 후 학생이 수정하거나 삭제할 수 없습니다.</div>
      </div>
    </Modal>
  </>;
}

export function MySellerReputationCard({ reputation }: { reputation: SellerReputation | null | undefined }) {
  const [open,setOpen] = useState(false);
  if (!reputation) return null;
  const ratingVisible = reputation.rating_count >= 5 && reputation.average_rating !== null;
  return <>
    <div className="bg-bg-card border border-line rounded-card-md p-3 flex flex-wrap items-center justify-between gap-3">
      <div><div className="text-2xs text-text-muted font-black">내 판매 평판</div><div className="text-xs text-text-secondary mt-1">유효 평가 {reputation.rating_count}건 · 공개 후기 {reputation.visible_review_count}건</div></div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          {ratingVisible
            ? <div className="font-display text-lg text-gold">⭐ {Number(reputation.average_rating).toFixed(1)} / 10</div>
            : <div className="text-xs font-bold text-text-secondary">평균 평점은 5건부터 공개</div>}
        </div>
        <button type="button" className="btn-secondary text-xs" disabled={reputation.visible_review_count===0} onClick={()=>setOpen(true)}>내 후기 보기</button>
      </div>
    </div>
    <Modal isOpen={open} onClose={()=>setOpen(false)} title="내 서비스 후기" emoji="💬">
      <div className="space-y-2">
        <div className="text-xs text-text-secondary">작성자 이름은 숨겨집니다. 판매자인 나에게는 각 후기의 개별 평점과 내용이 표시됩니다.</div>
        {!reputation.reviews.length
          ? <div className="bg-bg-deep rounded-card-md p-4 text-sm text-text-muted">공개된 후기가 없습니다.</div>
          : reputation.reviews.map((review,index)=><div key={`${index}-${review.review_text.slice(0,20)}`} className="bg-bg-deep rounded-card-md p-3">
              <div className="text-xs font-black text-gold">{review.rating===null?'⭐ 평점 집계 제외':`⭐ ${review.rating} / 10`}</div>
              <div className="mt-1.5 text-sm text-text-primary whitespace-pre-wrap">“{review.review_text}”</div>
            </div>)}
      </div>
    </Modal>
  </>;
}
