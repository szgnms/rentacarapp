import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="card login">
        <h1>Sayfa bulunamadı</h1>
        <p className="text-2">Aradığınız kayıt silinmiş ya da adres hatalı olabilir.</p>
        <Link className="btn primary" href="/dashboard">Gösterge paneline dön</Link>
      </div>
    </div>
  );
}
