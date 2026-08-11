// =====================================================================
// B.R.A.N.D 2.0 — Realtime Subscriptions
// Stage 5 Sub-step 5-D · 생성일 2026-05-20
// =====================================================================
// Master Lee 결정 ④: 거래 + 알림 + 경매 3개 채널 활성화
// 
// 구독 채널:
//   1. transactions       — 학생 본인 거래 (wallet 실시간 갱신)
//   2. notifications      — 메일·전역알림·활동피드
//   3. auctions           — 경매 입찰·낙찰 (Stage 0 Firebase 대체)
// 
// 비활성 채널 (필요 시 추후 활성화):
//   - rankings (선택)
//   - guild_gs (선택)
// =====================================================================

import { SupabaseClient, RealtimeChannel, RealtimeRemoveChannelResponse } from '@supabase/supabase-js';


// =====================================================================
// 1. 공통 타입 정의
// =====================================================================

/**
 * Realtime 이벤트 타입
 */
export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Realtime 페이로드 (Supabase 표준)
 */
export interface RealtimePayload<T> {
    eventType: RealtimeEventType;
    new: T;
    old: Partial<T>;
    schema: string;
    table: string;
}

/**
 * 구독 핸들 — unsubscribe 메서드 제공
 */
export interface SubscriptionHandle {
    unsubscribe: () => Promise<RealtimeRemoveChannelResponse>;
}


// =====================================================================
// 2. 채널 ① — 거래 구독 (학생 본인의 wallet 변경)
// =====================================================================

/**
 * 학생의 wallet 변경 실시간 구독
 * - 거래 발생 시 즉시 UI 갱신
 * - 다른 학생의 wallet은 RLS로 자동 차단됨
 */

// StrictMode/재마운트 시 동일 토픽 채널이 남아 발생하는
// "cannot add postgres_changes callbacks after subscribe()" 오류 방지.
function removeExistingChannel(supabase: SupabaseClient, topic: string): void {
    supabase
        .getChannels()
        .filter((ch) => ch.topic === `realtime:${topic}`)
        .forEach((ch) => supabase.removeChannel(ch));
}

export function subscribeToWalletChanges(
    supabase: SupabaseClient,
    studentId: number,
    callbacks: {
        onWalletUpdate: (wallet: WalletPayload) => void;
        onTransactionInsert?: (transaction: TransactionPayload) => void;
    }
): SubscriptionHandle {
    removeExistingChannel(supabase, `wallet:student:${studentId}`);
    const channel = supabase
        .channel(`wallet:student:${studentId}`)
        
        // Wallet 자체 변경 (잔액 갱신)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'wallets',
                filter: `student_id=eq.${studentId}`,
            },
            (payload) => {
                callbacks.onWalletUpdate(payload.new as WalletPayload);
            }
        )
        
        // 거래 발생 (히스토리 갱신용)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'transactions',
                filter: `student_id=eq.${studentId}`,
            },
            (payload) => {
                if (callbacks.onTransactionInsert) {
                    callbacks.onTransactionInsert(payload.new as TransactionPayload);
                }
            }
        )
        
        .subscribe();
    
    return {
        unsubscribe: () => supabase.removeChannel(channel),
    };
}

export interface WalletPayload {
    id: number;
    student_id: number;
    gold: number;
    bv: number;
    crystal: number;
    updated_at: string;
}

export interface TransactionPayload {
    id: number;
    student_id: number;
    classroom_id: number;
    value_token: 'GOLD' | 'BV' | 'CRYSTAL';
    amount: number;
    balance_after: number;
    source_type: string;
    source_id: number | null;
    tax_amount: number;
    memo: string | null;
    created_at: string;
    is_reversed: boolean;
}


// =====================================================================
// 3. 채널 ② — 알림 구독 (메일·전역알림·활동피드)
// =====================================================================

/**
 * 학생의 알림 채널 통합 구독
 * - 새 메일 도착
 * - 학급 전역 알림
 * - 활동 피드 (선택)
 */
