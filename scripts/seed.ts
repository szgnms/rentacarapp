// Demo verisi oluşturur. Kullanım: npm run seed  (mevcut veritabanını ve yüklenen dosyaları SIFIRLAR; çalışan sunucuyu önce durdurun)
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_FILE || path.join(process.cwd(), 'data', 'rentacar.db');

async function main() {
  for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.rmSync(f);
  // Modüller DB_FILE'ı okuduğundan silme işleminden sonra yüklenir.
  const { openDb } = await import('../lib/db');
  const { storageRoot } = await import('../lib/files');
  fs.rmSync(storageRoot(), { recursive: true, force: true });
  const { seedDemo } = await import('../lib/demo-seed');
  await seedDemo(openDb(file));
  console.log('Demo verisi oluşturuldu:', file);
  console.log('Giriş: admin / admin123 · mudur / mudur123 · rezervasyon / rezervasyon123 · saha / saha123 · muhasebe / muhasebe123 · filo / filo123 · personel / personel123');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
