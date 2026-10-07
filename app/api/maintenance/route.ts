import { handler, created } from '@/lib/api';
import { createMaintenance, listMaintenance } from '@/lib/domain/service';

export const GET = handler(({ query }) => listMaintenance(query));
export const POST = handler(({ body }) => created(createMaintenance(body)));
