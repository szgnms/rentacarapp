import { handler } from '@/lib/api';
import { getSettings } from '@/lib/db';
import { updateSettings } from '@/lib/domain/admin';

export const GET = handler(() => getSettings());
export const PUT = handler(({ body }) => updateSettings(body), { admin: true });
