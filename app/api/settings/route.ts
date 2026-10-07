import { handler } from '@/lib/api';
import { getSettings } from '@/lib/db';
import { updateSettings } from '@/lib/domain/admin';

export const GET = handler(({ user }) => {
  const s = getSettings();
  // SMTP şifresi yalnızca ayar yetkisi olanlara döner
  return user.role === 'admin' ? s : { ...s, smtp_pass: s.smtp_pass ? '••••' : '' };
});
export const PUT = handler(({ body }) => updateSettings(body), { perm: 'settings.manage' });
