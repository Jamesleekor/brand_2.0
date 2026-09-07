export interface OwnedFont {
  ownershipId: number; itemId: number; itemUid: string; name: string; isEquipped: boolean;
}
export interface CosmeticPricingOption { id: number; valueToken: string; price: number; conditionDescription: string | null; }
export interface FontMarketItem { id: number; itemUid: string; name: string; description: string | null; pricingOptions: CosmeticPricingOption[]; isOwned: boolean; isEquipped: boolean; ownershipId: number | null; }
