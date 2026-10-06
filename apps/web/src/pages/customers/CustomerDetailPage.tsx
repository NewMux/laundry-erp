import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, Banknote, FileText, MapPin, MessageCircle, Pencil, Plus, Printer, SlidersHorizontal, Undo2, Wallet } from 'lucide-react';
import { bhDate } from '@laundry/shared';
import { api, openFile, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, dateTime, money, phone } from '../../lib/format';
import { printTopup, reprintTopup } from '../../lib/print';
import { useCatalog } from '../../lib/catalog';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Stat, Tabs, Textarea } from '../../components/ui';
import { PaymentBadge, StatusBadge } from '../../components/orders';
import { useToast } from '../../components/toast';
import { CustomerFormModal } from './CustomerForm';

type Tab = 'orders' | 'wallet' | 'packages' | 'invoices';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can, hasCap, me, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('orders');
  const [dialog, setDialog] = useState<null | 'edit' | 'topup' | 'adjust' | 'refund' | 'settle' | 'statement'>(null);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api.get(`/api/customers/${id}`) });
  const orders = useQuery({ queryKey: ['customer-orders', id], queryFn: () => api.get(`/api/customers/${id}/orders`), enabled: tab === 'orders' });
  const wallet = useQuery({ queryKey: ['customer-wallet', id], queryFn: () => api.get(`/api/customers/${id}/wallet`), enabled: tab === 'wallet' });
  const outstanding = useQuery({ queryKey: ['customer-outstanding', id], queryFn: () => api.get(`/api/customers/${id}/outstanding`), enabled: tab === 'invoices' || dialog === 'settle' });
  const c = q.data?.customer;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['customer', id] });
    void qc.invalidateQueries({ queryKey: ['customer-wallet', id] });
    void qc.invalidateQueries({ queryKey: ['customer-outstanding', id] });
    void qc.invalidateQueries({ queryKey: ['customer-orders', id] });
  };

  const update = useMutation({
    mutationFn: (v: Record<string, unknown>) => api.patch(`/api/customers/${id}`, v),
    onSuccess: () => {
      toast.success(t('customers.saved'));
      setDialog(null);
      refresh();
    },
  });

  if (q.isLoading) return <Loading />;
  if (!c) return <div className="p-6"><ErrorBox error={q.error} /></div>;

  const balance = Number(c.walletPaid) + Number(c.walletBonus);
  const address = [
    c.addrFlat && `${t('customers.addrFlat')} ${c.addrFlat}`,
    c.addrBuilding && `${t('customers.addrBldg')} ${c.addrBuilding}`,
    c.addrHouse && `${t('customers.addrHouse')} ${c.addrHouse}`,
    c.addrRoad && `${t('customers.addrRoad')} ${c.addrRoad}`,
    c.addrBlock && `${t('customers.addrBlock')} ${c.addrBlock}`,
    c.addrArea,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {t('common.back')}
          </button>
        }
        title={<span className="bidi">{c.name}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.mobile && <span>{phone(c.mobile)}</span>}
            {c.type === 'COMPANY' && <Badge color="blue">{t('customers.COMPANY')}</Badge>}
            {c.creditEnabled && <Badge color="purple">{t('customers.credit')}</Badge>}
          </span>
        }
        actions={
          <>
            {can('pos', 'create') && !readOnly && (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/pos')}>
                {t('nav.pos')}
              </Button>
            )}
            {can('customers', 'edit') && !readOnly && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setDialog('edit')}>
                {t('common.edit')}
              </Button>
            )}
            <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => setDialog('statement')}>
              {t('customers.statement')}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('customers.totalSpent')} value={money(c.totalSpent)} sub={`${c.orders} ${t('customers.orders').toLowerCase()}`} />
        <Stat label={t('customers.wallet')} value={money(balance)} sub={Number(c.walletBonus) > 0 ? `${t('customers.bonusCredit')}: ${money(c.walletBonus)}` : undefined} tone={balance > 0 ? 'good' : 'default'} />
        <Stat label={t('customers.outstanding')} value={money(c.outstanding)} tone={c.outstanding > 0 ? 'bad' : 'default'} sub={c.creditEnabled && Number(c.creditLimit) > 0 ? `${t('customers.creditLimit')}: ${money(c.creditLimit)}` : undefined} />
        <Stat label={t('customers.lastVisit')} value={<span className="text-lg">{date(c.lastVisit) || '—'}</span>} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {can('wallet', 'create') && !readOnly && (
          <Button variant="success" icon={<Wallet className="size-4" />} onClick={() => setDialog('topup')}>
            {t('wallet.topup')}
          </Button>
        )}
        {can('wallet', 'edit') && !readOnly && (
          <Button variant="secondary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setDialog('adjust')}>
            {t('wallet.adjust')}
          </Button>
        )}
        {can('wallet', 'delete') && !readOnly && Number(c.walletPaid) > 0 && (
          <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setDialog('refund')}>
            {t('wallet.refund')}
          </Button>
        )}
        {c.outstanding > 0 && (can('pos', 'create') || can('delivery', 'create')) && !readOnly && (
          <Button variant="secondary" icon={<Banknote className="size-4" />} onClick={() => setDialog('settle')}>
            {t('customers.recordPayment')}
          </Button>
        )}
      </div>

      {(c.notes || address) && (
        <Card className="mb-4">
          {c.notes && <p className="text-sm text-slate-700 bidi">{c.notes}</p>}
          {address && (
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
              <MapPin className="size-4" /> {address}
              {c.mapUrl && (
                <a href={c.mapUrl} target="_blank" rel="noreferrer" className="ml-2 text-brand-700 underline">
                  {t('customers.map')}
                </a>
              )}
            </p>
          )}
        </Card>
      )}

      <Tabs
        className="mb-3"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'orders', label: t('customers.history') },
          { value: 'wallet', label: t('customers.transactions') },
          { value: 'packages', label: t('customers.packages'), count: q.data.packages.length },
          { value: 'invoices', label: t('customers.openInvoices') },
        ]}
      />

      {tab === 'orders' && (
        <div className="card overflow-x-auto">
          {orders.isLoading ? (
            <Loading />
          ) : !orders.data?.orders?.length ? (
            <Empty title={t('orders.noOrders')} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('orders.orderNo')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('orders.status')}</th>
                  <th className="num">{t('orders.pieces')}</th>
                  {hasCap('viewPrices') && <th className="num">{t('orders.total')}</th>}
                  {hasCap('viewPrices') && <th className="num">{t('orders.due')}</th>}
                  {hasCap('viewPrices') && <th>{t('orders.payment')}</th>}
                </tr>
              </thead>
              <tbody>
                {orders.data.orders.map((o: any) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/orders/${o.id}`)}>
                    <td className="font-bold">#{o.orderNo}</td>
                    <td>{dateTime(o.createdAt)}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="num">{o.pieceCount}</td>
                    {hasCap('viewPrices') && <td className="num">{money(o.total)}</td>}
                    {hasCap('viewPrices') && <td className="num">{Number(o.balanceDue) > 0 ? money(o.balanceDue) : '—'}</td>}
                    {hasCap('viewPrices') && (
                      <td>
                        <PaymentBadge state={o.paymentState} onAccount={o.onAccount} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'wallet' && (
        <div className="card overflow-x-auto">
          {wallet.isLoading ? (
            <Loading />
          ) : !wallet.data?.transactions?.length ? (
            <Empty title={t('common.noResults')} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.type')}</th>
                  <th>{t('common.reason')}</th>
                  <th className="num">{t('customers.paidCredit')}</th>
                  <th className="num">{t('customers.bonusCredit')}</th>
                  <th className="num">{t('common.balance')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wallet.data.transactions.map((x: any) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{dateTime(x.createdAt)}</td>
                    <td>{t(`wallet.types.${x.type}`)}</td>
                    <td className="text-slate-600 bidi">{x.reason}</td>
                    <td className={clsx('num', Number(x.paidDelta) < 0 && 'text-rose-600')}>{Number(x.paidDelta) ? money(x.paidDelta) : ''}</td>
                    <td className={clsx('num', Number(x.bonusDelta) < 0 && 'text-rose-600')}>{Number(x.bonusDelta) ? money(x.bonusDelta) : ''}</td>
                    <td className="num font-semibold">{money(Number(x.paidAfter) + Number(x.bonusAfter))}</td>
                    <td>
                      {x.paymentId && ['TOPUP', 'PACKAGE'].includes(x.type) && (
                        <button className="text-slate-500 hover:text-slate-800" onClick={() => reprintTopup(x.paymentId).catch(toast.error)} aria-label={t('common.reprint')}>
                          <Printer className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'packages' && (
        <div className="grid gap-3 md:grid-cols-2">
          {!q.data.packages.length ? (
            <div className="card md:col-span-2">
              <Empty title={t('wallet.noPackages')} />
            </div>
          ) : (
            q.data.packages.map((p: any) => (
              <div key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{p.name}</div>
                  <Badge color={p.status === 'ACTIVE' ? 'green' : 'gray'}>{t(`wallet.status.${p.status}`)}</Badge>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {p.kind === 'ITEMS' ? t('wallet.itemsLeft', { left: p.remainingItems, total: p.totalItems }) : `${t('customers.bonusCredit')}: ${money(p.bonusRemaining)} / ${money(p.bonusGranted)}`}
                </div>
                {p.kind === 'ITEMS' && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${(p.remainingItems / Math.max(1, p.totalItems)) * 100}%` }} />
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-500">
                  {date(p.createdAt)} · {money(p.pricePaid)}
                  {p.expiresAt && ` · ${t('wallet.expires', { date: date(p.expiresAt) })}`}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="card overflow-x-auto">
          {outstanding.isLoading ? (
            <Loading />
          ) : !outstanding.data?.orders?.length ? (
            <Empty title={t('common.noResults')} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('orders.orderNo')}</th>
                  <th>{t('common.date')}</th>
                  <th className="num">{t('orders.total')}</th>
                  <th className="num">{t('orders.paid')}</th>
                  <th className="num">{t('orders.due')}</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.data.orders.map((o: any) => (
                  <tr key={o.id}>
                    <td className="font-bold">
                      <Link to={`/orders/${o.id}`}>#{o.orderNo}</Link> {o.onAccount && <Badge color="purple">{t('orders.onAccount')}</Badge>}
                    </td>
                    <td>{date(o.createdAt)}</td>
                    <td className="num">{money(o.total)}</td>
                    <td className="num">{money(o.paidAmount)}</td>
                    <td className="num font-semibold text-rose-600">{money(o.balanceDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <CustomerFormModal open={dialog === 'edit'} initial={c} title={t('customers.edit')} onClose={() => setDialog(null)} onSubmit={(v) => update.mutate(v)} loading={update.isPending} error={update.error} />
      <TopupModal open={dialog === 'topup'} customer={c} shop={me?.tenant} onClose={() => setDialog(null)} onDone={refresh} />
      <AdjustModal open={dialog === 'adjust'} customerId={c.id} onClose={() => setDialog(null)} onDone={refresh} />
      <RefundModal open={dialog === 'refund'} customerId={c.id} max={Number(c.walletPaid)} onClose={() => setDialog(null)} onDone={refresh} />
      <SettleModal open={dialog === 'settle'} customerId={c.id} invoices={outstanding.data?.orders ?? []} onClose={() => setDialog(null)} onDone={refresh} />
      <StatementModal open={dialog === 'statement'} customer={c} onClose={() => setDialog(null)} />
    </div>
  );
}

function TopupModal({ open, customer, shop, onClose, onDone }: { open: boolean; customer: any; shop: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const catalog = useCatalog();
  const [packageId, setPackageId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const m = useMutation({
    mutationFn: () => api.post('/api/wallet/topup', { customerId: customer.id, method, packageId: packageId ?? undefined, amount: packageId ? undefined : Number(amount) }),
    onSuccess: async (r) => {
      toast.success(t('wallet.topupDone'));
      onDone();
      onClose();
      setAmount('');
      setPackageId(null);
      try {
        await printTopup(
          { name: shop?.name ?? '', address: shop?.address, phone: shop?.phone, vatNumber: shop?.vatNumber, crNumber: shop?.crNumber, logoUrl: shop?.logoFileId ? `/api/files/${shop.logoFileId}` : null },
          r.receipt,
          shop?.settings?.receipt,
        );
      } catch (e) {
        console.error('topup print failed', e);
      }
    },
    onError: (e) => toast.error(e),
  });
  const pkgs = (catalog.data?.packages ?? []).filter((p) => p.isActive);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.topupTitle')}
      footer={
        <Button variant="success" loading={m.isPending} disabled={!packageId && !(Number(amount) > 0)} onClick={() => m.mutate()}>
          {t('wallet.topup')}
        </Button>
      }
    >
      <div className="space-y-4">
        {pkgs.length > 0 && (
          <div>
            <div className="label">{t('wallet.package')}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {pkgs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPackageId(packageId === p.id ? null : p.id)}
                  className={clsx('rounded-xl border-2 p-3 text-left', packageId === p.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50')}
                >
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    BHD {money(p.price)} {p.kind === 'CREDIT' ? `→ ${money(p.creditValue)}` : `· ${t('common.itemsCount', { count: p.itemCount })}`}
                    {p.validityDays ? ` · ${t('common.daysShort', { count: p.validityDays })}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {!packageId && (
          <Field label={`${t('wallet.amount')}${pkgs.length ? ` (${t('wallet.orAmount')})` : ''}`}>
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </Field>
        )}
        <Field label={t('common.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER'].map((x) => (
              <option key={x} value={x}>
                {t(`paymentMethod.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ open, customerId, onClose, onDone }: { open: boolean; customerId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [paid, setPaid] = useState('');
  const [bonus, setBonus] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/api/wallet/adjust', { customerId, paidDelta: Number(paid) || 0, bonusDelta: Number(bonus) || 0, reason }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      onDone();
      onClose();
      setPaid('');
      setBonus('');
      setReason('');
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('wallet.adjust')} footer={<Button loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>{t('common.save')}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{t('wallet.adjustHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('wallet.paidDelta')}>
            <Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
          <Field label={t('wallet.bonusDelta')}>
            <Input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </Field>
        </div>
        <Field label={t('common.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function RefundModal({ open, customerId, max, onClose, onDone }: { open: boolean; customerId: string; max: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/api/wallet/refund', { customerId, amount: Number(amount), method, reason }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('wallet.refund')} footer={<Button variant="danger" loading={m.isPending} disabled={!(Number(amount) > 0) || reason.trim().length < 3} onClick={() => m.mutate()}>{t('wallet.refund')}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{t('wallet.refundHint')}</p>
        <Field label={`${t('wallet.amount')} (max ${money(max)})`}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label={t('common.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER'].map((x) => (
              <option key={x} value={x}>
                {t(`paymentMethod.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function SettleModal({ open, customerId, invoices, onClose, onDone }: { open: boolean; customerId: string; invoices: any[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const selectedDue = invoices.filter((i) => selected.includes(i.id)).reduce((s, i) => s + Number(i.balanceDue), 0);
  const totalDue = invoices.reduce((s, i) => s + Number(i.balanceDue), 0);
  const m = useMutation({
    mutationFn: () => api.post(`/api/customers/${customerId}/settle`, { amount: Number(amount), method, reference: reference || null, orderIds: selected.length ? selected : undefined }),
    onSuccess: (r) => {
      toast.success(`${t('payment.collected')} · ${r.receiptNo}`);
      onDone();
      onClose();
      setAmount('');
      setSelected([]);
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('customers.recordPayment')} footer={<Button loading={m.isPending} disabled={!(Number(amount) > 0)} onClick={() => m.mutate()}>{t('payment.confirm')}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">{t('customers.settleHint')}</p>
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {invoices.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <Checkbox checked={selected.includes(i.id)} onChange={(v) => setSelected((s) => (v ? [...s, i.id] : s.filter((x) => x !== i.id)))} />
              <span className="font-semibold">#{i.orderNo}</span>
              <span className="flex-1 text-slate-500">{date(i.createdAt)}</span>
              <span className="font-semibold tabular-nums">{money(i.balanceDue)}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAmount((selected.length ? selectedDue : totalDue).toFixed(3))}>
            {t('orders.due')}: {money(selected.length ? selectedDue : totalDue)}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('common.amount')}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label={t('common.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['BANK_TRANSFER', 'CASH', 'CARD', 'BENEFIT_PAY'].map((x) => (
                <option key={x} value={x}>
                  {t(`paymentMethod.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('payment.reference')}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function StatementModal({ open, customer, onClose }: { open: boolean; customer: any; onClose: () => void }) {
  const { t } = useTranslation();
  const { hasCap } = useAuth();
  const toast = useToast();
  const today = bhDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [type, setType] = useState<'credit' | 'wallet'>(customer.creditEnabled ? 'credit' : 'wallet');
  const share = async () => {
    try {
      const r = await api.get(`/api/documents/statement/${customer.id}/share${qs({ from, to, type })}`);
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('customers.statement')}
      footer={
        <>
          {hasCap('viewCustomerPhone') && (
            <Button variant="secondary" icon={<MessageCircle className="size-4 text-emerald-600" />} onClick={share}>
              {t('customers.shareStatement')}
            </Button>
          )}
          <Button icon={<FileText className="size-4" />} onClick={() => openFile(`/api/documents/statement/${customer.id}${qs({ from, to, type })}`)}>
            {t('common.exportPdf')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Tabs
          value={type}
          onChange={setType}
          tabs={[
            { value: 'credit', label: t('customers.statementCredit') },
            { value: 'wallet', label: t('customers.statementWallet') },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.from')}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('common.to')}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
