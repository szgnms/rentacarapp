import { handler } from '@/lib/api';
import { dashboard } from '@/lib/domain/reports';

export const GET = handler(() => dashboard());
