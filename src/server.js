import { openDb } from './db.js';
import { createApp } from './app.js';

openDb();
const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Rent A Car yönetim uygulaması: http://localhost:${port}`);
  console.log('Varsayılan giriş: admin / admin123 (ilk girişten sonra değiştirin)');
});