export function subscribeToNotifications(
    supabase: SupabaseClient,
    params: {
        studentId: number;
        classroomId: number;
        includeFeed?: boolean;
    },
    callbacks: {
        onNewMail: (mail: MailPayload) => void;
        onGlobalAlert: (alert: GlobalAlertPayload) => void;
        onActivityFeed?: (item: ActivityFeedPayload) => void;
    }
): SubscriptionHandle {
    removeExistingChannel(supabase, `notifications:student:${params.studentId}`);
    const channel = supabase
        .channel(`notifications:student:${params.studentId}`)
        
        // 우편함 — 본인 수신만
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mail_messages',
                filter: `recipient_id=eq.${params.studentId}`,
            },
            (payload) => {
                callbacks.onNewMail(payload.new as MailPayload);
            }
        )
        
        // 전역 알림 — 학급 전체
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'global_alerts',
                filter: `classroom_id=eq.${params.classroomId}`,
            },
            (payload) => {
                callbacks.onGlobalAlert(payload.new as GlobalAlertPayload);
            }
        );
    
    // 활동 피드 (선택)
    if (params.includeFeed && callbacks.onActivityFeed) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'activity_feed_items',
                filter: `classroom_id=eq.${params.classroomId}`,
            },
            (payload) => {
                callbacks.onActivityFeed!(payload.new as ActivityFeedPayload);
            }
        );
    }
    
    channel.subscribe();
    
    return {
        unsubscribe: () => supabase.removeChannel(channel),
    };
}

export interface MailPayload {
    id: number;
    classroom_id: number;
    recipient_id: number;
    sender_type: 'SYSTEM' | 'TEACHER' | 'GUARD' | 'STUDENT';
    title: string;
    body: string;
    message_type: string;
    is_read: boolean;
    created_at: string;
}

export interface GlobalAlertPayload {
    id: number;
    classroom_id: number;
    category: string;
    message: string;
    emoji: string | null;
    triggered_by_student_id: number | null;
    created_at: string;
    expires_at: string | null;
}

export interface ActivityFeedPayload {
    id: number;
    classroom_id: number;
    activity_type: string;
    subject_student_id: number;
    subject_data: Record<string, unknown>;
    created_at: string;
}


// =====================================================================
// 4. 채널 ③ — 경매 실시간 (Stage 0 Firebase 대체) ⭐
// =====================================================================

/**
 * 경매 채널 구독 — 학급 전체가 동시에 보는 화면
 * - 새 경매 시작
 * - 입찰 발생 (실시간 가격 변동)
 * - 낙찰/유찰
 * - 시도 회차 변경
 */
export function subscribeToAuctions(
    supabase: SupabaseClient,
    classroomId: number,
    callbacks: {
        onAuctionStart?: (auction: AuctionPayload) => void;
        onAuctionItemUpdate?: (item: AuctionItemPayload) => void;
        onNewBid?: (bid: AuctionBidPayload) => void;
        onAuctionResult?: (result: AuctionResultPayload) => void;
        onAuctionFailure?: (failure: AuctionFailurePayload) => void;
    }
): SubscriptionHandle {
    removeExistingChannel(supabase, `auctions:classroom:${classroomId}`);
    const channel = supabase
        .channel(`auctions:classroom:${classroomId}`);
    
    // 경매 시작/종료
    if (callbacks.onAuctionStart) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'auctions',
                filter: `classroom_id=eq.${classroomId}`,
            },
            (payload) => {
                callbacks.onAuctionStart!(payload.new as AuctionPayload);
            }
        );
    }
    
    // 경매 상품 상태 변경 (시도 회차, 현재 가격 등)
    if (callbacks.onAuctionItemUpdate) {
        channel.on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'auction_items',
            },
            (payload) => {
                const item = payload.new as AuctionItemPayload;
                // classroom_id 필터 (JOIN 없이는 직접 못 필터링 — 클라이언트에서 처리)
                callbacks.onAuctionItemUpdate!(item);
            }
        );
    }
    
    // 입찰 발생
    if (callbacks.onNewBid) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'auction_bids',
            },
            (payload) => {
                callbacks.onNewBid!(payload.new as AuctionBidPayload);
            }
        );
    }
    
    // 낙찰 결과
    if (callbacks.onAuctionResult) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'auction_results',
            },
            (payload) => {
                callbacks.onAuctionResult!(payload.new as AuctionResultPayload);
            }
        );
    }
    
    // 유찰
    if (callbacks.onAuctionFailure) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'auction_failures',
            },
            (payload) => {
                callbacks.onAuctionFailure!(payload.new as AuctionFailurePayload);
            }
        );
    }
    
    channel.subscribe();
    
    return {
        unsubscribe: () => supabase.removeChannel(channel),
    };
}

