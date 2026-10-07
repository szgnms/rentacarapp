# Rent A Car Yönetim Uygulaması

Araç kiralama işletmesinin tüm süreçlerini baştan sona yöneten web uygulaması:
filo, müşteri, rezervasyon, teslim (check-out), iade (check-in), tahsilat/depozito,
bakım/hasar, masraf, raporlama ve kullanıcı yetkilendirmesi.

- **Çatı:** Next.js 16 (App Router) + React 19 + TypeScript (strict)
- **Veritabanı:** SQLite — Node'un yerleşik `node:sqlite` modülü (native derleme / ek kurulum gerekmez)
- **Mimari:** Sayfalar Server Component olarak veriyi doğrudan domain katmanından okur;
  formlar ve işlemler Client Component'lerden `app/api/*` route handler'larına gider.

## Gereksinimler

- **Node.js 22.13 veya üzeri** (`node:sqlite` bu sürümden itibaren bayraksız gelir; Node 24 LTS önerilir)
- npm

## Yerelde çalıştırma

```bash
npm install
npm run seed     # (opsiyonel) demo verisi — mevcut veritabanını SIFIRLAR
npm run dev      # geliştirme: http://localhost:3000
```

Üretim modu:

```bash
npm run build
npm start        # http://localhost:3000
```

Varsayılan giriş: **admin / admin123** (demo verisinde ayrıca **personel / personel123**).
İlk girişten sonra şifreyi *Ayarlar → Hesabım* bölümünden değiştirin.

| Ortam değişkeni | Açıklama | Varsayılan |
|---|---|---|
| `PORT` | HTTP portu (`next start`/`next dev`) | `3000` |
| `DB_FILE` | SQLite dosya yolu | `data/rentacar.db` |
| `ADMIN_PASSWORD` | Boş veritabanında oluşturulan `admin` kullanıcısının şifresi | `admin123` |
| `COOKIE_SECURE` | `1` ise oturum çerezi yalnızca HTTPS üzerinden gönderilir | — |

> Node, `node:sqlite` için "ExperimentalWarning" uyarısı basar; zararsızdır.

### Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu (Turbopack) |
| `npm run build` / `npm start` | Üretim derlemesi / sunucusu |
| `npm test` | Domain katmanı testleri (bellek içi veritabanı) |
| `npm run typecheck` | TypeScript tip kontrolü |
| `npm run seed` | Demo verisi (veritabanını sıfırlar; çalışan sunucuyu önce durdurun) |

## Süreçler

### 1. Rezervasyon
- Tarih/şube/kategori/vites seçilir → **müsait araçlar** fiyatlarıyla listelenir.
  Müsaitlik; bekleyen/onaylı rezervasyonlar, aktif kiralamalar (gecikenler dahil),
  planlı/devam eden bakımlar ve "hizmet dışı" durumu dikkate alınarak hesaplanır.
- Müşteri aranır veya yerinde oluşturulur. Kara liste, minimum yaş ve ehliyet yılı kontrol edilir.
- Ek hizmetler, özel günlük fiyat, indirim, depozito ve ön ödeme girilir; fiyat özeti anlık güncellenir.
- Durumlar: **Beklemede → Onaylı → Teslim edildi**, ya da **İptal / Gelmedi**.

### 2. Teslim (check-out) → Kira sözleşmesi
- Rezervasyondan veya doğrudan **kapıdan kiralama** ile sözleşme (`KS2026-00001`) oluşur.
- Çıkış km'si, yakıt (x/8), ek sürücü, teslim notları, alınan depozito ve tahsilat kaydedilir.
- Teslimde müşteri kaydı sıkı kontrol edilir (ehliyet no/tarihi, doğum tarihi zorunlu).
- Teslimde **araç değişimi (upgrade)** yapılabilir; araç **Kirada** durumuna geçer.
- Yazdırılabilir **kira sözleşmesi** (şirket bilgileri + genel şartlar).

### 3. Kiralama süresince
- **Süre uzatma:** müsaitlik kontrolü + otomatik yeniden fiyatlama.
- **Ek ücretler:** trafik cezası, HGS/OGS, temizlik vb. (iade sonrasında da eklenebilir).
- **Ödemeler:** tahsilat, müşteriye iade, depozito alma/iade; bakiye anlık hesaplanır.

### 4. İade (check-in)
Dönüş km'si ve yakıt girildiğinde ücretler **otomatik hesaplanır ve önizlenir**:
- **Geç iade:** tolerans süresini aşan her gün × günlük fiyat × çarpan
- **Km aşımı:** (km − günlük limit × gün) × km aşım ücreti
- **Yakıt farkı:** eksik 1/8 depo × birim fiyat
- **Hasarlar:** müşteriye yansıtılan tutar (hasar kaydı araca işlenir) + diğer ek ücretler

