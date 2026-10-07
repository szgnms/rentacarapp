// Demo verisi oluşturur. Kullanım: npm run seed
// Veritabanını ve yüklenen yerel dosyaları SIFIRLAR. DATABASE_URL (uzak Postgres) tanımlıysa `--force` gerekir.
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const { closeDb, dataDir, databaseUrl, getDb, run } = await import('../lib/db');
  const { storageRoot } = await import('../lib/files');
  if (databaseUrl()) {
    if (!process.argv.includes('--force')) {
      console.error('DATABASE_URL tanımlı: uzak veritabanındaki TÜM veriler silinecek. Onaylamak için: npm run seed -- --force');
      process.exit(1);
    }
    await getDb();
    await run('DROP SCHEMA public CASCADE');
    await run('CREATE SCHEMA public');
    await closeDb();
  } else {
    fs.rmSync(path.join(dataDir(), 'pglite'), { recursive: true, force: true });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) fs.rmSync(storageRoot(), { recursive: true, force: true });
  const { seedDemo } = await import('../lib/demo-seed');
  await getDb(); // şema + başlangıç verisi
  await seedDemo();
  await closeDb();
  console.log('Demo verisi oluşturuldu.');
  console.log('Giriş: admin / admin123 · mudur / mudur123 · rezervasyon / rezervasyon123 · saha / saha123 · muhasebe / muhasebe123 · filo / filo123 · personel / personel123');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
