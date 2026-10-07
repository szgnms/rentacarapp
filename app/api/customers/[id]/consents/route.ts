import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { consentState, recordConsent } from '@/lib/domain/customers';

export const POST = handler<{ id: string }>(({ params, body, user }) => {
  const id = toId(params.id);
  for (const [type, granted] of Object.entries((body.consents ?? {}) as Record<string, unknown>)) recordConsent(id, type, granted, String(body.channel ?? 'Ofis'), user);
  return consentState(id);
}, { perm: 'customers.write' });
