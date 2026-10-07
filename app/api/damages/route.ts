import { handler, created } from '@/lib/api';
import { createDamage, listDamages } from '@/lib/domain/service';

export const GET = handler(({ query }) => listDamages(query));
export const POST = handler(({ body }) => created(createDamage(body)), { perm: 'maintenance.write' });
