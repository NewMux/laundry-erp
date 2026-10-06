import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Delete, KeyRound, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { Button, ErrorBox, Field, Input } from '../../components/ui';

const SHOP_KEY = 'lms.shopCode';

function readShop() {
  try {
    return localStorage.getItem(SHOP_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function LoginPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const pinUsers = useQuery({ queryKey: ['pin-users'], queryFn: () => api.get('/api/auth/pin-users') });
  const hasPinUsers = (pinUsers.data?.users?.length ?? 0) > 0;
  const [mode, setMode] = useState<'password' | 'pin'>(params.get('pin') ? 'pin' : 'password');
  useEffect(() => {
    if (hasPinUsers && params.get('pin')) setMode('pin');
  }, [hasPinUsers, params]);

  const [shopCode, setShopCode] = useState(readShop);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { shopCode: shopCode.trim() || null, identifier, password });
      try {
        if (shopCode.trim()) localStorage.setItem(SHOP_KEY, shopCode.trim().toLowerCase());
      } catch {
        /* storage unavailable */
      }
      await done();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/30">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="3" />
              <circle cx="12" cy="13" r="5" />
              <path d="M9 13.5c1-1 2-1 3 0s2 1 3 0" />
              <circle cx="8" cy="5.5" r=".8" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">{pinUsers.data?.tenant?.name ?? t('shell.productName')}</h1>
          <p className="text-sm text-white/80">{t('auth.tagline')}</p>
        </div>
        <div className="card p-6 shadow-xl">
          {mode === 'pin' && hasPinUsers ? (
            <PinLogin users={pinUsers.data.users} onDone={done} onPassword={() => setMode('password')} />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h2 className="text-lg font-semibold">{t('auth.signIn')}</h2>
              <Field label={t('auth.shopCode')} hint={t('auth.shopCodeHint')}>
                <Input value={shopCode} onChange={(e) => setShopCode(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="cleanpress" />
              </Field>
              <Field label={t('auth.identifier')}>
                <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required autoFocus />
              </Field>
              <Field label={t('auth.password')}>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </Field>
              <ErrorBox error={error} />
              <Button type="submit" size="lg" block loading={busy}>
                {t('auth.signIn')}
              </Button>
              {hasPinUsers && (
                <Button variant="ghost" block icon={<KeyRound className="size-4" />} onClick={() => setMode('pin')}>
                  {t('auth.switchToPin')}
                </Button>
              )}
              <p className="text-center text-xs text-slate-500">{t('auth.forgot')}</p>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-white/90">
          {t('auth.noAccount')}{' '}
          <Link to="/signup" className="font-semibold underline">
            {t('auth.startTrial')}
          </Link>
        </p>
      </div>
    </div>
  );
}

function PinLogin({ users, onDone, onPassword }: { users: { id: string; name: string; role: string }[]; onDone: () => Promise<void>; onPassword: () => void }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<{ id: string; name: string } | null>(users.length === 1 ? users[0] : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length !== 4 || !user) return;
    setBusy(true);
    setError(null);
    api
      .post('/api/auth/pin', { userId: user.id, pin })
      .then(onDone)
      .catch((e) => {
        setError(e);
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, user, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!user) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);

  if (!user) {
    return (
      <div>
        <h2 className="mb-1 text-lg font-semibold">{t('auth.switchToPin')}</h2>
        <p className="mb-4 text-sm text-slate-500">{t('auth.choosePin')}</p>
        <div className="grid grid-cols-2 gap-2">
          {users.map((u) => (
            <button key={u.id} onClick={() => setUser(u)} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100">
                <UserRound className="size-5 text-slate-600" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold bidi">{u.name}</div>
                <div className="truncate text-xs text-slate-500">{u.role}</div>
              </div>
            </button>
          ))}
        </div>
        <Button variant="ghost" block className="mt-4" onClick={onPassword}>
          {t('auth.usePassword')}
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <button className="mb-1 text-sm text-brand-700 underline" onClick={() => { setUser(null); setPin(''); }}>
        {t('common.back')}
      </button>
      <h2 className="text-lg font-semibold bidi">{t('auth.enterPin', { name: user.name })}</h2>
      <div className="my-5 flex justify-center gap-3">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={clsx('size-4 rounded-full border-2 border-brand-600', pin.length > i && 'bg-brand-600')} />
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="mx-auto mt-3 grid max-w-[260px] grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
          k === '' ? (
            <span key="blank" />
          ) : (
            <button
              key={k}
              disabled={busy}
              onClick={() => (k === 'del' ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 4 ? p + k : p)))}
              className="grid h-16 place-items-center rounded-2xl bg-slate-100 text-2xl font-semibold text-slate-800 transition hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50"
            >
              {k === 'del' ? <Delete className="size-6" /> : k}
            </button>
          ),
        )}
      </div>
      <Button variant="ghost" block className="mt-4" onClick={onPassword}>
        {t('auth.usePassword')}
      </Button>
    </div>
  );
}
