// =====================================================================
// B.R.A.N.D 2.0 — useWallet Hook
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// 학생 wallet 조회 + Realtime 자동 갱신.
// 거래 발생 시 즉시 wallet UI 갱신.
// =====================================================================

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { subscribeToWalletChanges } from '@/lib/realtime/subscriptions';

// =====================================================================
// Wallet 타입 (DB의 wallets 테이블 row)
// =====================================================================

export interface Wallet {
  id: number;
  studentId: number;
  gold: number;
  bv: number;
  crystal: number;
  updatedAt: string;
}

// =====================================================================
// useWallet — 본인 wallet 조회 + 실시간 갱신
// =====================================================================

export function useWallet() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  
  // 1. React Query로 wallet 조회
  const query = useQuery<Wallet | null>({
    queryKey: ['wallet', studentId],
    queryFn: async () => {
      if (!studentId) return null;
      
      const { data, error } = await supabase
        .from('wallets')
        .select('id, student_id, gold, bv, crystal, updated_at')
        .eq('student_id', studentId)
        .single();
      
      if (error) {
        throw new Error(error.message);
      }
      
      return {
        id: data.id,
        studentId: data.student_id,
        gold: Number(data.gold),
        bv: Number(data.bv),
        crystal: Number(data.crystal),
        updatedAt: data.updated_at,
      };
    },
    enabled: studentId !== null,
    staleTime: 1000 * 30,  // 30초 (Realtime이 갱신해줄 거라)
  });
  
  // 2. Realtime 구독 — wallet 변경 시 즉시 갱신
  useEffect(() => {
    if (!studentId) return;
    
    const { unsubscribe } = subscribeToWalletChanges(supabase, studentId, {
      onWalletUpdate: (newWallet) => {
        // React Query 캐시 직접 업데이트 (재요청 없이)
        queryClient.setQueryData<Wallet>(['wallet', studentId], {
          id: newWallet.id,
          studentId: newWallet.student_id,
          gold: Number(newWallet.gold),
          bv: Number(newWallet.bv),
          crystal: Number(newWallet.crystal),
          updatedAt: newWallet.updated_at,
        });
      },
      onTransactionInsert: () => {
        // 거래 발생 시 transactions 캐시도 무효화 (히스토리 갱신용)
        queryClient.invalidateQueries({ queryKey: ['transactions', studentId] });
      },
    });
    
    return () => { unsubscribe(); };
  }, [studentId, queryClient]);
  
  return {
    wallet: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

// =====================================================================
// 사용 예시
// =====================================================================
//
// function MyComponent() {
//   const { wallet, isLoading } = useWallet();
//   
//   if (isLoading) return <Spinner />;
//   if (!wallet) return null;
//   
//   return (
//     <div>
//       <p>골드: {wallet.gold}</p>
//       <p>BV: {wallet.bv}</p>
//       <p>크리스탈: {wallet.crystal}</p>
//     </div>
//   );
// }
//
// // 거래 발생 시 자동으로 wallet 값이 갱신됨 — 별도 작업 X
