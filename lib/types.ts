export type Role = 'admin' | 'branch_manager' | 'reservation' | 'field' | 'accounting' | 'fleet' | 'staff';
export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'out_of_service' | 'damaged' | 'for_sale' | 'in_transfer' | 'sold';
export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'converted' | 'waitlist';
export type RentalStatus = 'draft' | 'active' | 'returned' | 'closed' | 'cancelled';
export type PaymentType = 'payment' | 'refund' | 'deposit_in' | 'deposit_out';
export type PaymentMethod = 'cash' | 'credit_card' | 'bank_transfer' | 'deposit' | 'preauth' | 'pos' | 'payment_link';
export type ChargeType =
  | 'late_return' | 'extra_km' | 'fuel' | 'damage' | 'cleaning' | 'traffic_fine' | 'hgs' | 'other'
  | 'missing_equipment' | 'different_branch' | 'service_fee';
export type MaintenanceType = 'periodic' | 'repair' | 'tire' | 'inspection' | 'damage_repair' | 'other';
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type Severity = 'minor' | 'moderate' | 'major';
export type DamageStatus = 'open' | 'repaired' | 'closed';

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  branch_id: number | null;
  discount_limit_pct: number;
}

export interface User extends SessionUser {
  email: string | null;
  phone: string | null;
  active: number;
  created_at: string;
}

export interface Branch {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  code: string | null;
  manager_user_id: number | null;
  active: number;
}

export interface Extra {
  id: number;
  name: string;
  price_type: 'daily' | 'per_rental';
  price: number;
  max_price: number | null;
  active: number;
  code: string | null;
  description: string | null;
}

export interface Vehicle {
  id: number;
  plate: string;
  brand: string;
  model: string;
  trim: string | null;
  acriss: string | null;
  luggage: number | null;
  engine_no: string | null;
  fuel_capacity: number;
  parking_spot: string | null;
  hgs_tag_no: string | null;
  hgs_balance: number;
  next_service_date: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  financing: string | null;
  monthly_installment: number | null;
  depreciation_years: number | null;
  residual_value: number | null;
  sold_at: string | null;
  sale_price: number | null;
  year: number | null;
  category: string;
  fuel_type: string;
  transmission: string;
  seats: number;
  color: string | null;
  vin: string | null;
  daily_rate: number;
  deposit_amount: number;
  current_km: number;
  km_limit_per_day: number;
  extra_km_fee: number;
  status: VehicleStatus;
  branch_id: number | null;
  insurance_expiry: string | null;
  kasko_expiry: string | null;
  inspection_expiry: string | null;
  next_service_km: number | null;
  notes: string | null;
  created_at: string;
}

export interface VehicleListItem extends Vehicle {
  branch_name: string | null;
  active_contract: string | null;
  active_return_at: string | null;
}

export interface Customer {
  id: number;
  type: 'individual' | 'corporate';
  first_name: string;
  last_name: string;
  company_name: string | null;
  tax_office: string | null;
  tax_no: string | null;
  national_id: string | null;
  passport_no: string | null;
  nationality: string | null;
  birth_date: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  license_no: string | null;
  license_class: string | null;
  license_date: string | null;
  blacklisted: number;
  blacklist_reason: string | null;
  notes: string | null;
  credit_limit: number;
  invoice_title: string | null;
  invoice_address: string | null;
  license_expiry: string | null;
  risk_score: number;
  risk_note: string | null;
  preferred_language: string;
  anonymized_at: string | null;
  agency_id: number | null;
  created_at: string;
}

export interface CustomerListItem extends Customer {
  rental_count: number;
  total_spent: number;
}

interface PricedBooking {
  id: number;
  customer_id: number;
  vehicle_id: number;
  pickup_branch_id: number | null;
  return_branch_id: number | null;
  pickup_at: string;
  days: number;
  daily_rate: number;
  base_amount: number;
  long_term_discount: number;
  extras_amount: number;
  one_way_fee: number;
  young_driver_fee: number;
  channel_markup: number;
  coupon_id: number | null;
  coupon_discount: number;
  agency_id: number | null;
  agency_commission: number;
  portal_token: string | null;
  discount: number;
  total_amount: number;
  deposit_amount: number;
  created_by: number | null;
  created_at: string;
}

export interface Reservation extends Omit<PricedBooking, 'vehicle_id'> {
  vehicle_id: number | null;
  code: string;
  return_at: string;
  category: string | null;
  rate_plan_id: number | null;
  option_expires_at: string | null;
  cancellation_fee: number;
  approval_id: number | null;
  status: ReservationStatus;
  source: string | null;
  cancel_reason: string | null;
  notes: string | null;
}

