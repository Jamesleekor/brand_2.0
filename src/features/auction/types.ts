export type AuctionStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
export type AuctionFinalStatus = 'SOLD' | 'FAILED_FINAL' | null;

export interface LiveAuctionTopBid {
  bid_id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  amount: number;
  created_at: string;
}

export interface LiveAuctionResult {
  winner_student_id: number;
  winner_name: string;
  winner_brand_name: string | null;
  final_price: number;
  attempt_number: number;
  confirmed_at: string;
}

export interface LiveAuctionItem {
  id: number;
  auction_id: number;
  item_name: string;
  description: string | null;
  category: string;
  emoji: string;
  image_url: string | null;
  starting_price: number;
  current_price: number;
  previous_sale_price: number | null;
  display_order: number;
  current_attempt: 1 | 2 | 3;
  final_status: AuctionFinalStatus;
  bidding_started_at: string | null;
  bidding_ends_at: string | null;
  last_bid_at: string | null;
  is_current: boolean;
  bid_count: number;
  top_bid: LiveAuctionTopBid | null;
  result: LiveAuctionResult | null;
}

export interface LiveAuctionRecentBid {
  id: number;
  auction_item_id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  bid_amount: number;
  attempt_number: number;
  created_at: string;
  is_winning: boolean;
  invalidated_at: string | null;
}

export interface LiveAuctionHeader {
  id: number;
  classroom_id: number;
  round_number: number;
  school_year: number;
  scheduled_date: string;
  status: AuctionStatus;
  started_at: string | null;
  ended_at: string | null;
  initial_duration_seconds: number;
  extension_seconds: number;
  current_item_id: number | null;
  paused_at: string | null;
  pause_remaining_seconds: number | null;
  state_version: number;
}


export type AuctionSuperPassRoundStatus =
  | 'APPLYING'
  | 'NORMAL_BIDDING'
  | 'PRIORITY_BIDDING'
  | 'SOLD_SINGLE'
  | 'SOLD_PRIORITY'
  | 'FAILED_ATTEMPT'
  | 'CANCELLED';

export type AuctionSuperPassEntryStatus =
  | 'APPLIED'
  | 'WINNER_CONSUMED'
  | 'LOSER_RELEASED'
  | 'INVALID_RELEASED'
  | 'ATTEMPT_RELEASED'
  | 'CANCELLED_RELEASED';

export interface AuctionSuperPassApplicant {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  entry_status: AuctionSuperPassEntryStatus;
  reservation_status: 'RESERVED' | 'CONSUMED' | 'RELEASED' | 'EXPIRED' | null;
  applied_at: string;
}

export interface AuctionSuperPassState {
  round_id: number;
  status: AuctionSuperPassRoundStatus;
  attempt_number: number;
  minimum_price: number;
  application_started_at: string;
  application_ends_at: string;
  priority_started_at: string | null;
  priority_ends_at: string | null;
  applicant_count: number;
  winner_student_id: number | null;
  resolved_at: string | null;
  pass_item_id: number | null;
  available_quantity: number;
  current_student_applied: boolean;
  current_student_entry_status: AuctionSuperPassEntryStatus | null;
  current_student_priority_eligible: boolean;
  applicants: AuctionSuperPassApplicant[] | null;
}

export interface AuctionSuperPassActionResult {
  status: string;
  phase?: AuctionSuperPassRoundStatus;
  round_id?: number;
  item_id?: number;
  entry_id?: number;
  reservation_id?: number;
  applicant_count?: number;
  application_ends_at?: string;
  server_now?: string;
  ends_at?: string;
  winner_student_id?: number;
  final_price?: number;
  super_pass_resolution?: string;
}

export interface LiveAuctionState {
  server_now: string;
  auction: LiveAuctionHeader | null;
  items?: LiveAuctionItem[];
  recent_bids?: LiveAuctionRecentBid[];
  super_pass?: AuctionSuperPassState | null;
}

export interface PlaceBidResult {
  bid_id: number;
  amount: number;
  server_now: string;
  ends_at: string;
  student_id: number;
}

export interface FinalizeAuctionResult {
  status:
    | 'SOLD'
    | 'RETRY_READY'
    | 'FAILED_FINAL'
    | 'NOT_EXPIRED'
    | 'PAUSED'
    | 'NOT_CURRENT'
    | 'ALREADY_FINAL';
  item_id?: number;
  result_id?: number;
  winner_student_id?: number;
  final_price?: number;
  next_attempt?: number;
  next_price?: number;
  server_now?: string;
  ends_at?: string;
}
