# Rent A Car Yönetim Uygulaması

Araç kiralama işletmesinin tüm süreçlerini baştan sona yöneten web uygulaması:
filo, müşteri, rezervasyon, teslim (check-out), iade (check-in), tahsilat/depozito,
bakım/hasar, masraf, raporlama ve kullanıcı yetkilendirmesi.

- **Sunucu:** Node.js (≥ 22.5) + Express 5
- **Veritabanı:** SQLite (Node'un yerleşik `node:sqlite` modülü; ek kurulum/derleme gerekmez)
- **Arayüz:** Bağımlılıksız, Türkçe, mobil uyumlu tek sayfa uygulama (vanilla JS)

## Hızlı başlangıç

```bash
npm install
npm run seed     # (opsiyonel) demo verisi yükler — mevcut veritabanını SIFIRLAR
npm start        # http://localhost:3000
```

Varsayılan giriş: **admin / admin123** (demo verisinde ayrıca **personel / personel123**).
İlk girişten sonra şifreyi *Ayarlar → Hesabım* bölümünden değiştirin.

| Ortam değişkeni | Açıklama | Varsayılan |
|---|---|---|
| `PORT` | HTTP portu | `3000` |
| `DB_FILE` | SQLite dosya yolu | `data/rentacar.db` |
| `ADMIN_PASSWORD` | Boş veritabanında oluşturulan `admin` kullanıcısının şifresi | `admin123` |
| `COOKIE_SECURE` | `1` ise oturum çerezi yalnızca HTTPS üzerinden gönderilir | — |

Testler: `npm test` (uçtan uca API senaryoları, bellek içi veritabanı ile).

## Süreçler

### 1. Rezervasyon
- Tarih/şube/kategori/vites seçilir → **müsait araçlar** fiyatlarıyla listelenir.
  Müsaitlik; bekleyen/onaylı rezervasyonlar, aktif kiralamalar (gecikenler dahil),
  planlı/devam eden bakımlar ve "hizmet dışı" durumu dikkate alınarak hesaplanır.
- Müşteri aranır veya yerinde oluşturulur. Kara liste, minimum yaş ve ehliyet yılı kontrol edilir.
- Ek hizmetler (bebek koltuğu, navigasyon, ek sürücü, mini hasar sigortası…), özel günlük fiyat,
  indirim, depozito ve ön ödeme girilir.
- Durumlar: **Beklemede → Onaylı → Teslim edildi**, ya da **İptal / Gelmedi**.

### 2. Teslim (check-out) → Kira sözleşmesi
- Rezervasyondan veya doğrudan **kapıdan kiralama** ile sözleşme (`KS2026-00001`) oluşur.
- Çıkış km'si, yakıt seviyesi (x/8), ek sürücü, teslim notları, alınan depozito ve tahsilat kaydedilir.
- Teslimde müşteri kaydı sıkı kontrol edilir (ehliyet no/tarihi, doğum tarihi zorunlu).
- Gerekirse teslimde **araç değişimi (upgrade)** yapılabilir; araç **Kirada** durumuna geçer.
- Yazdırılabilir **kira sözleşmesi** çıktısı (şirket bilgileri + genel şartlar ile).

### 3. Kiralama süresince
- **Süre uzatma:** müsaitlik kontrolü + otomatik yeniden fiyatlama.
- **Ek ücretler:** trafik cezası, HGS/OGS, temizlik vb. (iade sonrasında da eklenebilir).
- **Ödemeler:** tahsilat, müşteriye iade, depozito alma/iade. Bakiye anlık hesaplanır.
- Geciken iadeler gösterge panelinde ve takvimde kırmızı görünür.

### 4. İade (check-in)
Dönüş km'si ve yakıt girildiğinde ücretler **otomatik hesaplanır ve önizlenir**:
- **Geç iade:** tolerans süresini aşan her gün × günlük fiyat × çarpan
- **Km aşımı:** (km − günlük limit × gün) × km aşım ücreti
- **Yakıt farkı:** eksik 1/8 depo × birim fiyat
- **Hasarlar:** müşteriye yansıtılan tutar (hasar kaydı araca işlenir)
- Diğer ek ücretler; her otomatik ücret tek tıkla muaf tutulabilir.

Depozito: tamamını iade et / **bakiyeye mahsup edip kalanı iade et** / tut.
İsteğe bağlı olarak araç doğrudan bakıma/onarıma alınır; aksi halde **Müsait** olur,
km'si ve bulunduğu şube güncellenir.

### 5. Filo, bakım ve hasar
- Araç kartı: teknik bilgiler, fiyat, km limiti, depozito, trafik sigortası/kasko/muayene tarihleri,
  sonraki bakım km'si; kiralama, rezervasyon, bakım, hasar ve masraf geçmişi; araç bazlı ciro/kâr.
- Bakım: planlandı → devam ediyor (araç **Bakımda**) → tamamlandı (araç **Müsait**).
- Uyarılar: süresi dolan/30 gün içinde dolacak sigorta-kasko-muayene, yaklaşan bakım km'si.

### 6. Finans ve raporlar
- Ödeme hareketleri ve masraflar (genel veya araç bazlı), filtreleme.
- Raporlar: net tahsilat, faturalanan tutar, gider dağılımı, net kâr, ödeme yöntemleri,
  **araç bazında doluluk %** ve karlılık, kategori özeti, en iyi müşteriler, CSV dışa aktarım.
- Gösterge paneli: filo doluluğu, bugünkü teslim/iadeler, gecikmeler, açık alacak, 6 aylık grafik.
- **Filo takvimi:** araç × gün doluluk görünümü (7/14/30 gün).

### 7. Ayarlar ve yetkiler
- Şirket bilgileri, tolerans saati, haftalık/aylık indirim oranları, tek yön ücreti, yakıt birim fiyatı,
  geç iade çarpanı, KDV, minimum sürücü yaşı/ehliyet yılı, sözleşme şartları.
- Şubeler, ek hizmetler, kullanıcılar.
- **Yönetici:** her şey. **Personel:** günlük operasyon; silme, iptal ve ayar değişikliği yapamaz.

## Proje yapısı

```
src/
  server.js          # giriş noktası
  app.js             # Express uygulaması, kimlik doğrulama, hata yönetimi
  db.js              # şema, varsayılan ayarlar, transaction yardımcıları
  auth.js            # scrypt şifreleme, oturumlar, yetki ara katmanı
  services.js        # iş kuralları: gün/fiyat hesabı, müsaitlik, müşteri uygunluğu, iade hesabı
  seed.js            # demo verisi
  routes/
    admin.js         # şubeler, ek hizmetler, ayarlar, kullanıcılar
    fleet.js         # araçlar, müşteriler, müsaitlik sorgusu
    operations.js    # teklif, rezervasyon, teslim, uzatma, iade, ödemeler
    service.js       # bakım, hasar, masraf, gösterge paneli, raporlar, takvim
public/              # tek sayfa arayüz (index.html, css, js/pages/*)
test/api.test.js     # uçtan uca API testleri
```

## API özeti

Tüm uç noktalar `/api` altındadır ve oturum çerezi (`sid`) ya da `Authorization: Bearer <token>` ister.

| Alan | Uç noktalar |
|---|---|
| Oturum | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` |
| Araç | `GET/POST /vehicles`, `GET/PUT/DELETE /vehicles/:id`, `GET /vehicles/available?pickup_at&return_at` |
| Müşteri | `GET/POST /customers`, `GET/PUT/DELETE /customers/:id` |
| Fiyat | `POST /quote` |
| Rezervasyon | `GET/POST /reservations`, `GET/PUT /reservations/:id`, `POST /reservations/:id/{confirm,cancel,no-show,checkout}` |
| Kiralama | `GET/POST /rentals`, `GET /rentals/:id`, `POST /rentals/:id/{extend,checkin/preview,checkin,cancel,charges}` |
| Ödeme | `GET/POST /payments`, `DELETE /payments/:id` |
| Bakım/Hasar/Masraf | `/maintenance`, `/damages`, `/expenses` (CRUD) |
| Raporlama | `GET /dashboard`, `GET /reports?from&to`, `GET /calendar?from&days` |
| Tanımlar | `/branches`, `/extras`, `/settings`, `/users`, `GET /meta` |
