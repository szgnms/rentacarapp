// Teslim/iade muayenesi sabitleri (istemci ve sunucuda ortak).

/** Rehberli fotoğraf kareleri. required: sözleşme imzaya açılmadan önce zorunlu. */
export const PHOTO_ANGLES = [
  { key: 'front_left', label: 'Ön sol köşe', required: true },
  { key: 'front', label: 'Ön', required: true },
  { key: 'front_right', label: 'Ön sağ köşe', required: true },
  { key: 'right_side', label: 'Sağ yan', required: true },
  { key: 'rear_right', label: 'Arka sağ köşe', required: true },
  { key: 'rear', label: 'Arka', required: true },
  { key: 'rear_left', label: 'Arka sol köşe', required: true },
  { key: 'left_side', label: 'Sol yan', required: true },
  { key: 'roof', label: 'Tavan', required: true },
  { key: 'interior_front', label: 'İç mekân (ön)', required: true },
  { key: 'interior_rear', label: 'İç mekân (arka)', required: true },
  { key: 'dashboard', label: 'Gösterge paneli (km + yakıt)', required: true },
  { key: 'trunk', label: 'Bagaj', required: true },
  { key: 'tires', label: 'Lastikler', required: false },
  { key: 'spare', label: 'Stepne / yedek', required: false },
  { key: 'registration', label: 'Ruhsat', required: false },
] as const;

export type PhotoAngle = (typeof PHOTO_ANGLES)[number]['key'];
export const REQUIRED_ANGLES = PHOTO_ANGLES.filter((a) => a.required).map((a) => a.key) as PhotoAngle[];
export const angleLabel = (k: string) => PHOTO_ANGLES.find((a) => a.key === k)?.label ?? k;

export const DAMAGE_TYPES = {
  scratch: 'Çizik',
  dent: 'Göçük',
  broken: 'Kırık',
  paint: 'Boya',
  glass: 'Cam',
  tire: 'Lastik',
  other: 'Diğer',
} as const;
export type DamageType = keyof typeof DAMAGE_TYPES;

export const CLEANLINESS_LABELS = {
  clean: 'Temiz',
  normal: 'Normal',
  dirty: 'Kirli (temizlik bedeli)',
  very_dirty: 'Çok kirli / koku (2× bedel)',
} as const;

export const DOC_TYPES = {
  id_front: 'Kimlik (ön)',
  id_back: 'Kimlik (arka)',
  passport: 'Pasaport',
  license_front: 'Ehliyet (ön)',
  license_back: 'Ehliyet (arka)',
  photo: 'Fotoğraf',
  other: 'Diğer belge',
} as const;

export const LANGUAGES = { tr: 'Türkçe', en: 'English', de: 'Deutsch', ru: 'Русский' } as const;
