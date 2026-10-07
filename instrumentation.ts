export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Demo modu: boş veritabanına örnek veri yükler. Vercel'de (geçici /tmp veritabanı) varsayılan olarak açıktır;
    // DEMO_SEED=0 ile kapatılır, başka ortamlarda DEMO_SEED=1 ile açılır.
    const demo = process.env.DEMO_SEED === '1' || (!!process.env.VERCEL && process.env.DEMO_SEED !== '0');
    if (demo) {
      const { getDb, one } = await import('./lib/db');
      if (!one('SELECT 1 FROM vehicles LIMIT 1')) {
        const { seedDemo } = await import('./lib/demo-seed');
        await seedDemo(getDb()).catch((e) => console.error('Demo verisi yüklenemedi', e));
      }
    }
    const { startScheduler } = await import('./lib/jobs');
    startScheduler();
  }
}
