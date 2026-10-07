import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Giriş' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/dashboard');
  return (
    <div className="login-wrap">
      <div className="card login">
        <h1>🚗 Rent A Car</h1>
        <div className="text-2">Kiralama yönetim paneline giriş yapın</div>
        <LoginForm />
      </div>
    </div>
  );
}
