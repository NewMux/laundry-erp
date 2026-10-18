import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button, ErrorBox, Field, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [shopCode, setShopCode] = useState(() => {
    try {
      return localStorage.getItem('lms.shopCode') ?? '';
    } catch {
      return '';
    }
  });
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/forgot-password', { shopCode: shopCode || null, identifier });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('auth.forgotTitle')}>
      {sent ? (
        <p className="text-sm text-slate-700">{t('auth.forgotSent')}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-600">{t('auth.forgotIntro')}</p>
          <Field label={t('auth.shopCode')}>
            <Input value={shopCode} onChange={(e) => setShopCode(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="cleanpress" />
          </Field>
          <Field label={t('auth.identifier')}>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required autoFocus />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" size="lg" block loading={busy}>
            {t('auth.forgotSend')}
          </Button>
        </form>
      )}
      <p className="text-xs text-slate-500">{t('auth.forgotNoEmail')}</p>
      <p className="text-center text-sm">
        <Link to="/login" className="font-semibold text-brand-700 underline">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
