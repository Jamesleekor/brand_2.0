import { z } from 'zod';

const PositiveInt = z.number().int().positive();
const NonNegativeInt = z.number().int().min(0);

export const MarketItemTypeSchema = z.enum(['SNACK', 'CONSUMABLE', 'TICKET', 'AUCTION_PASS', 'SPECIAL']);
export const MarketUseModeSchema = z.enum(['BAKERY_FULFILLMENT', 'IMMEDIATE', 'AUCTION_SUPER_PASS', 'MANUAL', 'NONE']);
export const MarketPricingModeSchema = z.enum(['FIXED', 'STOCK_DYNAMIC']);

export type MarketItemType = z.infer<typeof MarketItemTypeSchema>;
export type MarketUseMode = z.infer<typeof MarketUseModeSchema>;
export type MarketPricingMode = z.infer<typeof MarketPricingModeSchema>;

export const InventoryQuantityActionSchema = z.object({
  p_item_id: PositiveInt,
  p_quantity: z.number().int().min(1).max(100),
});

export const TeacherMarketSaveItemSchema = z.object({
  p_classroom_id: PositiveInt,
  p_item_id: PositiveInt.nullable(),
  p_payload: z.object({
    name: z.string().trim().min(1, '아이템 이름을 입력해주세요.').max(100),
    description: z.string().trim().max(1000).nullable(),
    image_url: z.string().trim().max(2000).nullable(),
    item_type: MarketItemTypeSchema,
    use_mode: MarketUseModeSchema,
    pricing_mode: MarketPricingModeSchema,
    base_price_gold: PositiveInt,
    base_stock: PositiveInt,
    current_stock: NonNegativeInt,
    weekly_purchase_limit: PositiveInt.nullable(),
    max_price_multiplier: z.number().min(1).max(1.5),
    curve_exponent: z.number().gt(0).max(10),
    is_sellable: z.boolean(),
    is_usable: z.boolean(),
    is_active: z.boolean(),
    is_archived: z.boolean(),
  }),
});

export const TeacherMarketAdjustStockSchema = z.object({
  p_classroom_id: PositiveInt,
  p_item_id: PositiveInt,
  p_delta: z.number().int().refine((value) => value !== 0, '재고 조정량은 0일 수 없습니다.'),
  p_reason: z.string().trim().max(500).nullable(),
});

export const TeacherMarketArchiveSchema = z.object({
  p_classroom_id: PositiveInt,
  p_item_id: PositiveInt,
});

export type InventoryQuantityActionInput = z.infer<typeof InventoryQuantityActionSchema>;
export type TeacherMarketSaveItemInput = z.infer<typeof TeacherMarketSaveItemSchema>;
export type TeacherMarketAdjustStockInput = z.infer<typeof TeacherMarketAdjustStockSchema>;
export type TeacherMarketArchiveInput = z.infer<typeof TeacherMarketArchiveSchema>;
