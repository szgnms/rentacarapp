import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { customerStatement } from '@/lib/domain/finance';

export const GET = handler<{ id: string }>(({ params }) => customerStatement(toId(params.id)));
