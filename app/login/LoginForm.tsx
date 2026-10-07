'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/client/api';
import { ErrorBox } from '@/components/client/Modal';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/auth/login', { username: f.get('username'), password: f.get('password') });
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <ErrorBox error={error} />
      <label className="field">Kullanıcı adı<input name="username" autoComplete="username" required autoFocus /></label>
      <label className="field">Şifre<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
    </form>
  );
}
