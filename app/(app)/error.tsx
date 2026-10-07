'use client';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-body">
        <h2>Bir hata oluştu</h2>
        <div className="alert danger" style={{ marginTop: 12 }}>{error.message || 'Beklenmeyen hata'}</div>
        <button className="primary" onClick={reset}>Tekrar dene</button>
      </div>
    </div>
  );
}
