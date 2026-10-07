import { handler } from '@/lib/api';
import { HttpError } from '@/lib/core';
import { PRICING_KINDS, deletePricing, savePricing, type PricingKind } from '@/lib/domain/pricing';

const kindOf = (k: string) => {
  if (!PRICING_KINDS.includes(k as PricingKind)) throw new HttpError(404, 'Bilinmeyen tür');
  return k as PricingKind;
};
export const PUT = handler<{ kind: string; id: string }>(({ params, body }) => savePricing(kindOf(params.kind), params.id, body), { perm: 'pricing.manage' });
export const DELETE = handler<{ kind: string; id: string }>(({ params }) => deletePricing(kindOf(params.kind), params.id), { perm: 'pricing.manage' });
