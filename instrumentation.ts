export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Demo modu: boş veritabanına örnek veri yükler. DEMO_SEED=1 ile açılır; Vercel'de kalıcı veritabanı (DATABASE_URL)
    // yoksa geçici /tmp veritabanı kullanıldığından varsayılan olarak açıktır (DEMO_SEED=0 ile kapatılır).
    const ephemeral = !!process.env.VERCEL && !process.env.DATABASE_URL && !process.env.POSTGRES_URL;
    const demo = process.env.DEMO_SEED === '1' || (ephemeral && process.env.DEMO_SEED !== '0');
    if (demo) {
      const { one } = await import('./lib/db');
      if (!(await one('SELECT 1 FROM vehicles LIMIT 1'))) {
        const { seedDemo } = await import('./lib/demo-seed');
        await seedDemo().catch((e) => console.error('Demo verisi yüklenemedi', e));
      }
    }
    const { startScheduler } = await import('./lib/jobs');
    startScheduler();
  }
}
