import { handler } from '@/lib/api';
import { calendar } from '@/lib/domain/reports';

export const GET = handler(({ query }) => calendar(query));
