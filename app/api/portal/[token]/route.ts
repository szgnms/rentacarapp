import { publicHandler } from '@/lib/api';
import { getPortal } from '@/lib/domain/portal';

export const GET = publicHandler<{ token: string }>(({ params }) => getPortal(params.token));