export interface AuctionPayload {
    id: number;
    classroom_id: number;
    title: string;
    status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
    starts_at: string;
    ends_at: string;
}

export interface AuctionItemPayload {
    id: number;
    auction_id: number;
    title: string;
    category: string;
    current_attempt: number;
    starting_price: number;
    current_price: number;
    final_status: 'SOLD' | 'FAILED' | 'IN_PROGRESS' | 'PENDING';
}

export interface AuctionBidPayload {
    id: number;
    auction_item_id: number;
    student_id: number;
    bid_price: number;
    attempt_number: number;
    created_at: string;
}

export interface AuctionResultPayload {
    id: number;
    auction_item_id: number;
    winner_student_id: number;
    final_price: number;
    attempt_number: number;
    created_at: string;
}

export interface AuctionFailurePayload {
    id: number;
    auction_item_id: number;
    failure_type: 'ATTEMPT_1' | 'ATTEMPT_2' | 'FINAL';
    attempt_number: number;
    created_at: string;
}


// =====================================================================
// 5. 채널 통합 — 학생 페이지 진입 시 한 번에 구독
// =====================================================================

/**
 * 학생 페이지 진입 시 표준 구독 묶음
 * - wallet 실시간
 * - 알림 실시간
 * - 경매 실시간
 * 
 * 페이지 이탈 시 unsubscribeAll 호출 필수.
 */
export function subscribeStudentChannels(
    supabase: SupabaseClient,
    params: {
        studentId: number;
        classroomId: number;
    },
    callbacks: {
        onWalletUpdate: (wallet: WalletPayload) => void;
        onTransactionInsert?: (tx: TransactionPayload) => void;
        onNewMail: (mail: MailPayload) => void;
        onGlobalAlert: (alert: GlobalAlertPayload) => void;
        onActivityFeed?: (item: ActivityFeedPayload) => void;
        onAuctionStart?: (auction: AuctionPayload) => void;
        onAuctionItemUpdate?: (item: AuctionItemPayload) => void;
        onNewBid?: (bid: AuctionBidPayload) => void;
        onAuctionResult?: (result: AuctionResultPayload) => void;
    }
): { unsubscribeAll: () => Promise<void> } {
    const walletHandle = subscribeToWalletChanges(supabase, params.studentId, {
        onWalletUpdate: callbacks.onWalletUpdate,
        onTransactionInsert: callbacks.onTransactionInsert,
    });
    
    const notifHandle = subscribeToNotifications(supabase, {
        studentId: params.studentId,
        classroomId: params.classroomId,
        includeFeed: !!callbacks.onActivityFeed,
    }, {
        onNewMail: callbacks.onNewMail,
        onGlobalAlert: callbacks.onGlobalAlert,
        onActivityFeed: callbacks.onActivityFeed,
    });
    
    const auctionHandle = subscribeToAuctions(supabase, params.classroomId, {
        onAuctionStart: callbacks.onAuctionStart,
        onAuctionItemUpdate: callbacks.onAuctionItemUpdate,
        onNewBid: callbacks.onNewBid,
        onAuctionResult: callbacks.onAuctionResult,
    });
    
    return {
        unsubscribeAll: async () => {
            await Promise.all([
                walletHandle.unsubscribe(),
                notifHandle.unsubscribe(),
                auctionHandle.unsubscribe(),
            ]);
        },
    };
}


// =====================================================================
// 6. 교사 채널 통합 — 모니터링용
// =====================================================================

/**
 * 교사 대시보드 진입 시 구독
 * - 학급 전체 거래 (모니터링)
 * - 학급 전체 알림
 * - 학급 경매 진행
 * - 업적 검토 큐 (PENDING_REVIEW 발생)
 */
