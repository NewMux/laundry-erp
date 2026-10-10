import { useTranslation } from 'react-i18next';
import { MapPin, Store, Truck } from 'lucide-react';
import { Badge } from './ui';

/** Pickup / delivery details stored on an order (customer app). */
export interface HandoverInfo {
  source?: 'COUNTER' | 'APP';
  appRef?: string | null;
  inbound?: 'DROPOFF' | 'PICKUP';
  outbound?: 'COLLECT' | 'DELIVERY';
  handoverStatus?: 'AWAITING_DROPOFF' | 'AWAITING_PICKUP' | 'PICKUP_EN_ROUTE' | 'OUT_FOR_DELIVERY' | null;
  pickupSlot?: Slot | null;
  deliverySlot?: Slot | null;
  address?: Address | null;
}
interface Slot {
  date: string;
  label: { en: string; ar: string };
  startHour?: number;
  endHour?: number;
}
interface Address {
  label: string;
  area: string;
  block: string;
  road: string;
  building: string;
  flat?: string;
  notes?: string;
  geo?: { lat: number; lng: number };
}

export const usesDriver = (o: HandoverInfo) => o.inbound === 'PICKUP' || o.outbound === 'DELIVERY';

const hours = (s: Slot) => (s.startHour !== undefined && s.endHour !== undefined ? ` ${String(s.startHour).padStart(2, '0')}:00–${String(s.endHour % 24).padStart(2, '0')}:00` : '');

export function slotText(s: Slot | null | undefined): string {
  if (!s) return '—';
  const d = new Date(`${s.date}T12:00:00+03:00`);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bahrain' });
  return `${day} · ${s.label.en}${hours(s)}`;
}

export function addressText(a: Address): string {
  return [a.area, `Block ${a.block}`, `Road ${a.road}`, `Building ${a.building}`, a.flat ? `Flat ${a.flat}` : ''].filter(Boolean).join(', ');
}

export function mapLink(a: Address): string {
  const q = a.geo ? `${a.geo.lat},${a.geo.lng}` : `${addressText(a)}, Bahrain`;
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
}

/** "App · Pickup booked" style badge for lists. */
export function HandoverBadge({ o }: { o: HandoverInfo }) {
  const { t } = useTranslation();
  if (o.handoverStatus) return <Badge color={o.handoverStatus === 'PICKUP_EN_ROUTE' || o.handoverStatus === 'OUT_FOR_DELIVERY' ? 'blue' : 'purple'}>{t(`handover.status.${o.handoverStatus}`)}</Badge>;
  if (o.source === 'APP') return <Badge color="purple">{t('handover.app')}</Badge>;
  return null;
}

/** The two legs, their windows, and where the driver goes. */
export function HandoverDetails({ o, compact }: { o: HandoverInfo; compact?: boolean }) {
  const { t } = useTranslation();
  const leg = (driver: boolean, label: string, slot: Slot | null | undefined) => (
    <div className="flex items-start gap-2">
      {driver ? <Truck className="mt-0.5 size-4 shrink-0 text-brand-600" /> : <Store className="mt-0.5 size-4 shrink-0 text-slate-400" />}
      <div>
        <div className="font-medium">{label}</div>
        {driver && <div className="text-slate-600">{slotText(slot)}</div>}
      </div>
    </div>
  );
  return (
    <div className="space-y-2 text-sm">
      {leg(o.inbound === 'PICKUP', o.inbound === 'PICKUP' ? t('handover.pickup') : t('handover.dropoff'), o.pickupSlot)}
      {leg(o.outbound === 'DELIVERY', o.outbound === 'DELIVERY' ? t('handover.delivery') : t('handover.collect'), o.deliverySlot)}
      {usesDriver(o) && o.address && (
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <div className="min-w-0">
            <div className="font-medium bidi">{o.address.label}</div>
            <div className="text-slate-600 bidi">{addressText(o.address)}</div>
            {o.address.notes && <div className="text-amber-800 bidi">{t('handover.driverNotes')}: {o.address.notes}</div>}
            {!compact && (
              <a className="text-brand-700 hover:underline" href={mapLink(o.address)} target="_blank" rel="noreferrer">
                {o.address.geo ? t('handover.openPin') : t('handover.openMap')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
