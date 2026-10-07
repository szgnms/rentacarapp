import { handler } from '@/lib/api';
import { quote } from '@/lib/domain/reservations';

export const POST = handler(({ body }) => quote(body));
