import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { DEFAULT_WORKING_HOURS, type WorkingHours } from '@laundry/shared';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Button, ErrorBox, Field, Input, Textarea } from '../../components/ui';
import { WorkingHoursEditor } from '../../components/WorkingHoursEditor';

export default function SignupPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [shop, setShop] = useState({ name: '', slug: '', crNumber: '', vatNumber: '', address: '', phone: '', email: '' });
  const [hours, setHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);
  const [owner, setOwner] = useState({ name: '', username: '', email: '', password: '' });
  const [template, setTemplate] = useState('standard');
  const [vatRate, setVatRate] = useState('10');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get('/api/onboarding/templates') });
  const slug = useDebounced(shop.slug, 400);
  const slugCheck = useQuery({
    queryKey: ['slug', slug],
    queryFn: () => api.get(`/api/onboarding/check-slug?slug=${encodeURIComponent(slug)}`),
    enabled: slug.length >= 3,
  });

  const setName = (name: string) => {
    setShop((s) => ({
      ...s,
      name,
      slug: slugTouched ? s.slug : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/onboarding/signup', {
        shop: { ...shop, email: shop.email || null, workingHours: hours },
        owner: { ...owner, email: owner.email || null },
        template,
        vatRate: Number(vatRate) || 0,
      });
      try {
        localStorage.setItem('lms.shopCode', shop.slug);
      } catch {
        /* ignore */
      }
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/settings/shop');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-100 px-4 py-8">
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t('signup.title')}</h1>
          <p className="text-sm text-slate-500">{t('signup.subtitle')}</p>
        </div>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">1. {t('signup.shop')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('signup.shopName')}>
              <Input required value={shop.name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label={t('signup.shopCode')}
              hint={
                slug.length >= 3 && slugCheck.data ? (
                  <span className={clsx('flex items-center gap-1', slugCheck.data.available ? 'text-emerald-600' : 'text-rose-600')}>
                    {slugCheck.data.available ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                    {slugCheck.data.available ? t('signup.available') : t('signup.taken')}
                  </span>
                ) : (
                  t('signup.shopCodeHint')
                )
              }
            >
              <Input
                required
                value={shop.slug}
                autoCapitalize="none"
                onChange={(e) => {
                  setSlugTouched(true);
                  setShop({ ...shop, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
                }}
              />
            </Field>
            <Field label={t('signup.crNumber')}>
              <Input value={shop.crNumber} onChange={(e) => setShop({ ...shop, crNumber: e.target.value })} />
            </Field>
            <Field label={t('signup.vatNumber')}>
              <Input value={shop.vatNumber} onChange={(e) => setShop({ ...shop, vatNumber: e.target.value })} />
            </Field>
            <Field label={t('signup.phone')}>
              <Input type="tel" value={shop.phone} onChange={(e) => setShop({ ...shop, phone: e.target.value })} />
            </Field>
            <Field label={t('signup.email')}>
              <Input type="email" value={shop.email} onChange={(e) => setShop({ ...shop, email: e.target.value })} />
            </Field>
            <Field label={t('signup.vatRate')}>
              <Input inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
            </Field>
          </div>
          <Field label={t('signup.address')}>
            <Textarea value={shop.address} onChange={(e) => setShop({ ...shop, address: e.target.value })} />
          </Field>
          <div>
            <div className="label">{t('signup.workingHours')}</div>
            <WorkingHoursEditor value={hours} onChange={setHours} />
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">2. {t('signup.owner')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('signup.ownerName')}>
              <Input required value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} />
            </Field>
            <Field label={t('signup.username')}>
              <Input required autoCapitalize="none" value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value.toLowerCase() })} />
            </Field>
            <Field label={t('signup.email')}>
              <Input type="email" value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} />
            </Field>
            <Field label={t('signup.password')}>
              <Input type="password" required minLength={8} autoComplete="new-password" value={owner.password} onChange={(e) => setOwner({ ...owner, password: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">3. {t('signup.priceList')}</h2>
          <p className="text-sm text-slate-500">{t('signup.templateHint')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(templates.data?.templates ?? []).map((tp: { key: string; name: string; items: number }) => (
              <button
                type="button"
                key={tp.key}
                onClick={() => setTemplate(tp.key)}
                className={clsx('rounded-xl border p-3 text-left transition', template === tp.key ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50')}
              >
                <div className="text-sm font-semibold">{tp.name}</div>
                <div className="text-xs text-slate-500">{t('signup.items', { count: tp.items })}</div>
              </button>
            ))}
          </div>
        </section>

        <ErrorBox error={error} />
        <Button type="submit" size="lg" block loading={busy}>
          {t('signup.create')}
        </Button>
        <p className="text-center text-sm text-slate-600">
          <Link to="/login" className="font-semibold text-brand-700 underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </form>
    </div>
  );
}
