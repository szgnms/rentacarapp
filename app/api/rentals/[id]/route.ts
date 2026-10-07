import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { getRental } from '@/lib/domain/bookings';

export const GET = handler<{ id: string }>(({ params }) => getRental(toId(params.id)));
