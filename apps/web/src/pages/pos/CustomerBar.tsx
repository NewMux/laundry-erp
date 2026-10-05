import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookUser, Phone, UserPlus, UserRound, Wallet, X } from 'lucide-react';
import { normalizeMobile } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, phone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Badge, Button, ErrorBox, Input } from '../../components/ui';

export interface PosCustomer {
  id: string;
  name: string;
  mobile?: string;
  walletPaid: number;
  walletBonus: number;
  walletBalance: number;
  creditEnabled: boolean;
  creditLimit: number;
  creditAvailable: number | null;
  outstanding: number;
  packages: {
    id: string;
    name: string;
    kind: 'CREDIT' | 'ITEMS';
    itemTypeId: string | null;
    serviceTypeId: string | null;
    remainingItems: number;
    totalItems: number;
    status: string;
    expiresAt: string | null;
  }[];
}

export async function loadPosCustomer(id: string): Promise<PosCustomer> {
  const r = await api.get(`/api/customers/${id}`);
  return { ...r.customer, packages: r.packages };
}

/** Step 1 of an order: find the customer by mobile number, or create one inline. */
export function CustomerBar({
  customer,
  walkIn,
  onSelect,
  onWalkIn,
  onClear,
}: {
  customer: PosCustomer | null;
  walkIn: boolean;
  onSelect: (c: PosCustomer) => void;
  onWalkIn: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { hasCap } = useAuth();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.replace(/\D/g, ''), 200);
  const results = useQuery({
    queryKey: ['customer-lookup', dq],
    queryFn: () => api.get(`/api/customers/lookup?phone=${dq}`),
    enabled: dq.length >= 3 && !customer,
  });
  const list: { id: string; name: string; mobile?: string }[] = results.data?.customers ?? [];

  useEffect(() => {
    if (!customer && !walkIn) inputRef.current?.focus();
  }, [customer, walkIn]);
  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  const pick = async (id: string) => {
    setBusy(true);
    try {
      onSelect(await loadPosCustomer(id));
      setQ('');
      setCreating(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const onEnter = () => {
    const digits = q.replace(/\D/g, '');
    const exact = list.find((c) => c.mobile === normalizeMobile(digits));
    if (exact) return void pick(exact.id);
    if (list.length === 1 && digits.length >= 8) return void pick(list[0].id);
    if (digits.length >= 8) setCreating(true);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/customers', { name: name.trim(), mobile: q });
      await pick(r.customer.id);
      setName('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (customer) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-brand-700 shadow-sm">
          <UserRound className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold bidi">{customer.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {customer.mobile && hasCap('viewCustomerPhone') && <span>{phone(customer.mobile)}</span>}
            {customer.walletBalance > 0 && (
              <Badge color="green">
                <Wallet className="size-3" /> {money(customer.walletBalance)}
              </Badge>
            )}
            {customer.creditEnabled && (
              <Badge color="purple">
                <BookUser className="size-3" /> {t('pos.credit')}
              </Badge>
            )}
            {customer.packages.filter((p) => p.kind === 'ITEMS' && p.status === 'ACTIVE').map((p) => (
              <Badge key={p.id} color="brand">
                {p.name}: {p.remainingItems}
              </Badge>
            ))}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onClear}>
          {t('pos.changeCustomer')}
        </Button>
      </div>
    );
  }

  if (walkIn) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <UserRound className="size-5 text-slate-400" />
        <span className="flex-1 text-sm font-medium text-slate-600">{t('pos.walkInSelected')}</span>
        <Button size="sm" variant="secondary" onClick={onClear}>
          {t('pos.changeCustomer')}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Phone className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <Input
            ref={inputRef}
            type="tel"
            inputMode="tel"
            className="h-12 pl-10 text-lg"
            placeholder={t('pos.searchPhone')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCreating(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && onEnter()}
            aria-label={t('pos.customerPhone')}
          />
          {q && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setQ('')} aria-label={t('common.clear')}>
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button size="lg" variant="secondary" onClick={onWalkIn}>
          {t('pos.walkIn')}
        </Button>
      </div>

      {(list.length > 0 || (dq.length >= 8 && results.isSuccess) || creating) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {list.map((c) => (
            <button key={c.id} onClick={() => pick(c.id)} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50" disabled={busy}>
              <UserRound className="size-5 text-slate-400" />
              <span className="flex-1 font-medium bidi">{c.name}</span>
              {c.mobile && <span className="text-sm text-slate-500">{phone(c.mobile)}</span>}
            </button>
          ))}
          {!creating && dq.length >= 8 && !list.some((c) => c.mobile === normalizeMobile(dq)) && (
            <button onClick={() => setCreating(true)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-brand-700 hover:bg-brand-50">
              <UserPlus className="size-5" />
              <span className="font-semibold">{t('pos.newCustomer')}</span>
              <span className="text-sm text-slate-500">{phone(normalizeMobile(dq))}</span>
            </button>
          )}
          {creating && (
            <form
              className="space-y-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div className="text-sm font-semibold">
                {t('pos.newCustomer')} · {phone(normalizeMobile(q))}
              </div>
              <div className="flex gap-2">
                <Input ref={nameRef} className="h-11 bidi" placeholder={t('customers.name')} value={name} onChange={(e) => setName(e.target.value)} required />
                <Button type="submit" size="lg" loading={busy} disabled={!name.trim()}>
                  {t('pos.createCustomer')}
                </Button>
              </div>
              <ErrorBox error={error} />
            </form>
          )}
        </div>
      )}
      {!creating && <ErrorBox error={error} />}
    </div>
  );
}
