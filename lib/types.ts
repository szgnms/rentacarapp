export type Role = 'admin' | 'staff';
export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'out_of_service';
export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'converted';
export type RentalStatus = 'active' | 'completed' | 'cancelled';
export type PaymentType = 'payment' | 'refund' | 'deposit_in' | 'deposit_out';
export type PaymentMethod = 'cash' | 'credit_card' | 'bank_transfer' | 'deposit';
export type ChargeType = 'late_return' | 'extra_km' | 'fuel' | 'damage' | 'cleaning' | 'traffic_fine' | 'hgs' | 'other';
export type MaintenanceType = 'periodic' | 'repair' | 'tire' | 'inspection' | 'damage_repair' | 'other';
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type Severity = 'minor' | 'moderate' | 'major';
export type DamageStatus = 'open' | 'repaired' | 'closed';

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
}

export interface User extends SessionUser {
  active: number;
  created_at: string;
}

export interface Branch {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  active: number;
}

export interface Extra {
  id: number;
  name: string;
  price_type: 'daily' | 'per_rental';
  price: number;
  max_price: number | null;
  active: number;
}

export interface Vehicle {
  id: number;
  plate: string;
  brand: string;
  model: string;
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
  discount: number;
  total_amount: number;
  deposit_amount: number;
  created_by: number | null;
  created_at: string;
}

export interface Reservation extends PricedBooking {
  code: string;
  return_at: string;
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

export interface Settings {
  company_name: string;
  company_phone: string;
  company_address: string;
  company_tax_no: string;
  currency: string;
  grace_hours: string;
  weekly_discount_pct: string;
  monthly_discount_pct: string;
  one_way_fee: string;
  fuel_price_per_eighth: string;
  min_driver_age: string;
  min_license_years: string;
  late_fee_multiplier: string;
  vat_rate: string;
  contract_terms: string;
}

export interface Quote {
  days: number;
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
