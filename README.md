# Rent A Car Yönetim Uygulaması

Araç kiralama işletmesinin tüm süreçlerini uçtan uca yöneten web uygulaması: web yönetim paneli,
tablet uyumlu **teslim/iade sihirbazları**, mobil uyumlu **müşteri portalı**; filo, fiyatlandırma, rezervasyon,
CRM & KVKK, sözleşme yaşam döngüsü, HGS/OGS, trafik cezaları, finans (e-Arşiv, cari, yaşlandırma),
bildirim motoru, KABİS, operasyon iş emirleri, raporlama/BI ve rol bazlı yetkilendirme.

- **Çatı:** Next.js 16 (App Router) + React 19 + TypeScript (strict)
- **Veritabanı:** SQLite — Node'un yerleşik `node:sqlite` modülü; sürümlü migration'lar (`lib/migrations.ts`)
- **Belgeler:** `pdf-lib` + DejaVu fontları ile Türkçe karakterli PDF (sözleşme, iade tutanağı, fatura, KABİS formu, ceza devir yazısı)
- **Dosyalar:** WORM dosya deposu — her dosyanın SHA-256 özeti saklanır, dosyalar silinmez yalnızca geçersiz kılınır
- **Mimari:** Sayfalar Server Component olarak veriyi doğrudan domain katmanından (`lib/domain/*`) okur;
  işlemler Client Component'lerden `app/api/*` route handler'larına gider. Her istek kullanıcı/IP/cihaz bağlamıyla denetim izine yazılır.

## Gereksinimler

- **Node.js 22.13+** (`node:sqlite` bayraksız; Node 24 LTS önerilir) ve npm

## Yerelde çalıştırma

```bash
npm install
npm run seed     # (opsiyonel) demo verisi — mevcut veritabanını ve yüklenen dosyaları SIFIRLAR
npm run dev      # geliştirme: http://localhost:3000
```

Üretim: `npm run build && npm start`

### Demo kullanıcıları (`npm run seed` sonrası)

| Kullanıcı | Şifre | Rol |
|---|---|---|
| `admin` | `admin123` | Süper Admin |
| `mudur` | `mudur123` | Bölge/Şube Müdürü (onay yetkisi) |
| `rezervasyon` | `rezervasyon123` | Rezervasyon / Çağrı merkezi |
| `saha` | `saha123` | Saha personeli (Sabiha Gökçen şubesi; teslim/iade) |
| `muhasebe` | `muhasebe123` | Muhasebe |
| `filo` | `filo123` | Filo / Bakım |
| `personel` | `personel123` | Genel personel |

Boş veritabanında yalnızca `admin` oluşturulur (şifre `ADMIN_PASSWORD` veya `admin123`).

| Ortam değişkeni | Açıklama | Varsayılan |
|---|---|---|
| `PORT` | HTTP portu | `3000` |
| `DB_FILE` | SQLite dosya yolu | `data/rentacar.db` |
| `UPLOAD_DIR` | Fotoğraf/PDF deposu | `DB_FILE` klasörü altında `uploads/` |
| `ADMIN_PASSWORD` | Boş veritabanında `admin` şifresi | `admin123` |
| `COOKIE_SECURE` | `1` ise oturum çerezi yalnızca HTTPS ile | — |

| Komut | Açıklama |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Geliştirme / üretim |
| `npm test` | Domain testleri (bellek içi veritabanı; teslim→iade→HGS→ceza→fatura akışları) |
| `npm run typecheck` | TypeScript kontrolü |
| `npm run seed` | Demo verisi |

## Vercel'e dağıtım (demo)

Uygulama Vercel'de çalışır, ancak Vercel'in dosya sistemi salt okunurdur ve yalnızca geçici `/tmp` yazılabilir:

- `VERCEL` ortamında veritabanı ve yüklenen dosyalar `/tmp/rentacar/` altına yazılır ve **boş veritabanına demo verisi otomatik yüklenir** (`DEMO_SEED=0` ile kapatılır).
- Bu veriler **kalıcı değildir**: her soğuk başlatmada/yeni sunucu örneğinde sıfırlanır, örnekler arasında paylaşılmaz (oturum aniden düşebilir).
  Vercel kurulumu bu yüzden **yalnızca tanıtım/deneme** içindir.
- Kalıcı kullanım için diskli bir sunucu kullanın (VPS, Railway/Render/Fly.io kalıcı disk) ve `DB_FILE` ile kalıcı yolu verin;
  ya da veritabanını Postgres'e, dosyaları nesne depolamaya (S3/Vercel Blob) taşıyın.
- Vercel proje ayarlarında **Production Branch** olarak uygulama kodunun bulunduğu dalı seçin (veya PR'ı `main`'e birleştirin) ve Node.js 22+ kullanın.

