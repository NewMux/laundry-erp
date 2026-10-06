import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, BookUser, Clock, CreditCard, Landmark, Smartphone, Trash2, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { fromFils, toFils } from '@laundry/shared';
import { money, parseMoney } from '../lib/format';
import { Button, MoneyInput, Modal } from './ui';

export type PayMethod = 'CASH' | 'CARD' | 'BENEFIT_PAY' | 'WALLET' | 'BANK_TRANSFER';
export interface PaymentLine {
  method: PayMethod;
  amount: string;
}

export interface PaymentResult {
  payments: { method: PayMethod; amount: number }[];
  onAccount: boolean;
}

/**
 * Payment at the counter: cash (with change), card, BenefitPay, customer
 * balance, credit account, split payments, or pay later.
 */
export function PaymentModal({
  open,
  onClose,
  due,
  walletBalance,
  creditAvailable,
  allowLater = true,
  allowAccount = false,
  loading,
  onConfirm,
  title,
}: {
  open: boolean;
  onClose: () => void;
  due: number;
  walletBalance?: number | null;
  /** null = credit account without limit; undefined = no credit account */
  creditAvailable?: number | null;
  allowLater?: boolean;
  allowAccount?: boolean;
  loading?: boolean;
  onConfirm: (r: PaymentResult) => void;
  title?: string;
}) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [tendered, setTendered] = useState('');
  const [onAccount, setOnAccount] = useState(false);

  useEffect(() => {
    if (open) {
      setLines([]);
      setTendered('');
      setOnAccount(false);
    }
  }, [open]);

  const paid = useMemo(() => fromFils(lines.reduce((s, l) => s + toFils(parseMoney(l.amount)), 0)), [lines]);
  const remaining = fromFils(Math.max(0, toFils(due) - toFils(paid)));
  const over = toFils(paid) > toFils(due);
  const cashLine = lines.find((l) => l.method === 'CASH');
  const change = cashLine && tendered ? fromFils(toFils(parseMoney(tendered)) - toFils(parseMoney(cashLine.amount))) : 0;
  const walletUsed = lines.filter((l) => l.method === 'WALLET').reduce((s, l) => s + parseMoney(l.amount), 0);
  const walletOver = walletBalance !== undefined && walletBalance !== null && walletUsed > walletBalance + 0.0005;

  const add = (method: PayMethod) => {
    setOnAccount(false);
    setLines((ls) => {
      const existing = ls.find((l) => l.method === method);
      let amount = remaining;
      if (method === 'WALLET' && walletBalance !== null && walletBalance !== undefined) amount = Math.min(remaining, walletBalance);
      if (existing) return ls;
      if (amount <= 0 && ls.length) return ls;
      return [...ls, { method, amount: amount.toFixed(3) }];
    });
  };

  const methods: { m: PayMethod; label: string; icon: React.ReactNode; show: boolean }[] = [
    { m: 'CASH', label: t('payment.cash'), icon: <Banknote className="size-6" />, show: true },
    { m: 'CARD', label: t('payment.card'), icon: <CreditCard className="size-6" />, show: true },
    { m: 'BENEFIT_PAY', label: t('payment.benefit'), icon: <Smartphone className="size-6" />, show: true },
    { m: 'WALLET', label: t('payment.wallet'), icon: <Wallet className="size-6" />, show: (walletBalance ?? 0) > 0 },
    { m: 'BANK_TRANSFER', label: t('payment.bankTransfer'), icon: <Landmark className="size-6" />, show: false },
  ];

  const accountOk = allowAccount && creditAvailable !== undefined && (creditAvailable === null || creditAvailable >= remaining - 0.0005);
  const canConfirm = !over && !walletOver && (remaining === 0 || onAccount || allowLater) && !(cashLine && tendered && change < 0);

  const confirm = () => {
    onConfirm({
      payments: lines.map((l) => ({ method: l.method, amount: parseMoney(l.amount) })).filter((p) => p.amount > 0),
      onAccount,
    });
  };

  const quick = [0.5, 1, 5, 10, 20];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t('payment.title')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="lg" variant="success" loading={loading} disabled={!canConfirm} onClick={confirm}>
            {remaining > 0 && !onAccount && lines.length === 0 ? t('pos.payLater') : t('payment.confirm')}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-end justify-between gap-4 rounded-xl bg-slate-900 px-5 py-4 text-white">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-300">{t('payment.due')}</div>
          <div className="text-3xl font-bold tabular-nums">BHD {money(due)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-slate-300">{t('payment.remaining')}</div>
          <div className={clsx('text-xl font-semibold tabular-nums', remaining > 0 ? 'text-amber-300' : 'text-emerald-300')}>{money(remaining)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {methods
          .filter((m) => m.show)
          .map((m) => (
            <button
              key={m.m}
              onClick={() => add(m.m)}
              className={clsx(
                'flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-sm font-semibold transition',
                lines.some((l) => l.method === m.m) ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {m.icon}
              {m.label}
              {m.m === 'WALLET' && <span className="text-[11px] font-normal text-slate-500">{t('payment.walletAvailable', { amount: money(walletBalance) })}</span>}
            </button>
          ))}
        {accountOk && (
          <button
            onClick={() => {
              setOnAccount((v) => !v);
            }}
            className={clsx(
              'flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-sm font-semibold transition',
              onAccount ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 hover:bg-slate-50',
            )}
          >
            <BookUser className="size-6" />
            {t('payment.account')}
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <div className="mt-4 space-y-2">
          {lines.map((l, i) => (
            <div key={l.method} className="flex items-center gap-2">
              <div className="w-36 shrink-0 text-sm font-medium">{t(`paymentMethod.${l.method}`)}</div>
              <div className="flex-1">
                <MoneyInput value={l.amount} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              </div>
              <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          {remaining > 0 && lines.length > 0 && <p className="text-xs text-slate-500">{t('payment.split')}: {t('payment.addPayment')} ↑</p>}
        </div>
      )}

      {cashLine && (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{t('payment.tendered')}</span>
            <span className={clsx('text-sm font-semibold', change < 0 ? 'text-rose-600' : 'text-emerald-700')}>
              {t('payment.change')}: BHD {money(Math.max(0, change))}
            </span>
          </div>
          <MoneyInput value={tendered} onChange={setTendered} placeholder={cashLine.amount} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setTendered(cashLine.amount)}>
              {t('payment.exact')}
            </Button>
            {quick.map((q) => (
              <Button key={q} size="sm" variant="secondary" onClick={() => setTendered(q.toFixed(3))}>
                {q}
              </Button>
            ))}
          </div>
        </div>
      )}

      {onAccount && <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">{t('payment.onAccountHint')}</p>}
      {!onAccount && lines.length === 0 && allowLater && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Clock className="size-4" /> {t('pos.payLater')}
        </p>
      )}
      {over && <p className="mt-3 text-sm text-rose-600">{t('payment.remaining')}: −{money(fromFils(toFils(paid) - toFils(due)))}</p>}
    </Modal>
  );
}
