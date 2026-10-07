import { handler } from '@/lib/api';
import { availableVehicles } from '@/lib/domain/vehicles';

export const GET = handler(({ query }) => availableVehicles(query));