| Ortam değişkeni | Açıklama |
|---|---|
| `DEMO_SEED` | `1`: boş veritabanına demo verisi yükle (Vercel'de varsayılan açık), `0`: kapalı |

## Modüller

### Rezervasyon (`/booking`, `/reservations`, `/calendar`)
- **Grup bazlı rezervasyon** (araç grubu seçilir, araç teslimden önce atanır) veya belirli araç.
- **Overbooking kontrolü:** grup müsaitliği = boş araç − atanmamış rezervasyon; dolu grupta **bekleme listesi**.
- Atamada grupta araç yoksa **upgrade** önerileri (fiyat değişmez).
- Satış **kanalı** (Ofis, Telefon, Web, Acente, Kurumsal, Marketplace) ve **acente** (komisyon hesaplanır), **kupon**.
- **Opsiyonlu** rezervasyon: ön ödeme/onay gelmezse süre sonunda otomatik iptal.
- **İptal / no-show politikası** ücretleri (ücretsiz iptal süresi, % ücret, no-show gün sayısı).
- Kullanıcının **indirim limiti** aşılırsa rezervasyon onaya düşer.
- Takvim: araç × gün gantt görünümü + **atanmamış grup rezervasyonları** satırı.

### Sözleşme yaşam döngüsü ve tablet sihirbazları
`draft → active → returned → closed` (+ kapanış sonrası ek borç)

**Teslim sihirbazı** (`/rentals/:id/checkout`): müşteri doğrulama ve kimlik/ehliyet fotoğrafları → araç doğrulama
(plaka / QR) ve ek sürücü → **rehberli 12+ açı fotoğraf** (zaman damgası filigranı, GPS, SHA-256) → **hasar şeması**
(araç diyagramına dokunarak işaretleme, fotoğraf) → ekipman kontrol listesi, km, yakıt (8'lik gösterge), temizlik
→ ücret özeti + çok dilli sözleşme şablonu → **müşteri ve personel dijital imzası** → provizyon/depozito ve tahsilat.
- Zorunlu fotoğraflar tamamlanmadan sözleşme imzaya açılmaz.
- İmza; belge özeti (fotoğraf özetleri, km/yakıt, hasar işaretleri, ekipman, şablon) ile bağlanır.
  İmzadan sonra veri değişirse imza **geçersiz** olur.
- Aktivasyonda **sözleşme PDF'i** üretilir, müşteriye gönderilir, **KABİS açılış bildirimi** kuyruğa girer.

**İade sihirbazı** (`/rentals/:id/checkin`): çıkış fotoğraflarıyla **yan yana karşılaştırmalı** çekim → yeni hasar
işaretleri ve ücretlendirme (hasar dosyası açılır) → eksik ekipman, km, **litre bazlı yakıt** farkı → hesap özeti
(geç iade gün/saat, km aşımı, yakıt, temizlik, farklı şube; her kalem affedilebilir) → müşteri imzası (reddederse
nedeni) → tahsilat ve **depozito**: bakiyeye mahsup, iade veya **HGS/ceza için belirli süre tutma** → iade tutanağı PDF,
KABİS kapanış, fatura, yıkama iş emri.

Sözleşme ekranında: süre uzatma, **ikame araç**, ek ücret (kapanış sonrası dahil), ücret affı (onaylı),
ödeme/iade/provizyon, depozitoyu serbest bırakma, fatura kesme, belgeler ve imza geçerlilikleri.

### Filo (`/vehicles`, `/transfers`, `/maintenance`)
- Araç kartı: donanım, ACRISS, şasi/motor no, otopark yeri, HGS etiketi ve bakiyesi, alış/finansman/taksit,
  **amortisman ve defter değeri**, satış.
- Durumlar: müsait, kirada, serviste, hasarlı, transferde, satılık, hizmet dışı, satıldı.
- **Belgeler** (trafik sigortası, kasko, muayene, egzoz, ruhsat…) dosyalarıyla; süresi yaklaşanlar uyarılır.
- **Şube transferleri** (talep → yolda → tamamlandı), bakım ve hasar kayıtları, HGS/ceza geçmişi.

### Fiyatlandırma (`/pricing`)
Grup × sezon × kanal × **gün bandı** (1–3 / 4–7 / 8–14 / 15–29 / 30+) tabloları, kanal fiyat farkı ve komisyonu,
kupon/kampanya (yüzde/tutar, min gün, erken rezervasyon, grup, kullanım limiti), **depozito kuralları**
(grup, sürücü yaşı, ehliyet yılı), acenteler. Ek hizmetler: sınırsız km, LDW/SCDW, adrese teslim, ek sürücü…;
genç sürücü ve tek yön ücreti, geç iade (gün/saat), KDV dahil fiyatlar.

### CRM & KVKK (`/customers`)
Bireysel/kurumsal müşteri, **kurumsal cari ve kredi limiti**, ek sürücüler, kimlik/ehliyet belge yükleme,
ehliyet geçerlilik kontrolü, risk puanı ve kara liste, **T.C. kimlik algoritma kontrolü**.
KVKK: aydınlatma/açık rıza ve İYS ticari ileti izinleri (geçmişiyle), **veri ihracı (JSON)**,
**anonimleştirme** (yasal saklama gerektiren işlem kayıtları korunur), kişisel veri erişim logu, cari ekstre.

### HGS/OGS ve trafik cezaları (`/tolls`, `/fines`)
- Ekstre **CSV içe aktarma** → plaka + geçiş zamanı ile sözleşme eşleştirme → hizmet bedeliyle müşteriye yansıtma
  (kapanmış sözleşmeye **kapanış sonrası borç**) → eşleşmeyenler **istisna kuyruğu**nda; şirket kullanımı / itiraz.
- Cezalar: kayıt veya içe aktarma, sözleşme/sürücü eşleştirme, **sürücüye devir yazısı (PDF)**, müşteriye yansıtma,
  ödeme/itiraz; **indirimli ödeme süresi** ve **zamanaşımı** takibi.
- Tutulan depozito serbest bırakılırken açık bakiyeye önce mahsup edilir.

### Finans (`/payments`, `/invoices`, `/finance`, `/expenses`)
Tahsilat yöntemleri (sanal/mobil POS, nakit, havale, ödeme linki, kart **provizyonu**), taksit, POS referansı
(kart verisi saklanmaz), depozito iadesi onay akışı, **e-Arşiv fatura** (otomatik/kapanış sonrası fark faturası,
**iade faturası**, iptal, PDF), müşteri cari ekstresi, **alacak yaşlandırma** (0-30/31-60/61-90/90+),
**acente komisyon ekstresi**, masraflar.

### Bildirimler, KABİS, operasyon
- **Bildirim motoru** (`/notifications`): tetikleyici × kanal (e-posta/SMS/WhatsApp) × dil şablonları; rezervasyon
  onayı, teslim/iade hatırlatma, geç iade, sözleşme/fatura gönderimi, HGS/ceza bildirimi, NPS anketi.
  Ticari iletilerde İYS rızası kontrol edilir. Otomasyon sunucuda 10 dakikada bir çalışır (elle de tetiklenebilir).
- **KABİS** (`/kabis`): açılış/kapanış bildirim kuyruğu, form PDF'i, EGM referansı, gecikme/hata alarmı.
- **İş emirleri** (`/tasks`): adrese teslim/alım, valet, yıkama, detaylı temizlik, **yol yardım**, **ikame araç**
  (tamamlanınca sözleşmede araç değişir), uzatma talepleri.
- **Günün işleri** (`/field`): saha personeli için tablet ekranı — bugünkü teslimler, iadeler, gecikmeler, iş emirleri.
  Ana ekrana eklenebilir (PWA manifest).

### Müşteri portalı (`/portal/:token`)
Rezervasyon/sözleşmeye özel gizli bağlantı (bildirimlerde gönderilir), mobil öncelikli: **online check-in**
(ehliyet/iletişim + KVKK onayı), kimlik/ehliyet fotoğrafı yükleme, rezervasyon ve hesap özeti, sözleşme/iade
tutanağı/fatura indirme, **yol yardım** ve **süre uzatma** talebi, NPS anketi.

### Raporlar / BI (`/reports`, `/dashboard`)
Doluluk, **ADR**, **RevPAU**, iptal/no-show oranı, hasar/100 kiralama ve /10.000 km, hasar maliyeti/tahsilatı,
HGS ve ceza tahsil oranı, yakıt geliri, NPS; şube, kanal ve personel performansı; araç bazında karlılık, CSV dışa aktarım.

### Yetkilendirme ve denetim
- **Roller:** Süper Admin, Bölge/Şube Müdürü, Rezervasyon, Saha, Muhasebe, Filo, Genel personel —
  yetki matrisi *Ayarlar → Rol / yetki matrisi*nde görünür. Şubeye bağlı kullanıcılar kendi şubesinin kayıtlarını görür.
- **Onay akışları** (`/approvals`): limit üstü indirim, depozito iadesi, hasar affı, ücret affı — onaylanınca işlem uygulanır;
  kişi kendi talebini onaylayamaz.
- **Denetim izi** (`/audit`): kim, ne zaman, hangi IP/cihazdan, hangi kayıtta ne yaptı (kişisel veri erişimleri dahil).

## Entegrasyonlar (simülasyon / yapılandırma)

| Entegrasyon | Durum |
|---|---|
| E-posta | *Ayarlar → Entegrasyonlar*'da SMTP tanımlanırsa gerçek gönderim (nodemailer); yoksa kuyrukta/kayıtta kalır |
| SMS / WhatsApp | Sağlayıcı bağlanana kadar mesajlar kayda alınır (gönderilmez) |
| KABİS | `Manuel` (EGM referansı elle girilir) veya `Simülasyon` modu |
| e-Arşiv | Fatura numarası, UUID ve PDF üretilir; GİB özel entegratör bağlantısı simülasyondur |
| POS / provizyon | Kart verisi alınmaz; POS onay/provizyon referansı kaydedilir |
| Telematik | Kapsam dışı (km/yakıt sihirbazda girilir) |

## Proje yapısı

```
app/
  (app)/                    # oturumlu panel: dashboard, field, booking, reservations, rentals (checkout/checkin/contract),
                            # calendar, tasks, vehicles, transfers, maintenance, customers (statement), payments, invoices,
                            # finance, expenses, tolls, fines, kabis, reports, pricing, approvals, notifications, settings, audit
  portal/[token]/           # müşteri self-servis portalı (oturumsuz)
  api/                      # REST route handler'ları (ince katman → lib/domain)
  manifest.ts               # PWA manifest
components/
  CheckoutWizard.tsx, CheckinWizard.tsx, inspection.tsx   # tablet sihirbazları, fotoğraf ızgarası, hasar şeması, imza
  BookingForm.tsx, PortalView.tsx
  client/                   # Modal, Toast, Filters, FormButton, ActionButton, ImportButton, PdfButton…
  dialogs/                  # form diyalogları
lib/
  db.ts, migrations.ts      # şema, migration'lar, ayarlar
  rules.ts                  # fiyat, müsaitlik, müşteri uygunluğu, iade hesabı
  permissions.ts, auth.ts, session.ts, api.ts, context.ts, audit.ts
  files.ts, pdf.ts, documents.ts, inspection.ts, jobs.ts
  domain/                   # agreements, reservations, vehicles, customers, pricing, payments, finance,
                            # tolls, kabis, notify, templates, tasks, approvals, portal, service, reports, admin
scripts/seed.ts             # demo verisi
test/domain.test.ts         # domain testleri
```

## API özeti

Tüm uç noktalar `/api` altındadır; oturum çerezi (`sid`) ya da `Authorization: Bearer <token>` ister
(portal uç noktaları hariç). Yetkisiz işlemler `403` döner.

| Alan | Uç noktalar |
|---|---|
| Oturum | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` |
| Araç | `/vehicles` CRUD, `GET /vehicles/available`, `POST /vehicles/:id/{sell,hgs-topup}`, `/vehicle-documents`, `/transfers`, `POST /transfers/:id/{depart,arrive,cancel}` |
| Müşteri | `/customers` CRUD, `/customers/:id/{drivers,consents,export,anonymize,statement}` |
| Fiyat | `POST /quote`, `GET /pricing`, `/pricing/:kind[/:id]` (season, plan, channel, coupon, deposit_rule, agency) |
| Rezervasyon | `/reservations` CRUD, `POST /reservations/:id/{confirm,cancel,no-show,checkout}`, `GET/POST /reservations/:id/assignment` |
| Sözleşme | `POST /rentals` (kapıdan taslak), `GET/PATCH /rentals/:id`, `POST /rentals/:id/{sign,activate,extend,swap,checkin-start,checkin-preview,checkin,release-hold,invoice,cancel}`, `/rentals/:id/charges` |
| Muayene | `PATCH /inspections/:id`, `POST /inspections/:id/{photos,marks}`, `DELETE /damage-marks/:id` |
| Dosya | `POST /files`, `GET/DELETE /files/:id` (SHA-256 bütünlük başlığı) |
| Finans | `/payments`, `/invoices`, `POST /invoices/:id/{send,cancel,credit}`, `GET /finance/{aging,agencies}` |
| HGS / Ceza | `GET /tolls`, `POST /tolls/{import,rematch}`, `POST /tolls/:id/{assign,company,dispute}`, `/fines`, `POST /fines/import`, `POST /fines/:id/{assign,charge,transfer,pay,object,close,cancel}` |
| Operasyon | `/tasks`, `/kabis`, `/approvals`, `/notifications`, `/notification-templates`, `/contract-templates`, `POST /automation`, `GET /audit` |
| Portal | `GET /portal/:token`, `POST /portal/:token/{checkin,roadside,extension_request,nps}`, `POST /portal/:token/upload`, `GET /portal/:token/files/:id` |
| Raporlama | `GET /dashboard`, `GET /reports`, `GET /calendar` |
| Tanımlar | `/branches`, `/extras`, `/settings`, `/users` |
