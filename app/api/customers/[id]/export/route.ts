import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { exportCustomerData } from '@/lib/domain/customers';

export const GET = handler<{ id: string }>(async ({ params }) => {
  const data = await exportCustomerData(toId(params.id));
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="kvkk-veri-${params.id}.json"` },
  });
}, { perm: 'customers.pii' });
