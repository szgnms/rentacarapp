import { handler } from '@/lib/api';
import { pricingData } from '@/lib/domain/pricing';

export const GET = handler(() => pricingData());