Her otomatik ücret tek tıkla muaf tutulabilir. Depozito: tamamını iade et /
**bakiyeye mahsup edip kalanı iade et** / tut. Araç isteğe bağlı doğrudan bakıma alınır.

### 5. Filo, bakım ve hasar
- Araç kartı: teknik bilgiler, fiyat, km limiti, belge tarihleri, geçmiş ve araç bazlı ciro/kâr.
- Bakım: planlandı → devam ediyor (araç **Bakımda**) → tamamlandı (araç **Müsait**).
- Uyarılar: süresi dolan/30 gün içinde dolacak sigorta-kasko-muayene, yaklaşan bakım km'si.

### 6. Finans ve raporlar
- Ödeme hareketleri, masraflar (genel / araç bazlı) ve filtreler.
- Raporlar: net tahsilat, faturalanan tutar, gider dağılımı, net kâr, ödeme yöntemleri,
  **araç bazında doluluk %** ve karlılık, kategori özeti, en iyi müşteriler, CSV dışa aktarım.
- Gösterge paneli ve **filo takvimi** (araç × gün doluluk görünümü).

### 7. Ayarlar ve yetkiler
- Şirket bilgileri, fiyat kuralları (tolerans, uzun dönem indirimleri, tek yön, yakıt, geç iade, KDV),
  sürücü kuralları, sözleşme şartları; şubeler, ek hizmetler, kullanıcılar.
- **Yönetici:** her şey. **Personel:** günlük operasyon; silme, iptal ve ayar değişikliği yapamaz.

## Proje yapısı

```
app/
  layout.tsx, globals.css        # kök layout, toast sağlayıcı, stiller
  login/                         # giriş sayfası
  (app)/                         # oturum korumalı bölüm (layout'ta kontrol edilir)
    dashboard/ booking/ calendar/ reservations/[id]/ rentals/[id]/(contract)/
    vehicles/[id]/ customers/[id]/ maintenance/ payments/ expenses/ reports/ settings/
  api/                           # REST route handler'ları (ince katman → lib/domain)
components/
  ui.tsx                         # sunucu-güvenli UI parçaları (Badge, Card, Table, Tabs…)
  client/                        # Client Component'ler (Modal, Toast, Filtreler, Grafik, Menü…)
  dialogs/                       # form diyalogları (araç, müşteri, bakım, ödeme, teslim, iade…)
  BookingForm.tsx                # rezervasyon / kapıdan kiralama formu
lib/
  db.ts                          # şema, bağlantı, sorgu yardımcıları, ayarlar
  core.ts                        # HttpError, tarih ve girdi doğrulama yardımcıları
  rules.ts                       # iş kuralları: gün/fiyat, müsaitlik, müşteri uygunluğu, iade hesabı
  auth.ts, session.ts, api.ts    # oturumlar, Server Component oturumu, route handler sarmalayıcısı
  domain/                        # admin, fleet, bookings, service, reports
  format.ts, types.ts            # ortak biçimlendirme/etiketler ve tipler
scripts/seed.ts                  # demo verisi
test/domain.test.ts              # uçtan uca domain testleri
```

## API özeti

Tüm uç noktalar `/api` altındadır; oturum çerezi (`sid`) ya da `Authorization: Bearer <token>` ister.

| Alan | Uç noktalar |
|---|---|
| Oturum | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` |
| Araç | `GET/POST /vehicles`, `GET/PUT/DELETE /vehicles/:id`, `GET /vehicles/available?pickup_at&return_at` |
| Müşteri | `GET/POST /customers`, `GET/PUT/DELETE /customers/:id` |
| Fiyat | `POST /quote` |
| Rezervasyon | `GET/POST /reservations`, `GET/PUT /reservations/:id`, `POST /reservations/:id/{confirm,cancel,no-show,checkout}` |
| Kiralama | `GET/POST /rentals`, `GET /rentals/:id`, `POST /rentals/:id/{extend,checkin-preview,checkin,cancel}`, `POST /rentals/:id/charges`, `DELETE /rentals/:id/charges/:chargeId` |
| Ödeme | `GET/POST /payments`, `DELETE /payments/:id` |
| Bakım/Hasar/Masraf | `/maintenance`, `/damages`, `/expenses` (CRUD) |
| Raporlama | `GET /dashboard`, `GET /reports?from&to`, `GET /calendar?from&days` |
| Tanımlar | `/branches`, `/extras`, `/settings`, `/users` |