export function subscribeTeacherChannels(
    supabase: SupabaseClient,
    classroomId: number,
    callbacks: {
        onClassroomTransaction?: (tx: TransactionPayload) => void;
        onGlobalAlert?: (alert: GlobalAlertPayload) => void;
        onPendingReview?: (application: AchievementApplicationPayload) => void;
        onAuctionEvent?: (item: AuctionItemPayload) => void;
        onSuspiciousP2P?: (transfer: P2PTransferPayload) => void;
    }
): { unsubscribeAll: () => Promise<void> } {
    removeExistingChannel(supabase, `teacher:classroom:${classroomId}`);
    const channel = supabase.channel(`teacher:classroom:${classroomId}`);
    
    // 모든 학급 거래 (감시)
    if (callbacks.onClassroomTransaction) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'transactions',
                filter: `classroom_id=eq.${classroomId}`,
            },
            (payload) => callbacks.onClassroomTransaction!(payload.new as TransactionPayload)
        );
    }
    
    // 전역 알림
    if (callbacks.onGlobalAlert) {
        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'global_alerts',
                filter: `classroom_id=eq.${classroomId}`,
            },
            (payload) => callbacks.onGlobalAlert!(payload.new as GlobalAlertPayload)
        );
    }
    
    // 업적 검토 큐 알림 (PENDING_REVIEW로 변경 시)
    if (callbacks.onPendingReview) {
        channel.on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'achievement_applications',
                filter: `classroom_id=eq.${classroomId}`,
            },
            (payload) => {
                const app = payload.new as AchievementApplicationPayload;
                if (app.status === 'PENDING_REVIEW') {
                    callbacks.onPendingReview!(app);
                }
            }
        );
    }
    
    // 수호대 의심 거래
    if (callbacks.onSuspiciousP2P) {
        channel.on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'p2p_transfers',
                filter: `classroom_id=eq.${classroomId}`,
            },
            (payload) => {
                const transfer = payload.new as P2PTransferPayload;
                if (transfer.status === 'SUSPICIOUS') {
                    callbacks.onSuspiciousP2P!(transfer);
                }
            }
        );
    }
    
    channel.subscribe();
    
    return {
        unsubscribeAll: async () => {
            await supabase.removeChannel(channel);
        },
    };
}

export interface AchievementApplicationPayload {
    id: number;
    classroom_id: number;
    student_id: number;
    achievement_id: number;
    status: string;
    evidence_text: string | null;
    evidence_data: Record<string, unknown> | null;
    rejection_reason: string | null;
    created_at: string;
}

export interface P2PTransferPayload {
    id: number;
    classroom_id: number;
    sender_id: number;
    receiver_id: number;
    amount: number;
    status: 'COMPLETED' | 'SUSPICIOUS' | 'REVOKED';
    tag: string | null;
    description: string | null;
    created_at: string;
}


// =====================================================================
// 7. React Hook 패턴 예시
// =====================================================================
//
// ```typescript
// // hooks/useStudentRealtime.ts
// export function useStudentRealtime(studentId: number, classroomId: number) {
//   const [wallet, setWallet] = useState<WalletPayload | null>(null);
//   const [notifications, setNotifications] = useState<MailPayload[]>([]);
//   
//   useEffect(() => {
//     // 초기 데이터 로드
//     loadInitialWallet(studentId).then(setWallet);
//     
//     // Realtime 구독
//     const { unsubscribeAll } = subscribeStudentChannels(supabase, {
//       studentId, classroomId,
//     }, {
//       onWalletUpdate: setWallet,
//       onTransactionInsert: (tx) => {
//         // 거래 발생 시 알림 표시
//         showToast({ title: `${tx.amount > 0 ? '+' : ''}${tx.amount} ${tx.value_token}` });
//       },
//       onNewMail: (mail) => {
//         setNotifications((prev) => [mail, ...prev]);
//         showToast({ title: mail.title });
//       },
//       onGlobalAlert: (alert) => {
//         showBanner({ message: alert.message, emoji: alert.emoji });
//       },
//       onNewBid: (bid) => {
//         // 경매 화면에서 입찰 실시간 표시
//         updateAuctionBids(bid);
//       },
//     });
//     
//     return () => { unsubscribeAll(); };
//   }, [studentId, classroomId]);
//   
//   return { wallet, notifications };
// }
// ```
