import { handler } from '@/lib/api';
import { reports } from '@/lib/domain/reports';

export const GET = handler(({ query }) => reports(query), { perm: 'reports.view' });
