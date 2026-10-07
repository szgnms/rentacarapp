import { handler } from '@/lib/api';
import { scopedBranch } from '@/lib/permissions';
import { dashboard } from '@/lib/domain/reports';

export const GET = handler(({ user }) => dashboard(scopedBranch(user)));
