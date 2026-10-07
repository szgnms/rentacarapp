import { handler } from '@/lib/api';
import { quote } from '@/lib/domain/bookings';

export const POST = handler(({ body }) => quote(body));
