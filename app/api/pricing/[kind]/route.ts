import { handler } from '@/lib/api';
import { HttpError } from '@/lib/core';
import { PRICING_KINDS, savePricing, type PricingKind } from '@/lib/domain/pricing';

export const POST = handler<{ kind: string }>(({ params, body }) => {
  if (!PRICING_KINDS.includes(params.kind as PricingKind)) throw new HttpError(404, 'Bilinmeyen tür');
  return savePricing(params.kind as PricingKind, null, body);
}, { perm: 'pricing.manage' });
