import type { Metadata } from 'next';
import { listBranches, listExtras } from '@/lib/domain/admin';
import { CATEGORIES, TRANSMISSIONS, getCustomer } from '@/lib/domain/fleet';
import { getReservation } from '@/lib/domain/bookings';
import { flat, orNotFound, type SearchParams } from '@/lib/page';
import { PageHead } from '@/components/ui';
import { BookingForm } from '@/components/BookingForm';

export const metadata: Metadata = { title: 'Yeni kiralama / rezervasyon' };

export default async function BookingPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await flat(searchParams);
  const editing = q.reservation_id ? orNotFound(() => getReservation(Number(q.reservation_id))) : null;
  const customerId = editing?.customer_id ?? (q.customer_id ? Number(q.customer_id) : null);
  // İstemciye yalnızca müşteri kartı + uygunluk uyarıları gönderilir.
  const customer = customerId
    ? (({ rentals: _r, reservations: _s, payments: _p, balance: _b, ...c }) => c)(orNotFound(() => getCustomer(customerId)))
    : null;
  return (
    <>
      <PageHead
        title={editing ? `Rezervasyon düzenle · ${editing.code}` : 'Yeni kiralama / rezervasyon'}
        sub="Tarih seçin, müsait aracı seçin, müşteriyi belirleyin ve kaydedin"
      />
      <BookingForm
        key={editing?.id ?? q.mode ?? 'new'}
        branches={listBranches()}
        extras={listExtras()}
        categories={CATEGORIES}
        transmissions={TRANSMISSIONS}
        editing={editing}
        initialMode={q.mode === 'rental' ? 'rental' : 'reservation'}
        initialVehicleId={q.vehicle_id ? Number(q.vehicle_id) : null}
        initialCustomer={customer}
      />
    </>
  );
}