export interface Rental extends PricedBooking {
  contract_no: string;
  reservation_id: number | null;
  planned_return_at: string;
  actual_return_at: string | null;
  start_km: number;
  end_km: number | null;
  start_fuel: number;
  end_fuel: number | null;
  charges_amount: number;
  additional_driver: string | null;
  source: string | null;
  deposit_hold_amount: number;
  deposit_hold_until: string | null;
  language: string;
  template_id: number | null;
  signed_at: string | null;
  closed_at: string | null;
  status: RentalStatus;
  checkout_notes: string | null;
  checkin_notes: string | null;
  closed_by: number | null;
}

export interface BookingJoin {
  customer_name: string;
  customer_phone: string;
  plate: string;
  brand: string;
  model: string;
  category: string;
  pickup_branch_name: string | null;
  return_branch_name: string | null;
}

export interface LineItem {
  id?: number;
  extra_id: number;
  name: string;
  quantity: number;
  amount: number;
}

export interface RentalCharge {
  id: number;
  rental_id: number;
  type: ChargeType;
  description: string | null;
  amount: number;
  damage_id: number | null;
  toll_id: number | null;
  fine_id: number | null;
  post_charge: number;
  created_at: string;
}

export interface Payment {
  id: number;
  customer_id: number;
  rental_id: number | null;
  reservation_id: number | null;
  type: PaymentType;
  method: PaymentMethod;
  amount: number;
  paid_at: string;
  reference: string | null;
  installments: number | null;
  description: string | null;
  created_by: number | null;
  created_at: string;
}

export interface Maintenance {
  id: number;
  vehicle_id: number;
  type: MaintenanceType;
  description: string | null;
  start_date: string;
  end_date: string | null;
  km: number | null;
  cost: number;
  vendor: string | null;
  status: MaintenanceStatus;
  work_order_no: string | null;
  parts: string | null;
  next_km: number | null;
  created_at: string;
}

export interface Damage {
  id: number;
  vehicle_id: number;
  rental_id: number | null;
  reported_at: string;
  location: string | null;
  description: string;
  severity: Severity;
  repair_cost: number;
  customer_charge: number;
  insurance_claim: number;
  status: DamageStatus;
  session_id: number | null;
  mark_x: number | null;
  mark_y: number | null;
  mark_type: string | null;
  photo_file_id: number | null;
  waived: number;
  expertise_note: string | null;
  deductible: number;
  third_party: string | null;
  created_at: string;
}

export interface Expense {
  id: number;
  vehicle_id: number | null;
  category: string;
  amount: number;
  expense_date: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
}

/** Tüm ayarlar metin olarak saklanır. */
export interface Settings {
  company_name: string;
  company_phone: string;
  company_email: string;
  company_address: string;
  company_tax_no: string;
  company_tax_office: string;
  company_iban: string;
  currency: string;
  grace_hours: string;
  weekly_discount_pct: string;
  monthly_discount_pct: string;
  one_way_fee: string;
  fuel_price_per_eighth: string;
  fuel_price_per_liter: string;
  fuel_service_fee: string;
  cleaning_fee: string;
  min_driver_age: string;
  min_license_years: string;
  young_driver_age: string;
  young_driver_fee_daily: string;
  late_fee_mode: string;
  late_fee_multiplier: string;
  late_fee_hourly_pct: string;
  vat_rate: string;
  contract_terms: string;
  equipment_items: string;
  different_branch_fee: string;
  free_cancel_hours: string;
  cancel_fee_pct: string;
  no_show_fee_days: string;
  option_hours: string;
  hgs_service_fee: string;
  fine_service_fee: string;
  hgs_low_balance: string;
  deposit_hold_days: string;
  field_payment_limit: string;
  fine_discount_days: string;
  fine_limitation_days: string;
  kabis_mode: string;
  invoice_prefix: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  notify_auto: string;
  public_base_url: string;
}

export interface Quote {
  days: number;
  category: string | null;
  rate_source: 'plan' | 'list' | 'manual';
  rate_plan_id: number | null;
  rate_plan_name: string | null;
  channel: string | null;
  channel_markup_pct: number;
  channel_markup: number;
  young_driver_fee: number;
  coupon_id: number | null;
  coupon_code: string | null;
  coupon_discount: number;
  unlimited_km: boolean;
  deposit_rule: string | null;
  daily_rate: number;
  base_amount: number;
  long_term_discount_pct: number;
  long_term_discount: number;
  extras: LineItem[];
  extras_amount: number;
  one_way_fee: number;
  discount: number;
  total_amount: number;
  deposit_amount: number;
}

export interface Conflict {
  type: 'status' | 'reservation' | 'rental' | 'maintenance';
  id?: number;
  message: string;
}

export interface Finance {
  payment: number;
  refund: number;
  deposit_in: number;
  deposit_out: number;
  paid: number;
  deposit_held: number;
}

export interface RentalFinance extends Finance {
  total: number;
  balance: number;
}

/** Unknown JSON request body. */
export type Body = Record<string, unknown>;
