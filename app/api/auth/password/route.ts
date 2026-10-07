import { handler } from '@/lib/api';
import { changeOwnPassword } from '@/lib/auth';

export const POST = handler(async ({ user, token, body }) => {
  await changeOwnPassword(user, token, body.current_password, body.new_password);
  return { ok: true };
});
