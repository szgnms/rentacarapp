import { handler } from '@/lib/api';
import { availableVehicles } from '@/lib/domain/fleet';

export const GET = handler(({ query }) => availableVehicles(query));
